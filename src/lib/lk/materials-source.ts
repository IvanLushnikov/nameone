/**
 * Слой доступа к данным личного кабинета: решает, откуда брать материалы —
 * с сервера или с устройства — и никогда не оставляет учителя ни с пустым
 * экраном, ни с требованием войти.
 *
 * ГЛАВНОЕ ПРАВИЛО ТЗ-21: «сервер — усилитель, а не разрешение на использование».
 * Кабинет не имеет права показать пустоту или отказ там, где у учителя есть
 * данные в браузере. Отсюда три решения, каждое зафиксировано ниже:
 *
 *   1. ПРОВЕРКА СЕССИИ ДО ЗАПРОСА. Cookie `session` HttpOnly, из JS её не видно,
 *      поэтому сигналом «сессия есть» служит профиль в localStorage: его пишет
 *      `/auth/callback` после обмена magic-link на cookie. Нет профиля — запрос
 *      к серверу НЕ уходит вообще: анонимный учитель не видит ни мигания
 *      «Загрузка», ни ошибки в консоли.
 *
 *   2. СЕРВЕР УПАЛ → ДАННЫЕ С УСТРОЙСТВА. Любая ошибка (401, 5xx, обрыв сети)
 *      не блокирует показ: читаем localStorage и честно помечаем, что эти
 *      материалы хранятся только на этом устройстве. Экран «недоступно» с
 *      кнопкой «Попробовать ещё раз» показывается только когда показать
 *      нечего: сервер не ответил И на устройстве пусто.
 *
 *   3. ЧЕТЫРЕ СОСТОЯНИЯ НА КАЖДОЙ ВКЛАДКЕ: загрузка / недоступно / пусто /
 *      данные. Белого экрана не бывает ни в одном.
 */

import {
  fetchFavorites,
  fetchHistoryPage,
  fetchTemplates,
  HISTORY_PAGE_SIZE,
  type ServerFavorite,
  type ServerHistoryItem,
} from "./materials-api";
import {
  getFavorites,
  getHistory,
  getProfile,
  getTemplates,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import type { UserHistoryItem, UserTemplate } from "@/lib/types";
import type { HistoryItem, HistorySource, LoadState } from "./types";

/* ─── Сессия ──────────────────────────────────────────────────────────────── */

/**
 * Есть ли смысл вообще ходить на сервер.
 *
 * HttpOnly-cookie из JS не читается, поэтому ориентируемся на профиль: он
 * появляется в localStorage только после успешного входа (или демо-входа
 * локально). Пока профиля нет — пользователь анонимный, и его данные лежат
 * на устройстве.
 */
export function hasServerSession(): boolean {
  return getProfile() !== null;
}

/* ─── История ─────────────────────────────────────────────────────────────── */

export interface HistoryLoadResult {
  items: HistoryItem[];
  nextCursor: string | null;
  source: HistorySource;
  /** true = показаны данные с устройства, потому что сервер не ответил. */
  degraded: boolean;
  state: "data" | "empty" | "unavailable";
}

function historyFromDevice(): HistoryItem[] {
  return getHistory().map(toHistoryItem);
}

function historyFromServer(raw: ServerHistoryItem): HistoryItem {
  return {
    id: raw.id,
    title: raw.title,
    subject: raw.subject,
    grade: raw.grade,
    createdAt: raw.createdAt,
    type: raw.type,
    // Бэк жёстко отдаёт `type: "worksheet"` и не отдаёт размер, поэтому для
    // серверной истории размер и точный тип уточняются по `GET /api/worksheets/:id`
    // при открытии/скачивании (см. `src/lib/lk/artifact.ts`).
    count: null,
    topic: null,
    isFavorite: raw.isFavorite,
    source: "server",
  };
}

/** Приводит запись localStorage к общей модели карточки. */
export function toHistoryItem(item: UserHistoryItem): HistoryItem {
  const artifact = item.artifact;
  return {
    id: item.id,
    title: item.title,
    subject: item.subject,
    grade: item.grade ?? null,
    createdAt: item.createdAt,
    type: item.type,
    count: artifact ? countOfArtifact(artifact) : null,
    topic: artifact && "topic" in artifact ? artifact.topic : null,
    isFavorite: item.isFavorite,
    source: "device",
  };
}

/** Количество единиц содержания: задания / этапы / слайды / недели. */
export function countOfArtifact(artifact: unknown): number | null {
  const a = (artifact ?? {}) as Record<string, unknown>;
  for (const key of ["tasks", "stages", "slides", "weeks"]) {
    if (Array.isArray(a[key])) return (a[key] as unknown[]).length;
  }
  return null;
}

/**
 * Страница истории: 20 записей, «Показать ещё» докладывает следующую.
 *
 * Для анонимного источник — устройство, и «показать ещё» режет локальный
 * список (серверной пагинации для анонима не существует).
 */
export async function loadHistoryPage(params?: {
  cursor?: string | null;
  limit?: number;
}): Promise<HistoryLoadResult> {
  const limit = params?.limit ?? HISTORY_PAGE_SIZE;
  const offset = Number(params?.cursor ?? "0") || 0;

  if (!hasServerSession()) {
    const all = historyFromDevice();
    const page = all.slice(offset, offset + limit);
    const next = offset + limit < all.length ? String(offset + limit) : null;
    return {
      items: page,
      nextCursor: next,
      source: "device",
      degraded: false,
      state: page.length > 0 ? "data" : "empty",
    };
  }

  const res = await fetchHistoryPage({
    limit,
    cursor: params?.cursor && /^\d{4}-\d{2}-\d{2}T/.test(params.cursor)
      ? params.cursor
      : null,
  });

  if (res.ok) {
    const items = res.data.items.map(historyFromServer);
    return {
      items,
      nextCursor: res.data.nextCursor,
      source: "server",
      degraded: false,
      state: items.length > 0 ? "data" : "empty",
    };
  }

  // Сервер не дал данных — показываем устройство, а не отказ.
  const all = historyFromDevice();
  if (all.length === 0) {
    return {
      items: [],
      nextCursor: null,
      source: "device",
      degraded: true,
      state: "unavailable",
    };
  }
  const page = all.slice(offset, offset + limit);
  const next = offset + limit < all.length ? String(offset + limit) : null;
  return {
    items: page,
    nextCursor: next,
    source: "device",
    degraded: true,
    state: "data",
  };
}

/* ─── Избранное ───────────────────────────────────────────────────────────── */

export interface FavoritesLoadResult {
  items: FavoriteArtifact[];
  /** id записи избранного на сервере — нужен для DELETE. */
  remoteIds: Map<string, string>;
  source: HistorySource;
  degraded: boolean;
  state: "data" | "empty" | "unavailable";
}

export async function loadFavorites(): Promise<FavoritesLoadResult> {
  if (!hasServerSession()) {
    const items = getFavorites();
    return {
      items,
      remoteIds: new Map(),
      source: "device",
      degraded: false,
      state: items.length > 0 ? "data" : "empty",
    };
  }

  const res = await fetchFavorites();
  if (res.ok) {
    const items = res.data.map(favArtifact);
    const remoteIds = new Map(res.data.map((f: ServerFavorite) => [f.worksheetId, f.id]));
    return {
      items,
      remoteIds,
      source: "server",
      degraded: false,
      state: items.length > 0 ? "data" : "empty",
    };
  }

  const items = getFavorites();
  if (items.length === 0) {
    return {
      items: [],
      remoteIds: new Map(),
      source: "device",
      degraded: true,
      state: "unavailable",
    };
  }
  return {
    items,
    remoteIds: new Map(),
    source: "device",
    degraded: true,
    state: "data",
  };
}

/** Избранное с сервера — это полный лист; остальные типы с сервера не приходят. */
function favArtifact(fav: ServerFavorite): FavoriteArtifact {
  return { ...fav.worksheet, id: fav.worksheetId } as FavoriteArtifact;
}

/* ─── Шаблоны ─────────────────────────────────────────────────────────────── */

export interface TemplatesLoadResult {
  items: UserTemplate[];
  source: HistorySource;
  degraded: boolean;
  state: "data" | "empty" | "unavailable";
}

export async function loadTemplates(): Promise<TemplatesLoadResult> {
  if (!hasServerSession()) {
    const items = getTemplates();
    return {
      items,
      source: "device",
      degraded: false,
      state: items.length > 0 ? "data" : "empty",
    };
  }

  const res = await fetchTemplates();
  if (res.ok) {
    return {
      items: res.data,
      source: "server",
      degraded: false,
      state: res.data.length > 0 ? "data" : "empty",
    };
  }

  const items = getTemplates();
  if (items.length === 0) {
    return {
      items: [],
      source: "device",
      degraded: true,
      state: "unavailable",
    };
  }
  return { items, source: "device", degraded: true, state: "data" };
}

/* ─── Общее состояние вкладки ─────────────────────────────────────────────── */

export type { LoadState };

/** Первичное состояние до загрузки — чтобы вкладка не мигала «пусто». */
export const initialLoadState: LoadState<unknown> = { kind: "loading" };

/** Пометка «только на этом устройстве» — одна, ненавязчивая, в шапке кабинета. */
export const DEVICE_ONLY_NOTE =
  "Материалы хранятся только на этом устройстве. Войдите в аккаунт — они появятся на всех устройствах.";

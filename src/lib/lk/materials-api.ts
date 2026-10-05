/**
 * Клиент «серверных» ручек личного кабинета учителя: история, избранное,
 * шаблоны и чтение листа по id.
 *
 * Написан по образцу `src/lib/forms/api.ts` и `src/lib/worksheets/api.ts`:
 *   - типизированный union результата `{ ok: true, ... } | { ok: false, error }`;
 *   - наружу НИЧЕГО не бросает — вызывающий делает narrowing по `ok`;
 *   - `credentials: "include"` + `cache: "no-store"` на каждом запросе;
 *   - 401 / 404 / 5xx / обрыв сети разведены по разным веткам.
 *
 * Эндпоинты (бэк менять не нужно):
 *   GET    /api/users/history?limit&cursor   backend/src/routes/users.ts:109
 *   GET    /api/users/favorites              users.ts:132
 *   POST   /api/users/favorites              users.ts:138
 *   DELETE /api/users/favorites/:id          users.ts:152  (id записи избранного, НЕ id листа)
 *   GET    /api/users/templates              users.ts:160
 *   POST   /api/users/templates              users.ts:170
 *   DELETE /api/users/templates/:id          users.ts:187
 *   GET    /api/worksheets/:id               routes/worksheets.ts:248
 *
 * ВАЖНО, что сервер отдаёт и чего не отдаёт (учтено в нормализации ниже и в
 * отчёте по ТЗ-21):
 *   - `/api/users/history` жёстко проставляет `type: "worksheet"` для всех
 *     записей и НЕ отдаёт `count`. Поэтому размер и точный тип материала для
 *     серверной истории берутся из `GET /api/worksheets/:id` (см. `fetchArtifact`).
 *   - `/api/users/favorites` отдаёт полный payload листа в `items[].worksheet`.
 *   - `/api/users/history` не отдаёт `topic` отдельным полем, но `title` у бэка
 *     равен `title ?? topic`, поэтому поиск по теме работает по названию.
 */

import type { UserTemplate, Worksheet, SubjectSlug, Difficulty } from "@/lib/types";

const FALLBACK_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Базовый URL бэкенда, читается при каждом обращении, а не один раз при
 * загрузке модуля. Иначе переменная, выставленная позже (тесты, смена
 * окружения при hot-reload), молча дала бы «сервера нет» вместо запроса.
 */
function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? FALLBACK_API_URL;
}

/**
 * Ошибка кабинетного запроса. `unauthorized` — нет сессии (401),
 * `not_found` — 404, `network` — обрыв/оффлайн/нет NEXT_PUBLIC_API_URL,
 * `internal` — 5xx и прочие не-ok.
 */
export type MaterialsApiError =
  | "unauthorized"
  | "not_found"
  | "network"
  | "internal";

export type MaterialsApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MaterialsApiError };

/* ─── История ─────────────────────────────────────────────────────────────── */

/** Строка истории в том виде, как её отдаёт бэк. */
export interface ServerHistoryItem {
  id: string;
  type: string;
  title: string;
  subject: string;
  grade: number;
  createdAt: string;
  isFavorite: boolean;
}

export interface HistoryPage {
  items: ServerHistoryItem[];
  /** Курсор следующей страницы. null = страниц больше нет. */
  nextCursor: string | null;
}

export const HISTORY_PAGE_SIZE = 20;

/**
 * GET /api/users/history — страница истории, свежие сверху.
 *
 * `cursor` приходит с сервера как ISO-дата и уходит обратно тем же ISO —
 * бэк сам переводит его в unix-секунды.
 */
export async function fetchHistoryPage(params?: {
  limit?: number;
  cursor?: string | null;
}): Promise<MaterialsApiResult<HistoryPage>> {
  const limit = params?.limit ?? HISTORY_PAGE_SIZE;
  const search = new URLSearchParams({ limit: String(limit) });
  if (params?.cursor) search.set("cursor", params.cursor);

  const res = await request<{ items?: unknown; nextCursor?: unknown }>(
    `/api/users/history?${search.toString()}`,
  );
  if (!res.ok) return res;

  const items = Array.isArray(res.body?.items)
    ? (res.body.items as unknown[])
        .map(normalizeHistoryItem)
        .filter((x): x is ServerHistoryItem => x !== null)
    : [];
  const next =
    typeof res.body?.nextCursor === "string" ? res.body.nextCursor : null;
  return { ok: true, data: { items, nextCursor: next } };
}

/** Мягкая нормализация строки истории: мусорный бэк не должен ронять вкладку. */
function normalizeHistoryItem(raw: unknown): ServerHistoryItem | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  return {
    id: o.id,
    type: typeof o.type === "string" ? o.type : "worksheet",
    title: typeof o.title === "string" && o.title ? o.title : "Материал",
    subject: typeof o.subject === "string" ? o.subject : "",
    grade: typeof o.grade === "number" ? o.grade : 0,
    createdAt:
      typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
    isFavorite: o.isFavorite === true,
  };
}

/* ─── Полный артефакт по id ───────────────────────────────────────────────── */

/**
 * GET /api/worksheets/:id — полный артефакт (задания/этапы/слайды/недели).
 *
 * Для анонимно сохранённого листа (user_id IS NULL) бэк отдаёт его по id
 * без сессии. Для листа залогиненного учителя — только владельцу, иначе 404.
 */
export async function fetchArtifact(
  id: string,
): Promise<MaterialsApiResult<Record<string, unknown>>> {
  const res = await request<{ worksheet?: unknown }>(
    `/api/worksheets/${encodeURIComponent(id)}`,
  );
  if (!res.ok) return res;
  const ws = res.body?.worksheet;
  if (!ws || typeof ws !== "object") return { ok: false, error: "internal" };
  return { ok: true, data: ws as Record<string, unknown> };
}

/* ─── Избранное ───────────────────────────────────────────────────────────── */

export interface ServerFavorite {
  /** id записи в favorites — его ждёт DELETE /api/users/favorites/:id. */
  id: string;
  worksheetId: string;
  favoritedAt: string;
  /** Полный payload листа. */
  worksheet: Worksheet;
}

export async function fetchFavorites(): Promise<
  MaterialsApiResult<ServerFavorite[]>
> {
  const res = await request<{ items?: unknown }>("/api/users/favorites");
  if (!res.ok) return res;
  const items = Array.isArray(res.body?.items)
    ? (res.body.items as unknown[])
        .map(normalizeFavorite)
        .filter((x): x is ServerFavorite => x !== null)
    : [];
  return { ok: true, data: items };
}

function normalizeFavorite(raw: unknown): ServerFavorite | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const worksheet = o.worksheet as Worksheet | undefined;
  if (!worksheet || typeof worksheet !== "object") return null;
  const worksheetId =
    typeof o.worksheetId === "string"
      ? o.worksheetId
      : typeof worksheet.id === "string"
        ? worksheet.id
        : "";
  if (!worksheetId) return null;
  return {
    id: typeof o.id === "string" ? o.id : worksheetId,
    worksheetId,
    favoritedAt:
      typeof o.favoritedAt === "string"
        ? o.favoritedAt
        : new Date().toISOString(),
    worksheet: { ...worksheet, id: worksheet.id || worksheetId },
  };
}

/**
 * POST /api/users/favorites — добавить лист в избранное.
 *
 * Бэк принимает только рабочий лист (`{ worksheet: Worksheet }`) и сам
 * создаёт/обновляет запись в `worksheets`. Для остальных типов артефактов
 * серверной избранности нет — вызывающий обязан оставить запись на устройстве.
 */
export async function addFavoriteRemote(
  worksheet: Worksheet,
): Promise<MaterialsApiResult<{ favoriteId: string; worksheetId: string }>> {
  const res = await request<Record<string, unknown>>("/api/users/favorites", {
    method: "POST",
    body: JSON.stringify({ worksheet }),
  });
  if (!res.ok) return res;
  const obj = res.body ?? {};
  return {
    ok: true,
    data: {
      favoriteId:
        typeof obj.favoriteId === "string" ? obj.favoriteId : worksheet.id,
      worksheetId:
        typeof obj.worksheetId === "string" ? obj.worksheetId : worksheet.id,
    },
  };
}

/** DELETE /api/users/favorites/:id — `id` записи избранного (не id листа). */
export async function removeFavoriteRemote(
  favoriteId: string,
): Promise<MaterialsApiResult<true>> {
  const res = await request<unknown>(
    `/api/users/favorites/${encodeURIComponent(favoriteId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) return res;
  return { ok: true, data: true };
}

/* ─── Шаблоны ─────────────────────────────────────────────────────────────── */

/** Тело POST /api/users/templates — ровно то, что валидирует zod на бэке. */
export interface TemplateInput {
  name: string;
  subject: string;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  count: number;
}

export async function fetchTemplates(): Promise<
  MaterialsApiResult<UserTemplate[]>
> {
  const res = await request<{ templates?: unknown }>("/api/users/templates");
  if (!res.ok) return res;
  const list = Array.isArray(res.body?.templates)
    ? res.body.templates
    : [];
  const templates = (list as unknown[])
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.name !== "string") return null;
      return {
        id: o.id,
        name: o.name,
        subject: (typeof o.subject === "string"
          ? o.subject
          : "math") as SubjectSlug,
        grade: typeof o.grade === "number" ? o.grade : 0,
        topic: typeof o.topic === "string" ? o.topic : "",
        difficulty: (typeof o.difficulty === "string"
          ? o.difficulty
          : "medium") as Difficulty,
        count: typeof o.count === "number" ? o.count : 0,
      } as UserTemplate;
    })
    .filter((x): x is UserTemplate => x !== null);
  return { ok: true, data: templates };
}

export async function createTemplateRemote(
  input: TemplateInput,
): Promise<MaterialsApiResult<UserTemplate>> {
  const res = await request<{ template?: unknown }>("/api/users/templates", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) return res;
  const t = res.body?.template as Record<string, unknown> | undefined;
  if (!t || typeof t.id !== "string") {
    // Сервер не вернул созданный шаблон — отдаём то, что просили, с локальным id.
    return {
      ok: true,
      data: { ...input, id: `tpl_local_${Math.random().toString(36).slice(2, 10)}` } as UserTemplate,
    };
  }
  return {
    ok: true,
    data: {
      id: t.id,
      name: typeof t.name === "string" ? t.name : input.name,
      subject: (typeof t.subject === "string" ? t.subject : input.subject) as SubjectSlug,
      grade: typeof t.grade === "number" ? t.grade : input.grade,
      topic: typeof t.topic === "string" ? t.topic : input.topic,
      difficulty: (typeof t.difficulty === "string"
        ? t.difficulty
        : input.difficulty) as Difficulty,
      count: typeof t.count === "number" ? t.count : input.count,
    },
  };
}

export async function deleteTemplateRemote(
  id: string,
): Promise<MaterialsApiResult<true>> {
  const res = await request<unknown>(
    `/api/users/templates/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!res.ok) return res;
  return { ok: true, data: true };
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */

type RequestOk<T> = { ok: true; body: T };
type RequestResult<T> = RequestOk<T> | { ok: false; error: MaterialsApiError };

/**
 * Общий каркас запроса кабинета.
 *
 * Пустой `NEXT_PUBLIC_API_URL` — это не ошибка в интерфейсе, а «сервера нет»:
 * наружу уходит `network`, вызывающий читает устройство.
 */
async function request<T>(
  path: string,
  init?: { method?: string; body?: string },
): Promise<RequestResult<T>> {
  const base = apiUrl();
  if (!base) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init?.body,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  let body: Record<string, unknown> | null = null;
  if (init?.method && init.method !== "GET") {
    try {
      body = (await res.json()) as Record<string, unknown> | null;
    } catch {
      body = null;
    }
  } else if (res.status !== 204) {
    try {
      body = (await res.json()) as Record<string, unknown> | null;
    } catch {
      body = null;
    }
  }

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status >= 500) return { ok: false, error: "internal" };
  if (!res.ok) return { ok: false, error: "internal" };

  return { ok: true, body: (body ?? {}) as T };
}

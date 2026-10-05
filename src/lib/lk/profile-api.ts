/**
 * Настройки профиля учителя: имя, почта, «Мои классы», сессии (ТЗ-21, блок 5).
 *
 * Один из двух файлов, которые в `src/lib/lk/` принадлежат этому блоку.
 * Второй — `subscription-api.ts`. Общего `index.ts` здесь намеренно нет: соседний
 * блок ТЗ-21 (серверный слой кабинета) тоже пишет в этот каталог, и лишняя точка
 * входа только провоцирует конфликт импортов.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: УЧИТЕЛЬ БЕЗ АККАУНТА — ПОЛНОПРАВНЫЙ
 * ─────────────────────────────────────────────────────────────────────────────
 * Вход отключён флагом `MAGIC_LINK_READY` (домен не куплен, письма не ходят).
 * Это не блокер, и настройки не могут из-за этого стать недоступными. Поэтому
 * здесь ДВА равноправных источника, а не «сервер, а если нет — извините»:
 *
 *   1. УСТРОЙСТВО (localStorage) — работает всегда, с первого клика, без входа.
 *      Это не «заглушка на будущее»: учитель без аккаунта отмечает свои классы,
 *      и фильтр кабинета по классу работает у него так же, как у залогиненного.
 *   2. АККАУНТ (сервер) — усилитель. Появляются перенос между устройствами и
 *      подтверждение почты.
 *
 * Правила, из которых это следует:
 *   * сервер НИКОГДА не является условием показа данных — при обрыве связи
 *     показываем устройство, а не пустоту;
 *   * анонимный путь НЕ выглядит как «урезанный»: те же поля, те же кнопки,
 *     разница одна и она подписана честно («хранится на этом устройстве»);
 *   * при появлении сессии данные с сервера становятся источником правды, а
 *     устройство обновляется из них — чтобы следующий визит без сети тоже
 *     показал актуальные классы.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ИМЯ И ПОЧТА ЖИВУТ В `uchlist.profile`, А КЛАССЫ — ОТДЕЛЬНО
 * ─────────────────────────────────────────────────────────────────────────────
 * `uchlist.profile` уже читает шапка кабинета (`src/lib/utils/storage.ts`), и
 * переписывать его ключ было бы «улучшением», из-за которого имя учителя
 * пропало бы из шапки. Поэтому имя и почту пишем через существующие
 * `getProfile`/`setProfile`, а свои настройки (классы, класс по умолчанию) —
 * в отдельный ключ `uchlist.classes`. Файл `storage.ts` при этом не меняется.
 */

import { getProfile, setProfile } from "@/lib/utils/storage";
import { getCurrentUser } from "@/lib/auth/api";
import type { PlanId } from "@/lib/content/plans";
import type { UserProfile } from "@/lib/types";

/** Событие, которым настройки сообщают подписчикам об изменении (та же вкладка). */
export const LK_PROFILE_CHANGED_EVENT = "lk-profile-changed";

/** Ключи устройства. Свои настройки не смешиваем с чужими. */
const KEY_CLASSES = "uchlist.classes";

/** Сколько классов держим — зеркалит MAX_CLASSES в backend/src/services/account.ts. */
export const MAX_CLASSES = 12;

/* ────────────────────────────────────────────────────────────────────────────
 * Типы
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TeacherProfileView {
  name: string;
  email: string;
  classes: string[];
  /** Класс, который кабинет показывает по умолчанию. */
  defaultClass: string | null;
  /**
   * Откуда показанные данные. `device` = только это устройство, `account` = сервер.
   * Над этим значением строится честная подпись в интерфейсе.
   */
  source: "device" | "account";
  /** Почту из этого источника никто не проверял и никому не отправляли. */
  emailIsLocal: boolean;
  /** Незавершённый запрос смены почты (серверный источник). */
  pendingEmailChange: { newEmail: string; createdAt: number; expiresAt: number } | null;
}

export interface TeacherClass {
  id: string;
  createdAt: number;
}

export interface ServerSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  current: boolean;
}

export type ProfileApiError =
  | "network"
  | "unauthorized"
  | "not_found"
  | "validation"
  | "conflict"
  | "email_unavailable"
  | "internal";

export type LoadProfileResult =
  | { status: "ready"; view: TeacherProfileView }
  | { status: "loading" }
  | { status: "error"; error: ProfileApiError };

/* ────────────────────────────────────────────────────────────────────────────
 * Устройство: классы и класс по умолчанию
 * ──────────────────────────────────────────────────────────────────────────── */

function readJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Нормализация класса. Дубликат правила с серверной (`normalizeClasses` в
 * `backend/src/services/account.ts`): «5а» и «5А» — это один класс, иначе
 * фильтр в кабинете расползётся на «5А / 5а» и учитель ничего не найдёт.
 */
export function normalizeClassName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 16);
}

function normalizeClassList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = normalizeClassName(raw);
    if (!value) continue;
    const key = value.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_CLASSES) break;
  }
  return out;
}

/** Свои классы, отмеченные на этом устройстве. Всегда массив, никогда не undefined. */
export function getLocalClasses(): TeacherClass[] {
  if (typeof window === "undefined") return [];
  return readJson<TeacherClass[]>(window.localStorage.getItem(KEY_CLASSES), []).filter(
    (c) => typeof c?.id === "string" && c.id.length > 0,
  );
}

/** Имена классов строкой — так их удобно положить в фильтр кабинета. */
export function getClassNames(): string[] {
  return getLocalClasses().map((c) => c.id);
}

/**
 * Класс по умолчанию. Фильтр истории в кабинете открывается на нём.
 *
 * Хранится отдельно от списка, потому что это не «ещё один класс», а выбор
 * учителя: снял галочку с класса — фильтр должен перестать на него смотреть,
 * иначе он будет показывать пустую ленту.
 */
export function getDefaultClass(): string | null {
  if (typeof window === "undefined") return null;
  const names = getClassNames();
  const saved = window.localStorage.getItem(`${KEY_CLASSES}.default`);
  if (saved && names.some((n) => n.toLocaleLowerCase("ru") === saved.toLocaleLowerCase("ru"))) {
    return saved;
  }
  return null;
}

export function setDefaultClass(id: string | null): void {
  if (typeof window === "undefined") return;
  const value = id ? normalizeClassName(id) : "";
  if (value) {
    window.localStorage.setItem(`${KEY_CLASSES}.default`, value);
  } else {
    window.localStorage.removeItem(`${KEY_CLASSES}.default`);
  }
  notifyProfileChanged();
}

/** Добавить или убрать класс. Возвращает новый список — для рендера без чтения. */
export function toggleLocalClass(name: string): TeacherClass[] {
  const clean = normalizeClassName(name);
  if (!clean) return getLocalClasses();
  const current = getLocalClasses();
  const exists = current.some((c) => c.id.toLocaleLowerCase("ru") === clean.toLocaleLowerCase("ru"));
  const next = exists
    ? current.filter((c) => c.id.toLocaleLowerCase("ru") !== clean.toLocaleLowerCase("ru"))
    : [...current, { id: clean, createdAt: Date.now() }].slice(0, MAX_CLASSES);

  writeClasses(next);
  return next;
}

function writeClasses(classes: TeacherClass[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_CLASSES, JSON.stringify(classes));
  } catch {
    // Квота — тем более не повод терять настройки молча: оставляем старое.
  }
  notifyProfileChanged();
}

/**
 * Подписка на изменения настроек. Нужна фильтру кабинета: он открыт в другой
 * вкладке/на другой странице и должен узнать, что класс добавили, без перезагрузки.
 */
export function subscribeProfileChanges(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(LK_PROFILE_CHANGED_EVENT, handler);
  // `storage` срабатывает только между вкладками — своей вкладки он не касается.
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(LK_PROFILE_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function notifyProfileChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LK_PROFILE_CHANGED_EVENT));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Устройство: имя и почта
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Имя и почта на устройстве.
 *
 * Пишем через `setProfile` — тем же путём, которым шапка кабинета их читает.
 * Пустой профиль (учитель ещё не заходил) создаём минимальный: без этого
 * настройки были бы «единственным путём» к самому себе и требовали бы входа.
 */
export function saveLocalProfile(patch: { name?: string; email?: string }): TeacherProfileView {
  const current = getProfile();
  const plan: PlanId = current?.plan ?? "free";
  const profile: UserProfile = {
    id: current?.id ?? "usr_local",
    email: patch.email?.trim() ?? current?.email ?? "",
    name: patch.name?.replace(/\s+/g, " ").trim().slice(0, 120) ?? current?.name ?? "",
    plan,
    generationsTotal: current?.generationsTotal ?? 0,
    generationsToday: current?.generationsToday ?? 0,
    generationsLimit: current?.generationsLimit ?? 0,
    createdAt: current?.createdAt ?? new Date().toISOString(),
  };
  setProfile(profile);
  notifyProfileChanged();
  return deviceView();
}

/** Вид настроек, собранный из устройства. Источник — устройство, всегда. */
export function deviceView(): TeacherProfileView {
  const profile = getProfile();
  return {
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    classes: getClassNames(),
    defaultClass: getDefaultClass(),
    source: "device",
    // Честная подпись для интерфейса: без входа подтвердить адрес некому и
    // никто его не проверит. Сказать «почта подтверждена» здесь нельзя.
    emailIsLocal: true,
    pendingEmailChange: null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Сервер
 * ──────────────────────────────────────────────────────────────────────────── */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const ACCOUNT_BASE = "/api/account";

type ServerProfilePayload = {
  id: string;
  email: string;
  name: string;
  classes: string[];
  pendingEmailChange: { newEmail: string; createdAt: number; expiresAt: number } | null;
};

async function request<T>(
  path: string,
  init: { method: string; body?: string } = { method: "GET" },
): Promise<{ ok: true; body: T } | { ok: false; error: ProfileApiError }> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: init.body,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown> | null;
  } catch {
    body = null;
  }

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 409) return { ok: false, error: "conflict" };
  // 503 здесь — не «сервер сломался», а «письмо с подтверждением отправить
  // некому». Отдельная ветка, чтобы интерфейс не обещал письмо, которого нет.
  if (res.status === 503) return { ok: false, error: "email_unavailable" };
  if (res.status === 400) return { ok: false, error: "validation" };
  if (res.status >= 500) return { ok: false, error: "internal" };
  if (!res.ok) return { ok: false, error: "internal" };
  return { ok: true, body: (body ?? {}) as T };
}

export async function fetchServerProfile(): Promise<
  { ok: true; profile: ServerProfilePayload } | { ok: false; error: ProfileApiError }
> {
  const res = await request<{ profile?: ServerProfilePayload }>(`${ACCOUNT_BASE}/profile`);
  if (!res.ok) return res;
  if (!res.body.profile || typeof res.body.profile.email !== "string") {
    return { ok: false, error: "internal" };
  }
  return { ok: true, profile: res.body.profile };
}

export async function patchServerProfile(input: {
  name?: string;
  classes?: string[];
}): Promise<{ ok: true; profile: ServerProfilePayload } | { ok: false; error: ProfileApiError }> {
  const res = await request<{ profile?: ServerProfilePayload }>(`${ACCOUNT_BASE}/profile`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!res.ok) return res;
  if (!res.body.profile) return { ok: false, error: "internal" };
  return { ok: true, profile: res.body.profile };
}

export async function listServerSessions(): Promise<
  { ok: true; sessions: ServerSession[] } | { ok: false; error: ProfileApiError }
> {
  const res = await request<{ sessions?: unknown }>(`${ACCOUNT_BASE}/sessions`);
  if (!res.ok) return res;
  const sessions = Array.isArray(res.body.sessions) ? (res.body.sessions as ServerSession[]) : [];
  return { ok: true, sessions };
}

export async function revokeServerSession(
  id: string,
): Promise<{ ok: true } | { ok: false; error: ProfileApiError }> {
  const res = await request(`${ACCOUNT_BASE}/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) return res;
  return { ok: true };
}

/** Завершить все сессии, кроме текущей — «выйти на всех остальных устройствах». */
export async function revokeOtherServerSessions(): Promise<
  { ok: true; revoked: number } | { ok: false; error: ProfileApiError }
> {
  const res = await request<{ revoked?: number }>(`${ACCOUNT_BASE}/sessions`, { method: "DELETE" });
  if (!res.ok) return res;
  return { ok: true, revoked: typeof res.body.revoked === "number" ? res.body.revoked : 0 };
}

export async function requestEmailChange(
  newEmail: string,
): Promise<{ ok: true; newEmail: string; expiresAt: number } | { ok: false; error: ProfileApiError }> {
  const res = await request<{ newEmail?: string; expiresAt?: number }>(
    `${ACCOUNT_BASE}/email-change`,
    { method: "POST", body: JSON.stringify({ newEmail }) },
  );
  if (!res.ok) return res;
  return {
    ok: true,
    newEmail: typeof res.body.newEmail === "string" ? res.body.newEmail : newEmail,
    expiresAt: typeof res.body.expiresAt === "number" ? res.body.expiresAt : 0,
  };
}

export async function confirmEmailChange(
  id: string,
): Promise<{ ok: true; email: string } | { ok: false; error: ProfileApiError }> {
  const res = await request<{ email?: string }>(`${ACCOUNT_BASE}/email-change/confirm`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  if (!res.ok) return res;
  if (typeof res.body.email !== "string") return { ok: false, error: "internal" };
  return { ok: true, email: res.body.email };
}

export async function cancelEmailChangeRequest(): Promise<
  { ok: true } | { ok: false; error: ProfileApiError }
> {
  const res = await request(`${ACCOUNT_BASE}/email-change/cancel`, { method: "POST" });
  if (!res.ok) return res;
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Сборка вида настроек: устройство + сервер
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Собрать настройки для экрана.
 *
 * Порядок именно такой:
 *   1. мгновенно отдаём устройство — интерфейс никогда не мигает «Загрузка»;
 *   2. проверяем сессию ОДНИМ запросом (`/api/auth/me`); 401 — это не ошибка,
 *      а обычный анонимный случай, и второй запрос мы не делаем;
 *   3. если сессия есть — читаем профиль с сервера; при обрыве связи остаёмся
 *      на устройстве (учитель не теряет свои классы из-за сети).
 */
export async function loadProfile(): Promise<LoadProfileResult> {
  const local = deviceView();

  const user = await getCurrentUser();
  if (!user) return { status: "ready", view: local };

  const res = await fetchServerProfile();
  if (!res.ok) {
    // 401 после живого /me — сессия протухла между запросами. Показываем устройство.
    return { status: "ready", view: local };
  }

  const server = res.profile;
  const view: TeacherProfileView = {
    name: server.name || local.name,
    email: server.email,
    classes: normalizeClassList(server.classes),
    defaultClass:
      local.defaultClass &&
      normalizeClassList(server.classes).some(
        (c) => c.toLocaleLowerCase("ru") === local.defaultClass!.toLocaleLowerCase("ru"),
      )
        ? local.defaultClass
        : null,
    source: "account",
    emailIsLocal: false,
    pendingEmailChange: server.pendingEmailChange,
  };

  // Зеркалим на устройство: следующий визит без сети обязан показать то же
  // самое, а не пустые фильтры.
  writeClasses(view.classes.map((id) => ({ id, createdAt: Date.now() })));
  if (view.name || view.email) {
    const current = getProfile();
    setProfile({
      id: current?.id ?? user.id,
      email: view.email,
      name: view.name,
      plan: user.plan,
      generationsTotal: current?.generationsTotal ?? 0,
      generationsToday: current?.generationsToday ?? 0,
      generationsLimit: current?.generationsLimit ?? 0,
      createdAt: current?.createdAt ?? new Date().toISOString(),
    });
  }

  return { status: "ready", view };
}

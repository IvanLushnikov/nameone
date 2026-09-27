/**
 * Клиент /api/auth/* и /api/users/* для ЛК учителя.
 *
 * Используется из `src/app/login`, `src/app/auth/callback`, `src/components/layout/Header`
 * и т.п. (client components). Полагается на то, что cookie `session=<token>`
 * ставится бэком при первом успешном callback-е; дальше `credentials: "include"`
 * автоматически шлёт её с каждым запросом.
 *
 * URL бэка: NEXT_PUBLIC_API_URL — переменная окружения, доступная клиенту
 * на этапе сборки. Если не задана — функции вернут {ok:false,error:"..."}.
 *
 * Типы AuthUser — намеренно совпадают с тем, что возвращает /api/auth/callback
 * и /api/users/me. /api/auth/me возвращает только id/email/name/plan, без
 * generationsToday/Limit, поэтому эти поля опциональны.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  plan: "free" | "base" | "plus";
  generationsToday?: number;
  generationsLimit?: number;
  generationsTotal?: number;
  createdAt?: string;
}

export interface UsageInfo {
  generationsToday: number;
  generationsLimit: number;
  /** null если daily counter ни разу не инициализировался. */
  generationsResetAt: string | null;
  plan: AuthUser["plan"];
}

interface ApiOk {
  ok: true;
  [k: string]: unknown;
}
interface ApiErr {
  ok?: false;
  error?: string;
}

/**
 * POST /api/auth/magic-link — запросить magic link на email.
 *
 * Никогда не раскрывает, существует ли такой email (anti-enumeration).
 * Возвращает {ok:true} даже если email не дошёл (бэк логирует и шлёт 200).
 */
export async function requestMagicLink(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = (await postJson("/api/auth/magic-link", { email })) as
      | ApiOk
      | ApiErr;
    if (res.ok === true) return { ok: true };
    return {
      ok: false,
      error: (res as ApiErr).error ?? "Не удалось отправить ссылку",
    };
  } catch (err) {
    return {
      ok: false,
      error: humanError(err, "Не удалось отправить ссылку"),
    };
  }
}

/**
 * POST /api/auth/callback — обменять magic-link токен на session-cookie.
 *
 * На 200 OK возвращает {ok:true, user}. На 401/404 (просрочен или использован)
 * — {ok:false, error}. Бэк при успехе дополнительно ставит HttpOnly cookie
 * `session=<token>`, которую дальше использует /api/auth/me и /api/users/*.
 */
export async function verifyMagicLink(
  token: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  try {
    const res = (await postJson("/api/auth/callback", { token })) as
      | (ApiOk & { user: AuthUser })
      | ApiErr;
    if (res.ok === true && res.user) {
      return { ok: true, user: res.user };
    }
    return {
      ok: false,
      error:
        (res as ApiErr).error ?? "Ссылка истекла или уже использована",
    };
  } catch (err) {
    const isAuth = err instanceof AuthApiError && err.isAuthError;
    return {
      ok: false,
      error: isAuth
        ? "Ссылка истекла или уже использована"
        : humanError(err, "Не получилось подтвердить вход"),
    };
  }
}

/**
 * GET /api/auth/me — текущий пользователь (или null, если нет cookie).
 *
 * Не бросает: возвращает null при любой ошибке (нет сессии, сеть упала).
 * Удобно звать на mount для условного UI в Header-е.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await getJson<{ ok: true; user: AuthUser | null }>(
      "/api/auth/me",
    );
    return res.user ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/users/usage — лимит генераций на сегодня (light payload).
 *
 * Бросает, если юзер не залогинен (401). Caller должен сам решать,
 * показывать ли виджет лимита.
 */
export async function getUsage(): Promise<UsageInfo> {
  const res = await getJson<{ ok: true } & UsageInfo>("/api/users/usage");
  return {
    generationsToday: res.generationsToday,
    generationsLimit: res.generationsLimit,
    generationsResetAt: res.generationsResetAt ?? null,
    plan: res.plan,
  };
}

/**
 * POST /api/auth/logout — удалить server-side session и очистить cookie.
 *
 * Не бросает: даже если бэк недоступен, фронт всё равно почистит localStorage.
 */
export async function signOutFromApi(): Promise<void> {
  try {
    await postJson<{ ok: true }>("/api/auth/logout", {});
  } catch {
    /* network/offline — локальный signOut всё равно отработает */
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  return jsonFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

async function getJson<T = unknown>(path: string): Promise<T> {
  return jsonFetch<T>(path, { method: "GET" });
}

function humanError(err: unknown, fallback: string): string {
  if (err instanceof AuthApiError) return err.message || fallback;
  return fallback;
}

async function jsonFetch<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  if (!API_URL) {
    throw new AuthApiError(
      "NO_API_URL",
      "NEXT_PUBLIC_API_URL не задан",
      0,
    );
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new AuthApiError("NETWORK", "Сеть недоступна", 0);
  }
  const json = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    const err = (json as unknown as ApiErr | null) ?? {};
    throw new AuthApiError(
      `HTTP_${res.status}`,
      err.error ?? `HTTP ${res.status}`,
      res.status,
    );
  }
  return (json ?? ({} as T)) as T;
}

export class AuthApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
  /** true для 401/403 — токен истёк / невалиден / нет сессии. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
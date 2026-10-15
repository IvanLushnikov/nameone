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
  plan: "free" | "base" | "standard" | "plus";
  /**
   * Признак администратора — из `/api/auth/me` (ТЗ-24).
   *
   * Опциональный: `/api/auth/callback` и вход по паролю это поле не отдают,
   * и выдумывать его там нельзя — тогда охрана `/superpower` решила бы, что
   * админ вошёл, на самом деле не проверив. Неизвестно = не админ.
   */
  isAdmin?: boolean;
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

/**
 * Полный ответ /api/users/usage — зеркало `UsageStatus` + сигналы антифрода
 * из backend/src/routes/users.ts.
 *
 * Взвешенные токены — единица потребления, по которой считается норма
 * (backend/src/services/usage.ts). `over: true` означает «норма превышена»,
 * но НЕ «генерация заблокирована»: порог мягкий, генерация продолжается.
 */
export interface UsagePayload {
  plan: "free" | "base" | "standard" | "plus";
  /** Норма за окно в взвешенных токенах. null = тариф без нормы (free). */
  norm: number | null;
  weightedTokensUsed: number;
  over: boolean;
  remaining: number | null;
  periodEndsAt: string | null;
  /** Токены, переведённые в листы: понятная подпись для учителя. */
  worksheetsEquivalent: number;
  /** Остаток бесплатных генераций (3 всего). null у платных. */
  freeRemaining: number | null;
  /** Показать ли невидимый Turnstile: у отпечатка есть признаки фрода. */
  requiresChallenge: boolean;
  /** Старые поля — бэк их ещё отдаёт. */
  generationsToday: number;
  generationsLimit: number;
  generationsResetAt?: string | null;
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
 * Результат подтверждения ссылки из письма.
 *
 * Три состояния, а не два: у администратора с включённым кодом подтверждения
 * ссылка — это только ПЕРВЫЙ шаг. Сервер не выдаёт сессию и просит код
 * (15.10.2026: раньше выдавал, и второй фактор защищал только вход по паролю).
 */
export type MagicLinkResult =
  | { ok: true; user: AuthUser }
  | { ok: true; mfaRequired: true; pendingToken: string; message: string }
  | { ok: false; error: string };

/**
 * POST /api/auth/callback — обменять токен из письма на сессию.
 *
 * На 200 OK возвращает {ok:true, user} и ставит HttpOnly-cookie `session`,
 * которой дальше пользуются /api/auth/me и /api/users/*. Для администратора с
 * кодом подтверждения вместо этого приходит {ok:true, mfaRequired, pendingToken} —
 * тогда сессии ещё нет, и её выдаст /api/admin/totp/verify.
 *
 * На 401/404 (просрочен или использован) — {ok:false, error}.
 */
export async function verifyMagicLink(token: string): Promise<MagicLinkResult> {
  try {
    const res = (await postJson("/api/auth/callback", { token })) as
      | (ApiOk & {
          user?: AuthUser;
          mfaRequired?: unknown;
          pendingToken?: unknown;
          message?: unknown;
        })
      | ApiErr;
    if (res.ok === true && res.mfaRequired === true && typeof res.pendingToken === "string") {
      return {
        ok: true,
        mfaRequired: true,
        pendingToken: res.pendingToken,
        message:
          typeof res.message === "string"
            ? res.message
            : "Введите код из приложения-аутентификатора",
      };
    }
    if (res.ok === true && res.user) {
      return { ok: true, user: res.user };
    }
    return {
      ok: false,
      error:
        (res as ApiErr).error ?? "Ссылка для входа не сработала",
    };
  } catch (err) {
    const isAuth = err instanceof AuthApiError && err.isAuthError;
    return {
      ok: false,
      error: isAuth
        ? "Ссылка для входа не сработала"
        : humanError(err, "Не получилось подтвердить вход"),
    };
  }
}

/**
 * ЕДИНЫЙ текст отказа входа по паролю (контракт §2.2, ТЗ §6).
 *
 * Один и тот же — на «нет такого аккаунта» и «пароль не подошёл». Разные тексты
 * на эти два случая — та же утечка, что и предзапрос «есть ли пароль у этого
 * email» (ТЗ §3, разрыв 4): по тексту ответа проверяется, зарегистрирован ли
 * конкретный адрес. Текст бэка сюда не пробрасывается — собираем отказ в одном
 * месте на фронте, даже если бэк по ошибке пришлёт другое.
 */
export const LOGIN_REFUSED_TEXT =
  "Не получилось войти. Проверьте почту и пароль";

/**
 * Отказ по числу попыток (контракт §2.2). Причину не раскрывает — только факт,
 * поэтому общий для входа и для смены пароля.
 */
export const RATE_LIMITED_TEXT =
  "Слишком много попыток. Попробуйте через 15 минут";

/**
 * POST /api/auth/login — вход по паролю.
 *
 * Отказ всегда один и тот же: `LOGIN_REFUSED_TEXT` на 401/403 и на «200 с
 * ok:false». 429 — отдельный отказ, он тоже не различает причину. Сеть и
 * нечитаемый ответ отдаются своими текстами: они не сказали бэку ни слова об
 * этой почте, поэтому ничего о существовании аккаунта не выдают — а «проверьте
 * почту и пароль» в такой ситуамости сбило бы учителя с толку.
 */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<
  | { ok: true; user: AuthUser }
  // Второй шаг для администратора (ТЗ-24 §8.1): пароль верен, но сессия ещё
  // не выдана — нужен код из приложения. Почты в ответе нет намеренно: первый
  // шаг не должен подтверждать, что адрес зарегистрирован.
  | { ok: true; mfaRequired: true; pendingToken: string }
  | { ok: false; error: string }
> {
  try {
    const res = (await postJson("/api/auth/login", { email, password })) as
      | (ApiOk & { user: AuthUser; mfaRequired?: boolean; pendingToken?: string })
      | ApiErr;
    if (res.ok === true && res.mfaRequired === true && res.pendingToken) {
      return { ok: true, mfaRequired: true, pendingToken: res.pendingToken };
    }
    if (res.ok === true && res.user) return { ok: true, user: res.user };
    return { ok: false, error: LOGIN_REFUSED_TEXT };
  } catch (err) {
    return { ok: false, error: loginErrorText(err) };
  }
}

/**
 * POST /api/auth/password — задать пароль или сменить существующий.
 *
 * Смена требует `currentPassword` (ТЗ §5): иначе любой, кто открыл вкладку на
 * чужом компьютере, сменил бы пароль и остался внутри. Отказ на «нет сессии» и
 * на «неверный currentPassword» — один текст (контракт §5).
 *
 * `setAt` — единственный источник даты «Пароль задан …» (контракт §2.1), поэтому
 * он `string | null`: если бэк её не прислал, карточка обязана это обработать,
 * а не напечатать «Invalid Date».
 */
export async function setPassword(
  password: string,
  currentPassword?: string,
): Promise<{ ok: true; setAt: string | null } | { ok: false; error: string }> {
  try {
    const body: { password: string; currentPassword?: string } = { password };
    if (currentPassword !== undefined) body.currentPassword = currentPassword;
    const res = (await postJson("/api/auth/password", body)) as
      | (ApiOk & { setAt?: string })
      | ApiErr;
    if (res.ok === true) {
      return { ok: true, setAt: res.setAt ?? null };
    }
    return { ok: false, error: passwordSaveErrorText(res) };
  } catch (err) {
    return { ok: false, error: passwordSaveErrorText(err) };
  }
}

/**
 * DELETE /api/auth/password — убрать пароль.
 *
 * После этого работает только вход по ссылке из письма (ТЗ §12.6).
 */
export async function removePassword(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const res = (await deleteJson("/api/auth/password")) as ApiOk | ApiErr;
    if (res.ok === true) return { ok: true };
    return { ok: false, error: passwordRemoveErrorText(res) };
  } catch (err) {
    return { ok: false, error: passwordRemoveErrorText(err) };
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
 * GET /api/users/usage — остаток нормы тарифа (light payload).
 *
 * Бросает, если юзер не залогинен (401). Caller должен сам решать,
 * показывать ли виджет лимита.
 *
 * С 2026-10-02 отдаёт ВЗВЕШЕННЫЕ ТОКЕНЫ (единицу потребления) вместо
 * «генераций на сегодня»: сутки у тарифа больше не существует, а норма
 * считается в токенах Luna-эквивалента. Старые поля
 * (generationsToday/ResetAt) бэк ещё отдаёт — ломать их не стали.
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
 * Мягкая версия getUsage для UI: не бросает, а отдаёт null.
 *
 * Дашборд вызывает это на mount. Ошибка здесь не должна ломать профиль:
 * карточка нормы просто не рисуется, остальное работает как раньше.
 */
export async function fetchUsage(): Promise<UsagePayload | null> {
  try {
    const res = await getJson<{ ok: true } & UsagePayload>("/api/users/usage");
    return res as UsagePayload;
  } catch {
    return null;
  }
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

/** DELETE без тела — так отдаёт ручка снятия пароля (контракт §2). */
async function deleteJson<T = unknown>(path: string): Promise<T> {
  return jsonFetch<T>(path, { method: "DELETE" });
}

/** Сеть упала — про аккаунт бэк не узнал ничего, поэтому текст свой. */
const NETWORK_TEXT =
  "Нет связи с сервером. Проверьте подключение к интернету";

/** Бэк не настроен (нет NEXT_PUBLIC_API_URL) — учителю имя переменной не нужно. */
const NO_API_TEXT = "Вход недоступен. Попробуйте позже.";

/** Правила пароля (ТЗ §7.1) — их и показываем, и требуем на бэке. */
const PASSWORD_RULES_TEXT =
  "Пароль: от 8 до 128 символов, нужна буква и цифра";

/**
 * Отказ на 401 у смены пароля: «нет сессии» и «неверный текущий пароль» дают
 * один и тот же текст (контракт §5) — отличить их на экране нельзя.
 */
const PASSWORD_CHANGE_REFUSED_TEXT =
  "Не получилось сменить пароль — проверьте текущий пароль";

/**
 * Отказ входа по паролю.
 *
 * Единый текст собирается здесь, а не берётся из ответа бэка: так «нет такого
 * аккаунта» и «пароль не подошёл» физически не могут разойтись на экране,
 * даже если бэк по ошибке пришлёт разные тексты.
 */
function loginErrorText(err: unknown): string {
  if (err instanceof AuthApiError) {
    if (err.status === 429) return RATE_LIMITED_TEXT;
    if (err.code === "NETWORK") return NETWORK_TEXT;
    if (err.code === "NO_API_URL") return NO_API_TEXT;
  }
  // Любой другой статус (401, 403, 400, 500) — один и тот же отказ.
  return LOGIN_REFUSED_TEXT;
}

function passwordSaveErrorText(source: unknown): string {
  if (source instanceof AuthApiError) {
    if (source.status === 429) return RATE_LIMITED_TEXT;
    if (source.status === 400) return PASSWORD_RULES_TEXT;
    if (source.code === "NETWORK") return NETWORK_TEXT;
    if (source.code === "NO_API_URL") return NO_API_TEXT;
    return PASSWORD_CHANGE_REFUSED_TEXT;
  }
  return "Не получилось сохранить пароль";
}

function passwordRemoveErrorText(source: unknown): string {
  if (source instanceof AuthApiError) {
    if (source.status === 429) return RATE_LIMITED_TEXT;
    if (source.code === "NETWORK") return NETWORK_TEXT;
    if (source.code === "NO_API_URL") return NO_API_TEXT;
    if (source.isAuthError) return "Не получилось убрать пароль — войдите в кабинет заново";
  }
  return "Не получилось убрать пароль";
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
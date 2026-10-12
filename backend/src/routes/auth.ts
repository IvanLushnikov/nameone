/**
 * /api/auth/* — magic-link auth flow + вход по паролю (ТЗ-23).
 *
 *   POST   /api/auth/magic-link   — запросить magic link (rate-limited 5/hour per IP)
 *   POST   /api/auth/login        — вход по паролю (rate-limited 5/15 мин по email)
 *   POST   /api/auth/password     — задать/сменить пароль (нужна сессия)
 *   DELETE /api/auth/password     — убрать пароль (нужна сессия)
 *   POST   /api/auth/callback     — обменять токен на session + cookie
 *   POST   /api/auth/logout       — удалить session
 *   GET    /api/auth/me           — текущий пользователь (или null) + hasPassword
 *
 * Безопасность:
 *   * magic-link и парольный вход НИКОГДА не раскрывают, существует ли email:
 *     на «нет аккаунта» и «неверный пароль» один и тот же ответ, одинаковый
 *     по тексту и по времени
 *   * cookie — HttpOnly + Secure + SameSite=None (см. комментарий в /callback), 30 дней
 *   * session-токен — наноид 32 символа (см. lib/shortid.ts)
 */

import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { z } from "zod";
import {
  LOGIN_FAILED_MESSAGE,
  LOGIN_RATE_LIMIT_MESSAGE,
  changeUserPassword,
  consumeMagicLinkAndCreateSession,
  emailSchema,
  loginWithPassword,
  removeUserPassword,
  requestMagicLink,
  setUserPasswordWithPolicy,
} from "../services/auth";
import { createPendingToken, isTotpEnabled } from "../services/admin-totp";
import { deleteSession, getUserPasswordState } from "../db/queries";
import type { UserRow } from "../db/queries";
import { BadRequestError, RateLimitError, UnauthorizedError } from "../lib/errors";
import { checkPasswordPolicy, PASSWORD_MAX_LENGTH } from "../lib/password";
import { djb2, rateLimitMiddleware } from "../middleware/ratelimit";
import type { RateLimitOpts } from "../middleware/ratelimit";
import { requireAuth } from "../middleware/auth";

const authRouter = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Общие куски для входа по ссылке и по паролю
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Поставить session-cookie.
 *
 * Общий код для обоих входов: cookie от входа по паролю должна быть РОВНО такой
 * же, как от входа по ссылке (контракт §2.3). Копия «почти такая же» рано или
 * поздно разъедется, и одна из форм входа перестанет работать.
 */
function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: 30 * 24 * 60 * 60, // 30 дней
    path: "/",
  });
}

/**
 * Тело user в ответах /callback и /login — одно и то же (контракт §2.3):
 * фронт переиспользует для обоих один тип AuthUser.
 */
function toSessionUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    generationsTotal: user.generations_total,
    generationsToday: user.generations_today,
    // Платным считается всё, что не «free» (ТЗ-21 п.4).
    generationsLimit: user.plan === "free" ? 3 : -1,
    createdAt: new Date(user.created_at * 1000).toISOString(),
  };
}

/**
 * rateLimitMiddleware с ТЕКСТОМ ОТКАЗА из контракта.
 *
 * Сам middleware отвечает англоязычным «Too Many Requests» — учителю это
 * показывать нельзя, а текст «Слишком много попыток…» задан в контракте §2.2.
 * Оборачиваем, а не дублируем логику ограничения: сам limit остаётся его.
 */
function rateLimitWithMessage(opts: RateLimitOpts, message: string): MiddlewareHandler<AppEnv> {
  const inner = rateLimitMiddleware(opts);
  return async (c, next) => {
    try {
      await inner(c, next);
    } catch (e) {
      if (e instanceof RateLimitError) throw new RateLimitError(message, e.details);
      throw e;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ключ ограничения попыток входа по email (ТЗ-23 §7.3)
// ─────────────────────────────────────────────────────────────────────────────
//
// ЛОВУШКА, которую пришлось обойти: keyFn у rateLimitMiddleware выполняется
// ДО хендлера и возвращает строку СИНХРОННО. Прочитать тело запроса из него
// нельзя — await там невозможен, а синхронно тело не достать. Если бы мы всё
// равно попытались, ручка падала бы ВСЕГДА: тело к моменту хендлера уже
// прочитано и пусто.
//
// Решение — два шага, оба проверены тестом «тело не съедается»:
//   1. middleware readLoginEmailKey СТОИТ выше ограничения и читает тело ОДИН
//      раз. Hono кэширует разобранное тело (bodyCache), поэтому повторный
//      c.req.json() в хендлере берёт то же самое значение, а не пустое;
//   2. нормализованный email кладём в WeakMap по c.req.raw — синхронно и без
//      изменения типов контекста (переменную в AppVariables добавить нельзя:
//      types.ts не наш файл). Запрос умирает вместе с ключом, память не течёт.

const loginEmailKeys = new WeakMap<Request, string>();

/** Нормализация ровно как в emailSchema: trim + lowercase. */
async function readLoginEmailKey(c: Context<AppEnv>, next: Next): Promise<void> {
  let key = "";
  try {
    const body: unknown = await c.req.json();
    if (body !== null && typeof body === "object") {
      const email = (body as { email?: unknown }).email;
      if (typeof email === "string") key = email.trim().toLowerCase();
    }
  } catch {
    // Нечитаемое JSON-тело: ключ не по email, роут сам ответит 400. Читать
    // тело второй раз не нужно — оно уже закэшировано (или уже упало).
  }
  loginEmailKeys.set(c.req.raw, key);
  await next();
}

/**
 * Ключ ограничения — по email, а НЕ по IP (ТЗ-23 §7.3).
 *
 * Вся школа сидит на одном Wi-Fi: по IP пять попыток одного учителя заблокировали
 * бы вход тридцати другим на уроке. Ключ берётся из уже прочитанного тела,
 * поэтому регистр и пробелы обойти нельзя — иначе лимит можно было бы сбросить,
 * просто набрав адрес с заглавной буквы.
 */
function loginRateLimitKey(c: Context<AppEnv>): string {
  const email = loginEmailKeys.get(c.req.raw);
  if (email) return `email:${email}`;
  // Тела с читаемым email нет (битый JSON, чужой формат): считаем по IP.
  // Ключ «на всех» был бы хуже — нечитаемое тело обнуляло бы лимит всем подряд.
  return `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`;
}

const magicLinkSchema = z.object({ email: emailSchema });

authRouter.post(
  "/magic-link",
  rateLimitMiddleware({ limit: 5, windowSec: 3600, bucket: "magic-link" }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new BadRequestError("Invalid JSON body");
    }
    const { email } = magicLinkSchema.parse(body);

    const result = await requestMagicLink(c.env.DB, email, c.env);
    return c.json(result);
  },
);

const callbackSchema = z.object({ token: z.string().min(8).max(128) });

authRouter.post("/callback", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const { token } = callbackSchema.parse(body);

  const result = await consumeMagicLinkAndCreateSession(c.env.DB, token);
  if (!result) throw new UnauthorizedError("Invalid or expired magic link");

  // Set HttpOnly Secure cookie.
  //
  // SameSite=None: фронт на listai-prototype.pages.dev (Pages preview, рабочее название
  // до выбора бренда — см. docs/BRAND.md) и в перспективе на uchlist.ru (прод-домен),
  // бэк на *.workers.dev — разные origin'ы. С SameSite=Lax браузер НЕ отдаёт cookie
  // при cross-origin fetch (XHR/fetch из фронта на бэк). SameSite=None + Secure —
  // единственный вариант, который работает на разных доменах.
  //
  // Когда переедем на один eTLD+1 (например uchlist.ru apex + api.uchlist.ru),
  // можно вернуть SameSite=Lax — это безопаснее (CSRF mitigation).
  //
  // Сам код cookie — в setSessionCookie, общий с входом по паролю.
  setSessionCookie(c, result.sessionToken);

  return c.json({
    ok: true,
    // Сессионный токен НЕ возвращается в теле ответа — только в HttpOnly-cookie
    // выше. Раньше он дублировался в JSON, и любая XSS или вредоносное
    // расширение браузера могли его просто прочитать из ответа.
    user: toSessionUser(result.user),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Вход по паролю (ТЗ-23)
// ─────────────────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: emailSchema,
  // Правила надёжности на ВХОДЕ не проверяем, и это не недосмотр: пароль мог
  // быть задан по старым правилам, и проверка заперла бы учителя в его же
  // кабинете. Здесь 400 означает только «не так устроено тело» (контракт §2).
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

authRouter.post(
  "/login",
  readLoginEmailKey,
  rateLimitWithMessage(
    // 5 попыток на email в окне 15 минут (ТЗ-23 §7.3). Свой bucket: ручка
    // пароля не должна делить лимит с /magic-link.
    { limit: 5, windowSec: 900, bucket: "password-login", keyFn: loginRateLimitKey },
    LOGIN_RATE_LIMIT_MESSAGE,
  ),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new BadRequestError("Invalid JSON body");
    }
    const { email, password } = loginSchema.parse(body);

    const result = await loginWithPassword(c.env.DB, email, password);
    // ОДИН отказ на «нет аккаунта», «нет пароля» и «неверный пароль»: ручка
    // входа не должна быть способом проверить, зарегистрирован ли адрес.
    if (!result) throw new UnauthorizedError(LOGIN_FAILED_MESSAGE);

    // ─────────────────────────────────────────────────────────────────────
    // ВТОРОЙ ШАГ ДЛЯ АДМИНИСТРАТОРА (ТЗ-24 §8.1)
    //
    // Пароль только что проверен, но сессию выдавать рано: у администратора
    // может быть включён код подтверждения. Поэтому при его наличии сессия
    // НЕ создаётся, а вместо неё отдаётся короткоживущий одноразовый токен,
    // с которым `/api/admin/totp/verify` проверит код и уже тогда создаст
    // сессию (на сутки, а не на 30 дней как у учителя).
    //
    // Для учителя ровно тот же код, что был раньше: код подтверждения — только
    // администратору (решение владельца от 12.10.2026).
    // ─────────────────────────────────────────────────────────────────────
    const isAdmin = result.user.is_admin === 1;
    if (isAdmin && (await isTotpEnabled(c.env.DB, result.user.id))) {
      const pendingToken = await createPendingToken(c.env.DB, result.user.id);
      return c.json({
        ok: true,
        mfaRequired: true,
        pendingToken,
        // Почту не возвращаем: первый шаг не должен подтверждать, что адрес
        // зарегистрирован. На втором шаге сессия уже есть, там почта придёт.
        message: "Введите код из приложения-аутентификатора",
      });
    }

    setSessionCookie(c, result.sessionToken);
    return c.json({ ok: true, user: toSessionUser(result.user) });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Пароль: задать, сменить, убрать (ТЗ-23 §5)
// ─────────────────────────────────────────────────────────────────────────────

const setPasswordSchema = z.object({
  password: z.string().min(1),
  currentPassword: z.string().min(1).optional(),
});

/**
 * Тот же текст, что у requireAuth в middleware/auth.ts, — специально.
 * Контракт §5: отказ на неверный currentPassword не должен отличаться от отказа
 * на «нет сессии», иначе по тексту можно понять, что сессия есть, а вот пароль
 * не подошёл. Строка продублирована, потому что middleware/auth.ts не наш файл.
 */
const NO_SESSION_MESSAGE = "Требуется вход в аккаунт";

authRouter.post(
  "/password",
  rateLimitWithMessage(
    // Тот же лимит, что и на входе (ТЗ задаёт только это число), но ключ по
    // пользователю, а не по IP: по IP пять попыток одного учителя заблокировали
    // бы смену пароля всей школе на одном Wi-Fi. Отдельный bucket.
    { limit: 5, windowSec: 900, bucket: "password-set" },
    LOGIN_RATE_LIMIT_MESSAGE,
  ),
  async (c) => {
    const user = requireAuth(c);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new BadRequestError("Invalid JSON body");
    }
    const { password, currentPassword } = setPasswordSchema.parse(body);

    // Требования к паролю — до любой работы с базой: это ошибка формы, а не
    // отказ в доступе.
    const policyError = checkPasswordPolicy(password);
    if (policyError) throw new BadRequestError(policyError);

    const state = await getUserPasswordState(c.env.DB, user.id);

    let setAtSec: number;
    if (state.hasPassword) {
      // Смена требует старый пароль (ТЗ-23 §5): иначе любой, кто открыл вкладку
      // на чужом компьютере, сменил бы пароль и остался внутри.
      const changed = currentPassword
        ? await changeUserPassword(c.env.DB, user.id, currentPassword, password)
        : null;
      if (changed === null) throw new UnauthorizedError(NO_SESSION_MESSAGE);
      setAtSec = changed;
    } else {
      setAtSec = await setUserPasswordWithPolicy(c.env.DB, user.id, password);
    }

    // setAt — тот же формат, что у createdAt в /callback (контракт §2.1).
    return c.json({ ok: true, setAt: new Date(setAtSec * 1000).toISOString() });
  },
);

authRouter.delete("/password", async (c) => {
  const user = requireAuth(c);
  // Удаление уже отсутствующего пароля — не ошибка: учитель нажал «Убрать»,
  // пароля уже нет, и ручка должна просто подтвердить состояние.
  await removeUserPassword(c.env.DB, user.id);
  return c.json({ ok: true });
});

authRouter.post("/logout", async (c) => {
  const token = c.req.header("x-session-token") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? getCookieFromCtx(c);
  if (token) {
    await deleteSession(c.env.DB, token);
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});

function getCookieFromCtx(c: { req: { header: (k: string) => string | undefined } }): string | undefined {
  const cookie = c.req.header("cookie");
  if (!cookie) return undefined;
  const m = /session=([^;]+)/.exec(cookie);
  return m?.[1];
}

// Хендлер async: чтение признака «пароль задан» ходит в D1, а раньше здесь
// синхронный код, который просто перекладывал c.get('user').
authRouter.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ ok: true, user: null });
  }
  // Два поля — из одной ручки (контракт §3): фронт показывает «Пароль задан <дата>»
  // без второй запроса. Второй запрос — лишняя ручка и лишняя точка отказа.
  // Дата — это updated_at, тот же формат, что у createdAt выше.
  const state = await getUserPasswordState(c.env.DB, user.id);
  return c.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      // Признак администратора нужен клиенту для охраны `/superpower`:
      // без него страница не знает, показывать ли содержимое или тихо увести
      // на вход. Сам по себе флаг ничего секретного не раскрывает — все
      // реальные цифры всё равно отдаёт `requireAdmin` на бэкенде.
      isAdmin: user.isAdmin,
      hasPassword: state.hasPassword,
      passwordSetAt: state.updatedAt === null ? null : new Date(state.updatedAt * 1000).toISOString(),
    },
  });
});

export { authRouter };

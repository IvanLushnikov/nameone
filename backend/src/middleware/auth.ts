/**
 * Hono middleware: session/token → c.get('user').
 *
 * Поведение (намеренно лояльное):
 *   1) Если передан валидный session-токен (Authorization: Bearer ИЛИ Cookie: session=)
 *      и связанный user существует в БД → c.set('user', { id, email, name, plan }).
 *   2) Если токена нет / битый / истёк → c.set('user', null). НЕ бросаем 401.
 *      Анонимные запросы разрешены — решает каждый конкретный роут.
 *   3) Дополнительно выставляем c.set('ip') и c.set('userAgent') — нужно для rate-limit,
 *      логирования и аналитики.
 *
 * Контракт: middleware НИКОГДА не бросает и НИКОГДА не отвечает сам — это
 * filter. Каждый роут сам решает, требуется ли user (обычно — `if (!c.get('user')) throw new UnauthorizedError()`).
 */

import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv, AuthUser } from "../types";
import { getSession, getUserById } from "../db/queries";
import { UnauthorizedError } from "../lib/errors";

/**
 * Достать session-токен из запроса (Authorization: Bearer / Cookie: session=).
 * Возвращает строку или null.
 */
function readSessionToken(c: Context<AppEnv>): string | null {
  // 1) Authorization: Bearer <token> (для API-клиентов, мобильных приложений и т.п.)
  const auth = c.req.header("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]) return m[1].trim();
  }

  // 2) Cookie: session=<token> (универсальный browser-flow).
  const cookie = getCookie(c, "session");
  if (cookie) return cookie;

  // 3) Кастомный заголовок X-Session-Token (на случай если где-то удобнее).
  const alt = c.req.header("x-session-token");
  if (alt) return alt;

  return null;
}

/**
 * Достать IP клиента из CF-стандартных заголовков с fallback'ом.
 * В dev (wrangler dev --local) cf-connecting-ip может отсутствовать — отдаём "0.0.0.0".
 */
function readIp(c: Context<AppEnv>): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    // Берём первый валидный IP из списка (часто их несколько через proxy).
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return "0.0.0.0";
}

/**
 * Hono middleware: подгружает пользователя по session-токену.
 * Использовать как `app.use('*', authMiddleware())` сразу после CORS.
 */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ip = readIp(c);
    const userAgent = c.req.header("user-agent") ?? "";

    c.set("ip", ip);
    c.set("userAgent", userAgent);

    const token = readSessionToken(c);
    if (!token) {
      c.set("user", null);
      await next();
      return;
    }

    // Проверяем сессию: getSession фильтрует по expires_at > now.
    const session = await getSession(c.env.DB, token);
    if (!session) {
      c.set("user", null);
      await next();
      return;
    }

    const dbUser = await getUserById(c.env.DB, session.user_id);
    if (!dbUser) {
      // Session ссылается на несуществующего user — грязные данные. Просто null и идём дальше.
      c.set("user", null);
      await next();
      return;
    }

    const authUser: AuthUser = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      plan: dbUser.plan,
      isAdmin: dbUser.is_admin === 1,
    };
    c.set("user", authUser);
    await next();
  };
}

/**
 * Хелпер для роутов, ТРЕБУЮЩИХ авторизацию.
 * Бросает UnauthorizedError, если user нет в контексте.
 *
 * Использовать в начале хендлера: `const user = requireAuth(c);`
 */
export function requireAuth(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (!user) {
    throw new UnauthorizedError("Требуется вход в аккаунт");
  }
  return user;
}

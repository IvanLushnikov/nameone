/**
 * /api/auth/* — magic-link auth flow.
 *
 *   POST /api/auth/magic-link   — запросить magic link (rate-limited 5/hour per IP)
 *   POST /api/auth/callback     — обменять токен на session + cookie
 *   POST /api/auth/logout       — удалить session
 *   GET  /api/auth/me           — текущий пользователь (или null)
 *
 * Безопасность:
 *   * magic-link никогда не раскрывает, существует ли email
 *   * cookie — HttpOnly + Secure + SameSite=None (см. комментарий в /callback), 30 дней
 *   * session-токен — наноид 32 символа (см. lib/shortid.ts)
 */

import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { z } from "zod";
import { emailSchema, requestMagicLink, consumeMagicLinkAndCreateSession } from "../services/auth";
import { deleteSession } from "../db/queries";
import { BadRequestError, UnauthorizedError } from "../lib/errors";
import { rateLimitMiddleware } from "../middleware/ratelimit";

const authRouter = new Hono<AppEnv>();

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
  // до выбора бренда — см. docs/BRAND.md) и в перспективе на rabochielisty.ru (прод-домен),
  // бэк на *.workers.dev — разные origin'ы. С SameSite=Lax браузер НЕ отдаёт cookie
  // при cross-origin fetch (XHR/fetch из фронта на бэк). SameSite=None + Secure —
  // единственный вариант, который работает на разных доменах.
  //
  // Когда переедем на один eTLD+1 (например rabochielisty.ru apex + api.rabochielisty.ru),
  // можно вернуть SameSite=Lax — это безопаснее (CSRF mitigation).
  setCookie(c, "session", result.sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: 30 * 24 * 60 * 60, // 30 дней
    path: "/",
  });

  return c.json({
    ok: true,
    // Сессионный токен НЕ возвращается в теле ответа — только в HttpOnly-cookie
    // выше. Раньше он дублировался в JSON, и любая XSS или вредоносное
    // расширение браузера могли его просто прочитать из ответа.
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      plan: result.user.plan,
      generationsTotal: result.user.generations_total,
      generationsToday: result.user.generations_today,
      generationsLimit: result.user.plan === "plus" ? -1 : result.user.plan === "base" ? -1 : 3,
      createdAt: new Date(result.user.created_at * 1000).toISOString(),
    },
  });
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

authRouter.get("/me", (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ ok: true, user: null });
  }
  return c.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
    },
  });
});

export { authRouter };

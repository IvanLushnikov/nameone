/**
 * Общая постановка session-cookie.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ
 * ----------------------
 * Cookie ставится в двух местах: при входе по паролю и при втором шаге входа
 * администратора с кодом подтверждения (`/api/admin/totp/verify`). Пока это был
 * один приватный помощник в `routes/auth.ts`, второй ручке он был недоступен —
 * и вход с кодом подтверждения просто не выдавал сессию: токен возвращался в
 * теле ответа, а cookie не ставилась. Общий код обязан лежать в общем месте,
 * иначе вторая ветка входа будет отставать от первой.
 *
 * Домен и SameSite — не «значения до ТЗ-23», а следствие того, ГДЕ живёт бэк.
 * SESSION_COOKIE_DOMAIN задан (`.uchlist.ru`) с 12.10.2026, когда бэк переехал с
 * `*.workers.dev` на собственный домен api.uchlist.ru. Cookie на своём домене —
 * «своя» для uchlist.ru, и браузеры её не блокируют; SameSite=Lax при этом
 * ещё и защищает от CSRF. Пока переменная не задана (локальная разработка,
 * старый деплой) — поведение прежнее: SameSite=None без домена.
 *
 * ВАЖНО: cookie ставится сразу после привязки домена и одновременно с
 * переключением NEXT_PUBLIC_API_URL фронта. Одно без другого ломает вход.
 */

import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../types";

/** Обычная сессия — 30 дней (ТЗ-23 §6.3). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Сессия администратора после кода подтверждения — сутки (решение владельца).
 * Короткий срок здесь не украшение: вход по ссылке из письма происходит на
 * чужом устройстве чаще, чем кажется, и украденный телефон не должен продержаться
 * месяц.
 */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export function setSessionCookie(
  c: Context<AppEnv>,
  token: string,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): void {
  const cookieDomain = c.env.SESSION_COOKIE_DOMAIN || undefined;
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: true,
    sameSite: cookieDomain ? "Lax" : "None",
    maxAge: maxAgeSeconds,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

/**
 * Защита от CSRF (подделки межсайтовых запросов).
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 * Сессионная cookie ставится с `SameSite=None` — это вынужденно, пока фронт
 * (`rabochielisty.ru`) и API (`*.workers.dev`) живут на разных доменах. Но
 * `SameSite=None` означает, что браузер отправит cookie и с чужого сайта.
 *
 * Многие ошибочно полагают, что CORS нас спасёт. Не спасёт: CORS запрещает
 * браузеру *прочитать* ответ, но сам POST до сервера доходит, и изменение
 * происходит. Итог без этой проверки: любой сторонний сайт может от имени
 * залогиненного учителя отменить подписку, выжечь лимиты генерации и создать
 * формы от его имени.
 *
 * ── Как работает ─────────────────────────────────────────────────────────────
 * Правило простое: браузер ВСЕГДА шлёт `Origin` на изменяющий запрос
 * (POST/PUT/PATCH/DELETE). Значит:
 *   * Origin есть и его нет в allowlist  → 403, запрос чужой;
 *   * Origin есть и он в allowlist        → пропускаем;
 *   * Origin нет (curl, server-to-server, вебхук ЮKassa) → пропускаем.
 *     Без браузера подделать запрос нельзя, а отсекать серверные вызовы и
 *     вебхуки платёжной системы мы не имеем права.
 *
 * Это НЕ заменяет SameSite=Lax: когда фронт и API переедут на один домен,
 * нужно вернуть Lax (это дешевле и надёжнее), а эту проверку оставить как
 * второй слой.
 */

import type { MiddlewareHandler } from "hono";
import { ForbiddenError } from "../lib/errors";
import { parseAllowedOrigins } from "./cors";
import type { AppEnv } from "../types";

/** Методы, которые меняют состояние и потому требуют проверки Origin. */
const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Любой localhost — для локальной разработки, где порт меняется. */
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(
  origin: string,
  env: { FRONTEND_URL?: string; APP_ENV?: string },
): boolean {
  // В проде localhost не проходит: иначе локально запущенная страница
  // получала бы доступ к API с cookie пользователя.
  if (env.APP_ENV === "production") return parseAllowedOrigins(env).includes(origin);
  if (LOCALHOST_ORIGIN.test(origin)) return true;
  return parseAllowedOrigins(env).includes(origin);
}

export function originGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method.toUpperCase())) {
      await next();
      return;
    }

    const origin = c.req.header("origin");

    // Не браузер — CSRF неприменим (curl, серверные вызовы, вебхук ЮKassa).
    if (!origin) {
      await next();
      return;
    }

    if (isAllowedOrigin(origin, c.env)) {
      await next();
      return;
    }

    // Отказ фиксируем в лог: массовые 403 с чужого Origin — это и есть
    // попытка атаки, и по этому логу её можно заметить.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        msg: "csrf: blocked cross-origin mutation",
        method: c.req.method,
        path: c.req.path,
        origin,
      }),
    );

    throw new ForbiddenError("Запрос с чужого источника отклонён", {
      code: "CSRF_ORIGIN_REJECTED",
    });
  };
}

/** Экспорт для тестов: список методов под проверкой. */
export const GUARDED_METHODS = MUTATING_METHODS;

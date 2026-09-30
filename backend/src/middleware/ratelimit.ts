/**
 * Hono middleware: HTTP rate-limit через таблицу `rate_limits`.
 *
 * Использовать точечно на дорогих/спамных endpoint'ах. Атомарный UPSERT
 * с условным сбросом окна — один SQL-roundtrip на запрос.
 *
 * Пример:
 *   authRouter.post(
 *     "/magic-link",
 *     rateLimitMiddleware({ limit: 5, windowSec: 3600 }),
 *     handler
 *   );
 *
 * Настройка по умолчанию: ключ = `user:<id>` если залогинен, иначе `ip:<djb2(ip)>`.
 * Для server-to-server (нет user, нет ip) — fallback на `ip:anon`.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { RateLimitError } from "../lib/errors";
import type { AppEnv } from "../types";

export interface RateLimitOpts {
  /** Максимум запросов в окне. */
  limit: number;
  /** Длина окна в секундах. */
  windowSec: number;
  /** Переопределить формирование ключа (по c.var). Опционально. */
  keyFn?: (c: Context<AppEnv>) => string;
  /** Префикс пространства ключей (например "magic-link"). По умолчанию "http". */
  bucket?: string;
}

/**
 * Simple djb2 hash → base36. Не криптостойкий — нам нужно только дедуплицировать
 * анонимные IP в bucket'е (16M+ записей на одном ключе нам не грозит).
 */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // base36, всегда положительный
  return (hash >>> 0).toString(36);
}

function defaultKey(c: Context<AppEnv>): string {
  const user = c.get("user");
  if (user?.id) return `user:${user.id}`;
  const ip = c.get("ip") ?? "0.0.0.0";
  return `ip:${djb2(ip)}`;
}

function shortId(): string {
  // 10 символов base36 — D1 TEXT PRIMARY KEY. Time-prefixed достаточно для уникальности в пределах одного bucket (rate_limits использует id+key, но key UNIQUE берёт на себя идемпотентность).
  return `${Date.now().toString(36)}_${djb2(Math.random().toString()).slice(0, 6)}`;
}

interface RateLimitHit {
  count: number;
  window_start: number;
}

/**
 * Атомарно: инкрементируем bucket с условным сбросом окна.
 * Возвращает новое значение count и метку времени начала окна.
 */
async function hit(
  db: D1Database,
  bucket: string,
  key: string,
  nowSec: number,
  windowSec: number,
): Promise<RateLimitHit> {
  // Используем INSERT...ON CONFLICT...DO UPDATE с CASE — окно сбрасывается
  // атомарно когда разница с window_start >= windowSec.
  const stmt = db.prepare(
    `INSERT INTO rate_limits (id, key, count, window_start)
     VALUES (?1, ?2, 1, ?3)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN (?4 - rate_limits.window_start) >= ?5
                    THEN 1
                    ELSE rate_limits.count + 1
               END,
       window_start = CASE WHEN (?4 - rate_limits.window_start) >= ?5
                           THEN ?4
                           ELSE rate_limits.window_start
                      END
     RETURNING count, window_start`,
  );
  const id = shortId();
  const result = await stmt
    // SQL имеет 5 placeholders (?1..?5) — лишние 6-й/7-й args раньше тихо
    // игнорировались D1, но после апдейта workerd стали валиться на .bind() →
    // 500 на каждый запрос через rateLimitMiddleware (включая /api/auth/magic-link).
    // Передаём ровно 5 значений: id, key, nowSec (VALUES), nowSec (CASE ?4), windowSec (CASE ?5).
    .bind(id, key, nowSec, nowSec, windowSec)
    .first<RateLimitHit>();
  if (!result) {
    // Теоретически не должно случаться на D1 — но пусть будет явный error.
    throw new Error("rate_limits upsert failed");
  }
  return result;
}

/**
 * Hono middleware для rate limiting.
 *
 * Бросает RateLimitError (429 + RATE_LIMIT) при превышении `limit` в окне `windowSec`.
 */
export function rateLimitMiddleware(opts: RateLimitOpts): MiddlewareHandler<AppEnv> {
  const limit = Math.floor(opts.limit);
  const windowSec = Math.max(1, Math.floor(opts.windowSec));
  const bucketPrefix = opts.bucket ?? "http";
  const keyFn = opts.keyFn ?? defaultKey;

  return async (c, next) => {
    const ctxKey = keyFn(c);
    // Полный ключ = "<bucket>:<ctxKey>" — разные endpoint'ы не делят bucket'ы.
    const key = `${bucketPrefix}:${ctxKey}`;
    const nowSec = Math.floor(Date.now() / 1000);

    const hitResult = await hit(c.env.DB, bucketPrefix, key, nowSec, windowSec);
    if (hitResult.count > limit) {
      // Считаем resetAt = window_start + windowSec (момент, когда окно сбросится и счётчик уйдёт в 0).
      const resetAt = hitResult.window_start + windowSec;
      throw new RateLimitError("Too Many Requests", {
        bucket: bucketPrefix,
        limit,
        remaining: 0,
        resetAt,
      });
    }
    await next();
  };
}

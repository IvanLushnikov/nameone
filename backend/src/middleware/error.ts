/**
 * Глобальный error handler.
 *
 * Все хендлеры бросают ApiError (или нативный Error) — этот middleware
 * превращает их в JSON-ответ формата:
 *
 *   { ok: false, error: <message>, code: <CODE>, details?: ... }
 *
 * В проде стек-трейсы НЕ утекают — клиенту уходит generic "Internal Server Error".
 * В dev — кладём stack в `details.stack` для удобства отладки.
 */

import type { Context, ErrorHandler } from "hono";
import { ApiError } from "../lib/errors";
import { ZodError } from "zod";
import type { AppEnv } from "../types";

export const errorMiddleware: ErrorHandler<AppEnv> = (err, c) => {
  const isProd = c.env.APP_ENV === "production";

  // 1. Наши ApiError → берём status/code/message напрямую.
  if (err instanceof ApiError) {
    return c.json(
      {
        ok: false,
        error: err.message,
        code: err.code,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      err.status as 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500,
    );
  }

  // 2. ZodError → 400 с details про каждое поле.
  if (err instanceof ZodError) {
    return c.json(
      {
        ok: false,
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
      },
      400,
    );
  }

  // 3. Неизвестная ошибка → 500.
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      msg: "unhandled error",
      path: c.req.path,
      method: c.req.method,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  return c.json(
    {
      ok: false,
      error: isProd ? "Internal Server Error" : err instanceof Error ? err.message : "Internal Server Error",
      code: "INTERNAL",
      ...(isProd || !(err instanceof Error)
        ? {}
        : { details: { stack: err.stack } }),
    },
    500,
  );
};

/**
 * 404 handler. Ставится как последний `app.all('*', ...)` в index.ts.
 */
export function notFoundHandler(c: Context<AppEnv>): Response {
  return c.json(
    { ok: false, error: "Not Found", code: "NOT_FOUND", path: c.req.path },
    404,
  );
}

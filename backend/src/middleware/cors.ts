/**
 * CORS middleware для Hono.
 *
 * Используем @hono/cors — стандартный, проверенный пакет.
 * Origin берём из env.FRONTEND_URL (в проде это https://rabochielisty.ru),
 * credentials: true — чтобы браузер отдавал/принимал cookie с session-токеном.
 *
 * Если потребуется allow нескольких origin (preview-deployments), поменяем
 * на функцию, которая смотрит на c.req.header('origin') и решает allow.
 */

import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

export function corsMiddleware(): MiddlewareHandler<AppEnv> {
  return cors({
    origin: (origin, c) => {
      const allowed = c.env.FRONTEND_URL;
      // Allow same-origin (origin === allowed) или пустой origin (server-to-server, curl).
      if (!origin || origin === allowed) return origin || allowed;
      // На будущее: можно добавить allowlist для preview-deploys.
      return allowed;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "X-Session-Token"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 86400,
  });
}

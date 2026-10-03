/**
 * CORS middleware для Hono.
 *
 * Используем @hono/cors — стандартный, проверенный пакет.
 *
 * Allowlist строится из:
 *   1) HARDCODED прод/preview origins (listai-prototype.pages.dev, uchlist.ru)
 *      — нужны потому что FRONTEND_URL env может меняться между dev/local/prod,
 *      а эти домена должны работать всегда.
 *   2) FRONTEND_URL env (comma-separated) — для override'а на dev/preview-deploy'ах.
 *
 * credentials: true — чтобы браузер отдавал/принимал cookie с session-токеном.
 * Это требует явный origin в Access-Control-Allow-Origin (wildcard * запрещён
 * спецификацией вместе с credentials).
 */

import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/**
 * Origins, которые мы всегда готовы считать "своими".
 *
 * listai-prototype.pages.dev — текущий preview-домен фронта (Pages).
 * uchlist.ru — будущий прод-домен (после переезда с listai-*).
 *
 * Оба с www- и без — Pages иногда отдаёт и так и так.
 */
const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://listai-prototype.pages.dev",
  "https://www.listai-prototype.pages.dev",
  "https://uchlist.ru",
  "https://www.uchlist.ru",
];

/**
 * Собрать финальный allowlist из DEFAULT + FRONTEND_URL env.
 * Дубликаты убираются, пробелы trim'ятся.
 *
 * Экспортируется: тот же список использует originGuard для защиты от CSRF.
 * Две проверки должны опираться на ОДИН список — иначе легко получить
 * конфигурацию, где CORS разрешает один домен, а CSRF-защита — другой.
 */
export function parseAllowedOrigins(env: { FRONTEND_URL?: string }): string[] {
  const out = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  if (env.FRONTEND_URL) {
    for (const raw of env.FRONTEND_URL.split(",")) {
      const trimmed = raw.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return Array.from(out);
}

export function corsMiddleware(): MiddlewareHandler<AppEnv> {
  return cors({
    origin: (origin, c) => {
      const allowed = parseAllowedOrigins(c.env);
      // Без Origin (server-to-server, curl, server-rendered) — отдаём первый
      // allowlisted, чтобы preflight/credential-режим не падал в нештатных
      // случаях. Браузер Origin всегда шлёт, так что реальные клиенты идут
      // по ветке ниже.
      if (!origin) return allowed[0];
      // Echo origin если он в allowlist — обязательное условие для credentials.
      if (allowed.includes(origin)) return origin;
      // Не в allowlist — не ставим CORS-заголовок вообще. Браузер сам отклонит
      // запрос, и наш бэкенд не будет ошибочно пускать кого попало.
      return "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "X-Session-Token"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 86400,
  });
}

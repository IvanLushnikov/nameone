/**
 * Type-safe доступ к env / биндингам Cloudflare Workers.
 *
 * Все хендлеры получают env через Hono context (`c.env`), не через `process.env`.
 * Здесь — тип `Env` (для Hono<{ Bindings: Env }>) и хелперы.
 */

import type { Context } from "hono";

/**
 * Интерфейс переменных окружения и биндингов.
 *
 * Vars из wrangler.toml: APP_ENV, APP_BASE_URL, FRONTEND_URL.
 * Secrets из .dev.vars / `wrangler secret put`: API-ключи и JWT_SECRET.
 * Bindings: DB (D1), PDFS (R2).
 */
export interface Env {
  // bindings
  DB: D1Database;
  PDFS: R2Bucket;

  // vars
  APP_ENV: string;
  APP_BASE_URL: string;
  FRONTEND_URL: string;

  // secrets (все опциональны — наличие проверяется в нужных роутах)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  RESEND_API_KEY?: string;
  YOOKASSA_SHOP_ID?: string;
  YOOKASSA_SECRET_KEY?: string;
  JWT_SECRET: string;
  ADMIN_EMAIL?: string;
}

/**
 * Достать env из Hono context с правильным типом.
 */
export function getEnv(c: Context<{ Bindings: Env }>): Env {
  return c.env;
}

/**
 * Достать обязательную переменную. Бросает InternalError если отсутствует.
 *
 * Использовать для секретов, без которых роут не может работать (например,
 * RESEND_API_KEY в /api/auth/magic-link).
 */
export function requireEnv<K extends keyof Env>(c: Context<{ Bindings: Env }>, key: K): NonNullable<Env[K]> {
  const v = c.env[key];
  if (v === undefined || v === null || v === "") {
    throw new Error(`Missing required env: ${String(key)}`);
  }
  return v as NonNullable<Env[K]>;
}

/**
 * Проверить, прод ли это. Удобно для разной логики логирования / CORS / ошибок.
 */
export function isProd(c: Context<{ Bindings: Env }>): boolean {
  return c.env.APP_ENV === "production";
}

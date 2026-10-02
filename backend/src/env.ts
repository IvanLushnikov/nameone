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
  /**
   * Публичный origin фронта ОДНИМ значением — для ссылок, которые видит человек
   * (magic-link на вход, возврат с оплаты, dev-ссылка демо-платежа).
   *
   * Отдельная переменная нужна потому, что FRONTEND_URL в проде — список через
   * запятую ради CORS. Вставлять список в ссылку нельзя: получается нерабочий
   * URL вида «https://a.ru,https://b.ru/auth/callback?token=…».
   */
  APP_PUBLIC_URL?: string;
  FRONTEND_URL: string;

  // secrets (все опциональны — наличие проверяется в нужных роутах)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  POLZA_API_KEY?: string;
  /** Override primary модели для F-08 chat-edit (apiName из MODEL_CATALOG, например "anthropic/claude-opus-5.5"). */
  POLZA_LLM_MODEL?: string;
  RESEND_API_KEY?: string;
  YOOKASSA_SHOP_ID?: string;
  YOOKASSA_SECRET_KEY?: string;
  JWT_SECRET: string;
  /**
   * Соль для отпечатка посетителя (SHA-256(ip + UA + cf.* + соль)).
   *
   * Обязательна для продакшена: без неё хэш от IP подбирается перебором
   * за секунды, и таблица отпечатков сама становится справочником по IP.
   * Ставится тем же `wrangler secret put`, что и остальные секреты.
   */
  FINGERPRINT_SALT?: string;
  /**
   * Cloudflare Turnstile (server secret). Sitekey живёт во фронте как
   * NEXT_PUBLIC_TURNSTILE_SITE_KEY и вшивается при билде (статический экспорт).
   *
   * Если секрета нет — антифрод работает в режиме «никогда не просим капчу»:
   * так лучше, чем отрезать учителя из-за ненастроенного стороннего сервиса.
   */
  TURNSTILE_SECRET_KEY?: string;
  /** Single-admin legacy var. Если задан — эквивалентно ADMIN_EMAILS=<email>. */
  ADMIN_EMAIL?: string;
  /** Comma-separated emails, которые становятся is_admin=1 при первой регистрации. */
  ADMIN_EMAILS?: string;
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

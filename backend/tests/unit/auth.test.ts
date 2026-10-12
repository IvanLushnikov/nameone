/**
 * Unit-тесты для services/auth.ts — magic-link бизнес-логика + вход по паролю.
 *
 * Покрывает:
 *   - parseAdminEmails   — парсинг ADMIN_EMAILS/ADMIN_EMAIL env
 *   - emailSchema        — zod-валидация email (lowercase, trim, max 254)
 *   - requestMagicLink   — find-or-create user + magic_link + email (dev-режим)
 *   - consumeMagicLinkAndCreateSession — атомарный swap, повторное использование → null
 *   - ТЗ-23 §9.6 п.6     — семь сценариев входа по паролю, через настоящие ручки
 *
 * D1 используется реальный (workerd-pool через @cloudflare/vitest-pool-workers).
 * Email — мок через RESEND_API_KEY=undefined → dev-режим (URL возвращается в devMagicUrl).
 * Сценарии входа по паролю идут через собранное приложение из src/index: их суть —
 * в ответах ручек (текст отказа, cookie, 429, 401), а не во внутренних функциях.
 *
 * Схема вставлена прямо в файл потому что workerd-runtime тестов не имеет
 * реализованного node:fs (readFileSync бросает assert.fail). Чтобы не
 * тянуть wrangler-toml-override/globalSetup механику — дублируем SQL здесь.
 * Идемпотентно через CREATE TABLE IF NOT EXISTS, безопасно.
 */

// Подтягиваем типы `cloudflare:test` через triple-slash reference. Прямой
// side-effect import (`import "@cloudflare/vitest-pool-workers"`) тянет
// dist/pool/index.mjs, рассчитанный на Node-runtime vitest.config.ts.
/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

import {
  parseAdminEmails,
  emailSchema,
  requestMagicLink,
  consumeMagicLinkAndCreateSession,
  LOGIN_FAILED_MESSAGE,
  LOGIN_RATE_LIMIT_MESSAGE,
} from "../../src/services/auth";
import { MAGIC_LINK_REUSE_SECONDS } from "../../src/db/queries";
import type { Env } from "../../src/env";
// Настоящее приложение целиком — та же схема, что в security-regressions.test.ts.
// Сценарии ТЗ §9.6 проверяют ответ ручек (текст отказа побайтово, cookie, 429,
// 401), а не внутренние функции: собранная вручную Hono-приложение без
// origin/auth/error middleware проверяла бы не тот код, который в проде.
import { app } from "../../src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Встроенная копия src/db/schema.sql (см. комментарий в шапке).
// Держим вручную: при изменении schema.sql скопируйте сюда. vitest-pool-workers
// не даёт надёжно прочитать файл в workerd-runtime.
// ─────────────────────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT,
  plan                TEXT NOT NULL DEFAULT 'free',
  generations_total   INTEGER NOT NULL DEFAULT 0,
  generations_today   INTEGER NOT NULL DEFAULT 0,
  generations_reset_at INTEGER,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  stripe_customer_id  TEXT,
  yookassa_customer_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_plan  ON users(plan);

-- ТЗ-23: пароль учителя. Отдельная таблица, а не колонка в users: миграция
-- это повторный прогон schema.sql, а ALTER TABLE ADD COLUMN не идемпотентен.
-- Копия таблицы из src/db/schema.sql — держим вручную по той же причине,
-- по которой здесь копия всего остального.
CREATE TABLE IF NOT EXISTS user_passwords (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,
  salt       TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS worksheets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  grade        INTEGER NOT NULL,
  topic        TEXT NOT NULL,
  difficulty   TEXT NOT NULL,
  type         TEXT NOT NULL,
  count        INTEGER NOT NULL,
  title        TEXT,
  payload_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worksheets_user_created ON worksheets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_worksheets_subject_grade ON worksheets(subject, grade);

CREATE TABLE IF NOT EXISTS favorites (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worksheet_id TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE(user_id, worksheet_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);

CREATE TABLE IF NOT EXISTS templates (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  grade        INTEGER NOT NULL,
  topic        TEXT NOT NULL,
  difficulty   TEXT NOT NULL,
  count        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                TEXT NOT NULL,
  status              TEXT NOT NULL,
  period              TEXT NOT NULL,
  yookassa_payment_id TEXT,
  starts_at           INTEGER NOT NULL,
  ends_at             INTEGER NOT NULL,
  auto_renew          INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_yookassa ON subscriptions(yookassa_payment_id);

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan                TEXT NOT NULL,
  amount_rub          INTEGER NOT NULL,
  yookassa_payment_id TEXT UNIQUE,
  status              TEXT NOT NULL,
  confirmation_url    TEXT,
  created_at          INTEGER NOT NULL,
  completed_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS llm_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  task        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  plan        TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL,
  tokens_out  INTEGER NOT NULL,
  cost_usd    REAL NOT NULL,
  latency_ms  INTEGER NOT NULL,
  cached      INTEGER NOT NULL DEFAULT 0,
  fallback    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_logs_user_created ON llm_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_logs_task_created ON llm_logs(task, created_at);

CREATE TABLE IF NOT EXISTS semantic_cache (
  id            TEXT PRIMARY KEY,
  cache_key     TEXT NOT NULL UNIQUE,
  subject       TEXT NOT NULL,
  grade         INTEGER NOT NULL,
  topic         TEXT NOT NULL,
  difficulty    TEXT NOT NULL,
  count         INTEGER NOT NULL,
  type          TEXT NOT NULL,
  response_json TEXT NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_lookup ON semantic_cache(subject, grade, topic);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires ON semantic_cache(expires_at);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  data_json   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

CREATE TABLE IF NOT EXISTS model_routing (
  task             TEXT NOT NULL,
  plan             TEXT NOT NULL,
  primary_model    TEXT NOT NULL,
  primary_provider TEXT NOT NULL,
  fallback_json    TEXT NOT NULL DEFAULT '[]',
  enabled          INTEGER NOT NULL DEFAULT 1,
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT,
  PRIMARY KEY (task, plan)
);

CREATE INDEX IF NOT EXISTS idx_model_routing_enabled ON model_routing(enabled);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  payload_json TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created ON admin_audit_log(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_created ON admin_audit_log(action, created_at);

-- 2026-10-02: роли (teacher/student). Живёт отдельной таблицей, а не колонкой в
-- users: миграция это повторный прогон schema.sql, а ALTER TABLE ADD COLUMN
-- в SQLite не идемпотентен. Нет строки = teacher, то есть поведение прежнее.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

`;

// ─────────────────────────────────────────────────────────────────────────────
// parseAdminEmails
// ─────────────────────────────────────────────────────────────────────────────

describe("parseAdminEmails", () => {
  // Cast к Env допустим: функция читает только ADMIN_EMAILS и ADMIN_EMAIL.
  const envFrom = (a: Partial<Pick<Env, "ADMIN_EMAILS" | "ADMIN_EMAIL">>): Env =>
    ({ ADMIN_EMAILS: undefined, ADMIN_EMAIL: undefined, ...a } as unknown as Env);

  it("parses comma-separated ADMIN_EMAILS, trims, lowercases", () => {
    const set = parseAdminEmails(envFrom({ ADMIN_EMAILS: "a@x.com, B@Y.com ,c@z.com" }));
    expect(set.size).toBe(3);
    expect(set.has("a@x.com")).toBe(true);
    expect(set.has("b@y.com")).toBe(true);
    expect(set.has("c@z.com")).toBe(true);
  });

  it("falls back to legacy ADMIN_EMAIL", () => {
    const set = parseAdminEmails(envFrom({ ADMIN_EMAIL: "ADMIN@EXAMPLE.COM" }));
    expect(set.size).toBe(1);
    expect(set.has("admin@example.com")).toBe(true);
  });

  it("combines ADMIN_EMAILS + ADMIN_EMAIL", () => {
    const set = parseAdminEmails(envFrom({ ADMIN_EMAILS: "a@x.com", ADMIN_EMAIL: "b@x.com" }));
    expect(set.size).toBe(2);
    expect(set.has("a@x.com")).toBe(true);
    expect(set.has("b@x.com")).toBe(true);
  });

  it("returns empty set when neither env var set", () => {
    expect(parseAdminEmails(envFrom({})).size).toBe(0);
  });

  it("skips empty entries from extra commas/whitespace", () => {
    const set = parseAdminEmails(envFrom({ ADMIN_EMAILS: ",,  a@x.com , ,  " }));
    expect(set.size).toBe(1);
    expect(set.has("a@x.com")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// emailSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("emailSchema", () => {
  it("lowercases input", () => {
    expect(emailSchema.parse("Foo@Bar.COM")).toBe("foo@bar.com");
  });

  it("trims surrounding whitespace", () => {
    expect(emailSchema.parse("  foo@bar.com  ")).toBe("foo@bar.com");
  });

  it("rejects invalid email (no @)", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => emailSchema.parse("")).toThrow();
  });

  it("rejects too long email (>254 chars total)", () => {
    const longLocal = "a".repeat(250);
    expect(() => emailSchema.parse(`${longLocal}@x.com`)).toThrow();
  });

  it("accepts a normal email", () => {
    expect(emailSchema.parse("user@example.com")).toBe("user@example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requestMagicLink + consumeMagicLinkAndCreateSession (с реальным D1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Достать токен из devMagicUrl, который возвращает requestMagicLink в dev-режиме
 * (RESEND_API_KEY не задан → URL прокидывается в ответе).
 */
function tokenFromDevUrl(devMagicUrl: string | undefined): string {
  if (!devMagicUrl) throw new Error("devMagicUrl is empty — RESEND_API_KEY должен быть undefined для dev-режима");
  const token = new URL(devMagicUrl).searchParams.get("token");
  if (!token) throw new Error("token not found in devMagicUrl");
  return token;
}

describe("requestMagicLink + consumeMagicLinkAndCreateSession (D1)", () => {
  beforeAll(async () => {
    // Схема зашита в SCHEMA_SQL. CREATE TABLE IF NOT EXISTS — идемпотентно.
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
  });

  it("creates user + magic_link on first request, returns devMagicUrl", async () => {
    const r = await requestMagicLink(env.DB, "alice@example.com", env);
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(true);
    // Dev-режим: RESEND_API_KEY=undefined → URL возвращается.
    expect(r.devMagicUrl).toBeTruthy();
    expect(r.devMagicUrl).toContain("/auth/callback?token=");
  });

  it("find-or-create: повторный запрос не создаёт дубль user", async () => {
    const email = "bob-find-or-create@example.com";
    await requestMagicLink(env.DB, email, env);
    await requestMagicLink(env.DB, email, env);
    await requestMagicLink(env.DB, email, env);

    const row = await env.DB
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE email = ?")
      .bind(email)
      .first<{ cnt: number }>();
    expect(row?.cnt).toBe(1);
  });

  it("rejects invalid email via zod schema", async () => {
    await expect(
      requestMagicLink(env.DB, "definitely-not-an-email", env),
    ).rejects.toThrow();
  });

  it("consume valid token → возвращает user + sessionToken + sessionExpiresAt", async () => {
    const r = await requestMagicLink(env.DB, "carol@example.com", env);
    const token = tokenFromDevUrl(r.devMagicUrl);

    const consumed = await consumeMagicLinkAndCreateSession(env.DB, token);
    expect(consumed).not.toBeNull();
    expect(consumed!.user.email).toBe("carol@example.com");
    // session token — 32 символа mixed-case (см. lib/shortid.ts:sessionToken).
    expect(consumed!.sessionToken).toMatch(/^[0-9a-zA-Z]{32}$/);
    expect(typeof consumed!.sessionExpiresAt).toBe("number");
    const now = Math.floor(Date.now() / 1000);
    expect(consumed!.sessionExpiresAt).toBeGreaterThan(now);
    expect(consumed!.sessionExpiresAt).toBeLessThanOrEqual(now + 31 * 24 * 60 * 60);
  });

  it("ссылка работает на двух устройствах подряд, потом перестаёт (08.10.2026)", async () => {
    // Сценарий учительницы: письмо открыли на телефоне, УчЛист заработал,
    // а на планшете — нет, потому что ссылка была полностью одноразовой.
    //
    // Теперь после первого использования ссылка живёт ещё
    // MAGIC_LINK_REUSE_SECONDS и выдаёт свою сессию на каждое устройство.
    // Через окно — снова null: пересылка ссылки на следующий день не должна
    // работать, поэтому «многоразовость» строго ограничена по времени.
    const r = await requestMagicLink(env.DB, "two-devices@example.com", env);
    const token = tokenFromDevUrl(r.devMagicUrl);

    const phone = await consumeMagicLinkAndCreateSession(env.DB, token);
    expect(phone).not.toBeNull();

    const tablet = await consumeMagicLinkAndCreateSession(env.DB, token);
    expect(tablet).not.toBeNull();
    // Сессии РАЗНЫЕ: телефон и планшет не вытесняют друг друга.
    expect(tablet!.sessionToken).not.toBe(phone!.sessionToken);
    expect(tablet!.user.email).toBe(phone!.user.email);

    // Старая ссылка, израсходованная давно, — как и раньше: null.
    await env.DB.prepare(`UPDATE magic_links SET used_at = ?1 WHERE token = ?2`)
      .bind(Math.floor(Date.now() / 1000) - MAGIC_LINK_REUSE_SECONDS - 60, token)
      .run();

    const late = await consumeMagicLinkAndCreateSession(env.DB, token);
    expect(late).toBeNull();
  });

  it("consume non-existent token → null", async () => {
    const r = await consumeMagicLinkAndCreateSession(env.DB, "definitely-no-such-token-xyz");
    expect(r).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ТЗ-23 §9.6 п.6 — семь сценариев, которые обязаны быть закрыты тестами.
//
// Почему через настоящее `app`, а не через вызов сервисных функций: половина
// этих сценариев — про ОТВЕТ ручки. Побайтовое совпадение текстов отказа, код
// 429, cookie с её флагами, 401 при смене без старого пароля — это всё
// middleware и роутер. Тест на `loginWithPassword()` ничего из этого не проверяет.
//
// Тот же приём, что в security-regressions.test.ts: настоящий Hono, настоящий
// D1 из workerd, настоящая сборка middleware (cors → origin → auth → error).
// ═══════════════════════════════════════════════════════════════════════════

const db = (): D1Database => (env as unknown as { DB: D1Database }).DB;

/**
 * Окружение для запросов — development.
 *
 * Именно development, а не production: в проде без RESEND_API_KEY запрос
 * magic-link уходит в 503 и НЕ заводит пользователя (fail-closed). Это верное
 * поведение, но для подготовки фикстур нужен работающий вход.
 */
function devEnv(): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "development",
    RESEND_API_KEY: undefined,
    FRONTEND_URL: "http://localhost:3000",
    APP_PUBLIC_URL: "http://localhost:3000",
    ALLOW_DEV_MAGIC_URL: "true",
  };
}

/**
 * Один запрос к настоящему приложению.
 *
 * `ip` задаётся явно, потому что сценарий 5 проверяет ключ ограничения: без
 * заголовка все запросы приходят с одного адреса "0.0.0.0", и это даже лучше
 * для доказательства «ключ по email» — но явный IP делает намерение читаемым.
 */
async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string; ip?: string } = {},
  environment: Env = devEnv(),
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers["X-Session-Token"] = init.token;
  if (init.ip) headers["CF-Connecting-IP"] = init.ip;

  return app.fetch(
    new Request(`https://api.test${path}`, {
      method: init.method ?? "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    environment as never,
  );
}

/**
 * Завести учителя и его сессию.
 *
 * Пользователя пишем прямо в D1, а не через /magic-link: письмо тут ни при
 * чём, а лишняя зависимость от почтового сервиса в тесте про пароль — это
 * лишний повод упасть не по делу. Пароль ниже ставится НАСТОЯЩЕЙ ручкой
 * POST /api/auth/password, то есть по боевому пути.
 */
async function seedUser(email: string): Promise<{ sessionToken: string }> {
  const userId = `usr_${crypto.randomUUID()}`;
  const sessionToken = `sess_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);

  await db()
    .prepare(
      `INSERT INTO users (id, email, name, plan, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'free', ?4, ?5)`,
    )
    .bind(userId, email, `Учитель ${email}`, now, now)
    .run();
  await db()
    .prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(sessionToken, userId, now + 86400, now)
    .run();

  return { sessionToken };
}

/** Задать пароль боевой ручкой. Возвращает ответ, чтобы тест сам проверял код. */
function setPasswordViaApi(
  sessionToken: string,
  password: string,
  currentPassword?: string,
): Promise<Response> {
  return call(
    "/api/auth/password",
    {
      body: currentPassword === undefined ? { password } : { password, currentPassword },
      token: sessionToken,
    },
  );
}

/** Попытка входа по паролю. */
function login(email: string, password: string, ip?: string): Promise<Response> {
  return call("/api/auth/login", { body: { email, password }, ip });
}

/**
 * Разобрать Set-Cookie ручки ответа в Map по имени.
 *
 * Берём обычный `headers.get("set-cookie")`, а не `getSetCookie()`: в типах
 * этого репозитория такого метода нет, а ручка входа ставит ровно одну cookie
 * — разбирать список из нескольких тут нечего. Так же сделано в
 * security-regressions.test.ts.
 */
function setCookieMap(res: Response): Map<string, string> {
  const map = new Map<string, string>();
  const header = res.headers.get("set-cookie");
  if (!header) return map;
  for (const part of header.split(/,\s*(?=[^;,\s]+=)/)) {
    const [pair] = part.split(";");
    const eq = pair?.indexOf("=") ?? -1;
    if (eq > 0) map.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
  }
  return map;
}

describe("ТЗ-23 §9.6 — вход по паролю (настоящие ручки)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
  });

  // Чистая база на каждый тест: счётчики ограничения попыток живут в общей
  // таблице rate_limits, и без сброса шестая попытка в одном тесте заблокировала
  // бы первый же вход в следующем.
  beforeEach(async () => {
    await db().prepare(`DELETE FROM rate_limits`).run();
    await db().prepare(`DELETE FROM user_passwords`).run();
    await db().prepare(`DELETE FROM sessions`).run();
    await db().prepare(`DELETE FROM users`).run();
  });

  // ── Сценарий 1 ───────────────────────────────────────────────────────────
  it("пароль есть → вход по паролю работает", async () => {
    const email = "s1-ok@example.com";
    const { sessionToken } = await seedUser(email);
    const set = await setPasswordViaApi(sessionToken, "uchlist2026");
    expect(set.status).toBe(200);

    const res = await login(email, "uchlist2026");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; user: { email: string } };
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe(email);

    // Сессионная cookie ставится — и она именно сессионная, а не «какая-то».
    const cookies = setCookieMap(res);
    expect(cookies.has("session")).toBe(true);
  });

  // ── Сценарий 2 ───────────────────────────────────────────────────────────
  it("пароль есть → неверный пароль отклонён", async () => {
    const email = "s2-wrong@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");

    const res = await login(email, "uchlist2027");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe(LOGIN_FAILED_MESSAGE);
    // Отказ не должен оставлять сессионной cookie.
    expect(setCookieMap(res).has("session")).toBe(false);
  });

  // ── Сценарий 3 ───────────────────────────────────────────────────────────
  it("пароля нет → вход по паролю отклонён С ТЕМ ЖЕ текстом", async () => {
    // Пользователь существует, пароль ему никто не задавал — самая частая
    // реальная ситуация: учитель только что пришёл по ссылке.
    const email = "s3-nopass@example.com";
    await seedUser(email);

    const res = await login(email, "uchlist2026");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(LOGIN_FAILED_MESSAGE);

    // Ровно та же строка, что и на неверный пароль: сравнение с константой
    // сервиса, а не «похожий текст».
    expect(body.error).toBe("Не получилось войти. Проверьте почту и пароль");
  });

  // ── Сценарий 4 ───────────────────────────────────────────────────────────
  it("чужой пароль отвечает так же, как несуществующий аккаунт (побайтово)", async () => {
    const email = "s4-real@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");

    const wrongPassword = await login(email, "uchlist2027");
    const noAccount = await login("s4-ghost@example.com", "uchlist2026");

    expect(wrongPassword.status).toBe(noAccount.status);
    // Побайтово, а не по полям: любое лишнее поле в теле (hint, reason)
    // снова отличило бы ответы, и ручка стала бы способом проверить адрес.
    expect(await wrongPassword.text()).toBe(await noAccount.text());
  });

  // ── Сценарий 5 ───────────────────────────────────────────────────────────
  it("шестая неудачная попытка блокируется по email, а посторонний учитель входит спокойно", async () => {
    // Оба учителя — с ОДНОГО IP: ровно тот случай, из-за которого ключ
    // ограничения не может быть по IP (вся школа на одном Wi-Fi).
    const SCHOOL_IP = "203.0.113.10";
    const victim = "s5-victim@example.com";
    const neighbour = "s5-neighbour@example.com";

    const victimSession = await seedUser(victim);
    await setPasswordViaApi(victimSession.sessionToken, "uchlist2026");
    const neighbourSession = await seedUser(neighbour);
    await setPasswordViaApi(neighbourSession.sessionToken, "uchlist2026");

    // Пять неудачных попыток — лимит ещё не выбран.
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await login(victim, `wrong-${attempt}`, SCHOOL_IP);
      expect(res.status, `попытка ${attempt} ещё должна была дойти до хендлера`).toBe(401);
    }

    // Шестая — блокировка по этому email.
    const sixth = await login(victim, "wrong-6", SCHOOL_IP);
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as { error: string }).error).toBe(LOGIN_RATE_LIMIT_MESSAGE);

    // Проверяющий учитель с того же IP в это же время входит без помех:
    // счётчик по email, а не по IP.
    const other = await login(neighbour, "uchlist2026", SCHOOL_IP);
    expect(other.status).toBe(200);
  });

  // ── Сценарий 6 ───────────────────────────────────────────────────────────
  it("смена пароля без старого отклоняется, со старым — проходит", async () => {
    const email = "s6-change@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");

    // Без старого — даже при верной новом пароле.
    const noOld = await setPasswordViaApi(sessionToken, "uchlist2027");
    expect(noOld.status).toBe(401);
    // Тот же текст, что на «нет сессии»: по тексту нельзя отличить одно от другого.
    expect(((await noOld.json()) as { error: string }).error).toBe("Требуется вход в аккаунт");

    // Со старым, но неверным.
    const wrongOld = await setPasswordViaApi(sessionToken, "uchlist2027", "wrongpass1");
    expect(wrongOld.status).toBe(401);
    expect(((await wrongOld.json()) as { error: string }).error).toBe("Требуется вход в аккаунт");

    // Со старым верным — проходит.
    const changed = await setPasswordViaApi(sessionToken, "uchlist2027", "uchlist2026");
    expect(changed.status).toBe(200);
    const setAt = ((await changed.json()) as { ok: boolean; setAt: string }).setAt;
    // setAt — ISO 8601, тот же формат, что у createdAt в /callback.
    expect(setAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // И пароль действительно сменился: старый больше не входит, новый входит.
    expect((await login(email, "uchlist2026")).status).toBe(401);
    expect((await login(email, "uchlist2027")).status).toBe(200);
  });

  // ── Сценарий 7 ───────────────────────────────────────────────────────────
  it("удаление пароля возвращает состояние «пароля нет», и вход отклоняется тем же текстом", async () => {
    const email = "s7-remove@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");

    // До удаления: пароль есть, дата есть.
    const before = (await (
      await call("/api/auth/me", { method: "GET", token: sessionToken })
    ).json()) as { user: { hasPassword: boolean; passwordSetAt: string | null } };
    expect(before.user.hasPassword).toBe(true);
    expect(before.user.passwordSetAt).not.toBeNull();

    const removed = await call("/api/auth/password", { method: "DELETE", token: sessionToken });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { ok: boolean }).ok).toBe(true);

    // Состояние «пароля нет» — оба поля сразу, одним запросом.
    const after = (await (
      await call("/api/auth/me", { method: "GET", token: sessionToken })
    ).json()) as { user: { hasPassword: boolean; passwordSetAt: string | null } };
    expect(after.user.hasPassword).toBe(false);
    expect(after.user.passwordSetAt).toBeNull();

    // Бывший пароль больше не входит — и отказ тот же единый.
    const res = await login(email, "uchlist2026");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe(LOGIN_FAILED_MESSAGE);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Проверки из контракта §2.3 / §3 и ловушка из §6 — они не в списке
  // «семи сценариев», но без них ручка может разъехаться с /callback.
  // ═══════════════════════════════════════════════════════════════════════

  it("cookie входа по паролю — ровно такая же, как у входа по ссылке", async () => {
    const email = "cookie@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");

    const byPassword = await login(email, "uchlist2026");
    const header = byPassword.headers.get("set-cookie");
    expect(header, "вход по паролю должен ставить сессионную cookie").not.toBeNull();

    expect(header).toContain("session=");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=None");
    expect(header).toContain("Path=/");
    // 30 дней = 2592000 секунд.
    expect(header).toContain("Max-Age=2592000");
  });

  it("ограничение попыток читает тело, но хендлер всё равно получает email и password", async () => {
    // Ловушка из контракта §6: keyFn выполняется ДО хендлера, и если прочитать
    // тело в нём — хендлер получит пустое, то есть ручка сломается всегда.
    // Успешный вход ниже — и есть доказательство, что тело доживает до хендлера.
    const email = "body-not-eaten@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");

    const res = await login(email, "uchlist2026");
    expect(res.status).toBe(200);
    // Если бы тело съедалось, zod упал бы на пустом теле — был бы 400.
    expect(((await res.json()) as { user: { email: string } }).user.email).toBe(email);
  });

  it("ключ ограничения по НОРМАЛИЗОВАННОМУ email: другой регистр и пробелы не сбрасывают счётчик", async () => {
    // Иначе лимит обходится элементарно — набрать адрес с заглавной буквы.
    const email = "case@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");
    const ip = "198.51.100.7";

    const variants = [
      email,
      email.toUpperCase(),
      `  ${email}  `,
      "Case@Example.Com",
      `\t${email.toUpperCase()}\n`,
    ];
    for (const variant of variants) {
      const res = await login(variant, "wrong-password", ip);
      expect(res.status).toBe(401);
    }
    // Пять попыток съели лимит (все пять нормализовались в один ключ) — шестая
    // заблокирована. Если бы ключ считался по сырому телу, каждая попытка была бы
    // отдельным адресом и шестая прошла бы.
    const sixth = await login(email, "wrong-password", ip);
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as { error: string }).error).toBe(LOGIN_RATE_LIMIT_MESSAGE);
  });

  it("пароль, соль и хеш не возвращаются в ответах ручек", async () => {
    const email = "no-leak@example.com";
    const { sessionToken } = await seedUser(email);
    await setPasswordViaApi(sessionToken, "uchlist2026");

    const loginBody = await (await login(email, "uchlist2026")).text();
    const meBody = await (await call("/api/auth/me", { method: "GET", token: sessionToken })).text();
    const setBody = await (
      await setPasswordViaApi(sessionToken, "uchlist2028", "uchlist2026")
    ).text();

    for (const [where, body] of [
      ["login", loginBody],
      ["me", meBody],
      ["password", setBody],
    ] as const) {
      expect(body, `${where}: хеш наружу`).not.toContain("hash");
      expect(body, `${where}: соль наружу`).not.toContain("salt");
      expect(body, `${where}: итерации наружу`).not.toContain("iterations");
      expect(body, `${where}: сам пароль наружу`).not.toContain("uchlist2026");
    }
  });

  it("вход без сессии на /me остаётся прежним: { ok: true, user: null }", async () => {
    const res = await call("/api/auth/me", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; user: null };
    expect(body.ok).toBe(true);
    expect(body.user).toBeNull();
  });
});
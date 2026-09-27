/**
 * Unit-тесты для services/auth.ts — magic-link бизнес-логика.
 *
 * Покрывает:
 *   - parseAdminEmails   — парсинг ADMIN_EMAILS/ADMIN_EMAIL env
 *   - emailSchema        — zod-валидация email (lowercase, trim, max 254)
 *   - requestMagicLink   — find-or-create user + magic_link + email (dev-режим)
 *   - consumeMagicLinkAndCreateSession — атомарный swap, повторное использование → null
 *
 * D1 используется реальный (workerd-pool через @cloudflare/vitest-pool-workers).
 * Email — мок через RESEND_API_KEY=undefined → dev-режим (URL возвращается в devMagicUrl).
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
import { describe, it, expect, beforeAll } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

import {
  parseAdminEmails,
  emailSchema,
  requestMagicLink,
  consumeMagicLinkAndCreateSession,
} from "../../src/services/auth";
import type { Env } from "../../src/env";

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

  it("consume same token twice → second time null (атомарный swap)", async () => {
    const r = await requestMagicLink(env.DB, "dave-replay@example.com", env);
    const token = tokenFromDevUrl(r.devMagicUrl);

    const first = await consumeMagicLinkAndCreateSession(env.DB, token);
    expect(first).not.toBeNull();

    const second = await consumeMagicLinkAndCreateSession(env.DB, token);
    expect(second).toBeNull();
  });

  it("consume non-existent token → null", async () => {
    const r = await consumeMagicLinkAndCreateSession(env.DB, "definitely-no-such-token-xyz");
    expect(r).toBeNull();
  });
});
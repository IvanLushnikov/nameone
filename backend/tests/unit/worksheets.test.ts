/**
 * Unit-тесты для backend/src/routes/worksheets.ts:POST /api/worksheets/save (W1).
 *
 * Покрывает:
 *   T1. POST /api/worksheets/save без auth → 401
 *   T2. POST /api/worksheets/save с auth + валидный body → 200 + worksheetId + counter++
 *   T3. POST /api/worksheets/save с auth + невалидный body (zod) → 400 + details
 *   T4. POST /api/worksheets/save: generations_today атомарно инкрементится
 *       (до=0 → после=1 → после второго=2)
 *
 * Использует `env.SELF.fetch` (через workerd-pool) — реальный HTTP-роут
 * с реальной D1.
 *
 * Схема D1 зашита в SCHEMA_SQL ниже — workerd не имеет fs.readFileSync,
 * см. комментарий в начале auth.test.ts.
 */

/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

import type { Env } from "../../src/env";
import { createMagicLink, consumeMagicLink, createSession, createUser } from "../../src/db/queries";

// ─────────────────────────────────────────────────────────────────────────────
// Встроенная копия src/db/schema.sql (workerd не имеет fs.readFileSync).
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

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY, email TEXT NOT NULL,
  expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL, grade INTEGER NOT NULL, topic TEXT NOT NULL,
  difficulty TEXT NOT NULL, type TEXT NOT NULL, count INTEGER NOT NULL,
  title TEXT, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worksheets_user_created ON worksheets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_worksheets_subject_grade ON worksheets(subject, grade);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worksheet_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, worksheet_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, subject TEXT NOT NULL, grade INTEGER NOT NULL,
  topic TEXT NOT NULL, difficulty TEXT NOT NULL, count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL, status TEXT NOT NULL, period TEXT NOT NULL,
  yookassa_payment_id TEXT, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan TEXT NOT NULL, amount_rub INTEGER NOT NULL,
  yookassa_payment_id TEXT UNIQUE, status TEXT NOT NULL,
  confirmation_url TEXT, created_at INTEGER NOT NULL, completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS llm_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  task TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  plan TEXT NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL,
  cost_usd REAL NOT NULL, latency_ms INTEGER NOT NULL,
  cached INTEGER NOT NULL DEFAULT 0, fallback INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL, grade INTEGER NOT NULL, topic TEXT NOT NULL,
  difficulty TEXT NOT NULL, count INTEGER NOT NULL, type TEXT NOT NULL,
  response_json TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, data_json TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL, window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

CREATE TABLE IF NOT EXISTS model_routing (
  task TEXT NOT NULL, plan TEXT NOT NULL,
  primary_model TEXT NOT NULL, primary_provider TEXT NOT NULL,
  fallback_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL, updated_by TEXT,
  PRIMARY KEY (task, plan)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT,
  payload_json TEXT, created_at INTEGER NOT NULL
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────────────────

interface TestUser {
  id: string;
  email: string;
  sessionToken: string;
}

/**
 * Создать user + magic_link + session через прямые SQL insert'ы + queries.ts.
 * Возвращает sessionToken, который нужно положить в cookie `session=`.
 */
async function createTestUserWithSession(): Promise<TestUser> {
  const id = `usr_${Math.random().toString(36).slice(2, 14)}`;
  const email = `save-test-${Math.random().toString(36).slice(2, 14)}@example.test`;
  await createUser(env.DB, { id, email, plan: "free" });

  // Создаём magic-link → consume → создаём session вручную через createSession.
  // Проще, чем requestMagicLink (не нужно мокать Resend).
  const token = `mlk_${Math.random().toString(36).slice(2, 30)}`;
  await createMagicLink(env.DB, { token, email });
  const consumed = await consumeMagicLink(env.DB, token);
  expect(consumed).not.toBeNull();

  const sessionToken = `sess_${Math.random().toString(36).slice(2, 30)}`;
  await createSession(env.DB, { token: sessionToken, userId: id });
  return { id, email, sessionToken };
}

const VALID_BODY = {
  subject: "math",
  grade: 7,
  topic: "algebra",
  title: "Лист 1",
  difficulty: "medium",
  tasks: [
    {
      number: 1,
      text: "2 + 2 = ?",
      type: "short-answer",
      answer: "4",
      points: 1,
    },
  ],
  type: "worksheet",
  source: "mock",
};

async function postSave(
  body: unknown,
  cookieSessionToken?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (cookieSessionToken) {
    headers["Cookie"] = `session=${cookieSessionToken}`;
  }
  return SELF.fetch("https://worker.test/api/worksheets/save", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function getGenerationsToday(userId: string): Promise<number> {
  const row = await env.DB
    .prepare("SELECT generations_today FROM users WHERE id = ?1")
    .bind(userId)
    .first<{ generations_today: number }>();
  return row?.generations_today ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Тесты
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/worksheets/save", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
  });

  beforeEach(async () => {
    // Чистим users/worksheets между тестами для детерминизма.
    await env.DB
      .prepare("DELETE FROM worksheets")
      .run();
    await env.DB
      .prepare("DELETE FROM sessions")
      .run();
    await env.DB
      .prepare("DELETE FROM magic_links")
      .run();
    await env.DB
      .prepare("DELETE FROM users")
      .run();
  });

  // T1
  it("T1: анонимный запрос → 401 + { ok:false, error:UNAUTHORIZED }", async () => {
    const res = await postSave(VALID_BODY);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  // T2
  it("T2: залогиненный юзер + валидный body → 200 + worksheetId + counter+1", async () => {
    const u = await createTestUserWithSession();
    const before = await getGenerationsToday(u.id);
    expect(before).toBe(0);

    const res = await postSave(VALID_BODY, u.sessionToken);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      worksheetId: string;
      generationsToday: number;
      generationsLimit: number;
    };
    expect(body.ok).toBe(true);
    expect(body.worksheetId).toMatch(/^ws_[0-9a-z]{12}$/);
    expect(body.generationsToday).toBe(1);
    // free plan → 3; см. backend/src/routes/users.ts / usage handler.
    expect(body.generationsLimit).toBe(3);

    // Лист реально записан в БД.
    const row = await env.DB
      .prepare("SELECT id, user_id, subject, type, count FROM worksheets WHERE id = ?1")
      .bind(body.worksheetId)
      .first<{ id: string; user_id: string; subject: string; type: string; count: number }>();
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(u.id);
    expect(row!.subject).toBe("math");
    expect(row!.type).toBe("worksheet");
    expect(row!.count).toBe(1);

    // Counter инкрементился.
    const after = await getGenerationsToday(u.id);
    expect(after).toBe(1);
  });

  // T3
  it("T3: залогиненный юзер + невалидный body (tasks=[]) → 400 + zod details", async () => {
    const u = await createTestUserWithSession();

    const res = await postSave(
      {
        ...VALID_BODY,
        tasks: [], // min(1) violated
      },
      u.sessionToken,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      code: string;
      details?: Array<{ path: string; message: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.details)).toBe(true);
    const hasTasksError = body.details!.some((d) => d.path.startsWith("tasks"));
    expect(hasTasksError).toBe(true);

    // Counter НЕ инкрементится при 400 (т.к. handler не дошёл до UPDATE).
    const after = await getGenerationsToday(u.id);
    expect(after).toBe(0);
  });

  // T4 — атомарный инкремент generations_today: 0 → 1 → 2
  it("T4: generations_today атомарно инкрементится при последовательных /save", async () => {
    const u = await createTestUserWithSession();

    expect(await getGenerationsToday(u.id)).toBe(0);

    const r1 = await postSave(VALID_BODY, u.sessionToken);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { generationsToday: number };
    expect(b1.generationsToday).toBe(1);
    expect(await getGenerationsToday(u.id)).toBe(1);

    const r2 = await postSave(
      { ...VALID_BODY, title: "Лист 2" },
      u.sessionToken,
    );
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { generationsToday: number };
    expect(b2.generationsToday).toBe(2);
    expect(await getGenerationsToday(u.id)).toBe(2);

    // Оба листа лежат в БД.
    const count = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM worksheets WHERE user_id = ?1")
      .bind(u.id)
      .first<{ cnt: number }>();
    expect(count?.cnt).toBe(2);
  });
});

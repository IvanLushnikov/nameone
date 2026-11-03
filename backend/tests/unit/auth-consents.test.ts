/**
 * D2.4: persist согласий оферты / ПДн / рекламы при auth.
 *
 * Без строки в user_consents галочка на /login ничего не доказывает.
 * Покрываем: 400 без обязательных; запись при magic-link / login / callback;
 * marketing=false тоже пишется (отказ).
 */
/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { app } from "../../src/index";
import type { Env } from "../../src/env";
import {
  hasAcceptedConsent,
  PDN_DOC_VERSION,
  OFFER_DOC_VERSION,
  MARKETING_CONSENT_VERSION,
} from "../../src/lib/consents";
import { setUserPasswordWithPolicy } from "../../src/services/auth";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  generations_total INTEGER NOT NULL DEFAULT 0,
  generations_today INTEGER NOT NULL DEFAULT 0,
  generations_reset_at INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  stripe_customer_id TEXT,
  yookassa_customer_id TEXT
);
CREATE TABLE IF NOT EXISTS user_passwords (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT,
  UNIQUE(user_id, type, version)
);
CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_totp (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_login_pending (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

function db() {
  return env.DB;
}

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

async function call(
  path: string,
  init: { method?: string; body?: unknown; ip?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "consent-test/1.0",
  };
  if (init.ip) headers["CF-Connecting-IP"] = init.ip;
  return app.fetch(
    new Request(`https://api.test${path}`, {
      method: init.method ?? "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    devEnv() as never,
  );
}

async function consentsFor(userId: string) {
  const rows = await db()
    .prepare(
      `SELECT type, version, accepted, accepted_at, ip FROM user_consents
       WHERE user_id = ?1 ORDER BY type`,
    )
    .bind(userId)
    .all<{
      type: string;
      version: string;
      accepted: number;
      accepted_at: number;
      ip: string | null;
    }>();
  return rows.results ?? [];
}

describe("D2.4 — persist согласий при auth", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
  });

  beforeEach(async () => {
    await db().prepare(`DELETE FROM user_consents`).run();
    await db().prepare(`DELETE FROM sessions`).run();
    await db().prepare(`DELETE FROM magic_links`).run();
    await db().prepare(`DELETE FROM user_passwords`).run();
    await db().prepare(`DELETE FROM users`).run();
    await db().prepare(`DELETE FROM rate_limits`).run();
  });

  it("без persist согласие нельзя считать принятым", async () => {
    const now = Math.floor(Date.now() / 1000);
    await db()
      .prepare(
        `INSERT INTO users (id, email, name, plan, created_at, updated_at)
         VALUES ('usr_nopersist', 'nopersist@example.com', 'X', 'free', ?1, ?1)`,
      )
      .bind(now)
      .run();

    // UI-галочка без строки в БД — это НЕ согласие.
    expect(await hasAcceptedConsent(db(), "usr_nopersist", "offer")).toBe(false);
    expect(await hasAcceptedConsent(db(), "usr_nopersist", "pdn")).toBe(false);
  });

  it("magic-link без оферты/ПДн → 400, строк нет", async () => {
    const res = await call("/api/auth/magic-link", {
      body: { email: "new@example.com", consents: { offer: false, pdn: true, marketing: false } },
    });
    expect(res.status).toBe(400);

    const users = await db()
      .prepare(`SELECT id FROM users WHERE email = 'new@example.com'`)
      .first();
    // Пользователя не создаём при отказе валидации — parse до requestMagicLink.
    expect(users).toBeNull();
  });

  it("magic-link без consents → 400", async () => {
    const res = await call("/api/auth/magic-link", {
      body: { email: "nocon@example.com" },
    });
    expect(res.status).toBe(400);
  });

  it("успешный magic-link пишет offer+pdn+marketing(false)", async () => {
    const res = await call("/api/auth/magic-link", {
      body: {
        email: "alice@example.com",
        consents: { offer: true, pdn: true, marketing: false },
      },
      ip: "203.0.113.10",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; devMagicUrl?: string };
    expect(json.ok).toBe(true);

    const user = await db()
      .prepare(`SELECT id FROM users WHERE email = 'alice@example.com'`)
      .first<{ id: string }>();
    expect(user?.id).toBeTruthy();

    const rows = await consentsFor(user!.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => ({ type: r.type, version: r.version, accepted: r.accepted }))).toEqual(
      expect.arrayContaining([
        { type: "offer", version: OFFER_DOC_VERSION, accepted: 1 },
        { type: "pdn", version: PDN_DOC_VERSION, accepted: 1 },
        { type: "marketing", version: MARKETING_CONSENT_VERSION, accepted: 0 },
      ]),
    );
    const before = Math.floor(Date.now() / 1000) - 5;
    for (const r of rows) {
      expect(r.accepted_at).toBeGreaterThanOrEqual(before);
      expect(r.ip).toBe("203.0.113.10");
    }
    expect(await hasAcceptedConsent(db(), user!.id, "offer")).toBe(true);
    expect(await hasAcceptedConsent(db(), user!.id, "pdn")).toBe(true);
  });

  it("callback с consents перефиксирует запись", async () => {
    const create = await call("/api/auth/magic-link", {
      body: {
        email: "bob@example.com",
        consents: { offer: true, pdn: true, marketing: false },
      },
    });
    const { devMagicUrl } = (await create.json()) as { devMagicUrl: string };
    const token = new URL(devMagicUrl).searchParams.get("token")!;

    const cb = await call("/api/auth/callback", {
      body: {
        token,
        consents: { offer: true, pdn: true, marketing: true },
      },
    });
    expect(cb.status).toBe(200);

    const user = await db()
      .prepare(`SELECT id FROM users WHERE email = 'bob@example.com'`)
      .first<{ id: string }>();
    const marketing = await db()
      .prepare(
        `SELECT accepted FROM user_consents
         WHERE user_id = ?1 AND type = 'marketing' AND version = ?2`,
      )
      .bind(user!.id, MARKETING_CONSENT_VERSION)
      .first<{ accepted: number }>();
    expect(marketing?.accepted).toBe(1);
  });

  it("password login без consents → 400; с consents — пишет строки", async () => {
    const now = Math.floor(Date.now() / 1000);
    const userId = "usr_pwd_consent";
    await db()
      .prepare(
        `INSERT INTO users (id, email, name, plan, created_at, updated_at)
         VALUES (?1, 'pwd@example.com', 'Pwd', 'free', ?2, ?2)`,
      )
      .bind(userId, now)
      .run();
    await setUserPasswordWithPolicy(db(), userId, "uchlist2026");

    const missing = await call("/api/auth/login", {
      body: { email: "pwd@example.com", password: "uchlist2026" },
    });
    expect(missing.status).toBe(400);
    expect(await consentsFor(userId)).toEqual([]);

    const ok = await call("/api/auth/login", {
      body: {
        email: "pwd@example.com",
        password: "uchlist2026",
        consents: { offer: true, pdn: true, marketing: false },
      },
    });
    expect(ok.status).toBe(200);
    const rows = await consentsFor(userId);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.type === "marketing")?.accepted).toBe(0);
  });

  it("повторный login с marketing=false не затирает ранее принятое true", async () => {
    const now = Math.floor(Date.now() / 1000);
    const userId = "usr_mkt_keep";
    await db()
      .prepare(
        `INSERT INTO users (id, email, name, plan, created_at, updated_at)
         VALUES (?1, 'keep@example.com', 'Keep', 'free', ?2, ?2)`,
      )
      .bind(userId, now)
      .run();
    await setUserPasswordWithPolicy(db(), userId, "uchlist2026");

    const first = await call("/api/auth/login", {
      body: {
        email: "keep@example.com",
        password: "uchlist2026",
        consents: { offer: true, pdn: true, marketing: true },
      },
    });
    expect(first.status).toBe(200);

    const second = await call("/api/auth/login", {
      body: {
        email: "keep@example.com",
        password: "uchlist2026",
        consents: { offer: true, pdn: true, marketing: false },
      },
    });
    expect(second.status).toBe(200);

    const marketing = await db()
      .prepare(
        `SELECT accepted FROM user_consents
         WHERE user_id = ?1 AND type = 'marketing' AND version = ?2`,
      )
      .bind(userId, MARKETING_CONSENT_VERSION)
      .first<{ accepted: number }>();
    expect(marketing?.accepted).toBe(1);
  });
});

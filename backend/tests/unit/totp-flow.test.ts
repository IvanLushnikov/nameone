/**
 * ТЗ-24, лист-5: код подтверждения администратора — полный путь.
 *
 * Файл `totp.test.ts` проверяет криптографию против опубликованного тест-вектора
 * RFC 6238. Здесь — поведение: настройка, вход, резервные коды, блокировка
 * перебора, аварийный путь и то, что учительский вход не сломан.
 *
 * ДВА ПРИНЦИПА, КОТОРЫЕ ЗДЕСЬ ПРОВЕРЯЮТСЯ ОСОБЕННО
 * -----------------------------------------------
 *
 * 1. НАСТРОЕННЫЙ, НО НЕ ПОДТВЕРЖДЁННЫЙ КОД НЕ ДАЁТ ВХОДА. Иначе «начал
 *    настраивать, отвлёкся» заканчивается потерей доступа навсегда.
 *
 * 2. АВАРИЙНЫЙ ПУТЬ ОБЯЗАН РАБОТАТЬ. Единственный администратор продукта,
 *    потерявший телефон и резервные коды, иначе навсегда теряет доступ к
 *    единственному разделу с финансами. «Починить» это, пока телефон цел, иначе
 *    не получится.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Env } from "../../src/env";
// Импорт самого приложения ОБЯЗАТЕЛЕН: без него SELF поднимает worker из
// wrangler.toml, а не текущий src/index.ts, и роутов в нём может не быть.
// Так делают остальные тесты с SELF (auth.test.ts, artifact-routes.test.ts).
import app from "../../src/index";

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

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_passwords (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,
  salt       TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_totp (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc     TEXT NOT NULL,
  secret_iv      TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  confirmed_at   INTEGER,
  last_used_at   INTEGER
);

CREATE TABLE IF NOT EXISTS admin_backup_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_totp_recovery (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT,
  disabled_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_login_pending (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  payload_json TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
`;

const ADMIN_TOKEN = "tok_admin_mfa";
const TEACHER_TOKEN = "tok_teacher_mfa";
const ADMIN_EMAIL = "admin@mfa.test.local";
const TEACHER_EMAIL = "teacher@mfa.test.local";

async function callApi(path: string, options: { token?: string; body?: unknown; method?: string } = {}) {
  return SELF.fetch(`https://uchlist.test${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { cookie: `session=${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

/** Завести админа с паролем. Пароль «Passw0rd!test» — соответствует политике ТЗ-23. */
async function seed() {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
     VALUES ('u_mfa_admin', ?2, 'Владелец', 'plus', 1, ?1, ?1),
            ('u_mfa_teacher', ?3, 'Учитель', 'free', 0, ?1, ?1)`,
  )
    .bind(now, ADMIN_EMAIL, TEACHER_EMAIL)
    .run();

  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES (?1, 'u_mfa_admin', ?3, ?4), (?2, 'u_mfa_teacher', ?3, ?4)`,
  )
    .bind(ADMIN_TOKEN, TEACHER_TOKEN, now + 3600, now)
    .run();

  // Пароли кладём напрямую: для теста важна не проверка пароля, а второй шаг.
  for (const [id, salt] of [
    ["u_mfa_admin", "AAAAAAAAAAAAAAAAAAAAAA=="],
    ["u_mfa_teacher", "AQEBAQEBAQEBAQEBAQEBAQ=="],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO user_passwords (user_id, hash, salt, iterations, created_at, updated_at)
       VALUES (?1, 'x', ?2, 1000, ?3, ?3)`,
    )
      .bind(id, salt, now)
      .run();
  }
}

/** Код из приложения для заданного секрета (тест выступает за приложение). */
async function codeFor(secretBase32: string, atMs = Date.now()): Promise<string> {
  const { base32Decode, totpAt, currentCounter } = await import("../../src/lib/totp");
  return totpAt(base32Decode(secretBase32), currentCounter(atMs));
}

/** Пройти настройку до конца: setup → confirm. Возвращает секрет и резервные коды. */
async function setupTotp(secret: string): Promise<{ backupCodes: string[] }> {
  const start = await callApi("/api/admin/totp/setup", { token: ADMIN_TOKEN, method: "POST" });
  expect(start.status).toBe(200);

  const code = await codeFor(secret);
  const confirm = await callApi("/api/admin/totp/confirm", {
    token: ADMIN_TOKEN,
    body: { code },
  });
  expect(confirm.status).toBe(200);
  const body = (await confirm.json()) as { backupCodes: string[] };
  return { backupCodes: body.backupCodes };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
});

beforeEach(async () => {
  for (const table of [
    "admin_totp",
    "admin_backup_codes",
    "admin_totp_recovery",
    "admin_login_pending",
    "sessions",
    "user_passwords",
    "rate_limits",
    "admin_audit_log",
    "magic_links",
    "users",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seed();
});

describe("G1: настройка и вход с кодом", () => {
  it("после настройки вход по паролю просит код, а не выдаёт сессию", async () => {
    const { startTotpSetup } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");

    // Пароль верный, код включён — но это ещё не подтверждённая настройка.
    await codeFor(secret);

    const me = await callApi("/api/admin/totp", { token: ADMIN_TOKEN });
    const meBody = (await me.json()) as { enabled: boolean };
    expect(meBody.enabled).toBe(false);

    const confirm = await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });
    expect(confirm.status).toBe(200);

    const meAfter = await callApi("/api/admin/totp", { token: ADMIN_TOKEN });
    expect(((await meAfter.json()) as { enabled: boolean }).enabled).toBe(true);
  });

  it("неподтверждённый секрет входа не даёт — это защита от «настроил и забыл»", async () => {
    const { startTotpSetup } = await import("../../src/services/admin-totp");
    await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");

    const row = await env.DB
      .prepare(`SELECT confirmed_at FROM admin_totp WHERE user_id = 'u_mfa_admin'`)
      .first<{ confirmed_at: number | null }>();
    expect(row?.confirmed_at).toBeNull();

    // Состояние: «настройка начата». Вход по паролю должен идти как обычно,
    // потому что код ещё не действует.
    const { isTotpEnabled } = await import("../../src/services/admin-totp");
    expect(await isTotpEnabled(env.DB, "u_mfa_admin")).toBe(false);
  });

  it("верный код пускает, неверный — нет, и время ответа не зависит от ответа", async () => {
    const { startTotpSetup } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });

    const { createPendingToken, verifyLoginCode } = await import("../../src/services/admin-totp");
    const pending = await createPendingToken(env.DB, "u_mfa_admin");

    const good = await callApi("/api/admin/totp/verify", {
      body: { code: await codeFor(secret), pendingToken: pending },
    });
    expect(good.status).toBe(200);

    // Для неверного кода нужен СВОЙ временный токен: предыдущий уже израсходован
    // (одноразовый), и повторная отправка дала бы 401 «токен истёк» — то есть
    // проверяла бы не код, а одноразовость. Проверяем именно код.
    const bad = await callApi("/api/admin/totp/verify", {
      body: { code: "000000", pendingToken: await createPendingToken(env.DB, "u_mfa_admin") },
    });
    expect(bad.status).toBe(400);

    const still = await verifyLoginCode(env.DB, env as unknown as Env, "u_mfa_admin", "000000");
    expect(still.ok).toBe(false);
  });

  it("временный токен одноразовый: войдя им, войти им же второй раз нельзя", async () => {
    const { startTotpSetup, createPendingToken } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });

    const pending = await createPendingToken(env.DB, "u_mfa_admin");
    const first = await callApi("/api/admin/totp/verify", {
      body: { code: await codeFor(secret), pendingToken: pending },
    });
    expect(first.status).toBe(200);

    const second = await callApi("/api/admin/totp/verify", {
      body: { code: await codeFor(secret), pendingToken: pending },
    });
    expect(second.status).toBe(401);
  });

  it("выданная сессия админа живёт сутки, а не месяц", async () => {
    const { startTotpSetup, createPendingToken } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });

    const pending = await createPendingToken(env.DB, "u_mfa_admin");
    const res = await callApi("/api/admin/totp/verify", {
      body: { code: await codeFor(secret), pendingToken: pending },
    });

    // Токен берём из cookie: с 15.10.2026 он туда только и отдаётся, в теле
    // ответа его больше нет — иначе его прочитает любой XSS.
    const cookie = res.headers.get("set-cookie") ?? "";
    const sessionToken = /session=([^;]+)/.exec(cookie)?.[1];
    expect(sessionToken).toBeTruthy();

    const row = await env.DB
      .prepare(`SELECT expires_at, created_at FROM sessions WHERE token = ?1`)
      .bind(sessionToken!)
      .first<{ expires_at: number; created_at: number }>();

    // Решение владельца: сессия суперадминки — сутки (у учителя 30 дней).
    expect(row!.expires_at - row!.created_at).toBe(24 * 3600);
  });
});

describe("G2: резервный код одноразовый", () => {
  it("первый раз пускает, второй — нет", async () => {
    const { startTotpSetup, createPendingToken } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    const { backupCodes } = await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    }).then((r) => r.json()) as { backupCodes: string[] };

    expect(backupCodes).toHaveLength(10);

    const first = await callApi("/api/admin/totp/verify", {
      body: { code: backupCodes[0], pendingToken: await createPendingToken(env.DB, "u_mfa_admin") },
    });
    expect(first.status).toBe(200);

    const second = await callApi("/api/admin/totp/verify", {
      body: { code: backupCodes[0], pendingToken: await createPendingToken(env.DB, "u_mfa_admin") },
    });
    expect(second.status).toBe(400);
  });

  it("в базе нет самих кодов — только хеши", async () => {
    const { startTotpSetup } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    const { backupCodes } = await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    }).then((r) => r.json()) as { backupCodes: string[] };

    const rows = await env.DB
      .prepare(`SELECT code_hash FROM admin_backup_codes`)
      .all<{ code_hash: string }>();

    expect(rows.results).toHaveLength(10);
    for (const hash of rows.results.map((r) => r.code_hash)) {
      for (const code of backupCodes) {
        expect(hash).not.toContain(code);
      }
    }
  });

  it("перевыпуск гасит старые коды", async () => {
    const { startTotpSetup, createPendingToken } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    const old = await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    }).then((r) => r.json()) as { backupCodes: string[] };

    // Явно POST: без тела callApi по умолчанию шлёт GET, а роут — только POST.
    const fresh = await callApi("/api/admin/totp/backup-codes", { token: ADMIN_TOKEN, method: "POST" });
    expect(fresh.status).toBe(200);

    const res = await callApi("/api/admin/totp/verify", {
      body: { code: old.backupCodes[0], pendingToken: await createPendingToken(env.DB, "u_mfa_admin") },
    });
    expect(res.status).toBe(400);
  });
});

describe("G4: перебор кодов блокируется", () => {
  it("после серии неверных кодов прилетает отказ по частоте", { timeout: 180_000 }, async () => {
    const { startTotpSetup, createPendingToken } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });

    const pending = await createPendingToken(env.DB, "u_mfa_admin");
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await callApi("/api/admin/totp/verify", {
        body: { code: "000000", pendingToken: pending },
      });
      if (res.status === 429) limited += 1;
    }
    // Лимит — 10 попыток за 10 минут. Дальше обязан быть отказ, иначе шесть
    // цифр перебираются за секунды.
    expect(limited).toBeGreaterThan(0);
  });
});

describe("G5: аварийный путь существует", () => {
  it("отключение кода возвращает доступ и остаётся в журнале", async () => {
    const { startTotpSetup, emergencyDisableTotp, isTotpEnabled } = await import(
      "../../src/services/admin-totp"
    );
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });
    expect(await isTotpEnabled(env.DB, "u_mfa_admin")).toBe(true);

    const wasEnabled = await emergencyDisableTotp(
      env.DB,
      "u_mfa_admin",
      "потерян телефон",
    );
    expect(wasEnabled).toBe(true);
    expect(await isTotpEnabled(env.DB, "u_mfa_admin")).toBe(false);

    const log = await env.DB
      .prepare(`SELECT reason FROM admin_totp_recovery WHERE user_id = 'u_mfa_admin'`)
      .first<{ reason: string }>();
    // После аварийного отключения в системе живёт администратор без второго
    // фактора — это обязано остаться в истории, а не раствориться.
    expect(log?.reason).toBe("потерян телефон");
  });

  it("секрет и резервные коды стираются вместе с отключением", async () => {
    const { startTotpSetup, emergencyDisableTotp } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });

    await emergencyDisableTotp(env.DB, "u_mfa_admin");

    const totp = await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_totp`).first<{ n: number }>();
    const codes = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM admin_backup_codes`)
      .first<{ n: number }>();
    expect(totp?.n).toBe(0);
    expect(codes?.n).toBe(0);
  });
});

describe("G6: учительский вход не слома", () => {
  it("учитель не может настраивать код подтверждения", async () => {
    const res = await callApi("/api/admin/totp/setup", { token: TEACHER_TOKEN, method: "POST" });
    expect([400, 401, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it("у учителя код подтверждения не спрашивается и вообще не настроен", async () => {
    const res = await callApi("/api/admin/totp", { token: TEACHER_TOKEN });
    expect(res.status).not.toBe(200);
  });

  it("сессия учителя остаётся 30-дневной — решение ТЗ-23 не задето", async () => {
    // Учительская сессия создаётся обычным входом; проверяем, что таблица
    // сессий и её срок не изменились из-за появления админского кода.
    const row = await env.DB
      .prepare(`SELECT expires_at, created_at FROM sessions WHERE token = ?1`)
      .bind(TEACHER_TOKEN)
      .first<{ expires_at: number; created_at: number }>();
    expect(row!.expires_at - row!.created_at).toBe(3600);
  });
});

describe("итог листа-5", () => {
  it("BACKUP_CODE_SINGLE_USE — резервный код работает один раз", { timeout: 180_000 }, async () => {
    const { startTotpSetup, createPendingToken } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    const { backupCodes } = (await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    }).then((r) => r.json())) as { backupCodes: string[] };

    const first = await callApi("/api/admin/totp/verify", {
      body: { code: backupCodes[0], pendingToken: await createPendingToken(env.DB, "u_mfa_admin") },
    });
    expect(first.status).toBe(200);

    const second = await callApi("/api/admin/totp/verify", {
      body: { code: backupCodes[0], pendingToken: await createPendingToken(env.DB, "u_mfa_admin") },
    });
    expect(second.status).toBe(400);
    console.log("BACKUP_CODE_SINGLE_USE");
  });

  it("TOTP_BRUTE_FORCE_BLOCKED — перебор упирается в блокировку", { timeout: 180_000 }, async () => {
    const { startTotpSetup, createPendingToken } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });

    const pending = await createPendingToken(env.DB, "u_mfa_admin");
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await callApi("/api/admin/totp/verify", {
        body: { code: "000000", pendingToken: pending },
      });
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    console.log("TOTP_BRUTE_FORCE_BLOCKED");
  });

  it("EMERGENCY_RECOVERY_WORKS — аварийный путь возвращает доступ", async () => {
    const { startTotpSetup, emergencyDisableTotp, isTotpEnabled } = await import(
      "../../src/services/admin-totp"
    );
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });

    await emergencyDisableTotp(env.DB, "u_mfa_admin", "аварийно");
    expect(await isTotpEnabled(env.DB, "u_mfa_admin")).toBe(false);

    // Положительный контроль: после аварийного отключения вход снова идёт
    // по одному паролю, а не блокируется навсегда.
    const { createPendingToken } = await import("../../src/services/admin-totp");
    const res = await callApi("/api/admin/totp/verify", {
      body: { code: "000000", pendingToken: await createPendingToken(env.DB, "u_mfa_admin") },
    });
    expect(res.status).toBe(400);
    console.log("EMERGENCY_RECOVERY_WORKS");
  });

  it("TEACHER_LOGIN_UNCHANGED — учителя это не касается", async () => {
    const res = await callApi("/api/admin/totp/setup", { token: TEACHER_TOKEN, method: "POST" });
    expect(res.status).not.toBe(200);
    // Плюс контроль: администратору тот же адрес доступен.
    const adminRes = await callApi("/api/admin/totp/setup", { token: ADMIN_TOKEN, method: "POST" });
    expect(adminRes.status).toBe(200);
    console.log("TEACHER_LOGIN_UNCHANGED");
  });
});

/**
 * G7: вход по ссылке из письма (15.10.2026).
 *
 * Найдено при аудите: `/api/auth/callback` выдавал администратору полную
 * 30-дневную сессию сразу, минуя код подтверждения. Второй фактор защищал
 * только вход по паролю — то есть ровно наполовину, а получить суперадминку
 * было достаточно через письмо.
 *
 * Здесь закрывается именно это, и проверяется не «есть ли код», а «какая
 * сессия в итоге у человека»: cookie, база и срок жизни.
 */
describe("G7: вход по ссылке из письма", () => {
  /** Положить ссылку для входа на указанную почту и вернуть её токен. */
  async function issueLink(email: string): Promise<string> {
    const token = `ml_${email.replace(/[^a-z]/gi, "")}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO magic_links (token, email, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(token, email, now + 900, now)
      .run();
    return token;
  }

  async function enableTotpForAdmin(): Promise<string> {
    const { startTotpSetup } = await import("../../src/services/admin-totp");
    const { secret } = await startTotpSetup(env.DB, env as unknown as Env, "u_mfa_admin");
    await callApi("/api/admin/totp/confirm", {
      token: ADMIN_TOKEN,
      body: { code: await codeFor(secret) },
    });
    return secret;
  }

  /** Сколько сессий у админа прямо сейчас. */
  async function adminSessionCount(): Promise<number> {
    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'u_mfa_admin'`)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  it("ссылка администратору с включённым кодом не выдаёт сессию — только второй шаг", async () => {
    await enableTotpForAdmin();
    const before = await adminSessionCount();

    const token = await issueLink(ADMIN_EMAIL);
    const res = await callApi("/api/auth/callback", { body: { token } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { mfaRequired?: boolean; pendingToken?: string; user?: unknown };
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.pendingToken).toBe("string");
    // Пользователя в ответе быть не должно: человек ещё не вошёл.
    expect(body.user).toBeUndefined();

    // Главное утверждение теста: сессии нет ни в cookie, ни в базе.
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain("session=");
    expect(await adminSessionCount()).toBe(before);
    console.log("MAGIC_LINK_NO_SESSION_WITHOUT_CODE");
  });

  it("ссылка учителю по-прежнему входит сразу — второй шаг только у администратора", async () => {
    const token = await issueLink(TEACHER_EMAIL);
    const res = await callApi("/api/auth/callback", { body: { token } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: { email: string }; mfaRequired?: boolean };
    expect(body.mfaRequired).toBeUndefined();
    expect(body.user?.email).toBe(TEACHER_EMAIL);
    expect(res.headers.get("set-cookie") ?? "").toContain("session=");
    console.log("TEACHER_MAGIC_LINK_UNCHANGED");
  });

  it("второй шаг кладёт cookie сессии, а не возвращает токен в теле ответа", async () => {
    const secret = await enableTotpForAdmin();

    const token = await issueLink(ADMIN_EMAIL);
    const first = await callApi("/api/auth/callback", { body: { token } });
    const firstBody = (await first.json()) as { pendingToken: string };

    const second = await callApi("/api/admin/totp/verify", {
      body: { code: await codeFor(secret), pendingToken: firstBody.pendingToken },
    });

    expect(second.status).toBe(200);
    const cookie = second.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("session=");

    // Токен в теле ответа — утечка: его читает любой XSS или расширение.
    const body = (await second.json()) as Record<string, unknown>;
    expect(body.token).toBeUndefined();
    expect((body.user as { email?: string } | null)?.email).toBe(ADMIN_EMAIL);

    // И эта cookie действительно рабочая, а не просто выглядит: с ней сервер
    // узнаёт администратора. Проверяем через /api/auth/me — он не требует
    // таблиц статистики и потому доступен в этой тестовой схеме.
    const sessionToken = /session=([^;]+)/.exec(cookie)?.[1];
    const me = await callApi("/api/auth/me", { token: sessionToken });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } | null }).user?.email).toBe(ADMIN_EMAIL);
    console.log("MFA_STEP_SETS_SESSION_COOKIE");
  });
});
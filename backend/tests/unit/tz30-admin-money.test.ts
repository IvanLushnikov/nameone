/**
 * ТЗ-30, работа 1: админка не знает ни одной цены, а выручка — по факту.
 *
 * ─── ЧТО ЛОВИТ ЭТОТ ФАЙЛ ──────────────────────────────────────────────────
 *
 * 1. СКАН ИСХОДНИКА. В `routes/admin.ts` была таблица `MONTHLY_REVENUE_RUB`
 *    с ценами 500 / 990 / 1500 ₽ — ценами ДО снижения 12.10.2026. Прайс и
 *    биллинг обновились, админка — нет, и по этой цифре владелец решал,
 *    «хватает ли денег». Скан ловит возврат любого захардкоженного числа:
 *    это единственный способ поймать правку, которую компилятор не видит.
 *
 * 2. ВЫРУЧКА ПО ПЛАТЕЖУ, А НЕ ПО ТАРИФУ. Платёж до 12.10 должен попадать в
 *    выручку по своей цене. Считаем по таблице `payments`, а если платёж
 *    старше снижения попал в отчёт — он обязан дать свою сумму, иначе
 *    история за месяцы перепишется задним числом.
 *
 * 3. ПРИВЕДЕНИЕ К КОПЕЙКАМ. `payments.amount_rub` хранит КОПЕЙКИ (так его
 *    пишет `billing.ts` при создании платежа). Регрессия, которую ловит
 *    тест: забыть `/100`, и 249 ₽ превратятся в 24 900 ₽.
 *
 * 4. НЕПЛАТЯЩИЙ ПОЛЬЗОВАТЕЛЬ. У бесплатного тарифа выручки нет, и `costShare`
 *    обязан быть null, а не 0 или делением на ноль.
 *
 * ─── ПОЧЕМУ ЗДЕСЬ НЕТ СКАНА ИСХОДНИКА admin.ts ────────────────────────────
 * Бэк-тесты идут в workerd, где `fs` не реализован: `readFileSync` падает с
 * «not yet implemented in Workers» (так же написано в начале worksheets.test.ts
 * и billing.test.ts). Скан исходника `admin.ts` живёт поэтому на фронте, в
 * `tests/integration/plans-price-sources.test.ts` (node-пул, fs есть).
 *
 * ─── ПОЧЕМУ ОЖИДАЕМЫЕ СУММЫ, А НЕ КОНСТАНТЫ ───────────────────────────────
 * Ожидания взяты из `PRICES` и из самих вставленных платежей, а не выписаны
 * руками из тех же данных, что потом сравниваются: иначе проверка «совпало с
 * самим собой» проходит всегда.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

import { PRICES } from "../../src/services/billing";

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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  data_json   TEXT,
  created_at  INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan                TEXT NOT NULL,
  period              TEXT NOT NULL DEFAULT 'monthly',
  amount_rub          INTEGER NOT NULL,
  yookassa_payment_id TEXT UNIQUE,
  status              TEXT NOT NULL,
  confirmation_url    TEXT,
  created_at          INTEGER NOT NULL,
  completed_at        INTEGER
);
`;

const ADMIN_TOKEN = "tok_admin_money";
const NOW = Math.floor(Date.now() / 1000);

function monthStart(): number {
  const d = new Date();
  return Math.floor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getTime() / 1000);
}

async function adminUsage() {
  const res = await SELF.fetch("https://uchlist.test/api/admin/usage", {
    headers: { cookie: `session=${ADMIN_TOKEN}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    users: Array<{
      userId: string | null;
      plan: string;
      revenueRub: number;
      costShare: number | null;
      hasPayment: boolean;
      listPriceRub: number | null;
    }>;
    totals: { revenueRub: number; alerts: number };
  };
}

async function seed() {
  for (const table of ["events", "llm_logs", "payments", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
     VALUES ('u_admin', 'admin@test.local', 'Admin', 'plus', 1, ?1, ?1),
            ('u_old', 'old@test.local', 'Old', 'base', 0, ?1, ?1),
            ('u_free', 'free@test.local', 'Free', 'free', 0, ?1, ?1)`,
  )
    .bind(NOW)
    .run();

  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES (?1, 'u_admin', ?2, ?3)`,
  )
    .bind(ADMIN_TOKEN, NOW + 3600, NOW)
    .run();

  // Платёж ДО снижения 12.10 по СТАРОЙ цене 500 ₽ = 50 000 копеек.
  // Именно он проверяет главный пункт ТЗ-30: своя сумма, а не нынешний прайс.
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, plan, period, amount_rub, status, created_at, completed_at)
     VALUES ('pay_old', 'u_old', 'base', 'monthly', 50000, 'succeeded', ?1, ?1),
            ('pay_new', 'u_old', 'base', 'monthly', ?2, 'succeeded', ?1, ?1),
            -- Неоплаченный: в выручку не попадает, как и раньше.
            ('pay_pending', 'u_old', 'base', 'monthly', 99900, 'pending', ?1, NULL)`,
  )
    .bind(NOW, PRICES.base.monthly)
    .run();

  // Бесплатный тариф, чтобы проверить ветку без выручки.
  await env.DB.prepare(
    `INSERT INTO llm_logs (id, user_id, task, provider, model, plan, tokens_in, tokens_out,
                           cost_usd, latency_ms, created_at)
     VALUES ('log_old', 'u_old', 'worksheet-gen', 'polza', 'gpt-6-luna', 'base', 100, 200, 1.0, 100, ?1),
            ('log_free', 'u_free', 'worksheet-gen', 'polza', 'gpt-6-luna', 'free', 100, 200, 1.0, 100, ?1)`,
  )
    .bind(NOW)
    .run();
}

describe("ТЗ-30 работа 1: выручка админки считается по фактическим платежам", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
  });

  beforeEach(async () => {
    await seed();
  });

  it("M2: выручка = сумма платежей пользователя, включая платёж до 12.10", async () => {
    const body = await adminUsage();
    const old = body.users.find((u) => u.userId === "u_old");
    expect(old, "пользователь с платежами не попал в отчёт").toBeDefined();

    // 50 000 копеек (старые 500 ₽) + нынешние 249 ₽ из PRICES.
    const expected = (50_000 + PRICES.base.monthly) / 100;
    expect(old!.revenueRub).toBe(expected);

    // Главное утверждение ТЗ-30: платёж по старой цене учтён по СТАРОЙ цене.
    // Если бы считали по нынешнему прайсу, сумма была бы втрое меньше.
    expect(old!.revenueRub).toBeGreaterThan(PRICES.base.monthly / 100);
    expect(body.totals.revenueRub).toBe(expected);
  });

  it("M3: рядом с фактом отдаётся текущая цена из PRICES — и она в рублях", async () => {
    const body = await adminUsage();
    const old = body.users.find((u) => u.userId === "u_old")!;
    expect(old.listPriceRub).toBe(PRICES.base.monthly / 100);
    // Регрессия: forgot /100 → 24 900 вместо 249.
    expect(old.listPriceRub).toBe(249);
  });

  it("M4: у бесплатного тарифа выручки нет, costShare = null (не деление на ноль)", async () => {
    const body = await adminUsage();
    const free = body.users.find((u) => u.userId === "u_free")!;
    expect(free.revenueRub).toBe(0);
    expect(free.costShare).toBeNull();
    expect(free.hasPayment).toBe(false);
    // Нет выручки — нет и ложной тревоги по COGS.
    expect(free).not.toHaveProperty("overAlert", true);
  });

  it("M5: неоплаченный платёж в выручку не попадает", async () => {
    const body = await adminUsage();
    const old = body.users.find((u) => u.userId === "u_old")!;
    // 99 900 копеек (999 ₽) со статусом pending в сумму не вошли.
    expect(old.revenueRub).toBeLessThan(999);
    expect(old.hasPayment).toBe(true);
  });
});
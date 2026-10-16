/**
 * ТЗ-30: экран «Деньги» (`/superpower/money`) не имеет права показывать
 * копейки как рубли.
 *
 * ─── ПОЧЕМУ ЭТОТ ФАЙЛ ОТДЕЛЬНО, А НЕ В tz30-admin-money.test.ts ───────────
 * Баг был исправлен в `routes/admin.ts`, но тот файл читает ДРУГОЙ источник.
 * Экран `/superpower/money` подписан на `GET /api/admin/money`, а тот, в свою
 * очередь, читает `services/admin-stats.ts` — свой файл с СВОЕЙ копией
 * запроса выручки. Копия и жила в ней без `/100`, поэтому:
 *
 *   routes/admin.ts        — починили, /api/admin/usage показывает верно;
 *   services/admin-stats.ts — забыли, /superpower/money показывал в 100 раз
 *                            больше (24 900 ₽ вместо 249 ₽).
 *
 * Тест закрывает именно второй источник. Проверять надо оба: «починили там»
 * не означает «починили везде».
 *
 * ─── ЧТО ЛОВИТ ────────────────────────────────────────────────────────────
 *
 * S1. ГЛАВНОЕ. Платёж 249 ₽ обязан показаться как 249 ₽, а не как 24 900 ₽.
 *     Число взято из `PRICES.base.monthly` — не выписано руками, чтобы тест
 *     не прошёл бы сам с собой, если цена снова поменяется.
 *
 * S2. ТРИ МЕСТА ОДНОЙ ПРАВДЫ. Выручка считается в файле трижды: в
 *     `revenueByUser`, в `getOverview` и через них в `getCostByUser`. Все три
 *     обязаны давать одно и то же число в рублях.
 *
 * S3. РАСХОД — РУБЛИ, НЕ КОПЕЙКИ. `llm_costs_actual.cost_rub` называется так
 *     же, как `payments.amount_rub`, но лежат в РУБЛЯХ (это счёт провайдера).
 *     Тест специально кладёт расход 0,02 ₽: если бы сюда прикрутили `/100`,
 *     расход стал бы 0,0002 ₽ и тест на это отвечает падением. Это защита от
 *     «починки» в не ту сторону, а не просто проверка суммы.
 *
 * S4. ДОЛЯ РАСХОДА СЧИТАЕТСЯ. `costShare = расход / выручка`. Пока выручка была
 *     завышена в 100 раз, доля всегда была около нуля и тревога «съел больше
 *     четверти выручки» не срабатывала никогда — то есть предсказатель из ТЗ
 *     был мёртвым. С настоящими рублями он снова может сработать.
 *
 * S5. ТАБЛИЦА «ПЛАТЕЖИ». Тот же экран, та же колонка `payments.amount_rub`,
 *     но запрос в `routes/admin.ts` отдавал её сырой. Фронт умеет только
 *     форматировать число, не переводить единицы, — то есть 249 ₽ превращались
 *     в 24 900 ₽ ещё и в списке платежей.
 *
 * ─── ПРО МОК, А НЕ ЖИВОЙ ПРОДАКШН ───────────────────────────────────────
 * Боевой `payments` на момент написания пуст (проверено 16.10.2026:
 * `SELECT ... FROM payments` на удалённой D1 отдаёт 0 строк), поэтому «как
 * в бою» проверить нечем. Значения кладём теми же путём, каким их кладёт
 * `billing.ts` — целыми копейками.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

import { PRICES } from "../../src/services/billing";
import { getOverview, getCostByUser, currentMonth, monthRange, kopecksToRub } from "../../src/services/admin-stats";

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

-- Нужна админскому rate-limit мидлвару: без неё /api/admin/money отдаёт 500
-- ещё до роута, и тест падал бы не на деньгах, а на отсутствии таблицы.
CREATE TABLE IF NOT EXISTS rate_limits (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
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

-- СМ. src/db/schema.sql: amount_rub — ИМЯ ГОВОРИТ ПРО РУБЛИ, ЗНАЧЕНИЕ ПРО
-- КОПЕЙКИ. Именно так его пишет billing.ts (amountKopecks).
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

-- А вот cost_rub — РЕАЛЬНЫЕ РУБЛИ от провайдера (polza usage.cost_rub).
CREATE TABLE IF NOT EXISTS llm_costs_actual (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  task            TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  cost_rub        REAL NOT NULL,
  cost_usd_est    REAL,
  latency_ms      INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS polza_balance_snapshots (
  id                  TEXT PRIMARY KEY,
  amount_rub          REAL NOT NULL,
  available_rub       REAL,
  reserved_rub        REAL,
  spent_rub           REAL,
  provider_updated_at TEXT,
  created_at          INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  payload_json TEXT,
  created_at   INTEGER NOT NULL
);
`;

const NOW = Math.floor(Date.now() / 1000);
const ADMIN_TOKEN = "tok_admin_stats";
const MONTH = currentMonth();

/** Середина текущего месяца — чтобы запись точно попала в период отчёта. */
const IN_MONTH = (() => {
  const r = monthRange(MONTH)!;
  return Math.floor((r.from + r.to) / 2);
})();

/**
 * Расход учителя у провайдера — 0,02 ₽ (двадцать копеек).
 *
 * Число выбрано специально: с ценой одного рабочего листа это правдоподобная
 * мелочь, и одновременно оно СЛУЖАЕТ ЛОВУШКОЙ. Если в `getCostByUser` появят
 * `/100` по аналогии с выручкой, расход станет 0,0002 ₽ и все проверки S3–S4
 * упадут. То есть тест защищает не только от «забыли /100», но и от «добавили
 * /100 куда не надо».
 */
const COST_RUB = 0.02;

async function seed() {
  for (const table of [
    "admin_audit_log",
    "subscriptions",
    "polza_balance_snapshots",
    "llm_costs_actual",
    "payments",
    "llm_logs",
    "events",
    "sessions",
    "users",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
     VALUES ('u_admin', 'admin@test.local', 'Admin', 'plus', 1, ?1, ?1),
            ('u_teach', 'teach@test.local', 'Teach', 'base', 0, ?1, ?1)`,
  )
    .bind(NOW)
    .run();

  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, 'u_admin', ?2, ?3)`,
  )
    .bind(ADMIN_TOKEN, NOW + 3600, NOW)
    .run();

  // ОДИН успешный платёж на 249 ₽ — целыми копейками, ровно как пишет
  // billing.ts. 24 900 ₽ на экране — это ровно то, что было вместо этого.
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, plan, period, amount_rub, status, created_at, completed_at)
     VALUES ('pay_249', 'u_teach', 'base', 'monthly', ?1, 'succeeded', ?2, ?2)`,
  )
    .bind(PRICES.base.monthly, IN_MONTH)
    .run();

  await env.DB.prepare(
    `INSERT INTO llm_costs_actual (id, user_id, task, provider, model, cost_rub, created_at)
     VALUES ('ca_1', 'u_teach', 'worksheet-gen', 'polza', 'gpt-6-luna', ?1, ?2)`,
  )
    .bind(COST_RUB, IN_MONTH)
    .run();
}

/** Ответ `GET /api/admin/money` — тот самый, который читает `/superpower/money`. */
async function adminMoney() {
  const res = await SELF.fetch(`https://uchlist.test/api/admin/money?month=${MONTH}`, {
    headers: { cookie: `session=${ADMIN_TOKEN}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    summary: { revenueRub: number; costRubActual: number | null; costShare: number | null };
    costByUser: Array<{ userId: string | null; costRub: number; revenueRub: number; costShare: number | null }>;
    payments: Array<{ id: string; amount_rub: number }>;
  };
}

describe("ТЗ-30: экран «Деньги» показывает рубли, а не копейки", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
  });

  beforeEach(async () => {
    await seed();
  });

  it("S1: платёж 249 ₽ показан как 249 ₽, а не как 24 900 ₽", async () => {
    const overview = await getOverview(env.DB, MONTH);
    expect(overview.money.revenueRub).toBe(249);

    // Регрессия ровно в том виде, в каком её видел владелец.
    expect(overview.money.revenueRub).not.toBe(24_900);

    // И то же самое по HTTP — экран читает этот ответ, а не функцию напрямую.
    const body = await adminMoney();
    expect(body.summary.revenueRub).toBe(249);
  });

  it("S2: все три места выручки в файле дают одну и ту же сумму", async () => {
    const range = monthRange(MONTH)!;
    const expected = PRICES.base.monthly / 100;

    // (1) getOverview
    const overview = await getOverview(env.DB, MONTH);
    expect(overview.money.revenueRub).toBe(expected);

    // (2) getCostByUser — выручка приходит из revenueByUser, своей копии запроса
    const byUser = await getCostByUser(env.DB, range.from, range.to);
    expect(byUser).toHaveLength(1);
    expect(byUser[0]!.revenueRub).toBe(expected);

    // (3) согласованность: разошлись бы — экран показал бы разные числа в
    // шапке и в таблице, и ни один из них не проверить было бы нечем.
    expect(byUser[0]!.revenueRub).toBe(overview.money.revenueRub);

    // И преобразование одно: 24 900 копеек → 249 ₽.
    expect(kopecksToRub(PRICES.base.monthly)).toBe(249);
  });

  it("S3: расход по счёту провайдера остаётся в рублях (0,02 ₽, а не 0,0002)", async () => {
    const range = monthRange(MONTH)!;
    const byUser = await getCostByUser(env.DB, range.from, range.to);

    // `cost_rub` в llm_costs_actual — рубли. `/100` здесь был бы ошибкой в
    // сто раз, и тест на это упал бы.
    expect(byUser[0]!.costRub).toBe(COST_RUB);
    expect(byUser[0]!.costRub).toBeGreaterThan(0);

    const overview = await getOverview(env.DB, MONTH);
    expect(overview.money.costRubActual).toBe(COST_RUB);
  });

  it("S4: доля расхода считается по настоящим рублям, а не тонет в нуле", async () => {
    const range = monthRange(MONTH)!;
    const byUser = await getCostByUser(env.DB, range.from, range.to);

    // 0,02 ₽ расхода на 249 ₽ выручки — это меньше процента.
    expect(byUser[0]!.costShare).toBe(0);
    expect(byUser[0]!.overAlert).toBe(false);

    // Ключевое: раньше выручка была 24 900 ₽, и та же доля всё равно была бы
    // 0 — из этого и не срабатывала тревога. Теперь доля считается от
    // правильного знаменателя. Проверяем именно формулу, а не «случай 0».
    const manual = Math.round((COST_RUB / PRICES.base.monthly) * 100);
    expect(byUser[0]!.costShare).toBe(manual);
  });

  it("S5: в таблице «Платежи» та же сумма в рублях, а не в копейках", async () => {
    const body = await adminMoney();
    const pay = body.payments.find((p) => p.id === "pay_249");
    expect(pay, "платёж не попал в ответ /api/admin/money").toBeDefined();

    // Фронт (/superpower/money) делает formatRub(r.amount_rub) и больше
    // ничего: 24 900 на экране значит, что деления не было.
    expect(pay!.amount_rub).toBe(249);
    expect(pay!.amount_rub).not.toBe(24_900);
  });

  it("S6: у учителя без платежей выручка нулевая, а доля — null", async () => {
    await env.DB.prepare(`DELETE FROM payments`).run();
    const range = monthRange(MONTH)!;

    const overview = await getOverview(env.DB, MONTH);
    expect(overview.money.revenueRub).toBe(0);
    // Нет выручки — нет и доли: деление на ноль дало бы NaN на экране.
    expect(overview.money.costShare).toBeNull();

    const byUser = await getCostByUser(env.DB, range.from, range.to);
    expect(byUser[0]!.revenueRub).toBe(0);
    expect(byUser[0]!.costShare).toBeNull();
    expect(byUser[0]!.overAlert).toBe(false);
  });
});
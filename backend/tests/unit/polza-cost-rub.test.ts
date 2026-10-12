/**
 * ТЗ-24, лист-2: расходы — по счёту polza.ai, а не по прайсу из кода.
 *
 * ЧТО ПРОВЕРЯЕМ
 * ------------
 * 1. Провайдер отдаёт `usage.cost_rub` (фактическое списание в рублях) — мы его
 *    читаем и доносим до базы, а не выбрасываем, как было до 12.10.2026.
 * 2. Если провайдер такого поля не прислал — расчёт по прайсу продолжает
 *    работать. Это критично: подставлять ноль нельзя, иначе расход тихо
 *    занизится и в /superpower будет написано «потратили 0 ₽».
 * 3. Снимок баланса сохраняет все четыре поля провайдера, а рост кошелька
 *    читается как пополнение.
 *
 * ОТРИЦАТЕЛЬНЫЕ ПРОВЕРКИ С КОНТРОЛЕМ
 * ----------------------------------
 * Пункт 2 — отрицательная проверка («cost_rub нет → costRub = null»). Рядом в
 * том же тесте стоит положительный контроль: расчёт по прайсу даёт НЕ ноль.
 * Без него тест проходил бы и при полностью сломанной тарификации.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import { getPolzaProvider, _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { logLlmCall } from "../../src/llm";
import { recordBalanceSnapshot } from "../../src/services/polza-balance";
import type { Env } from "../../src/env";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

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

CREATE TABLE IF NOT EXISTS llm_costs_actual (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  task        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  cost_rub    REAL NOT NULL,
  cost_usd_est REAL,
  latency_ms  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS polza_balance_snapshots (
  id              TEXT PRIMARY KEY,
  amount_rub      REAL NOT NULL,
  available_rub   REAL,
  reserved_rub    REAL,
  spent_rub       REAL,
  provider_updated_at TEXT,
  created_at      INTEGER NOT NULL
);
`;

/** Ответ polza. `usage.cost_rub` можно задать или убрать через overrides. */
function polzaResponse(usageOverrides: Record<string, unknown> = {}): unknown {
  return {
    model: "openai/gpt-6-luna",
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: {
      prompt_tokens: 3000,
      completion_tokens: 2000,
      total_tokens: 5000,
      ...usageOverrides,
    },
  };
}

async function actualCosts(): Promise<Array<{ cost_rub: number; cost_usd_est: number | null }>> {
  const res = await env.DB.prepare(
    `SELECT cost_rub, cost_usd_est FROM llm_costs_actual ORDER BY created_at DESC`,
  ).all<{ cost_rub: number; cost_usd_est: number | null }>();
  return res.results ?? [];
}

async function snapshots(): Promise<
  Array<{
    amount_rub: number;
    available_rub: number | null;
    reserved_rub: number | null;
    spent_rub: number | null;
  }>
> {
  const res = await env.DB.prepare(
    `SELECT amount_rub, available_rub, reserved_rub, spent_rub
     FROM polza_balance_snapshots ORDER BY created_at DESC`,
  ).all<{
    amount_rub: number;
    available_rub: number | null;
    reserved_rub: number | null;
    spent_rub: number | null;
  }>();
  return res.results ?? [];
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
});

beforeEach(async () => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
  await env.DB.prepare(`DELETE FROM llm_costs_actual`).run();
  await env.DB.prepare(`DELETE FROM llm_logs`).run();
  await env.DB.prepare(`DELETE FROM polza_balance_snapshots`).run();
});

afterEach(() => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("polza: фактическое списание доезжает из ответа", () => {
  it("читает usage.cost_rub — ровно то, что списал провайдер", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(polzaResponse({ cost_rub: 15.75 })), { status: 200 }),
      ),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    expect(res.costRub).toBe(15.75);
  });

  it("принимает cost_rub строкой — polza отдаёт суммы строками", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(polzaResponse({ cost_rub: "15.75000000" })), { status: 200 }),
      ),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    expect(res.costRub).toBe(15.75);
  });

  it("принимает алиас cost, если cost_rub не пришёл", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(polzaResponse({ cost: 3.5 })), { status: 200 })),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    expect(res.costRub).toBe(3.5);
  });

  it("мусорное значение не превращается в число — остаётся null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify(polzaResponse({ cost_rub: "—" })), { status: 200 }),
      ),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    expect(res.costRub).toBeNull();
  });
});

describe("polza: без cost_rub расчёт по прайсу продолжает работать", () => {
  it("costRub = null, НО costUsd остаётся положительным (контроль)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(polzaResponse()), { status: 200 })),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    // Отрицательная часть: провайдер не дал сумму.
    expect(res.costRub).toBeNull();
    // Положительный контроль: расчёт по прайсу НЕ сломан и не обнулился.
    // Именно это отличало бы рабочий код от кода, где молча занулено всё.
    expect(res.costUsd).toBeGreaterThan(0);
  });

  it("logLlmCall без costRub не пишет фактическое списание — и не выдумывает ноль", async () => {
    await logLlmCall(env.DB, {
      userId: null,
      task: "worksheet",
      provider: "polza",
      model: "gpt-6-luna",
      plan: "free",
      tokensIn: 3000,
      tokensOut: 2000,
      costUsd: 0.01,
      latencyMs: 100,
      cached: false,
      fallback: false,
    });

    // Ни одной строки фактических денег: «мы не знаем» ≠ «потратили ноль».
    expect(await actualCosts()).toHaveLength(0);
    // Но основная запись вызова на месте — наблюдаемость не теряется.
    const logs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM llm_logs`).first<{ n: number }>();
    expect(logs?.n).toBe(1);
  });
});

describe("logLlmCall пишет фактическое списание", () => {
  it("costRub попадает в llm_costs_actual рядом с нашей оценкой", async () => {
    await logLlmCall(env.DB, {
      userId: null,
      task: "worksheet",
      provider: "polza",
      model: "gpt-6-luna",
      plan: "free",
      tokensIn: 3000,
      tokensOut: 2000,
      costUsd: 0.01,
      costRub: 15.75,
      latencyMs: 100,
      cached: false,
      fallback: false,
    });

    const rows = await actualCosts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_rub).toBe(15.75);
    // Наша оценка сохраняется рядом — по ней на экране считается расхождение.
    expect(rows[0]!.cost_usd_est).toBe(0.01);
  });
});

describe("снимок баланса polza.ai", () => {
  /** Ответ GET /api/v2/balance — как его отдаёт провайдер. */
  function balanceResponse(overrides: Record<string, unknown> = {}): unknown {
    return {
      amount: "1250.50000000",
      available: "1200.06000000",
      reservedAmount: "12.50000000",
      spentAmount: "845.30000000",
      updatedAt: "2026-10-12T12:00:00.000Z",
      ...overrides,
    };
  }

  it("сохраняет все четыре поля провайдера", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(balanceResponse()), { status: 200 })),
    );

    const result = await recordBalanceSnapshot(env.DB, FAKE_ENV);
    expect(result.recorded).toBe(true);

    const rows = await snapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount_rub).toBe(1250.5);
    expect(rows[0]!.available_rub).toBe(1200.06);
    expect(rows[0]!.reserved_rub).toBe(12.5);
    expect(rows[0]!.spent_rub).toBe(845.3);
  });

  it("рост кошелька читается как пополнение", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(balanceResponse()), { status: 200 })),
    );
    await recordBalanceSnapshot(env.DB, FAKE_ENV);

    // Второй снимок позже по времени и с большим балансом.
    await env.DB.prepare(`UPDATE polza_balance_snapshots SET created_at = created_at - 90000`).run();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(balanceResponse({ amount: "1750.50000000" })), {
            status: 200,
          }),
      ),
    );

    const second = await recordBalanceSnapshot(env.DB, FAKE_ENV);
    expect(second.recorded).toBe(true);
    // 1750.50 − 1250.50 = 500 ₽ положили.
    expect(second.deltaRub).toBeCloseTo(500, 5);
  });

  it("второй снимок в тот же день не делается — сутки, как и решил владелец", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(balanceResponse()), { status: 200 })),
    );

    await recordBalanceSnapshot(env.DB, FAKE_ENV);
    const second = await recordBalanceSnapshot(env.DB, FAKE_ENV);

    expect(second.recorded).toBe(false);
    expect(second.reason).toBe("recent");
    expect(await snapshots()).toHaveLength(1);
  });

  it("ответ без reservedAmount/spentAmount — законная ситуация, не падение", async () => {
    // У ключа с личным лимитом расходов провайдер эти поля не возвращает.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ amount: "300.00000000", updatedAt: "2026-10-12T12:00:00Z" }), {
            status: 200,
          }),
      ),
    );

    const result = await recordBalanceSnapshot(env.DB, FAKE_ENV);
    expect(result.recorded).toBe(true);

    const rows = await snapshots();
    expect(rows[0]!.amount_rub).toBe(300);
    expect(rows[0]!.reserved_rub).toBeNull();
    expect(rows[0]!.spent_rub).toBeNull();
  });

  it("недоступность провайдера не роняет запись — снимок не пишется молча", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    const result = await recordBalanceSnapshot(env.DB, FAKE_ENV);
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("provider-error");
    expect(await snapshots()).toHaveLength(0);
  });

  it("ответ без amount отвергается — снимок без баланса бессмыслен", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ available: "10.00" }), { status: 200 })),
    );

    const result = await recordBalanceSnapshot(env.DB, FAKE_ENV);
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("provider-error");
  });
});

describe("итог листа-2", () => {
  it("POLZA_COST_RUB_CAPTURED — фактическое списание доезжает до базы", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(polzaResponse({ cost_rub: "42.50000000" })), { status: 200 }),
      ),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    await logLlmCall(env.DB, {
      userId: null,
      task: "worksheet",
      provider: "polza",
      model: "gpt-6-luna",
      plan: "free",
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costUsd: res.costUsd,
      costRub: res.costRub,
      latencyMs: res.latencyMs,
      cached: false,
      fallback: false,
    });

    const rows = await actualCosts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_rub).toBe(42.5);
    console.log("POLZA_COST_RUB_CAPTURED");
  });

  it("POLZA_COST_FALLBACK_INTACT — расчёт по прайсу жив без cost_rub", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(polzaResponse()), { status: 200 })),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    expect(res.costRub).toBeNull();
    expect(res.costUsd).toBeGreaterThan(0);
    console.log("POLZA_COST_FALLBACK_INTACT");
  });

  it("POLZA_BALANCE_SNAPSHOT_OK — баланс и пополнение снимаются", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(balanceFixture()), { status: 200 })),
    );

    const first = await recordBalanceSnapshot(env.DB, FAKE_ENV);
    expect(first.recorded).toBe(true);
    expect(first.balance?.amountRub).toBe(1250.5);

    await env.DB.prepare(`UPDATE polza_balance_snapshots SET created_at = created_at - 90000`).run();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(balanceFixture({ amount: "2250.50000000" })),
            { status: 200 },
          ),
      ),
    );
    const second = await recordBalanceSnapshot(env.DB, FAKE_ENV);
    expect(second.deltaRub).toBeCloseTo(1000, 5);
    console.log("POLZA_BALANCE_SNAPSHOT_OK");
  });
});

/** Локальная копия фикстуры — используется в итоговом тесте. */
function balanceFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    amount: "1250.50000000",
    available: "1200.06000000",
    reservedAmount: "12.50000000",
    spentAmount: "845.30000000",
    updatedAt: "2026-10-12T12:00:00.000Z",
    ...overrides,
  };
}
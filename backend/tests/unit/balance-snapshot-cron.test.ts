/**
 * ТЗ-43: снимок баланса провайдера снимается кроном, а крон вообще вызывается.
 *
 * ─── ЧТО БЫЛО ───────────────────────────────────────────────────────────────
 * Функция `recordBalanceSnapshot` (backend/src/services/polza-balance.ts) была
 * написана и покрыта тестами ещё в ТЗ-24, но НИ ОДНОГО вызова в проде не
 * было: `polza_balance_snapshots` — 0 строк за всё время, экран
 * `/superpower/money` показывал «Снимков баланса ещё нет».
 *
 * А на проверку оказалось, что не вызывается и сам крон: обработчик был написан
 * в `backend/src/index.ts` как `app.fire`, а `app.fire` не зовёт НИКТО, а
 * рантайм Cloudflare обращается к методу `scheduled` у объекта по умолчанию.
 * Триггер в `wrangler.toml` срабатывал вхолостую.
 *
 * ─── ЧТО ПРОВЕРЯЕМ ──────────────────────────────────────────────────────────
 *
 * C1. Точка входа крона существует и её зовёт рантайм: `scheduled` у объекта
 *     по умолчанию — это ровно то, что вызывает Cloudflare. Без этого крона
 *     нет вообще, а всё остальное в этом файле — мёртвый код.
 *
 * C2. Суточный триггер СНИМАЕТ баланс: в таблице появляется строка с суммой,
 *     которую отдал провайдер.
 *
 * C3. Часовой триггер баланс НЕ снимает: снимок раз в сутки, а не каждый час
 *     (AD-2 ТЗ-43).
 *
 * C4. Ошибка провайдера (HTTP 500) не роняет обработчик крона и не пишет
 *     мусор в таблицу: снимок — телеметрия, а не условие работы.
 *
 * C5. Второй суточный прогон в тот же день не пишет вторую строку: тот же
 *     «не чаще раза в сутки» контракт, что и у самой функции.
 *
 * ─── ПРО МОК, А НЕ ЖИВОЙ ПРОДАКШН ───────────────────────────────────────────
 * Провайдер подменён: реальный запрос к polza.ai стоит денег, а тут нужен
 * ответ «провайдер ответил суммой». Любой НЕ-балансовый запрос fetch в этом
 * тесте считается ошибкой и роняет тест — чтобы случайно не уехать в сеть.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
// Настоящая схема из репозитория, а не выдержка: тест одновременно доказывает,
// что schema.sql после правок ещё накатывается на чистую базу без ошибок.
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import worker from "../../src/index";

const HOURLY_CRON = "0 * * * *";
const DAILY_CRON = "0 3 * * *";

/** Обработчик scheduled у объекта по умолчанию — как его зовёт Cloudflare. */
type ScheduledHandler = (
  event: ScheduledEvent,
  e: unknown,
  ctx: ExecutionContext,
) => void;

function scheduledHandler(): ScheduledHandler {
  const handler = (worker as unknown as { scheduled?: ScheduledHandler }).scheduled;
  if (typeof handler !== "function") {
    throw new Error(
      "У воркера нет метода scheduled — рантайм Cloudflare не сможет вызвать крон",
    );
  }
  return handler;
}

/**
 * Окружение с ключом провайдера.
 *
 * `POLZA_API_KEY` — секрет, в тестовом окружении его нет (и быть не должно).
 * Подкладываем его через Proxy: остальные биндинги (D1, R2) берутся как есть,
 * а `this` у них остаётся настоящим — иначе методы D1 потеряли бы состояние.
 */
function envWithProviderKey(): unknown {
  return new Proxy(env, {
    get(target, prop) {
      if (prop === "POLZA_API_KEY") return "test-key";
      return Reflect.get(target, prop, target);
    },
  });
}

/** Ответ polza.ai на GET /api/v2/balance. */
function balanceResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    amount: "1250.50000000",
    available: "1200.06000000",
    reservedAmount: "12.50000000",
    spentAmount: "845.30000000",
    updatedAt: "2026-10-29T03:00:00.000Z",
    ...overrides,
  };
}

/** Провайдер отвечает заданным кодом и телом. */
function stubProvider(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (!url.includes("/api/v2/balance")) {
        // Любой другой запрос в сеть из крона — это ошибка теста, а не молчание.
        throw new Error(`Неожиданный сетевой запрос из крона: ${url}`);
      }
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }),
  );
}

/** Прогоняет крон и дожидается его работы. */
async function runCron(cron: string): Promise<string[]> {
  const lines: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));

  let ran: Promise<unknown> = Promise.resolve();
  const ctx = { waitUntil: (p: Promise<unknown>) => (ran = p) } as unknown as ExecutionContext;
  try {
    scheduledHandler()({ cron } as ScheduledEvent, envWithProviderKey(), ctx);
    await ran;
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
  return lines;
}

async function snapshots(): Promise<Array<{ amount_rub: number; available_rub: number | null }>> {
  const res = await env.DB.prepare(
    `SELECT amount_rub, available_rub FROM polza_balance_snapshots ORDER BY created_at DESC`,
  ).all<{ amount_rub: number; available_rub: number | null }>();
  return res.results ?? [];
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "tz43-balance-cron", queries: [schemaSql] }]);
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM polza_balance_snapshots`).run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ТЗ-43: крон снимает баланс провайдера", () => {
  it("C1: у воркера есть обработчик scheduled — до него доходит рантайм", () => {
    // Проверка не «в коде есть строка», а «рантайм найдёт, куда позвать».
    expect(typeof (worker as unknown as { scheduled?: unknown }).scheduled).toBe("function");
  });

  it("C2: суточный триггер записывает снимок баланса", async () => {
    stubProvider(200, balanceResponse());

    const lines = await runCron(DAILY_CRON);

    const rows = await snapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount_rub).toBe(1250.5);
    expect(rows[0]!.available_rub).toBe(1200.06);
    expect(lines.join("\n")).toContain("recordBalanceSnapshot");
  });

  it("C3: часовой триггер баланс не снимает", async () => {
    stubProvider(200, balanceResponse());

    await runCron(HOURLY_CRON);

    expect(await snapshots()).toHaveLength(0);
  });

  it("C4: ошибка провайдера не роняет крон и не пишет мусор в таблицу", async () => {
    stubProvider(500, "boom");

    const lines = await runCron(DAILY_CRON);
    const joined = lines.join("\n");

    // Крон отработал целиком: остальные задачи (уборка ПДн, тема недели) —
    // не должны пострадать из-за недоступного провайдера.
    expect(joined).toContain("purgeExpiredPhotos");
    expect(joined).toContain("purgeExpiredForms");
    expect(joined).not.toContain("recordBalanceSnapshot failed");
    // И в таблице не появилось никакой «нулевой» строки.
    expect(await snapshots()).toHaveLength(0);
  });

  it("C5: второй суточный прогон в тот же день второй строки не пишет", async () => {
    stubProvider(200, balanceResponse());

    await runCron(DAILY_CRON);
    await runCron(DAILY_CRON);

    expect(await snapshots()).toHaveLength(1);
  });
});

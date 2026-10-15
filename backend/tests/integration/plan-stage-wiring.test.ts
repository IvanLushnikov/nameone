/**
 * СТАДИЯ ПЛАНИРОВАНИЯ РАБОТАЕТ НАСКВОЗЬ (ТЗ-26, В-1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО НЕ ДУБЛЬ ЖИВОГО ПРОГОНА
 * ─────────────────────────────────────────────────────────────────────────────
 * Живой прогон проверяет главное: «модель, получив план, пишет разнообразный
 * лист». Это стоит денег на каждом запуске и требует пополнения баланса.
 *
 * Здесь проверяется другое и бесплатно: что МЕХАНИЗМ собран правильно. Что
 * флаг читается, что запрос плана уходит отдельным вызовом, что план доходит
 * до промпта генерации и что генерация идёт по нему. Ошибка в любом из
 * этих четырёх мест не дала бы заметить себя на живых данных — она бы просто
 * выглядела как «модель плохо следует плану».
 *
 * Отдельно проверено, что без флага стадия не вызывается вовсе: лишний вызов
 * провайдера на каждую генерацию — это реальные деньги, и «вроде работает»
 * здесь недостаточно.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ИМЕННО ПОДМЕНЕНО И ПОЧЕМУ ТЕСТ НЕ ПУСТОЙ
 * ─────────────────────────────────────────────────────────────────────────────
 * Настоящий провайдер не зовётся вообще. Подменено ровно одно — глобальный
 * `fetch`: он перехвачен через `vi.stubGlobal("fetch", ...)` и отвечает телом
 * той же формы, что отдаёт polza.ai на OpenAI-совместимый /chat/completions
 * (`choices[0].message.content` строкой с JSON, плюс `usage`). Провайдер,
 * тарификация, разбор ответа, нормализация плана и сборка листа — всё это
 * остаётся боевым кодом и проходится целиком: тест проверяет не «был ли
 * вызов», а дошёл ли план до промпта.
 *
 * Ключ в окружении — фиктивная константа `POLZA_API_KEY: "test-key"`, а не
 * значение из `.dev.vars`: без неё `callWithFallback` падает ДО сетевого
 * вызова («LLM: POLZA_API_KEY not configured»), и до подменённого `fetch`
 * дело не доходит вообще — ровно так этот файл и ронял выкатку в CI.
 * Настоящий ключ не нужен и не читается.
 *
 * Вторая линия защиты — `POLZA_BASE_URL` указывает на домен `.invalid`
 * (RFC 2606, не резолвится). Даже если подмена `fetch` будет снята, запрос
 * физически некуда уйти и деньги потратить нельзя; тест проверяет, что
 * каждый вызов ушёл именно туда.
 *
 * Именно поэтому тест не пустой: он проходит тот же путь «ручка → флаг →
 * отдельный вызов плана → разбор ответа → нормализация → промпт генерации →
 * сборка листа», что и боевая выдача, и меняется только последнее звено —
 * ответ вместо провайдера пишет подмена.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
// Окружение воркера: в пуле @cloudflare/vitest-plugin процессных
// переменных нет вовсе, всё окружение живёт в биндингах.
import { env as workerEnv } from "cloudflare:test";

import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import type { Env } from "../../src/env";

/**
 * Адрес провайдера внутри теста. `.invalid` по RFC 2606 не резолвится
 * никогда — это страховка на случай, если подмена `fetch` будет снята.
 */
const FAKE_BASE_URL = "http://plan-stage-wiring.invalid/v1";

/** Окружение для вызова: разворачиваем целиком, забыть поле нельзя. */
const FAKE_ENV = {
  ...(workerEnv as unknown as Record<string, unknown>),
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
  // Стадия включена явно. В обычных тестах её нет — см. описание флага в
  // `src/llm/index.ts`.
  PLAN: "1",
  // Фиктивная константа, а НЕ значение из `.dev.vars`: ключа у разработчика
  // и в CI нет, и без этой строки роутер падает до сетевого вызова. Настоящий
  // ключ не читается и не требуется — оба ключа заданы константой.
  POLZA_API_KEY: "test-key",
  POLZA_BASE_URL: FAKE_BASE_URL,
} as unknown as Env;

function fakeDb() {
  const cache = new Map<string, unknown>();
  return {
    cache,
    prepare(sql: string) {
      return {
        bind(...a: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM semantic_cache")) {
                const hit = cache.get(String(a[0]));
                return hit ? { response_json: JSON.stringify(hit), hit_count: 0 } : null;
              }
              return null;
            },
            async run() {
              if (
                sql.includes("INSERT OR IGNORE INTO semantic_cache") &&
                !cache.has(String(a[1]))
              ) {
                cache.set(String(a[1]), JSON.parse(String(a[8])));
              }
              if (sql.includes("DELETE FROM semantic_cache")) cache.delete(String(a[0]));
              return { success: true };
            },
          };
        },
      };
    },
    withSession() {
      return this;
    },
  } as never;
}

const PLAN_MARKER = "PLAN_LIST";

/** Метка стадии планирования в её собственном system-промпте. */
const PLAN_STAGE_MARKER = "[plan_stage]";

/** Что видел мок: по порядку вызовов, по главному признаку запроса. */
interface Trace {
  calls: Array<{ url: string; plan: boolean; system: string; user: string }>;
}

/** Тело ответа провайдера — форма polza.ai, без неё разбор чинить нечего. */
function providerReply(payload: unknown): Record<string, unknown> {
  return {
    model: "openai/gpt-6-luna",
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 1240,
      completion_tokens: 860,
      total_tokens: 2100,
      prompt_tokens_details: { cached_tokens: 0 },
    },
  };
}

/**
 * Подмена глобального `fetch`: отвечает телом провайдера и пишет след.
 *
 * Отдельная стадия определяется по метке `[plan_stage]` в system-промпте —
 * ровно так же, как её различает лог в бою, а не по порядковому номеру вызова.
 */
function installProviderFetch(reply: (system: string, user: string) => unknown): Trace {
  const trace: Trace = { calls: [] };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const messages = (body?.messages ?? []) as Array<{ role: string; content?: string }>;
      const system = String(messages.find((m) => m.role === "system")?.content ?? "");
      const user = String(messages.find((m) => m.role === "user")?.content ?? "");
      const plan = system.includes(PLAN_STAGE_MARKER);
      trace.calls.push({ url: String(url), plan, system, user });

      return new Response(JSON.stringify(providerReply(reply(system, user))), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );

  return trace;
}

/** План нормального вида: столько позиций, сколько просил лист. */
function planPayload(planItems: number): unknown {
  return {
    items: Array.from({ length: planItems }, (_, i) => ({
      n: i + 1,
      подтема: `подтема ${i + 1}`,
      навык: `навык ${i + 1}`,
      тип: "решение задачи",
      сложность: "средняя",
    })),
  };
}

/** Лист: ровно столько заданий, сколько просил учитель. */
function worksheetPayload(taskCount: number): unknown {
  return {
    title: "Лист",
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    difficulty: "medium",
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      number: i + 1,
      text: `Сократите дробь ${i + 1}/9.`,
      answer: "1/3",
    })),
  };
}

function stubProvider(opts: { planItems: number; taskCount: number }): Trace {
  return installProviderFetch((system) =>
    system.includes(PLAN_STAGE_MARKER) ? planPayload(opts.planItems) : worksheetPayload(opts.taskCount),
  );
}

/** Планировщик отвечает ерундой — конвейер обязан продолжить без плана. */
function stubBrokenPlanProvider(opts: { taskCount: number }): Trace {
  return installProviderFetch((system) =>
    system.includes(PLAN_STAGE_MARKER) ? { items: [{ безПодтемы: true }] } : worksheetPayload(opts.taskCount),
  );
}

/**
 * Ни один вызов не должен уйти настоящему провайдеру.
 *
 * Проверка не декоративная: пока она здесь, «тест зелёный» означает «тест
 * сломанной подменой fetch ушёл бы в polza.ai и стоил денег».
 */
function expectOnlyFakeEndpoint(trace: Trace): void {
  for (const call of trace.calls) {
    expect(
      call.url.startsWith(FAKE_BASE_URL),
      `вызов ушёл не в подменный адрес, а в ${call.url}`,
    ).toBe(true);
  }
}

const REQ = {
  subject: "math" as const,
  grade: 5,
  topic: "Обыкновенные дроби",
  difficulty: "medium" as const,
  count: 3,
  type: "worksheet" as const,
  withAnswers: true,
  withExplanations: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  _resetPolzaSingleton();
});

describe("ТЗ-26 В-1: стадия планирования сквозным путём", () => {
  it("запрос плана уходит ПЕРВЫМ и отличается от запроса генерации", async () => {
    const trace = stubProvider({ planItems: 3, taskCount: 3 });

    await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    // Ровно два, а не «больше нуля»: лишний вызов — это лишние деньги.
    expect(trace.calls, "ожидались план и генерация").toHaveLength(2);
    expect(trace.calls[0]!.plan, "первым должен идти запрос плана").toBe(true);
    expect(trace.calls[1]!.plan, "вторым должен идти запрос генерации").toBe(false);
    expectOnlyFakeEndpoint(trace);
  });

  it("план доходит до промпта генерации целиком, со всеми позициями", async () => {
    const trace = stubProvider({ planItems: 4, taskCount: 4 });

    await generateWorksheet(
      { request: { ...REQ, count: 4 }, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    const generation = trace.calls.find((c) => !c.plan);
    expect(generation, "запрос генерации не найден").toBeTruthy();
    expect(generation!.user, "в промпте генерации нет маркера плана").toContain(PLAN_MARKER);
    // ВСЕ позиции плана, а не только первая: обрезанный список — ровно та
    // поломка, которую на живых данных не отличить от «модель не старалась».
    for (let i = 1; i <= 4; i++) {
      expect(generation!.user, `в промпте генерации нет позиции плана ${i}`).toContain(`навык ${i}`);
      expect(generation!.user, `в промпте генерации нет подтемы плана ${i}`).toContain(`подтема ${i}`);
    }
    // Плана быть не должно в запросе самого планирования.
    expect(trace.calls[0]!.user).not.toContain(PLAN_MARKER);
  });

  it("стоимость стадии — ровно один вызов, и лист после неё обычный", async () => {
    const trace = stubProvider({ planItems: 3, taskCount: 3 });

    const result = await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    // План + генерация. Больше ничем не платим: ни дозапроса, ни ретрая.
    expect(trace.calls).toHaveLength(2);
    const tasks = result.worksheet.tasks as unknown as unknown[];
    expect(tasks).toHaveLength(3);
    expectOnlyFakeEndpoint(trace);
  });

  it("без флага стадия не вызывается вообще — лишних денег нет", async () => {
    const trace = stubProvider({ planItems: 3, taskCount: 3 });

    await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      { ...FAKE_ENV, PLAN: "0" } as unknown as Env,
      fakeDb(),
    );

    // Именно «один», а не «ноль плановых»: проверка «плана не было» на пустом
    // следе вызовов зелёная и при сломанной генерации — то есть ничего не
    // проверяла бы.
    expect(trace.calls, "без флага должна остаться только генерация").toHaveLength(1);
    expect(trace.calls[0]!.plan, "единственным вызовом был запрос плана").toBe(false);
    expect(trace.calls[0]!.user).not.toContain(PLAN_MARKER);
  });

  it("негодный план не ломает выдачу: лист собирается как обычно", async () => {
    const trace = stubBrokenPlanProvider({ taskCount: 3 });

    const result = await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    // Планировщик действительно звали — иначе тест прошёл бы, не проверив
    // ничего: «плохой план» обязан быть плохим ОТВЕТОМ, а не отсутствием.
    expect(trace.calls[0]!.plan, "планировщик не вызывался").toBe(true);
    const generation = trace.calls.find((c) => !c.plan);
    expect(generation, "запрос генерации не найден").toBeTruthy();
    // Мусор обязан быть отброшен, а не подставлен в промпт: иначе «план
    // нашёлся», но генерация поехала по ерунде.
    expect(generation!.user, "в промпт генерации попал негодный план").not.toContain(PLAN_MARKER);
    expect(result.worksheet.tasks.length).toBe(3);
  });
});
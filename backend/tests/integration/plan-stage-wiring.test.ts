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
 */

import { describe, it, expect, vi, afterEach } from "vitest";
// Окружение воркера: в пуле @cloudflare/vitest-pool-workers процессных
// переменных нет вовсе, всё окружение живёт в биндингах.
import { env as workerEnv } from "cloudflare:test";

import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import type { Env } from "../../src/env";

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
  calls: Array<{ plan: boolean; system: string; user: string }>;
}

function stubProvider(planItems: number): Trace {
  const trace: Trace = { calls: [] };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const messages = (body?.messages ?? []) as Array<{ role: string; content?: string }>;
      const system = String(messages.find((m) => m.role === "system")?.content ?? "");
      const user = String(messages.find((m) => m.role === "user")?.content ?? "");
      const isPlan = system.includes(PLAN_STAGE_MARKER);
      trace.calls.push({ plan: isPlan, system, user });

      let payload: unknown;
      if (isPlan) {
        payload = {
          items: Array.from({ length: planItems }, (_, i) => ({
            n: i + 1,
            подтема: `подтема ${i + 1}`,
            навык: `навык ${i + 1}`,
            тип: "решение задачи",
            сложность: "средняя",
          })),
        };
      } else {
        payload = {
          title: "Лист",
          subject: "math",
          grade: 5,
          topic: "Обыкновенные дроби",
          difficulty: "medium",
          tasks: Array.from({ length: planItems }, (_, i) => ({
            number: i + 1,
            text: `Сократите дробь ${i + 1}/9.`,
            answer: "1/3",
          })),
        };
      }

      return new Response(
        JSON.stringify({
          model: "test-model",
          choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );

  return trace;
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
    const trace = stubProvider(3);

    await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    expect(trace.calls.length, "ни одного вызова провайдера").toBeGreaterThan(0);
    expect(trace.calls[0]!.plan, "первым должен идти запрос плана").toBe(true);
    expect(
      trace.calls.some((c) => !c.plan),
      "запроса генерации не было",
    ).toBe(true);
  });

  it("план доходит до промпта генерации целиком, со всеми позициями", async () => {
    const trace = stubProvider(4);

    await generateWorksheet(
      { request: { ...REQ, count: 4 }, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    const generation = trace.calls.find((c) => !c.plan);
    expect(generation, "запрос генерации не найден").toBeTruthy();
    expect(generation!.user, "в промпте генерации нет маркера плана").toContain(PLAN_MARKER);
    // Все позиции плана, а не только первая.
    expect(generation!.user).toContain("навык 1");
    expect(generation!.user).toContain("навык 4");
    // Плана быть не должно в запросе самого планирования.
    expect(trace.calls[0]!.user).not.toContain(PLAN_MARKER);
  });

  it("стоимость стадии — ровно один вызов, и лист после неё обычный", async () => {
    const trace = stubProvider(3);

    const result = await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    // План + генерация. Больше ничем не платим: ни дозапроса, ни ретрая.
    expect(trace.calls.length).toBe(2);
    const tasks = result.worksheet.tasks as unknown as unknown[];
    expect(tasks).toHaveLength(3);
  });

  it("без флага стадия не вызывается вообще — лишних денег нет", async () => {
    const trace = stubProvider(3);

    await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      { ...FAKE_ENV, PLAN: "0" } as unknown as Env,
      fakeDb(),
    );

    expect(trace.calls.filter((c) => c.plan), "план запрашивался без флага").toHaveLength(0);
    expect(trace.calls.every((c) => !c.user.includes(PLAN_MARKER))).toBe(true);
  });

  it("негодный план не ломает выдачу: лист собирается как обычно", async () => {
    // Планировщик отвечает ерундой — конвейер обязан продолжить без плана,
    // а не выбросить ошибку на полку.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        const messages = (body?.messages ?? []) as Array<{ role: string; content?: string }>;
        const system = String(messages.find((m) => m.role === "system")?.content ?? "");
        const payload = system.includes(PLAN_STAGE_MARKER)
          ? { items: [{ безПодтемы: true }] }
          : {
              title: "Лист",
              subject: "math",
              grade: 5,
              topic: "Обыкновенные дроби",
              difficulty: "medium",
              tasks: [{ number: 1, text: "Сократите дробь 1/9.", answer: "1/3" }],
            };
        return new Response(
          JSON.stringify({
            model: "test-model",
            choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const result = await generateWorksheet(
      { request: REQ, plan: "plus", userId: null, ip: "203.0.113.10", bypassCache: true },
      FAKE_ENV,
      fakeDb(),
    );

    expect(result.worksheet.tasks.length).toBeGreaterThan(0);
  });
});
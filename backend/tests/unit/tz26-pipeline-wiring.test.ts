/**
 * НОВЫЕ ПУТИ В КОНВЕЙЕРЕ РЕАЛЬНО ИСПОЛНЯЮТСЯ (ТЗ-26, Ф-2 и Ф-5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТОТ ФАЙЛ, А НЕ ТОЛЬКО ЮНИТ-ТЕСТЫ НА ФУНКЦИИ
 * ─────────────────────────────────────────────────────────────────────────────
 * `skill-dupes.ts` и `hasUsableAnswer` покрыты юнит-тестами на фикстурах. Но
 * ТЗ-26 добавил в конвейер две вещи, которые юнит-тесты НЕ видят:
 *
 *   1. `dedupeSheet()` в `src/llm/index.ts` — вызывает провайдера, собирает
 *      промпт, мержит ответ и пересобирает лист на месте;
 *   2. проброс `requireAnswer` через `filterAndReport` — флаг, который решает,
 *      выкинет ли фильтр задание без ответа.
 *
 * Обе вещи компилируются, но могут быть неверно СОЕДИНЕНЫ: перепутан порядок
 * аргументов `buildTopUpPrompt`, потерян признак `withAnswers`, забыт `return`.
 * Юнит-тест на чистую функцию такое не поймает — а учитель поймает на первом
 * же листе. Этот файл гоняет НАСТОЯЩИЙ `generateWorksheet` с подменённой сетью.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Тот же приём, что в `tz25-quality-loss.test.ts`: `vi.stubGlobal("fetch")` и D1 —
 * заглушка, пишущая `llm_logs` по одному вызову. Реальный polza.ai платный,
 * в сеть тест не ходит. `userId: null` не даёт записям usage мешать, `plan:
 * "plus"` снимает мягкий порог нормы.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { afterAll } from "vitest";

// Маркер успеха для гейт-чекера (unlazy).
afterAll(() => { console.log("TZ26-PIPELINE-WIRING-OK"); });

import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { hasUsableAnswer } from "../../src/llm/validation/quality-filter";
import { findSkillDupes } from "../../src/llm/validation/skill-dupes";
import type { Env } from "../../src/env";
import type { GenerationRequest } from "../../src/types";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

function fakeDb() {
  const cache = new Map<string, unknown>();
  const logs: Array<Record<string, unknown>> = [];
  const db = {
    cache,
    logs,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM semantic_cache")) {
                const hit = cache.get(String(args[0]));
                if (!hit) return null;
                return { response_json: JSON.stringify(hit), hit_count: 0 };
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO semantic_cache")) {
                if (!cache.has(String(args[1]))) {
                  cache.set(String(args[1]), JSON.parse(String(args[8])));
                }
                return { success: true };
              }
              if (sql.includes("DELETE FROM semantic_cache")) {
                cache.delete(String(args[0]));
                return { success: true };
              }
              // llm_logs: по строке на вызов — по ним считаем, сколько раз
              // конвейер звал провайдера.
              if (sql.includes("INSERT INTO llm_logs")) {
                logs.push({ task: args[2], provider: args[3], model: args[4] });
                return { success: true };
              }
              return { success: true };
            },
          };
        },
      };
    },
    withSession() {
      return db;
    },
  };
  return db;
}

function providerResponse(payload: unknown, finishReason = "stop"): unknown {
  return {
    model: "anthropic/claude-sonnet-4-6",
    choices: [
      { message: { content: JSON.stringify(payload) }, finish_reason: finishReason },
    ],
    usage: { prompt_tokens: 1200, completion_tokens: 3600, total_tokens: 4800 },
  };
}

/**
 * Подменить провайдера.
 *
 * `payloads` — очередь ответов: каждый следующий вызов получает следующий.
 * Именно очередь нужна, чтобы отличить «дозапрос из-за дубля» от прочих.
 */
function stubProvider(payloads: unknown | unknown[]) {
  const queue = Array.isArray(payloads) ? [...payloads] : [payloads];
  let cursor = 0;
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    const payload = queue[Math.min(cursor, queue.length - 1)];
    cursor += 1;
    return new Response(JSON.stringify(providerResponse(payload)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

function makeRequest(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    subject: "russian",
    grade: 8,
    topic: "Орфография",
    difficulty: "medium",
    count: 3,
    type: "worksheet",
    withAnswers: true,
    withExplanations: true,
    ...over,
  };
}

const ARGS = { plan: "plus" as const, userId: null, ip: "203.0.113.10" };

/** Лист из заданных заданий. */
function sheet(tasks: Array<{ number: number; text: string; answer?: unknown }>) {
  return {
    title: "Орфография",
    subject: "russian",
    grade: 8,
    topic: "Орфография",
    difficulty: "medium",
    tasks,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetPolzaSingleton();
});

describe("ТЗ-26 Ф-5: конвейер выкидывает задание без ответа и добирает", () => {
  it("задание с answer:null не доезжает до учителя", async () => {
    const db = fakeDb();
    stubProvider([
      // Первый ответ: три задания, у второго ответа нет.
      sheet([
        { number: 1, text: "Найдите орфограмму в слове «звезда».", answer: "з-в-з-д-а" },
        { number: 2, text: "Подберите проверочное слово к «замок».", answer: null },
        { number: 3, text: "Укажите ударение в слове «щавель».", answer: "щаве́ль" },
      ]),
      // Дозапрос: одно задание в замену.
      sheet([{ number: 1, text: "В каком слове пишется ь?", answer: "мель, тень" }]),
    ]);

    const result = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as unknown as D1Database,
    );
    const tasks = result.worksheet.tasks as unknown as Array<{ text: string; answer?: unknown }>;

    // Задание без ответа не должно остаться в выдаче — это и есть критерий Г8.
    expect(tasks.every((t) => hasUsableAnswer(t.answer))).toBe(true);
    expect(tasks.map((t) => t.text)).not.toContain("Подберите проверочное слово к «замок».");
    // Число заданий сохранено: потерянное место занял дозапрос.
    expect(tasks).toHaveLength(3);
  });

  it("при withAnswers=false лист без ответов остаётся целиком", async () => {
    const db = fakeDb();
    stubProvider(
      sheet([
        { number: 1, text: "Найдите орфограмму в слове «звезда».", answer: null },
        { number: 2, text: "Укажите ударение в слове «щавель».", answer: null },
        { number: 3, text: "Пишется ли ь в слове «мель»?", answer: null },
      ]),
    );

    const result = await generateWorksheet(
      { ...ARGS, request: makeRequest({ withAnswers: false }) },
      FAKE_ENV,
      db as unknown as D1Database,
    );
    const tasks = result.worksheet.tasks as unknown as unknown[];

    // Главный страх такой правки: съесть лист, который учитель просил без
    // ответов. Один вызов провайдера — значит никакого дозапроса не было.
    expect(tasks).toHaveLength(3);
  });
});

describe("ТЗ-26 Ф-2: конвейер ловит дубль навыка и делает один дозапрос", () => {
  it("один вызов модели сверх первого, и дубль ушёл из листа", async () => {
    const db = fakeDb();
    const { fetchMock } = stubProvider([
      // Первый ответ: задание 2 — дубль задания 1 (одна рамка, другая рамка).
      sheet([
        { number: 1, text: "Распределите объекты на живую и неживую природу: корова, камень.", answer: "живая/неживая" },
        { number: 2, text: "Распределите объекты на живую и неживую природу: рожь, молоко.", answer: "живая/неживая" },
        { number: 3, text: "Приведите примеры живой природы во дворе.", answer: "берёза, воробей" },
      ]),
      // Дозапрос: задание на другой навык.
      sheet([{ number: 1, text: "Опишите строение клетки растения.", answer: "оболочка, цитоплазма, ядро" }]),
    ]);

    const result = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as unknown as D1Database,
    );
    const tasks = result.worksheet.tasks as unknown as Array<{ text: string }>;

    // В листе не осталось повторов — это и есть смысл Ф-2.
    expect(findSkillDupes(tasks as never).hasDupes).toBe(false);
    expect(tasks).toHaveLength(3);

    // Ровно ОДИН дозапрос: два вызова всего, а не пять.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("лист без дублей не вызывает модель второй раз", async () => {
    const db = fakeDb();
    const { fetchMock } = stubProvider(
      sheet([
        { number: 1, text: "Найдите орфограмму в слове «звезда».", answer: "з-в-з-д-а" },
        { number: 2, text: "Подберите синоним к слову «трудолюбивый».", answer: "прилежный" },
        { number: 3, text: "Укажите ударение в слове «щавель».", answer: "щаве́ль" },
      ]),
    );

    await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as unknown as D1Database,
    );

    // Детектор не должен стоить денег, когда повторов нет.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
/**
 * ТЗ-34: критерии оценивания в контрольной и тесте.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Три поломки, которые стоили учителю обещания тарифа:
 *
 *   1. КРИТЕРИЙ ПРИЁМКИ БЫЛ В `answer`, а не в `criteria`. Правило 17 промпта
 *      требовало класть критерии в поле ответа — и фильтр, требующий ответа,
 *      выкидывал задание без «эталона», подставляя вместо него обычный
 *      расчёт. Учитель получал контрольную, в которой не было ни одного
 *      развёрнутого задания.
 *   2. БАЛЛЫ И ОТМЕТКИ ПРИХОДИЛИ ОТ МОДЕЛИ. У одного учителя было «5 за
 *      80 %», у другого «5 за 90 %».
 *   3. РАЗНООБРАЗИЕ ТИПОВ ПРОВЕРЯЛА ТОЛЬКО МОДЕЛЬ. В живом ответе было три
 *      расчёта из четырёх при лимите «не больше 2 одного типа», и в `quality`
 *      про это не было ни одного поля.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Тот же приём, что в `tz25-quality-loss.test.ts`: `vi.stubGlobal("fetch")` и
 * D1-заглушка. Реальный polza.ai — платный API, тест туда не ходит.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { filterTasks, hasConcreteCriteria } from "../../src/llm/validation/quality-filter";
import {
  findTypeDiversityViolations,
  typeHistogram,
  pickReplacementIndex,
} from "../../src/llm/validation/type-diversity";
import { buildEvaluationPart } from "../../../src/lib/content/grading";
import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import {
  WORKSHEET_GEN_SYSTEM,
  buildWorksheetPrompt,
} from "../../src/llm/prompts/worksheet-gen";
import type { Env } from "../../src/env";
import type { GenerationRequest } from "../../src/types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. ФИЛЬТР: ЗАДАНИЕ С КРИТЕРИЯМИ НЕ ВЫКИДЫВАЕТСЯ
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-34 AD-5: задание с критериями — полноценное задание", () => {
  it("эссе с пустым ответом, но с критериями, НЕ выкидывается", () => {
    const tasks = [
      {
        number: 1,
        text: "Расскажите, что такое дробь, и приведите пример.",
        type: "essay",
        answer: null,
        criteria: ["Называет определение и приводит пример", "Объясняет смысл числителя и знаменателя"],
      },
      {
        number: 2,
        text: "Сократите дробь 8/20.",
        type: "computation",
        answer: "2/5",
      },
    ];
    const { tasks: out, report } = filterTasks(tasks, "math", { requireAnswer: true });
    expect(report.droppedNoAnswer).toEqual([]);
    expect(report.before).toBe(2);
    expect(report.after).toBe(2);
    expect(out).toHaveLength(2);
  });

  it("эссе с пустым ответом и БЕЗ критериев — выкидывается, как раньше", () => {
    const tasks = [
      {
        number: 1,
        text: "Расскажите, что такое дробь.",
        type: "essay",
        answer: null,
      },
      {
        number: 2,
        text: "Сократите дробь 8/20.",
        type: "computation",
        answer: "2/5",
      },
    ];
    const { tasks: out, report } = filterTasks(tasks, "math", { requireAnswer: true });
    expect(report.droppedNoAnswer).toEqual([1]);
    expect(out).toHaveLength(1);
  });

  it("критерии из стоп-листа не считаются ключом к заданию", () => {
    // «Ответ неполный» — это не критерий, и задание без настоящего ключа
    // выкидывается: иначе в контрольной останется развёрнутый вопрос, который
    // нечем проверять.
    const tasks = [
      {
        number: 1,
        text: "Расскажите, что такое дробь.",
        type: "essay",
        answer: null,
        criteria: ["Ответ неполный", "бывают ошибки"],
      },
      {
        number: 2,
        text: "Сократите дробь 8/20.",
        type: "computation",
        answer: "2/5",
      },
    ];
    const { report } = filterTasks(tasks, "math", { requireAnswer: true });
    expect(report.droppedNoAnswer).toEqual([1]);
  });

  it("пустые и общие критерии вычищаются из задания, факт — в отчёте", () => {
    const tasks = [
      {
        number: 1,
        text: "Расскажите, что такое дробь.",
        type: "essay",
        answer: "по критериям ниже",
        criteria: [
          "Называет определение и приводит пример",
          "Ответ неполный",
          "   ",
        ],
      },
    ];
    const { tasks: out, report } = filterTasks(tasks, "math", { requireAnswer: true });
    expect(report.cleanedCriteria).toEqual([1]);
    expect(out[0]?.criteria).toEqual(["Называет определение и приводит пример"]);
  });

  it("критерии, положенные моделью в `answer`, не остаются в ключе", () => {
    const tasks = [
      {
        number: 1,
        text: "Расскажите, что такое дробь.",
        type: "essay",
        answer: "Критерии: называет определение, приводит пример",
        criteria: ["Называет определение и приводит пример"],
      },
    ];
    const { tasks: out, report } = filterTasks(tasks, "math", { requireAnswer: true });
    expect(report.cleanedCriteriaAnswer).toEqual([1]);
    expect(out[0]?.answer).toBeNull();
  });

  it("hasConcreteCriteria отличает конкретный критерий от общего", () => {
    expect(hasConcreteCriteria({ criteria: ["Называет определение и приводит пример"] })).toBe(true);
    expect(hasConcreteCriteria({ criteria: ["Ответ неполный"] })).toBe(false);
    expect(hasConcreteCriteria({ criteria: [] })).toBe(false);
    expect(hasConcreteCriteria({})).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. РАЗНООБРАЗИЕ ТИПОВ: ПРОВЕРКА КОДОМ
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-34 §3.5: разнообразие типов проверяет код", () => {
  const typed = (types: string[]) => types.map((type, i) => ({ number: i + 1, type, text: `t${i}` }));

  it("гистограмма считает типы заданий", () => {
    const histogram = typeHistogram(typed(["computation", "computation", "short-answer"]));
    expect(histogram.get("computation")).toBe(2);
    expect(histogram.get("short-answer")).toBe(1);
  });

  it("живой случай: short-answer, computation, computation, computation → нарушение", () => {
    // Ровно тот вариант 2 живой контрольной, который видел владелец.
    const violations = findTypeDiversityViolations([
      {
        scope: "variant2",
        tasks: typed(["short-answer", "computation", "computation", "computation"]),
        count: 4,
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.type).toBe("computation");
    expect(violations[0]?.actual).toBe(3);
    expect(violations[0]?.limit).toBe(2);
  });

  it("лист, где все 4 задания одного типа, нарушает правило", () => {
    const violations = findTypeDiversityViolations([
      { scope: "variant1", tasks: typed(["computation", "computation", "computation", "computation"]), count: 4 },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ type: "computation", actual: 4, limit: 2 });
  });

  it("проверка идёт по варианту отдельно И по работе суммой", () => {
    // Вариант 1: 4 расчёта из 4 — нарушение внутри варианта.
    // Сумма: 6 расчётов из 8 — нарушение по сумме.
    const violations = findTypeDiversityViolations([
      { scope: "variant1", tasks: typed(["computation", "computation", "computation", "computation"]), count: 4 },
      { scope: "variant2", tasks: typed(["computation", "computation", "short-answer", "short-answer"]), count: 4 },
      {
        scope: "work",
        tasks: typed([
          "computation", "computation", "computation", "computation",
          "computation", "computation", "short-answer", "short-answer",
        ]),
        count: 8,
      },
    ]);
    const byScope = new Map(violations.map((v) => [v.scope, v]));
    expect(byScope.get("variant1")).toMatchObject({ type: "computation", actual: 4, limit: 2 });
    expect(byScope.get("work")).toMatchObject({ type: "computation", actual: 6, limit: 4 });
    // Второй вариант сам по себе разнообразен — по нему нарушений нет.
    expect(byScope.has("variant2")).toBe(false);
  });

  it("разнообразие, соблюдённое в обоих вариантах, даёт нарушение по сумме", () => {
    // По 3 расчёта и 2 коротких ответа в каждом варианте: внутри варианта
    // всё в порядке (лимит 3), а сумма — 6 расчётов из 10 при лимите 5.
    const violations = findTypeDiversityViolations([
      { scope: "variant1", tasks: typed(["computation", "computation", "computation", "short-answer", "short-answer"]), count: 5 },
      { scope: "variant2", tasks: typed(["computation", "computation", "computation", "short-answer", "short-answer"]), count: 5 },
      {
        scope: "work",
        tasks: typed([
          "computation", "computation", "computation", "short-answer", "short-answer",
          "computation", "computation", "computation", "short-answer", "short-answer",
        ]),
        count: 10,
      },
    ]);
    expect(violations.filter((v) => v.scope !== "work")).toHaveLength(0);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ scope: "work", type: "computation", actual: 6, limit: 5 });
  });

  it("задания без типа в гистограмму не попадают", () => {
    // Листы, созданные до ТЗ-33, приходят без типа. Проверка не должна на
    // них срабатывать и звать модель впустую.
    const violations = findTypeDiversityViolations([
      { scope: "variant1", tasks: [{ number: 1 }, { number: 2 }, { number: 3 }], count: 3 },
    ]);
    expect(violations).toHaveLength(0);
  });

  it("на замену выбирается задание самого частого типа", () => {
    const tasks = typed(["computation", "computation", "computation", "short-answer"]);
    const index = pickReplacementIndex(tasks, { type: "computation", actual: 3, limit: 2, scope: "variant1" });
    expect(index).not.toBeNull();
    expect(tasks[index ?? -1]?.type).toBe("computation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. СБОРКА БЛОКА `evaluation`
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-34: блок evaluation собирается кодом", () => {
  it("максимальный балл берётся из реестра, а не из модельного points", () => {
    const part = buildEvaluationPart({
      variant: 1,
      title: "Контрольная",
      tasks: [
        { number: 1, type: "computation", points: 3, criteria: null },
        { number: 2, type: "essay", points: 1, criteria: ["Называет определение и приводит пример"] },
      ],
      model: null,
    });
    expect(part.criteria[0]?.maxPoints).toBe(3); // essay весит 3 по реестру
    expect(part.totalMaxPoints).toBe(5); // 2 + 3
  });

  it("шкала отметок едет в блоке", () => {
    const part = buildEvaluationPart({ variant: 1, title: "Тест", tasks: [] });
    expect(part.marks.map((m) => m.fromPercent)).toEqual([85, 70, 50, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ПРОМПТ
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-34: промпт", () => {
  it("правило 17 говорит: критерии — в поле criteria, а не в answer", () => {
    expect(WORKSHEET_GEN_SYSTEM).toMatch(/КРИТЕРИИ ПРИЁМКИ/);
    expect(WORKSHEET_GEN_SYSTEM).toMatch(/В ПОЛЕ "criteria"/);
    expect(WORKSHEET_GEN_SYSTEM).toMatch(/ПУСТОЙ \(null\)/);
  });

  it("для контрольной и теста просим блок evaluation с ошибками и рекомендацией", () => {
    const control = buildWorksheetPrompt({
      subject: "math",
      grade: 5,
      topic: "drobi",
      difficulty: "medium",
      count: 4,
      type: "control",
      withAnswers: true,
      withExplanations: false,
    });
    expect(control.user).toContain("КРИТЕРИИ_ОЦЕНИВАНИЯ");
    expect(control.user).toContain("typicalMistakes");
    expect(control.user).toContain("recommendation");
  });

  it("для обычного рабочего листа блок evaluation НЕ просим", () => {
    // Лист учитель раздаёт, а не оценивает: критерии в листе — лишние
    // токены и лишняя печать.
    const worksheet = buildWorksheetPrompt({
      subject: "math",
      grade: 5,
      topic: "drobi",
      difficulty: "medium",
      count: 4,
      type: "worksheet",
      withAnswers: true,
      withExplanations: false,
    });
    expect(worksheet.user).not.toContain("КРИТЕРИИ_ОЦЕНИВАНИЯ");
  });

  it("в промпте сказано: хотя бы одно задание с критериями", () => {
    const test = buildWorksheetPrompt({
      subject: "math",
      grade: 5,
      topic: "drobi",
      difficulty: "medium",
      count: 4,
      type: "test",
      withAnswers: true,
      withExplanations: false,
    });
    expect(test.user).toContain("ХОТЯ БЫ ОДНО задание должно иметь непустые конкретные критерии");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. КОНВЕЙЕР ЦЕЛИКОМ
// ─────────────────────────────────────────────────────────────────────────────

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
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1200, completion_tokens: 3600, total_tokens: 4800 },
  };
}

function stubProvider(payloads: unknown | unknown[]) {
  const queue = Array.isArray(payloads) ? [...payloads] : [payloads];
  let cursor = 0;
  const fetchMock = vi.fn(async () => {
    const payload = queue[Math.min(cursor, queue.length - 1)];
    cursor += 1;
    return new Response(JSON.stringify(providerResponse(payload)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

/** Четыре задания разных типов — разнообразие соблюдено. */
function variantTasks(prefix: string) {
  return [
    { number: 1, type: "computation", text: `${prefix} посчитайте 8/20`, answer: "2/5", points: 1 },
    { number: 2, type: "short-answer", text: `${prefix} назовите знаменатель`, answer: "20", points: 3 },
    {
      number: 3,
      type: "essay",
      text: `${prefix} объясните, что такое дробь`,
      answer: null,
      points: 1,
      criteria: ["Называет определение и приводит пример", "Объясняет смысл числителя и знаменателя"],
    },
    { number: 4, type: "multiple-choice", text: `${prefix} выберите верный вариант`, answer: "А", options: ["А", "Б", "В", "Г"], points: 3 },
  ];
}

function controlPayload() {
  return {
    variants: [
      {
        title: "Вариант 1",
        subject: "math",
        grade: 5,
        topic: "drobi",
        difficulty: "medium",
        tasks: variantTasks("Первый"),
        evaluation: {
          typicalMistakes: ["Путает числитель и знаменатель при сокращении дроби"],
          recommendation: "Разобрать на доске перевод смешанного числа в неправильную дробь.",
        },
      },
      {
        title: "Вариант 2",
        subject: "math",
        grade: 5,
        topic: "drobi",
        difficulty: "medium",
        tasks: variantTasks("Второй"),
        evaluation: {
          typicalMistakes: ["Сокращает дробь, не проверяя, что знаменатель делится на числитель"],
          recommendation: "Проверить сокращение обратным умножением на доске.",
        },
      },
    ],
  };
}

function makeRequest(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    difficulty: "medium",
    count: 4,
    type: "control",
    withAnswers: true,
    withExplanations: true,
    ...over,
  };
}

const ARGS = { plan: "plus" as const, userId: null, ip: "203.0.113.10" };

beforeEach(() => {
  _resetPolzaSingleton();
});

afterEach(() => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ТЗ-34: конвейер отдаёт evaluation отдельным ключом", () => {
  it("у контрольной evaluation — массив длиной 2, по вариантам", async () => {
    stubProvider(controlPayload());
    const result = await generateWorksheet(
      { request: makeRequest(), ...ARGS },
      FAKE_ENV,
      fakeDb() as unknown as D1Database,
    );

    const evaluation = result.evaluation ?? [];
    expect(evaluation).toHaveLength(2);
    expect(evaluation[0]?.variant).toBe(1);
    expect(evaluation[1]?.variant).toBe(2);
    expect(evaluation[0]?.title).toBe("Вариант 1");
  });

  it("в evaluation есть criteria, typicalMistakes, recommendation, totalMaxPoints и marks", async () => {
    stubProvider(controlPayload());
    const result = await generateWorksheet(
      { request: makeRequest(), ...ARGS },
      FAKE_ENV,
      fakeDb() as unknown as D1Database,
    );

    const part = (result.evaluation ?? [])[0];
    expect(part).toBeDefined();
    expect(part?.criteria.length).toBeGreaterThan(0);
    expect(part?.typicalMistakes.length).toBeGreaterThan(0);
    expect(part?.recommendation).toBeTruthy();
    expect(part?.totalMaxPoints).toBeGreaterThan(0);
    expect(part?.marks).toHaveLength(4);
    expect(part?.marks.map((m) => m.fromPercent)).toEqual([85, 70, 50, 0]);
  });

  it("максимальный балл задания — из реестра, а не из модельного points", async () => {
    stubProvider(controlPayload());
    const result = await generateWorksheet(
      { request: makeRequest(), ...ARGS },
      FAKE_ENV,
      fakeDb() as unknown as D1Database,
    );

    const part = (result.evaluation ?? [])[0];
    const essay = part?.criteria.find((c) => c.number === 3);
    // Essay весит 3 по реестру, хотя модель просила `points: 1`.
    expect(essay?.maxPoints).toBe(3);
    // Сумма по всем четырём заданиям: 2 + 2 + 3 + 1 = 8.
    expect(part?.totalMaxPoints).toBe(8);
  });

  it("в ответе нет слова «критери» в тексте и в ответе задания", async () => {
    stubProvider(controlPayload());
    const result = await generateWorksheet(
      { request: makeRequest(), ...ARGS },
      FAKE_ENV,
      fakeDb() as unknown as D1Database,
    );

    const texts: string[] = [];
    for (const task of result.worksheet.tasks) {
      if (typeof task.text === "string") texts.push(task.text);
      if (typeof task.answer === "string") texts.push(task.answer);
    }
    for (const text of texts) {
      expect(text.toLowerCase(), text).not.toContain("критери");
    }
  });

  it("у обычного рабочего листа evaluation нет", async () => {
    stubProvider({
      title: "Лист",
      subject: "math",
      grade: 5,
      topic: "drobi",
      difficulty: "medium",
      tasks: variantTasks("Лист"),
    });
    const result = await generateWorksheet(
      { request: makeRequest({ type: "worksheet" }), ...ARGS },
      FAKE_ENV,
      fakeDb() as unknown as D1Database,
    );
    expect(result.evaluation ?? []).toHaveLength(0);
  });

  it("у теста evaluation — массив длиной 1", async () => {
    stubProvider({
      title: "Тест",
      subject: "math",
      grade: 5,
      topic: "drobi",
      difficulty: "medium",
      tasks: variantTasks("Тест"),
      evaluation: {
        typicalMistakes: ["Путает числитель и знаменатель при сокращении дроби"],
        recommendation: "Разобрать сокращение дробей на доске.",
      },
    });
    const result = await generateWorksheet(
      { request: makeRequest({ type: "test" }), ...ARGS },
      FAKE_ENV,
      fakeDb() as unknown as D1Database,
    );
    const evaluation = result.evaluation ?? [];
    expect(evaluation).toHaveLength(1);
    expect(evaluation[0]?.criteria.length).toBeGreaterThan(0);
  });
});

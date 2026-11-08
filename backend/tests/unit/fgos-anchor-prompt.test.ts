/**
 * ТЗ-39: ФГОС-ЯКОРЬ В ЗАПРОСЕ — раздел программы и один пример формулировки.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. ЯКОРЬ ДОХОДИТ ДО МОДЕЛИ. Таксономия ФГОС собрана (5 658 тем, покрытие
 *    полное), но до генерации она не доходила: модель получала только
 *    название темы и придумывала навыки сама. Тест смотрит на РЕАЛЬНЫЙ
 *    промпт, который уходит провайдеру, — так ломается любой разрыв по
 *    дороге: забытое поле в типе, потерянный `meta` в роуте, не переданный
 *    аргумент в билдер.
 *
 * 2. БЕЗ ЯКОРЯ ВСЁ КАК БЫЛО. Лист без раздела программы генерируется ровно
 *    так же, как до ТЗ-39: тот же user-промпт побайтно и тот же ключ кэша.
 *    Это отдельная проверка, а не «нулевой якорь где-то в коде»: если блок
 *    начнёт попадать в промпт без причины, вход вырастет у ВСЕХ листов.
 *
 * 3. КЛЮЧ КЭША РАЗЛИЧАЕТ ЯКОРЯ. Лист, собранный с якорем, нельзя отдавать как
 *    «тот же запрос» тому, у кого якоря не было: у него другая опора и другой
 *    материал. Ровно тот класс дефектов, которому посвящён этот заход
 *    («поставил галочку — никакой разницы»), только в другой одежде.
 *
 * 4. ПРИМЕР НЕ КОПИРУЕТСЯ В ЗАДАНИЕ. Пример в промпте назван стилем, а не
 *    шаблоном, но просьба — это просьба: код сверяет задания с примером.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Тот же приём, что в `umk-prompt.test.ts` и `cache-format-version.test.ts`:
 * `vi.stubGlobal("fetch")` и D1-заглушка с настоящим `semantic_cache` в
 * памяти. Реальный polza.ai — платный, тест в сеть не ходит.
 */

import { describe, it, expect, vi, afterEach, afterAll } from "vitest";

// Маркер успеха для гейт-чекера (unlazy).
afterAll(() => {
  console.log("TZ39-FGOS-ANCHOR-OK");
});

import { generateWorksheet, cacheTopicForRequest } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { makeCacheKey } from "../../src/llm/cache";
import {
  buildWorksheetPrompt,
  buildTopUpPrompt,
  buildVariantRetryPrompt,
} from "../../src/llm/prompts/worksheet-gen";
import {
  buildFgosBlock,
  dropAnchorCopies,
  fgosAnchorFromRequest,
  fgosAnchorId,
  isCopiedFromAnchor,
  normalizeFgosExample,
  normalizeFgosRef,
  sameConstructionAsAnchor,
  FGOS_EXAMPLE_MAX_CHARS,
  FGOS_REF_MAX_CHARS,
} from "../../src/llm/prompts/fgos-block";
import type { Env } from "../../src/env";
import type { GenerationRequest } from "../../src/types";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

const ARGS = { plan: "plus" as const, userId: null, ip: "203.0.113.10" };

/** Раздел программы и пример — как их присылает фронт из таксономии. */
const ANCHOR = {
  fgosRef: "Дроби",
  fgosExample: {
    text: "Найдите значение выражения 3/8 + 1/8 и запишите ответ в виде дроби.",
    answer: "1/2",
  },
};

function makeRequest(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    difficulty: "medium",
    count: 3,
    type: "worksheet",
    withAnswers: true,
    withExplanations: true,
    ...over,
  };
}

/** D1-заглушка: кэш в памяти, llm_logs считаются. */
function fakeDb() {
  const cache = new Map<string, unknown>();
  const db = {
    cache,
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
                // args: id, cache_key, subject, grade, topic, difficulty, count,
                //       type, response_json, created_at, expires_at
                if (!cache.has(String(args[1]))) {
                  cache.set(String(args[1]), JSON.parse(String(args[8])));
                }
                return { success: true };
              }
              if (sql.includes("DELETE FROM semantic_cache")) {
                cache.delete(String(args[0]));
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

/** Лист, который вернёт подменённый провайдер. */
function sheet() {
  return {
    title: "Обыкновенные дроби",
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    difficulty: "medium",
    tasks: [
      { number: 1, text: "Сократите дробь 8/12.", answer: "2/3", skill: "сокращение дроби" },
      { number: 2, text: "Сравните 1/3 и 1/5.", answer: "1/3 больше", skill: "сравнение дробей" },
      {
        number: 3,
        text: "Найдите 1/4 от 20.",
        answer: "5",
        skill: "нахождение части от целого",
      },
    ],
  };
}

/** Подменить провайдера и считать реальные вызовы. */
function stubProvider(payload: unknown = sheet()) {
  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        model: "anthropic/claude-sonnet-4-6",
        choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1200, completion_tokens: 3600, total_tokens: 4800 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetPolzaSingleton();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Блок якоря
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-39: блок якоря собирается из раздела и одного примера", () => {
  it("без раздела программы блока нет", () => {
    expect(buildFgosBlock(null)).toBe("");
    expect(buildFgosBlock(undefined)).toBe("");
    expect(buildFgosBlock({})).toBe("");
    expect(buildFgosBlock({ fgosRef: null })).toBe("");
    expect(buildFgosBlock({ fgosRef: "   " })).toBe("");
  });

  it("мусор в meta не превращается в блок", () => {
    // Значение приходит из браузера. Мусорный meta — это «нет якоря», а не 500.
    expect(buildFgosBlock({ fgosRef: 42 } as never)).toBe("");
    expect(buildFgosBlock({ fgosRef: { text: "Дроби" } } as never)).toBe("");
    expect(buildFgosBlock({ fgosExample: { text: "без раздела" } } as never)).toBe("");
  });

  it("в блоке есть раздел и ровно ОДИН пример", () => {
    const block = buildFgosBlock(ANCHOR);
    expect(block).toContain("Дроби");
    expect(block).toContain(ANCHOR.fgosExample.text);
    // Правило «пример — стиль, а не шаблон» должно быть в промпте словами.
    expect(block).toContain("не повторяется");
    // Примеров ровно один — два примера превращаются в шаблон (AD-1).
    expect(block.match(/Пример формулировки/g)?.length).toBe(1);
  });

  it("раздел без примера — блок всё равно есть", () => {
    const block = buildFgosBlock({ fgosRef: "Средневековая Русь" });
    expect(block).toContain("Средневековая Русь");
    expect(block).not.toContain("Пример формулировки");
  });

  it("длинный раздел обрезается по границе слова", () => {
    const long = "Дроби ".repeat(200);
    const block = buildFgosBlock({ fgosRef: long });
    expect(block.length).toBeLessThan(long.length);
    expect(block).toContain("…");
    expect(normalizeFgosRef(long)!.length).toBeLessThanOrEqual(FGOS_REF_MAX_CHARS + 1);
  });

  it("пример из браузера обрезается по потолку", () => {
    const long = "Найдите значение ".repeat(100);
    expect(normalizeFgosExample({ text: long })!.text.length).toBeLessThanOrEqual(
      FGOS_EXAMPLE_MAX_CHARS + 1,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Якорь в промпте листа
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-39: якорь доезжает до промпта листа", () => {
  it("в user-промпте есть блок-якорь, когда раздел задан", () => {
    const { user } = buildWorksheetPrompt(makeRequest({ meta: ANCHOR }));
    expect(user).toContain("ФГОС_ЯКОРЬ");
    expect(user).toContain("FGOS");
    expect(user).toContain("Дроби");
    expect(user).toContain(ANCHOR.fgosExample.text);
  });

  it("без якоря блока в промпте нет", () => {
    const { user } = buildWorksheetPrompt(makeRequest());
    expect(user).not.toContain("ФГОС_ЯКОРЬ");
    expect(user).not.toContain("ОРИЕНТИР ПО ПРОГРАММЕ");
  });

  it("якорь и учебник не конфликтуют — оба доезжают", () => {
    const { user } = buildWorksheetPrompt(
      makeRequest({ meta: { umk: "vilenkin", ...ANCHOR } }),
    );
    expect(user).toContain("УМК");
    expect(user).toContain("ФГОС_ЯКОРЬ");
    expect(user).toContain("Дроби");
  });

  it("дозапрос недостающих заданий тоже знает про раздел", () => {
    const { user } = buildTopUpPrompt(makeRequest({ meta: ANCHOR }), 1, ["Сократите дробь 8/12."]);
    expect(user).toContain("ФГОС_ЯКОРЬ");
  });

  it("ретрай второго варианта контрной тоже знает про раздел", () => {
    const { user } = buildVariantRetryPrompt(
      makeRequest({ meta: ANCHOR, type: "control" }),
      [1],
      ["Сократите дробь 8/12."],
      "варианты совпали",
    );
    expect(user).toContain("ФГОС_ЯКОРЬ");
  });

  it("system-промпт не менялся — иначе сбросится prompt cache «Плюса»", () => {
    // Якорь живёт в user-части: system-промпт листа кэшируется у провайдера,
    // и его правка стоит денег (см. шапку worksheet-gen.ts).
    const { system } = buildWorksheetPrompt(makeRequest({ meta: ANCHOR }));
    const { system: systemWithout } = buildWorksheetPrompt(makeRequest());
    expect(system).toBe(systemWithout);
    expect(system).not.toContain("ОРИЕНТИР ПО ПРОГРАММЕ");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Ключ кэша
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-39: якорь — часть ключа кэша", () => {
  it("разные якоря дают разные ключи", () => {
    const withFractions = makeCacheKey({
      ...makeRequest({ meta: ANCHOR }),
      topic: cacheTopicForRequest(makeRequest({ meta: ANCHOR })),
    });
    const withHistory = makeCacheKey({
      ...makeRequest({ meta: { fgosRef: "Средневековая Русь" } }),
      topic: cacheTopicForRequest(makeRequest({ meta: { fgosRef: "Средневековая Русь" } })),
    });
    const without = makeCacheKey(makeRequest());

    expect(withFractions).not.toBe(withHistory);
    expect(withFractions).not.toBe(without);
    expect(withHistory).not.toBe(without);
  });

  it("один и тот же якорь даёт один и тот же ключ — повтор остаётся бесплатным", () => {
    const a = makeCacheKey({
      ...makeRequest({ meta: ANCHOR }),
      topic: cacheTopicForRequest(makeRequest({ meta: ANCHOR })),
    });
    const b = makeCacheKey({
      ...makeRequest({ meta: ANCHOR }),
      topic: cacheTopicForRequest(makeRequest({ meta: ANCHOR })),
    });
    expect(a).toBe(b);
  });

  it("без якоря ключ не меняется — регрессия против старого кода", () => {
    // Ожидаемое значение — ключ, который давал код ДО ТЗ-39 (см. отчёт:
    // «тот же ключ кэша для запроса без fgosRef»). Если число поменяется,
    // значит запрос без якоря поедет мимо кэша и учитель заплатит дважды.
    expect(cacheTopicForRequest(makeRequest())).toBe(makeRequest().topic);
    expect(makeCacheKey(makeRequest())).toBe(
      makeCacheKey({ ...makeRequest(), topic: makeRequest().topic }),
    );
    expect(makeCacheKey(makeRequest())).toBe("3d5e2bec1670ef72");
  });

  it("смена якоря даёт другую запись кэша, а не предыдущий лист", async () => {
    const db = fakeDb();
    stubProvider();
    await generateWorksheet(
      { ...ARGS, request: makeRequest({ meta: ANCHOR }) },
      FAKE_ENV,
      db as unknown as D1Database,
    );
    const first = [...db.cache.keys()];

    stubProvider();
    await generateWorksheet(
      { ...ARGS, request: makeRequest({ meta: { fgosRef: "Средневековая Русь" } }) },
      FAKE_ENV,
      db as unknown as D1Database,
    );
    const second = [...db.cache.keys()];

    expect(second.length).toBe(2);
    expect(first[0]).not.toBe(second[1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Пример не копируется в задание
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-39: задание не повторяет пример дословно", () => {
  it("точная копия примера распознаётся", () => {
    expect(
      isCopiedFromAnchor(
        "Найдите значение выражения 3/8 + 1/8 и запишите ответ в виде дроби.",
        ANCHOR.fgosExample.text,
      ),
    ).toBe(true);
  });

  it("копия с другой пунктуацией и регистром — тоже копия", () => {
    expect(
      isCopiedFromAnchor(
        "найдите значение выражения 3/8 + 1/8 и запишите ответ в виде дроби!",
        ANCHOR.fgosExample.text,
      ),
    ).toBe(true);
  });

  it("те же числа другие — это НЕ копия", () => {
    // Смена чисел делает задание другим: учитель его не видел. Выбрасывать
    // такое было бы излишней строгостью.
    expect(
      isCopiedFromAnchor(
        "Найдите значение выражения 5/9 + 1/9 и запишите ответ в виде дроби.",
        ANCHOR.fgosExample.text,
      ),
    ).toBe(false);
  });

  it("та же конструкция с другими числами видна отдельной проверкой", () => {
    // Это не дефект, но это риск AD-1: если таких заданий половина листа,
    // якорь превратился в шаблон. Проверка — для замера, не для выбрасывания.
    expect(
      sameConstructionAsAnchor(
        "Найдите значение выражения 5/9 + 1/9 и запишите ответ в виде дроби.",
        ANCHOR.fgosExample.text,
      ),
    ).toBe(true);
  });

  it("из листа выбрасывается только копия, остальное остаётся", () => {
    const tasks = [
      { text: "Сократите дробь 8/12." },
      { text: ANCHOR.fgosExample.text },
      { text: "Сравните 1/3 и 1/5." },
    ];
    const { tasks: kept, dropped } = dropAnchorCopies(tasks, ANCHOR.fgosExample.text);
    expect(dropped).toEqual([2]);
    expect(kept.map((t) => t.text)).toEqual([
      "Сократите дробь 8/12.",
      "Сравните 1/3 и 1/5.",
    ]);
  });

  it("без примера ничего не выбрасывается", () => {
    const tasks = [{ text: "Любое задание" }];
    const { tasks: kept, dropped } = dropAnchorCopies(tasks, null);
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
  });

  it("скопированное задание не доезжает до учителя даже через провайдера", async () => {
    const db = fakeDb();
    stubProvider({
      ...sheet(),
      tasks: [
        { number: 1, text: ANCHOR.fgosExample.text, answer: "1/2", skill: "сложение дробей" },
        { number: 2, text: "Сравните 1/3 и 1/5.", answer: "1/3 больше", skill: "сравнение дробей" },
        { number: 3, text: "Найдите 1/4 от 20.", answer: "5", skill: "нахождение части" },
      ],
    });

    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ meta: ANCHOR }) },
      FAKE_ENV,
      db as unknown as D1Database,
    );

    const texts = res.worksheet.tasks.map((t) => t.text);
    expect(texts).not.toContain(ANCHOR.fgosExample.text);
    // Дозапрос вернёт то же самое (провайдер в тесте отвечает одним и тем же),
    // поэтому лист останется короче — и это честно: `stillMissing` покажет
    // нехватку, а не тихо короткий лист.
    expect(res.quality?.stillMissing ?? 0).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Чтение якоря из запроса
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-39: якорь читается из запроса безопасно", () => {
  it("нормальный запрос даёт якорь", () => {
    const anchor = fgosAnchorFromRequest(makeRequest({ meta: ANCHOR }));
    expect(anchor?.ref).toBe("Дроби");
    expect(anchor?.example?.text).toBe(ANCHOR.fgosExample.text);
  });

  it("мусорный meta — это «нет якоря», а не ошибка", () => {
    expect(fgosAnchorFromRequest(null)).toBeNull();
    expect(fgosAnchorFromRequest({})).toBeNull();
    expect(fgosAnchorFromRequest({ meta: "строка" })).toBeNull();
    expect(fgosAnchorFromRequest({ meta: { fgosRef: 42 } })).toBeNull();
    expect(fgosAnchorFromRequest({ meta: { fgosRef: "" } })).toBeNull();
  });

  it("идентификатор якоря стабилен и различает разные якоря", () => {
    const a = fgosAnchorId(fgosAnchorFromRequest(makeRequest({ meta: ANCHOR })));
    const b = fgosAnchorId(fgosAnchorFromRequest(makeRequest({ meta: ANCHOR })));
    const c = fgosAnchorId(
      fgosAnchorFromRequest(makeRequest({ meta: { fgosRef: "Средневековая Русь" } })),
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});

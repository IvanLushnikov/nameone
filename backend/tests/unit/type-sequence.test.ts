/**
 * ТЗ-40: ПРОВЕРКА ПОСЛЕДОВАТЕЛЬНОСТИ ФОРМ (Q-09).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Страница «Методика» обещала, что одинаковые формы подряд не идут. В живых
 * прогонах 29.10.2026 серия была в 7 листах из 10, и проверить её было нечем:
 * правило промпта «Не пиши 5 одинаковых задач подряд» — просьба к модели, а не
 * гарантия.
 *
 * Здесь — два уровня:
 *   1. ДЕТЕКТОР (`findTypeRuns`, `findDefectRuns`) — чистые функции: где серия,
 *      а где нормальная методика.
 *   2. КОНВЕЙЕР (`generateWorksheet` с подменённым провайдером) — реальный
 *      путь материала: серия уезжает учителю или чинится.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Проверка обязана быть БЕЗОПАСНОЙ. Ложный дефект хуже пропущенного (аудит
 * 19.10.2026, §12): детектор, который бракует нормальный лист, учитель
 * выключит. Поэтому половина тестов — про то, что лист ТРОГАТЬ НЕЛЬЗЯ:
 *   · лист с чередованием форм — не трогаем и не зовём модель;
 *   · две одинаковые формы подряд — не трогаем;
 *   · три одинаковые формы подряд, но все про ОДИН И ТО ЖЕ навык — это
 *     отработка навыка, а не дефект;
 *   · тест с автопроверкой: задания с выбором ответа идут подряд по определению.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { findSkillDupes } from "../../src/llm/validation/skill-dupes";
import {
  findDefectRuns,
  findTypeRuns,
  isDrillingRun,
  runTailNumbers,
} from "../../src/llm/validation/type-sequence";
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
              if (sql.includes("INSERT INTO llm_logs")) {
                logs.push({
                  task: args[2],
                  provider: args[3],
                  model: args[4],
                  tokensIn: args[6],
                  tokensOut: args[7],
                  costUsd: args[8],
                });
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

function providerResponse(payload: unknown): unknown {
  return {
    model: "anthropic/claude-sonnet-4-6",
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1200, completion_tokens: 3600, total_tokens: 4800 },
  };
}

/**
 * Подменить провайдера.
 *
 * `payloads` — ответы по очереди: первый достаётся первому вызову, второй —
 * второму. Последний повторяется, если вызовов окажется больше.
 */
function stubProvider(payloads: unknown[]) {
  const queue = [...payloads];
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

function makeRequest(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    subject: "history",
    grade: 6,
    topic: "Древняя Русь",
    difficulty: "medium",
    count: 12,
    type: "worksheet",
    withAnswers: true,
    withExplanations: true,
    ...over,
  };
}

const ARGS = { plan: "plus" as const, userId: null, ip: "203.0.113.10" };

/**
 * Двенадцать РАЗНЫХ заданий по истории.
 *
 * Формулировки подобраны так, чтобы детектор дублей не считал их
 * одинаковыми: у них нет общих цепочек из трёх содержательных слов. Иначе
 * тест мерил бы не последовательность форм, а ложные срабатывания детектора.
 */
const CLEAN_TEXTS = [
  "Объясните значение битвы на реке Калке.",
  "Перечислите последствия раздробленности Руси.",
  "Охарактеризуйте внутреннюю политику Ярослава Мудрого.",
  "Сравните управление Киевом и Новгородом.",
  "Опишите положение Церкви в домонгольской Руси.",
  "Расскажите о походе Олега на Царьград.",
  "Укажите, что изменилось в войске после Святослава.",
  "Определите роль городов в развитии торговли.",
  "Проследите путь распространения православия на север.",
  "Опишите устройство дружины и её роль в походах.",
  "Укажите, чем занимались ремесленники городов.",
  "Перечислите источники по истории Древней Руси.",
];

/**
 * Лист с ЧЕРЕДОВАНИЕМ форм — нормальный лист.
 *
 * Типы идут вперемешку, соседних одинаковых нет вообще. Это эталон того, что
 * детектор НЕ должен трогать.
 */
const ALTERNATING_TYPES = [
  "computation",
  "multiple-choice",
  "short-answer",
  "fill-blank",
  "computation",
  "multiple-choice",
  "short-answer",
  "fill-blank",
  "computation",
  "multiple-choice",
  "short-answer",
  "fill-blank",
];

/** Лист, где три задания подряд одного типа (позиции 5, 6, 7). */
const RUN_TYPES = [
  "computation",
  "multiple-choice",
  "short-answer",
  "fill-blank",
  "computation",
  "computation",
  "computation",
  "short-answer",
  "multiple-choice",
  "fill-blank",
  "short-answer",
  "multiple-choice",
];

function sheetWith(types: readonly string[], texts: readonly string[] = CLEAN_TEXTS) {
  return {
    title: "Лист по истории",
    subject: "history",
    grade: 6,
    topic: "Древняя Русь",
    difficulty: "medium",
    tasks: types.map((type, i) => ({
      number: i + 1,
      text: texts[i] ?? `Задание ${i + 1}`,
      type,
      answer: `Ответ ${i + 1}`,
    })),
  };
}

/** Сколько раз провайдер был вызван (по записям llm_logs). */
function providerCalls(db: ReturnType<typeof fakeDb>): number {
  return db.logs.filter((l) => l.provider === "polza").length;
}

beforeEach(() => {
  _resetPolzaSingleton();
});

afterEach(() => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. ДЕТЕКТОР: где серия
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-40: детектор серий одинаковых форм", () => {
  it("находит серию из трёх одинаковых форм с правильными start и length", () => {
    // Пример из ТЗ-40: К В В В В1 К — три `multiple-choice` подряд.
    const tasks = [
      { type: "computation" },
      { type: "multiple-choice" },
      { type: "multiple-choice" },
      { type: "multiple-choice" },
      { type: "fill-blank" },
      { type: "computation" },
    ];
    expect(findTypeRuns(tasks)).toEqual([
      { start: 2, length: 3, type: "multiple-choice" },
    ]);
  });

  it("две одинаковые формы подряд — не серия", () => {
    const tasks = [
      { type: "computation" },
      { type: "computation" },
      { type: "short-answer" },
    ];
    expect(findTypeRuns(tasks)).toEqual([]);
  });

  it("серия длиннее трёх — одна серия целиком, а не несколько", () => {
    const tasks = Array.from({ length: 5 }, () => ({ type: "essay" }));
    expect(findTypeRuns(tasks)).toEqual([{ start: 1, length: 5, type: "essay" }]);
  });

  it("неизвестный тип разрывает серию и серией не является (ТЗ-40, AD-4)", () => {
    // Мусор в поле `type` не должен ни входить в серию, ни собирать её.
    const tasks = [
      { type: "computation" },
      { type: "computation" },
      { type: "что-то" },
      { type: "computation" },
      { type: "computation" },
    ];
    expect(findTypeRuns(tasks)).toEqual([]);
  });

  it("нет поля type — серии нет", () => {
    expect(findTypeRuns([{}, {}, {}])).toEqual([]);
  });

  it("порог задаётся параметром", () => {
    const tasks = [
      { type: "computation" },
      { type: "computation" },
      { type: "short-answer" },
    ];
    expect(findTypeRuns(tasks, 2)).toEqual([
      { start: 1, length: 2, type: "computation" },
    ]);
  });

  it("хвост серии — номера заданий подряд", () => {
    const runs = findTypeRuns([
      { type: "computation" },
      { type: "computation" },
      { type: "computation" },
      { type: "computation" },
    ]);
    // Первое задание серии остаётся: менять его — ломать лист сильнее, чем нужно.
    expect(runTailNumbers(runs)).toEqual([2, 3, 4]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ДЕТЕКТОР: где серия НЕ дефект
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-40: нормальная методика дефектом не считается", () => {
  it("отстройка одного навыка — не дефект", () => {
    const tasks = [
      { type: "computation", skill: "Нахождение процента от числа" },
      { type: "computation", skill: "Нахождение процента от числа" },
      { type: "computation", skill: "Нахождение процента от числа" },
    ];
    expect(findTypeRuns(tasks).length).toBe(1);
    expect(isDrillingRun(tasks, findTypeRuns(tasks)[0]!)).toBe(true);
    expect(findDefectRuns(tasks)).toEqual([]);
  });

  it("метки навыка разные — серия дефектная", () => {
    const tasks = [
      { type: "computation", skill: "Нахождение одного процента" },
      { type: "computation", skill: "Нахождение процента от числа" },
      { type: "computation", skill: "Процент в задаче о книгах" },
    ];
    expect(findDefectRuns(tasks).length).toBe(1);
  });

  it("метка, совпадающая с темой листа, — не метка навыка", () => {
    // Так подставляет сервер (`skill-labels.ts`): такая метка ничего не
    // доказывает, и серия считается дефектом.
    const tasks = [
      { type: "computation", skill: "Проценты" },
      { type: "computation", skill: "Проценты" },
      { type: "computation", skill: "Проценты" },
    ];
    expect(
      findDefectRuns(tasks, { topic: "Проценты" }).length,
      "метка-тема не должна оправдывать серию",
    ).toBe(1);
  });

  it("тест с автопроверкой: выбор ответа идёт подряд по определению", () => {
    const tasks = Array.from({ length: 7 }, () => ({ type: "multiple-choice" }));
    expect(findTypeRuns(tasks).length).toBe(1);
    expect(findDefectRuns(tasks, { workType: "test" }).length).toBe(0);
    // А в рабочем листе такая серия — дефект.
    expect(findDefectRuns(tasks, { workType: "worksheet" }).length).toBe(1);
  });

  it("формат экзамена: часть 1 — краткие ответы подряд", () => {
    const tasks = Array.from({ length: 5 }, () => ({ type: "multiple-choice" }));
    expect(findDefectRuns(tasks, { workType: "oge" }).length).toBe(0);
    expect(findDefectRuns(tasks, { workType: "ege" }).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. КОНВЕЙЕР: серия уезжает учителю только если её не починили
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-40: конвейер убирает серию одинаковых форм", () => {
  it("лист с тремя одинаковыми формами подряд — после конвейера серии нет", async () => {
    // Порядок вызовов провайдера:
    //   1. основной лист — 12 заданий, три из них (№5–7) одного типа;
    //   2. замена — модель вернула два задания ДРУГОЙ формы.
    const replacement = {
      tasks: [
        {
          number: 1,
          text: "Объясните, чем отличалось положение дружинников от простых людей.",
          type: "short-answer",
          answer: "Дружина — профессиональная сила",
          skill: "положение дружины",
        },
        {
          number: 2,
          text: "Опишите, как новгородские купцы вели торговлю с северными землями.",
          type: "fill-blank",
          answer: "через Новгород и Ладогу",
          skill: "торговые связи Севера",
        },
      ],
    };
    stubProvider([sheetWith(RUN_TYPES), replacement]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    // ГЛАВНОЕ: серии из трёх и более одинаковых форм в выдаче нет.
    expect(findTypeRuns(res.worksheet.tasks as never).length).toBe(0);
    // Лист не потерял задания: замена заняла место серии, а не добавилась.
    expect(res.worksheet.tasks).toHaveLength(12);
    expect(res.quality.stillMissing).toBe(0);
    // И замена действительно другой формы.
    const types = res.worksheet.tasks.map((t) => t.type);
    expect(types[4]).toBe("computation");
    expect(types[5]).not.toBe("computation");
    expect(types[6]).not.toBe("computation");
    // Модель позвана дважды: лист и замена.
    expect(providerCalls(db)).toBe(2);
  });

  it("замена не удалась — задание удаляется, лист короче, честное число", async () => {
    // Модель на замену не вернула ничего: лист из трёх одинаковых форм подряд
    // хуже короткого листа, и учитель должен увидеть «получено 10 из 12».
    stubProvider([sheetWith(RUN_TYPES), { tasks: [] }]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    expect(findTypeRuns(res.worksheet.tasks as never).length).toBe(0);
    expect(res.worksheet.tasks).toHaveLength(10);
    expect(res.quality.delivered).toBe(10);
    expect(res.quality.requested).toBe(12);
    expect(res.quality.stillMissing).toBe(2);
  });

  it("замена, породившая дубль, снимается постусловием чистки (ТЗ-34)", async () => {
    // Модель вернула задание, которое дублирует задание №3 листа. Замена
    // должна быть снята ПОСТУСЛОВИЕМ (`dropRemainingDupes`), а не молча
    // уехать учителю.
    const dupe = {
      number: 1,
      text: CLEAN_TEXTS[2],
      type: "short-answer",
      answer: "Ответ 3",
    };
    stubProvider([sheetWith(RUN_TYPES), { tasks: [dupe] }]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    expect(findSkillDupes(res.worksheet.tasks).hasDupes).toBe(false);
    expect(res.quality.repeatedSkills).toBe(0);
    // Дубликат убран — лист короче, и это видно учителю.
    expect(res.quality.stillMissing).toBeGreaterThan(0);
  });

  it("разнообразие навыков после замены не хуже, чем было", async () => {
    const replacement = {
      tasks: [
        {
          number: 1,
          text: "Объясните, чем отличалось положение дружинников от простых людей.",
          type: "short-answer",
          answer: "Дружина — профессиональная сила",
          skill: "положение дружины",
        },
        {
          number: 2,
          text: "Опишите, как новгородские купцы вели торговлю с северными землями.",
          type: "fill-blank",
          answer: "через Новгород и Ладогу",
          skill: "торговые связи Севера",
        },
      ],
    };
    const sheet = sheetWith(RUN_TYPES);
    // Разные метки навыка у всех заданий листа.
    sheet.tasks = sheet.tasks.map((task, i) => ({
      ...task,
      skill: `навык ${i + 1}`,
    }));
    stubProvider([sheet, replacement]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    const distinct = (tasks: readonly unknown[]): number =>
      new Set(
        tasks.map((t) => String((t as { skill?: unknown }).skill ?? "").trim()),
      ).size;
    expect(distinct(res.worksheet.tasks)).toBeGreaterThanOrEqual(
      distinct(sheet.tasks),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. КОНВЕЙЕР: ложных срабатываний быть не должно
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-40: нормальный лист не трогаем", () => {
  it("лист с чередованием форм — ни одного лишнего вызова модели", async () => {
    stubProvider([sheetWith(ALTERNATING_TYPES)]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    // ОДИН вызов — как у листа без серий. Никакой «профилактики».
    expect(providerCalls(db)).toBe(1);
    expect(res.worksheet.tasks).toHaveLength(12);
    expect(res.quality.stillMissing).toBe(0);
    // Состав листа прежний — те же тексты в том же порядке.
    expect(res.worksheet.tasks.map((t) => t.text)).toEqual(
      CLEAN_TEXTS.map((text) => text),
    );
  });

  it("две одинаковые формы подряд — не дефект", async () => {
    const types = [...ALTERNATING_TYPES];
    types[4] = "computation";
    types[5] = "computation";
    stubProvider([sheetWith(types)]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    expect(providerCalls(db)).toBe(1);
    expect(res.worksheet.tasks).toHaveLength(12);
    expect(res.quality.stillMissing).toBe(0);
  });

  it("три одинаковые формы подряд на ОДНИМ навыке — отработка навыка, не дефект", async () => {
    const sheet = sheetWith(RUN_TYPES);
    sheet.tasks = sheet.tasks.map((task, i) => ({
      ...task,
      skill: i >= 4 && i <= 6 ? "нахождение процента от числа" : `навык ${i + 1}`,
    }));
    stubProvider([sheet]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    // Один вызов: серия не тронута, модель не зовётся второй раз.
    expect(providerCalls(db)).toBe(1);
    expect(res.worksheet.tasks).toHaveLength(12);
    expect(res.quality.stillMissing).toBe(0);
  });

  it("тест с автопроверкой: семь заданий с выбором ответа — это его формат", async () => {
    const types = Array.from({ length: 10 }, () => "multiple-choice");
    const sheet = sheetWith(types);
    stubProvider([sheet]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 10, type: "test" }) },
      FAKE_ENV,
      db as never,
    );

    expect(providerCalls(db)).toBe(1);
    expect(res.worksheet.tasks).toHaveLength(10);
    expect(res.quality.stillMissing).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. КОНТРОЛЬНАЯ: серия чинится в любом из вариантов
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-40: контрольная — серия убирается в каждом варианте", () => {
  it("серия во втором варианте — в ответе чисто в обоих, длины равны", async () => {
    // Вариант 1 — формы чередуются. Вариант 2 — три `computation` подряд
    // (позиции 3, 4, 5). Варианты различаются текстами, иначе сработал бы
    // ретрай за одинаковые варианты (это другая задача).
    const v1Texts = [
      "Объясните значение битвы на реке Калке.",
      "Перечислите последствия раздробленности Руси.",
      "Охарактеризуйте внутреннюю политику Ярослава Мудрого.",
      "Сравните управление Киевом и Новгородом.",
      "Опишите положение Церкви в домонгольской Руси.",
      "Расскажите о походе Олега на Царьград.",
    ];
    const v2Texts = [
      "Опишите устройство дружины и её роль в походах.",
      "Укажите, что изменилось в войске после Святослава.",
      "Определите роль городов в развитии торговли.",
      "Проследите путь распространения православия на север.",
      "Укажите, чем занимались ремесленники городов.",
      "Перечислите источники по истории Древней Руси.",
    ];
    const v1Types = [
      "computation",
      "multiple-choice",
      "short-answer",
      "fill-blank",
      "computation",
      "multiple-choice",
    ];
    const v2Types = [
      "computation",
      "multiple-choice",
      "computation",
      "computation",
      "computation",
      "multiple-choice",
    ];
    const variants = {
      variants: [
        {
          title: "Вариант 1",
          subject: "history",
          grade: 6,
          topic: "Древняя Русь",
          difficulty: "medium",
          tasks: v1Types.map((type, i) => ({
            number: i + 1,
            text: v1Texts[i]!,
            type,
            answer: `Ответ ${i + 1}`,
          })),
        },
        {
          title: "Вариант 2",
          subject: "history",
          grade: 6,
          topic: "Древняя Русь",
          difficulty: "medium",
          tasks: v2Types.map((type, i) => ({
            number: i + 1,
            text: v2Texts[i]!,
            type,
            answer: `Ответ ${i + 1}`,
          })),
        },
      ],
    };
    const replacement = {
      tasks: [
        {
          number: 1,
          text: "Сравните полномочия князя и городского веча.",
          type: "short-answer",
          answer: "Князь — войско и земли, вече — сход горожан",
        },
        {
          number: 2,
          text: "Назовите торговые пути, связывавшие Новгород с севером.",
          type: "fill-blank",
          answer: "Волхов и Ладога",
        },
      ],
    };
    stubProvider([variants, replacement]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 6, type: "control" }) },
      FAKE_ENV,
      db as never,
    );

    expect(res.secondVariant).not.toBeNull();
    // Ни в одном варианте серии нет.
    expect(findTypeRuns(res.worksheet.tasks as never).length).toBe(0);
    expect(findTypeRuns(res.secondVariant?.tasks as never).length).toBe(0);
    // И оба варианта — одной длины (ТЗ-25, AD-8).
    expect(res.secondVariant?.tasks).toHaveLength(res.worksheet.tasks.length);
  });
});

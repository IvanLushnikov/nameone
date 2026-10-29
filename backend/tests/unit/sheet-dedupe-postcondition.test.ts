/**
 * ТЗ-34: ЧИСТКА ЛИСТА С ПОСТУСЛОВИЕМ (Q-02) И ЧЕСТНЫЙ ПРИЗНАК ОТКАТА (Q-08).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Два разных дефекта, оба — про честность ответа API:
 *
 *   1. Q-02. Модель вернула лист, где три задания БАЙТ-В-БАЙТ одинаковые.
 *      Система это видела, честно написала «заменить не получилось» — и всё
 *      равно отдала лист учителю. Три ученика из класса получали одно и то же
 *      задание. Теперь в ответе НЕТ ни одной пары дублей: лист либо чистый,
 *      либо короткий и честно короткий.
 *
 *   2. Q-08. Признак `quality.filterBackedOff` врал: он стоял `true` именно
 *      тогда, когда фильтр НИЧЕГО не отбросил. «Откат фильтра» и «всё чисто»
 *      выглядели одинаково, и по ответу отличить их было невозможно.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧЕГО НЕТ В ЭТОМ ФАЙЛЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * Здесь нет мока «чистка прошла успешно». Каждый кейс гоняет НАСТОЯЩИЙ
 * конвейер `generateWorksheet` с подменённым провайдером — так же, как это
 * делает `tz25-quality-loss.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * `vi.stubGlobal("fetch")` — реальный polza.ai не трогаем, это платный API.
 * Ответы провайдера выдаются ПО ОЧЕРЕДИ: конвейер зовёт модель несколько раз
 * (лист → замена дубля → добивка длины), и тест должен решать, что модель
 * «скажет» на каждый вызов. Порядок вызовов зафиксирован комментариями в
 * каждом кейсе: это и есть документ конвейера.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
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
 * `payloads` — массив ответов: первый достаётся первому вызову, второй —
 * второму и так далее. Последний повторяется, если вызовов окажется больше.
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
 * тест мерил бы не чистку, а ложные срабатывания детектора.
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

/** Задание, которое фильтр качества выкидывает: ссылка на образец, которого нет. */
function brokenTask(number: number, text: string) {
  return { number, text, answer: "Ответ" };
}

/** Лист без дублей — двенадцать РАЗНЫХ заданий. */
const CLEAN_SHEET = {
  title: "Лист по истории",
  subject: "history",
  grade: 6,
  topic: "Древняя Русь",
  difficulty: "medium",
  tasks: CLEAN_TEXTS.map((text, i) => ({
    number: i + 1,
    text,
    answer: `Ответ ${i + 1}`,
  })),
};

/**
 * Тот самый лист из живого прогона: задания №6, №9 и №12 — байт-в-байт
 * одинаковые.
 *
 * Детектор видит три пары (6↔9, 6↔12, 9↔12), и на замену уходят вторые
 * задания пар — №9 и №12. То есть МЕСТА ДЛЯ ЗАМЕНЫ ДВА, а не три: третье
 * одинаковое задание убирается вместе с ними.
 */
const DUPE_TEXT = "Назовите причины похода Игоря на север.";
const SHEET_WITH_DUPE = {
  title: "Лист по истории",
  subject: "history",
  grade: 6,
  topic: "Древняя Русь",
  difficulty: "medium",
  tasks: CLEAN_TEXTS.map((text, i) => ({
    number: i + 1,
    text: i === 5 || i === 8 || i === 11 ? DUPE_TEXT : text,
    answer: `Ответ ${i + 1}`,
  })),
};

/** Замена дубля: одно задание, которого в листе ещё нет. */
const REPLACEMENT = {
  tasks: [
    {
      number: 1,
      text: "Составьте рассказ о походе Святослава на хазарский город.",
      answer: "Разорение Хазарии",
    },
  ],
};

/** Есть ли в листе два БАЙТ-В-БАЙТ одинаковых задания. */
function hasIdenticalPair(tasks: readonly { text?: unknown }[]): boolean {
  const seen = new Set<string>();
  for (const task of tasks) {
    const text = typeof task.text === "string" ? task.text : "";
    if (seen.has(text)) return true;
    seen.add(text);
  }
  return false;
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
// Q-02: ПОСТУСЛОВИЕ ЧИСТКИ
// ─────────────────────────────────────────────────────────────────────────────

describe("Q-02: после чистки в листе не остаётся ни одной пары дублей", () => {
  it("фикстура действительно содержит дубль — иначе кейс ничего не проверяет", () => {
    // Тест на самом детекторе: три одинаковых задания дают три пары, и на
    // замену идут вторые задания пар — №9 и №12.
    const dupes = findSkillDupes(SHEET_WITH_DUPE.tasks);
    expect(dupes.hasDupes).toBe(true);
    expect(dupes.pairs.map((p) => `${p.first}-${p.second}`)).toEqual([
      "6-9",
      "6-12",
      "9-12",
    ]);
    // А чистый лист дублей не содержит.
    expect(findSkillDupes(CLEAN_SHEET.tasks).hasDupes).toBe(false);
  });

  it("замена не удалась — в ответе НЕТ дубля, а не «написано в лог»", async () => {
    // Порядок вызовов провайдера:
    //   1. основной лист — 12 заданий, три из них байт-в-байт одинаковые;
    //   2. замена дублей — модель вернула ОДНО задание на ДВА слота;
    //   3. добивка длины — модель не вернула ничего.
    //
    // Старый код на шаге 2 подставлял `usable[cursor] ?? task`: на втором слоте
    // замены не было, и туда возвращалось СТАРОЕ задание — то есть ровно тот
    // дубль, который чистка убирала. Длина листа сохранялась, дозапрос не
    // срабатывал, и дубль уезжал учителю вместе с фразой «заменить не
    // получилось».
    stubProvider([SHEET_WITH_DUPE, REPLACEMENT, { tasks: [] }]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    // ГЛАВНОЕ: в ответе нет ни одной пары дублей.
    expect(findSkillDupes(res.worksheet.tasks).hasDupes).toBe(false);
    expect(hasIdenticalPair(res.worksheet.tasks)).toBe(false);
    // И это видно по признакам, а не только по факту: повторов в выдаче нет.
    expect(res.quality.repeatedSkills).toBe(0);
    // Честная нехватка вместо тихого брака: заданий меньше, чем просили, и
    // учитель об этом знает.
    expect(res.quality.stillMissing).toBeGreaterThan(0);
    expect(res.quality.delivered).toBeLessThan(res.quality.requested);
  });

  it("замена удалась — длина листа не изменилась, повторов нет", async () => {
    // На каждый из двух дублей модель вернула по заданию.
    const twoReplacements = {
      tasks: [
        ...REPLACEMENT.tasks,
        {
          number: 2,
          text: "Объясните, чем отличалось положение дружинников от простых людей.",
          answer: "Дружина — профессиональная сила",
        },
      ],
    };
    stubProvider([SHEET_WITH_DUPE, twoReplacements]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    expect(findSkillDupes(res.worksheet.tasks).hasDupes).toBe(false);
    expect(res.quality.repeatedSkills).toBe(0);
    // Длина сохранилась: замена заняла место дубля, а не добавила задание.
    expect(res.worksheet.tasks).toHaveLength(12);
    expect(res.quality.stillMissing).toBe(0);
  });

  it("лист без дублей проходит чистку без изменений и без лишних вызовов модели", async () => {
    // Регрессия: чистка не должна ни что-то менять, ни звать модель на пустом
    // месте. Двенадцать разных заданий, ровно столько, сколько просили.
    stubProvider([CLEAN_SHEET]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    expect(providerCalls(db)).toBe(1);
    expect(res.worksheet.tasks).toHaveLength(12);
    expect(res.quality.dropped).toBe(0);
    expect(res.quality.repeatedSkills).toBe(0);
    expect(res.quality.stillMissing).toBe(0);
    // Состав листа прежний — те же тексты, в том же порядке.
    expect(res.worksheet.tasks.map((t) => t.text)).toEqual(
      CLEAN_SHEET.tasks.map((t) => t.text),
    );
  });

  it("задания, отличающиеся числами, дублями НЕ считаются", async () => {
    // Детектор — фильтр безопасности: он гарантированно не врёт на
    // отличиях. Два задания, отличающиеся только числами, — это РАЗНЫЕ
    // задания, и заменять их нельзя: это отняло бы у учителя нормальный
    // материал и потратило бы вызов модели.
    const mathSheet = {
      title: "Лист по математике",
      subject: "math",
      grade: 5,
      topic: "Обыкновенные дроби",
      difficulty: "medium",
      tasks: [
        { number: 1, text: "Вычислите 3/4 + 1/4.", answer: "1" },
        { number: 2, text: "Вычислите 5/8 + 1/8.", answer: "3/4" },
        { number: 3, text: "Сравните дроби 2/7 и 3/7.", answer: "2/7 меньше" },
      ],
    };
    stubProvider([mathSheet]);

    const db = fakeDb();
    const res = await generateWorksheet(
      {
        ...ARGS,
        request: makeRequest({
          subject: "math" as GenerationRequest["subject"],
          grade: 5,
          topic: "Обыкновенные дроби",
          count: 3,
        }),
      },
      FAKE_ENV,
      db as never,
    );

    // Ни одного вызова на замену: разные задания дублями не признаны.
    expect(providerCalls(db)).toBe(1);
    expect(res.worksheet.tasks).toHaveLength(3);
    expect(res.quality.repeatedSkills).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-08: ПРИЗНАК ОТКАТА ФИЛЬТРА
// ─────────────────────────────────────────────────────────────────────────────

describe("Q-08: filterBackedOff значит ровно одно — откат", () => {
  it("фильтр ничего не отбросил, а заданий не хватило — это НЕ откат", async () => {
    // Ровно тот случай, который пришёл в живых прогонах: фильтр отбросил
    // НОЛЬ заданий (`dropped: 0` во всех десяти прогонах), а материал всё
    // равно не хватил. Старый код ставил здесь `filterBackedOff = true`, и
    // учителю говорили «Фильтр отсеял слишком много заданий» — про фильтр,
    // который не отсеял ни одного.
    const short = {
      title: "Лист по истории",
      subject: "history",
      grade: 6,
      topic: "Древняя Русь",
      difficulty: "medium",
      tasks: CLEAN_SHEET.tasks.slice(0, 8),
    };
    // Добивка длины: модель вернула два задания из четырёх нужных.
    const topUp = {
      tasks: [
        {
          number: 9,
          text: "Объясните, зачем городам были вечевые площади.",
          answer: "Сход жителей",
        },
        {
          number: 10,
          text: "Опишите роль ярмарки в жизни средневекового города.",
          answer: "Обмен",
        },
      ],
    };
    stubProvider([short, topUp]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    // Фильтр ничего не отбросил — отката не было.
    expect(res.quality.dropped).toBe(0);
    expect(res.quality.filterBackedOff).toBe(false);
    // И нехватка честная: материал короче, чем просили.
    expect(res.quality.stillMissing).toBe(2);
  });

  it("фильтр откатил проверку — признак честный и его видно", async () => {
    // Шесть заданий, каждое — ссылка на образец, которого нет. Фильтр
    // выкинул все шесть, но это «слишком агрессивно», поэтому он откатил свою
    // правку и вернул исходный набор.
    const allBroken = {
      title: "Лист по истории",
      subject: "history",
      grade: 6,
      topic: "Древняя Русь",
      difficulty: "medium",
      tasks: [
        brokenTask(1, "Киев — столица князей. Выполните по образцу."),
        brokenTask(2, "Новгород — вольный город. Сделайте аналогично предыдущему пункту."),
        brokenTask(3, "Вече — сход горожан. Рассчитайте таким же способом, как в примере."),
        brokenTask(4, "Дружина — сила князя. Выполните по образцу полученный итог."),
        brokenTask(5, "Ярмарка — торг новгородцев. Сделайте по образцу указанный порядок."),
        brokenTask(6, "Летопись — летописец. Определите таким же способом долготу."),
      ],
    };
    // Добивка длины — нормальные задания.
    const topUp = {
      tasks: [
        {
          number: 7,
          text: "Объясните значение слова «вече» в Древней Руси.",
          answer: "Сход жителей",
        },
        {
          number: 8,
          text: "Назовите столицы, которые меняли статус.",
          answer: "Киев и Владимир",
        },
        {
          number: 9,
          text: "Опишите устройство дружины и её роль в походах.",
          answer: "Дружина и полки",
        },
        {
          number: 10,
          text: "Укажите, чем занимались ремесленники городов.",
          answer: "Кузнецы, гончары",
        },
        {
          number: 11,
          text: "Определите роль княжеского двора.",
          answer: "Управление и войско",
        },
        {
          number: 12,
          text: "Перечислите источники по истории Древней Руси.",
          answer: "Летописи",
        },
      ],
    };
    stubProvider([allBroken, topUp]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    // Откат был — признак стоит.
    expect(res.quality.filterBackedOff).toBe(true);
    // И это видно учителю: блок предупреждения показывается даже когда
    // заданий хватает (откат не уменьшает лист — он возвращает в него
    // непрошедшие проверку задания).
    expect(res.quality.stillMissing).toBe(0);
  });

  it("фильтр отбросил часть заданий — отката не было, потери видны", async () => {
    const withBroken = {
      title: "Лист по истории",
      subject: "history",
      grade: 6,
      topic: "Древняя Русь",
      difficulty: "medium",
      tasks: [
        ...CLEAN_SHEET.tasks.slice(0, 10),
        brokenTask(11, "Летопись — летописец. Выполните по образцу полученный итог."),
        brokenTask(12, "Князь — правитель. Сделайте аналогично предыдущему пункту."),
      ],
    };
    // Добивка вернула одно задание из двух — лист остался короче, и это видно.
    const topUp = {
      tasks: [
        {
          number: 11,
          text: "Объясните, зачем городам были вечевые площади.",
          answer: "Сход жителей",
        },
      ],
    };
    stubProvider([withBroken, topUp]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest() },
      FAKE_ENV,
      db as never,
    );

    // Отката не было, потери — были, и они видны.
    expect(res.quality.filterBackedOff).toBe(false);
    expect(res.quality.dropped).toBe(2);
    expect(res.quality.droppedPatternRef.length).toBe(2);
    expect(res.quality.stillMissing).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// КОНТРОЛЬНАЯ: оба варианта проходят ту же чистку
// ─────────────────────────────────────────────────────────────────────────────

describe("контрольная: дубль убирается в любом из вариантов", () => {
  it("дубль в первом варианте — в ответе чисто в обоих", async () => {
    // Вариант 1: задания 3 и 6 одинаковые. Вариант 2: все задания свои и
    // ПОЗИЦИОННО отличаются от первого (иначе сработал бы ретрай за
    // одинаковые варианты, а это другая задача).
    const v1 = [
      { number: 1, text: "Объясните значение битвы на реке Калке.", answer: "Разгром" },
      { number: 2, text: "Перечислите последствия раздробленности Руси.", answer: "Уделы" },
      { number: 3, text: "Назовите причины похода Игоря на север.", answer: "Спор с древлянами" },
      { number: 4, text: "Опишите положение Церкви в домонгольской Руси.", answer: "Влияние" },
      { number: 5, text: "Определите роль городов в развитии торговли.", answer: "Ярмарки" },
      { number: 6, text: "Назовите причины похода Игоря на север.", answer: "Спор с древлянами" },
    ];
    const v2 = [
      { number: 1, text: "Расскажите о походе Олега на Царьград.", answer: "Щит" },
      { number: 2, text: "Охарактеризуйте внутреннюю политику Ярослава Мудрого.", answer: "Столы" },
      { number: 3, text: "Сравните управление Киевом и Новгородом.", answer: "Власть" },
      { number: 4, text: "Укажите, что изменилось в войске после Святослава.", answer: "Полки" },
      { number: 5, text: "Проследите путь распространения православия на север.", answer: "Миссии" },
      { number: 6, text: "Опишите устройство дружины и её роль в походах.", answer: "Дружина" },
    ];
    const variants = {
      variants: [
        {
          title: "Вариант 1",
          subject: "history",
          grade: 6,
          topic: "Древняя Русь",
          difficulty: "medium",
          tasks: v1,
        },
        {
          title: "Вариант 2",
          subject: "history",
          grade: 6,
          topic: "Древняя Русь",
          difficulty: "medium",
          tasks: v2,
        },
      ],
    };
    // Замена дубля в первом варианте.
    stubProvider([variants, REPLACEMENT]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 6, type: "control" }) },
      FAKE_ENV,
      db as never,
    );

    expect(res.secondVariant).not.toBeNull();
    // Ни в одном варианте дублей нет.
    expect(findSkillDupes(res.worksheet.tasks).hasDupes).toBe(false);
    expect(findSkillDupes(res.secondVariant?.tasks ?? []).hasDupes).toBe(false);
    expect(hasIdenticalPair(res.worksheet.tasks)).toBe(false);
    // И повторов в признаках нет — они считаются по обоим вариантам.
    expect(res.quality.repeatedSkills).toBe(0);
  });
});

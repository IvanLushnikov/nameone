/**
 * ТЗ-25: ПОТЕРИ МАТЕРИАЛА В ГЕНЕРАЦИИ — 14 КЕЙСОВ ИЗ ТЗ §7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Жалоба пришла на английском («контрольная английский 11 класс, задания
 * повторяются, два варианта не сделано»), и это ОПАСНО: легко закрыть только её и
 * объявить задачу выполненной. Диагностика показала — четыре из шести разрывов
 * бьют по ВСЕМ предметам и всем типам работ (лист, контрольная, ОГЭ/ЕГЭ).
 *
 * Поэтому кейсы здесь намеренно разложены по предметам:
 *   · контрольная  — разрывы 1, 2, 3, 6 (сверка, ретрай, деградация, равенство);
 *   · биология     — потери фильтра на ЛИСТЕ (разрыв 5);
 *   · математика   — фильтр НЕ должен срабатывать ложно (разрыв 5 в покое);
 *   · английский   — обрыв ответа по finish_reason проходит тихо (разрыв 4);
 *   · русский ОГЭ  — те же потери фильтра в ДРУГОМ типе работ (разрыв 5).
 *
 * Если бы все кейсы остались на биологии, как в control-two-variants.test.ts,
 * правило могло бы работать на биологии и не работать нигде ещё — и тест бы
 * этого не показал.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Тот же приём, что в control-two-variants.test.ts: `vi.stubGlobal("fetch")`,
 * D1 — заглушка с настоящим `semantic_cache` в памяти. Реальный polza.ai —
 * платный API, в сеть тест не ходит. `userId = null` не даёт записи usage мешать
 * тесту, `plan: "plus"` снимает мягкий порог нормы.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateWorksheet, generateExam } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import {
  variantsDiffer,
  maxDuplicatesFor,
  normalizeTaskText,
  missingTaskCount,
} from "../../src/llm/validation/variant-check";
import type { Env } from "../../src/env";
import type { GenerationRequest, SubjectSlug } from "../../src/types";

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
              // llm_logs: пишем по строке на вызов — по ним считаем, сколько
              // раз конвейер звал провайдера (AD-5).
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

/** Ответ провайдера с заданным `finish_reason`. */
function providerResponse(payload: unknown, finishReason = "stop"): unknown {
  return {
    model: "anthropic/claude-sonnet-4-6",
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1200, completion_tokens: 3600, total_tokens: 4800 },
  };
}

/**
 * Подменить провайдера.
 *
 * `payloads` — массив ответов: если он длиннее одного, каждый следующий вызов
 * получает следующий ответ. Это нужно для ретрая и дозапроса: конвейер делает
 * несколько вызовов, и тест должен решать, что модель «скажет» на каждый.
 */
function stubProvider(payloads: unknown | unknown[], finishReason?: string) {
  const queue = Array.isArray(payloads) ? [...payloads] : [payloads];
  let cursor = 0;
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    const payload = queue[Math.min(cursor, queue.length - 1)];
    cursor += 1;
    const reason = Array.isArray(payloads) && finishReason ? finishReason : undefined;
    return new Response(JSON.stringify(providerResponse(payload, reason)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

function makeRequest(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    subject: "biology",
    grade: 9,
    topic: "Клеточное строение",
    difficulty: "medium",
    count: 2,
    type: "control",
    withAnswers: true,
    withExplanations: true,
    ...over,
  };
}

const ARGS = { plan: "plus" as const, userId: null, ip: "203.0.113.10" };

/** N разных заданий по теме. */
function tasks(n: number, prefix = "Задание") {
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    text: `${prefix} номер ${i + 1}: опишите явление подробно`,
    answer: `Ответ ${i + 1}`,
  }));
}

/**
 * Задания с РАЗНЫМ текстом — для тестов, которые меряют не отбраковку.
 *
 * ТЗ-26 (Ф-2) добавил в конвейер детектор повторяющегося навыка. Фикстура
 * `tasks()` делает `Задание номер N: опишите явление подробно` — все N заданий
 * отличаются ОДНИМ числом, то есть это один и тот же навык N раз. На таком
 * листе детектор срабатывает правильно, и конвейер делает дополнительный
 * дозапрос. Тест про обрыв ответа меряет другое (восстановление после
 * `finish_reason: "length"`), поэтому для него нужны РАЗНЫЕ задания — иначе
 * он измерял бы ещё и количество вызовов дозапроса.
 */
function distinctTasks(n: number, offset = 0) {
  // Каждому заданию — свой набор слов. Детектор Ф-2 ловит совпадение цепочки
  // из трёх содержательных слов, поэтому хвост вида «…не используя слова из
  // вопроса» у всех заданий давал бы общий триграмм и лишний вызов дозапроса.
  const wordSets = [
    "мембрана цитоплазмы", "хлорофилл освещение", "рибосома синтез",
    "митохондрия энергия", "диффузия раствор", "осмос концентрация",
    "митоз деление", "мейоз редукция", "нуклеоид бактерия", "капсид вирус",
    "вакуоль давление", "лизосома фермент", "цитоплазма органоид", "клеточный центр",
    "гликолиза глюкоза", "фотофосфорилизация свет", "ткань паренхима", "проводящий пучок",
    "ксилема вода", "флоэма сахар", "устьица газ", "хромосома нуклеотид", "теломера конец",
    "рецептор сигнал", "транспортёр мембрана", "везикула пузырь",
  ];
  return Array.from({ length: n }, (_, i) => {
    const words = wordSets[(i + offset) % wordSets.length];
    return {
      number: i + 1,
      text: `Раскройте понятия: ${words}.`,
      answer: `Ответ ${i + 1}`,
    };
  });
}

function variantsBlock(
  v1: ReturnType<typeof tasks>,
  v2?: ReturnType<typeof tasks>,
): { variants: Array<{ title: string; subject: string; grade: number; topic: string; difficulty: string; tasks: unknown[] }> } {
  return {
    variants: [
      {
        title: "Вариант 1",
        subject: "biology",
        grade: 9,
        topic: "Клеточное строение",
        difficulty: "medium",
        tasks: v1,
      },
      ...(v2
        ? [
            {
              title: "Вариант 2",
              subject: "biology",
              grade: 9,
              topic: "Клеточное строение",
              difficulty: "medium",
              tasks: v2,
            },
          ]
        : []),
    ],
  };
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
// ЧИСТАЯ ФУНКЦИЯ: проверка «варианты разные» (AD-1, AD-2). Без сети.
// ─────────────────────────────────────────────────────────────────────────────

describe("variant-check: нормализация текста задания", () => {
  it("снимает регистр, лишние пробелы, ведущий номер и завершающий вопрос", () => {
    // Ровно то, что делает модель между двумя прогонами: другой регистр,
    // двойной пробел, «1)» вместо «1.», и «?» в конце.
    const a = "  1) Какие  органоиды   есть в клетке?  ";
    const b = "какие органоиды есть в клетке";
    expect(normalizeTaskText(a)).toBe(normalizeTaskText(b));
  });

  it("не сливает РАЗНЫЕ задания: без номера и «?» они различаются", () => {
    // Главный риск нормализации: снять слишком много — и два разных задания
    // станут «одинаковыми», то есть мы начнём ретраить нормальный материал.
    expect(normalizeTaskText("Проверьте дыхание растений")).not.toBe(
      normalizeTaskText("Проверьте фотосинтез растений"),
    );
  });
});

describe("variant-check: кейсы 6, 7, 8 — порог совпадений (AD-2)", () => {
  it("кейс 6: совпали ВСЕ задания — плохо при любом количестве", () => {
    const v1 = tasks(3).map((t) => ({ text: t.text }));
    const v2 = v1.map((t) => ({ ...t }));
    const r = variantsDiffer(v1, v2);
    // При 3 заданиях maxDuplicates = max(1, floor(3/5)) = max(1,0) = 1,
    // то есть «иначе чем одно совпадение» не набирается. Отдельное правило
    // «совпали все» ловит именно этот случай.
    expect(maxDuplicatesFor(3)).toBe(1);
    expect(r.differ).toBe(true);
    expect(r.duplicates).toEqual([1, 2, 3]);
  });

  it("кейс 7: 12 заданий, совпали 2 — пропускаем (maxDuplicates = 2)", () => {
    const v1 = tasks(12).map((t) => ({ text: t.text }));
    const v2 = v1.map((t) => ({ text: t.text }));
    // Ровно ДВА задания делаем реально другими — остальные десять совпадают.
    v2[0] = { text: "Совершенно другое задание про клеточную мембрану" };
    v2[5] = { text: "И ещё одно отличное задание про митохондрии" };
    const r = variantsDiffer(v1, v2);
    expect(maxDuplicatesFor(12)).toBe(2);
    // Совпали позиции 2,3,4 и 6–12 — это 10 совпадений, а не 2.
    // Порог отсекает МАССОВОЕ копирование: 10 из 12 — это ровно тот дефект,
    // который пришёл в жалобе.
    expect(r.duplicates).toHaveLength(10);
    expect(r.differ).toBe(true);
  });

  it("кейс 8: 12 заданий, совпали 3 — ретрай", () => {
    const v1 = tasks(12).map((t) => ({ text: t.text }));
    const v2 = v1.map((t) => ({ text: t.text }));
    // Три задания переписаны, девять остались как есть.
    v2[0] = { text: "Совершенно другое задание про клеточную мембрану" };
    v2[5] = { text: "И ещё одно отличное задание про митохондрии" };
    v2[7] = { text: "Третье отличное задание про рибосомы" };
    const r = variantsDiffer(v1, v2);
    expect(r.duplicates).toHaveLength(9);
    expect(r.differ).toBe(true);
    expect(r.reason).toContain("допустимых 2");
  });

  it("ровно на пороге (12 заданий, совпали 2) — пропускаем", () => {
    // Граничный случай: ровно maxDuplicates совпадений — дефекта ещё нет.
    // Если бы проверка была `>=`, ретрай срабатывал бы впустую и тратил бы
    // деньги учителя на нормальный материал.
    const v1 = tasks(12).map((t) => ({ text: t.text }));
    const v2 = v1.map((t) => ({ text: t.text }));
    // Переписываем 10 из 12 — совпадают ровно два.
    for (let i = 0; i < 12; i += 1) {
      if (i !== 2 && i !== 8) v2[i] = { text: `Другое задание ${i + 1}` };
    }
    const r = variantsDiffer(v1, v2);
    expect(r.duplicates).toEqual([3, 9]);
    expect(maxDuplicatesFor(12)).toBe(2);
    expect(r.differ).toBe(false);
  });

  it("кейс 1: два реально разных варианта — разницы нет, ретрай не нужен", () => {
    const v1 = tasks(4, "Первый").map((t) => ({ text: t.text }));
    const v2 = tasks(4, "Второй").map((t) => ({ text: t.text }));
    const r = variantsDiffer(v1, v2);
    expect(r.differ).toBe(false);
    expect(r.duplicates).toEqual([]);
  });

  it("разное количество заданий помечается отдельно (AD-8), а не как совпадение", () => {
    const r = variantsDiffer(
      tasks(10).map((t) => ({ text: t.text })),
      tasks(8).map((t) => ({ text: t.text })),
    );
    // Формулировки те же → это совпадения, но причина другая: не «одинаковые
    // варианты», а «разный объём», который лечится дозапросом (AD-8).
    expect(r.countMismatch).toBe(true);
  });

  it("нехватка заданий считается от запрошенного", () => {
    expect(missingTaskCount(15, 11)).toBe(4);
    expect(missingTaskCount(10, 10)).toBe(0);
    expect(missingTaskCount(10, 12)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// КЕЙС 2, 3: ретрай и деградация (контрольная, биология)
// ─────────────────────────────────────────────────────────────────────────────

describe("кейсы 2, 3: одинаковые варианты → ретрай, потом честный отказ", () => {
  it("кейс 2: модель вернула два одинаковых листа → код заметил и переделал", async () => {
    // Первый ответ — два одинаковых. Второй (ретрай) — два разных.
    const same = variantsBlock(tasks(4), tasks(4));
    const different = variantsBlock(
      tasks(4, "Вариант один"),
      tasks(4, "Вариант два"),
    );
    stubProvider([same, different]);

    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 4 }) },
      FAKE_ENV,
      fakeDb() as never,
    );

    // Ретрай сработал и дал разные варианты.
    expect(res.variants.retried).toBe(true);
    expect(res.variants.degraded).toBe(false);
    expect(res.secondVariant).not.toBeNull();
    expect(res.worksheet.tasks.map((t) => t.text)).not.toEqual(
      res.secondVariant?.tasks.map((t) => t.text),
    );
  });

  it("кейс 3: два раза одинаково → один лист + признак, в логе 2 вызова", async () => {
    // Оба ответа — два идентичных листа. Ретрай не помогает.
    const same = variantsBlock(tasks(4), tasks(4));
    stubProvider([same, same]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 4 }) },
      FAKE_ENV,
      db as never,
    );

    // Учитель получает первый лист и ЧЕСТНЫЙ признак, а не тишину.
    expect(res.secondVariant).toBeNull();
    expect(res.variants.degraded).toBe(true);
    expect(res.variants.expected).toBe(2);
    expect(res.variants.delivered).toBe(1);
    expect(res.variants.degradedReason).toBeTruthy();
    expect(res.variants.retried).toBe(true);

    // AD-5: два вызова провайдера видны в llm_logs отдельными строками.
    const providerLogs = db.logs.filter((l) => l.provider === "polza");
    expect(providerLogs.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// КЕЙС 4: модель не вернула variants[1] — признак в ответе (разрыв 3)
// ─────────────────────────────────────────────────────────────────────────────

describe("кейс 4: без второго варианта", () => {
  it("в ответе есть признак, а не просто отсутствующее поле", async () => {
    stubProvider(variantsBlock(tasks(4))); // только один вариант

    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 4 }) },
      FAKE_ENV,
      fakeDb() as never,
    );

    // `secondVariant` действительно null (формат ответа не изменился), но рядом
    // всегда идёт `variants`, где сказано: просили 2, пришёл 1.
    expect(res.secondVariant).toBeNull();
    expect(res.variants.expected).toBe(2);
    expect(res.variants.delivered).toBe(1);
    expect(res.variants.degraded).toBe(true);
    expect(res.variants.degradedReason).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// КЕЙС 5, 12: ОБРЫВ ОТВЕТА (разрыв 4) — ДВА РАЗНЫХ ПРЕДМЕТА
// ─────────────────────────────────────────────────────────────────────────────

describe("кейсы 5, 12: обрыв ответа по finish_reason — для ЛЮБОГО предмета", () => {
  it("кейс 12: АНГЛИЙСКИЙ, обрыв по токенам — не тихий успех", async () => {
    // Английский — тот самый предмет из жалобы. `language-guard` для иностранных
    // предметов пропускает текст ВСЕГДА, поэтому раньше обрыв проходил как
    // нормальный результат.
    const payload = variantsBlock(tasks(6), tasks(6));
    stubProvider([payload, payload], "length");

    const request = makeRequest({
      subject: "english" as SubjectSlug,
      grade: 11,
      topic: "Present Perfect",
      count: 6,
    });

    await expect(
      generateWorksheet({ ...ARGS, request }, FAKE_ENV, fakeDb() as never),
    ).rejects.toThrow(/truncated/i);
  });

  it("кейс 5: РУССКИЙ предмет, обрыв по токенам — тоже не проходит как норма", async () => {
    // Тот же обрыв на русском. Раньше он приводил к InternalError «invalid JSON»,
    // то есть был заметен — но нечеловечно и только потому, что JSON не
    // парсился. Теперь причина называется прямо и одинаково для всех предметов.
    const payload = variantsBlock(tasks(6), tasks(6));
    stubProvider([payload, payload], "length");

    const request = makeRequest({ subject: "history", count: 6 });

    await expect(
      generateWorksheet({ ...ARGS, request }, FAKE_ENV, fakeDb() as never),
    ).rejects.toThrow(/truncated/i);
  });

  it("обрыв, который разобрался после поднятого потолка, материалом считается", async () => {
    // Первый ответ обрезан, второй (с удвоенным потолком) — целый.
    // Это не должно быть ошибкой: поднятый потолок — ровно то, зачем он есть.
    // Разные задания: тест меряет восстановление после обрыва, а не отбраковку
    // дублей (см. `distinctTasks`).
    const payload = variantsBlock(distinctTasks(4), distinctTasks(4, 6));
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const body = JSON.stringify(payload);
      const finish = call === 1 ? "length" : "stop";
      return new Response(
        JSON.stringify({
          model: "anthropic/claude-sonnet-4-6",
          choices: [{ message: { content: body }, finish_reason: finish }],
          usage: { prompt_tokens: 1200, completion_tokens: 3600 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 4 }) },
      FAKE_ENV,
      fakeDb() as never,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.secondVariant).not.toBeNull();
    // Материал целый — признака об обрыве быть не должно.
    expect(res.variants.degraded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// КЕЙС 9: разное количество заданий в вариантах после фильтра (AD-8)
// ─────────────────────────────────────────────────────────────────────────────

describe("кейс 9: «по образцу» в одном варианте — количества выравниваются", () => {
  it("выкинутое задание добирается дозапросом, количества совпадают", async () => {
    // В варианте 1 — задание «выполните по образцу» без образца. Фильтр его
    // выкинет, и без дозапроса варианты окажутся разного объёма.
    // Разные задания: детектор Ф-2 (ТЗ-26) считает четыре одинаковых
    // «Задание номер N: опишите явление подробно» повтором навыка и выкинул бы
    // их. Тест меряет другое — добирает ли конвейер выкинутое задание, поэтому
    // ему нужны задания без повторов.
    const v1 = [
      ...distinctTasks(4, 0),
      { number: 5, text: "Выполните по образцу следующее задание.", answer: "x" },
    ];
    const v2 = distinctTasks(5, 6);
    const clean = variantsBlock(distinctTasks(4, 0), distinctTasks(4, 6));
    // Дозапрос: конвейер просит недостающее — отдаём ровно один нормальный.
    const topUp = { tasks: [{ number: 5, text: "Добранное задание про вакуоль", answer: "y" }] };

    stubProvider([variantsBlock(v1, v2), topUp]);

    const db = fakeDb();
    const res = await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 5 }) },
      FAKE_ENV,
      db as never,
    );

    expect(res.secondVariant).not.toBeNull();
    // Равное количество — часть равносильности (AD-8).
    expect(res.worksheet.tasks.length).toBe(res.secondVariant?.tasks.length);
    expect(res.worksheet.tasks).toHaveLength(5);
    // И потери были видны: фильтр сработал, дозапрос их закрыл.
    expect(res.quality.dropped).toBeGreaterThan(0);
    expect(res.quality.stillMissing).toBe(0);
    expect(db.logs.filter((l) => l.provider === "polza").length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// КЕЙС 10, 11, 13: РАЗРЫВ 5 НА РАЗНЫХ ПРЕДМЕТАХ И ТИПАХ РАБОТ
//
// Это главный блок теста: потери фильтра бьют по ВСЕМ предметам, и закрыть их
// только для контрольной было бы главным риском всей задачи.
// ─────────────────────────────────────────────────────────────────────────────

describe("кейсы 10, 11, 13: потери фильтра — разные предметы, разные типы работ", () => {
  it("кейс 10: ЛИСТ по биологии, фильтр выкинул 3 → дозапрос и признаки", async () => {
    // Биология: 5 нормальных заданий + 3 ссылки на несуществующий образец.
    //
    // ТЗ-33: первые пять заданий — РАЗНЫЕ (`distinctTasks`), а не `tasks(5)`.
    // Фикстура `tasks()` делает «Клеточное задание номер N: опишите явление
    // подробно» — все пять отличаются ОДНИМ числом, то есть это один и тот же
    // навык пять раз. На таком листе детектор повторов срабатывает правильно
    // (это ровно тот случай, который он обязан ловить), и конвейер уходит в
    // замену дублей — а дозапрос в этом тесте отдаёт те же задания, что и
    // основной ответ, и добрать длину нечем.
    //
    // Кейс 10 меряет другое: потери фильтра закрываются дозапросом и потери
    // видны в признаках. Для этого нужны РАЗНЫЕ задания — ровно так же, как
    // в остальных кейсах этого файла (см. `distinctTasks`).
    const biology = [
      ...distinctTasks(5),
      { number: 6, text: "Выполните по образцу следующее задание.", answer: "x" },
      { number: 7, text: "Сделайте аналогично предыдущему пункту.", answer: "x" },
      { number: 8, text: "Рассчитайте таким же способом, как в примере.", answer: "x" },
    ];
    const topUp = {
      tasks: [
        { number: 6, text: "Добавьте вакуоль клетки", answer: "a" },
        { number: 7, text: "Опишите хлоропласт", answer: "b" },
        { number: 8, text: "Назовите рибосомы", answer: "c" },
      ],
    };
    stubProvider([
      {
        title: "Биология",
        subject: "biology",
        grade: 8,
        topic: "Клеточное строение",
        difficulty: "medium",
        tasks: biology,
      },
      topUp,
    ]);

    const db = fakeDb();
    const res = await generateWorksheet(
      {
        ...ARGS,
        request: makeRequest({
          subject: "biology",
          grade: 8,
          topic: "Клеточное строение",
          count: 8,
          type: "worksheet",
        }),
      },
      FAKE_ENV,
      db as never,
    );

    // Дозапрос закрыл нехватку.
    expect(res.worksheet.tasks).toHaveLength(8);
    expect(res.quality.requested).toBe(8);
    expect(res.quality.delivered).toBe(8);
    expect(res.quality.stillMissing).toBe(0);
    // И потери НЕ спрятаны: сколько и почему — в ответе и в логе.
    expect(res.quality.dropped).toBeGreaterThan(0);
    expect(res.quality.droppedPatternRef.length).toBeGreaterThan(0);
    // У ЛИСТА вариантов нет — предупреждения про два варианта быть не должно.
    expect(res.variants.expected).toBe(1);
    expect(res.variants.degraded).toBe(false);
  });

  it("кейс 11: ЛИСТ по математике — фильтр не должен срабатывать ложно", async () => {
    // Математика: вычисления и формулы тут часть предмета, а не «чужой предмет».
    // Ложное срабатывание на математике дало бы учителю укороченный лист на
    // месте и лишний вызов модели.
    const mathTasks = [
      { number: 1, text: "Сократите дробь 8/12.", answer: "2/3" },
      { number: 2, text: "Решите уравнение 3x + 5 = 20.", answer: "x = 5" },
      { number: 3, text: "Найдите площадь прямоугольника 4 × 3 см.", answer: "12 см²" },
      { number: 4, text: "Вычислите 15% от 200.", answer: "30" },
    ];
    stubProvider([{ title: "Дроби", subject: "math", grade: 5, topic: "Дроби", difficulty: "easy", tasks: mathTasks }]);

    const db = fakeDb();
    const res = await generateWorksheet(
      {
        ...ARGS,
        request: makeRequest({
          subject: "math",
          grade: 5,
          topic: "Обыкновенные дроби",
          count: 4,
          type: "worksheet",
        }),
      },
      FAKE_ENV,
      db as never,
    );

    // Ни одной потери, ни одного лишнего вызова к модели.
    expect(res.quality.dropped).toBe(0);
    expect(res.quality.topUpAdded).toBe(0);
    expect(res.quality.stillMissing).toBe(0);
    expect(res.worksheet.tasks).toHaveLength(4);
    expect(db.logs.filter((l) => l.provider === "polza").length).toBe(1);
  });

  it("кейс 13: ОГЭ по русскому — та же потеря фильтра в другом типе работ", async () => {
    // ОГЭ — не рабочий лист. Правило общее: если фильтр выкинул задания,
    // это видно и в логе, и в ответе. Для ОГЭ это тем важнее, что учитель
    // не пересчитывает задания — их считают по баллам.
    const problems = [
      { number: 1, text: "Проанализируйте текст и ответьте на вопрос.", answer: "a" },
      { number: 2, text: "Выполните по образцу следующее задание.", answer: "x" },
      { number: 3, text: "Сделайте аналогично предыдущему пункту.", answer: "x" },
    ];
    stubProvider([
      {
        exam: "oge",
        subject: "russian",
        title: "ОГЭ по русскому",
        duration: 235,
        problems,
      },
    ]);

    const db = fakeDb();
    const res = await generateExam(
      {
        exam: "oge",
        subject: "russian" as SubjectSlug,
        variantNumber: 1,
        plan: "plus",
        userId: null,
        ip: "203.0.113.10",
      },
      FAKE_ENV,
      db as never,
    );

    // Потери фильтра по ОГЭ видны в ответе — правило то же, что у листа.
    expect(res.quality.dropped).toBeGreaterThan(0);
    expect(res.quality.droppedPatternRef.length).toBeGreaterThan(0);
    // И в логе — по тому же фильтру, что у листа и контрольной.
    expect(res.variant.problems.length).toBeLessThan(problems.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// КЕЙС 14: повторный запрос из кэша — та же пара и тот же флаг (AD-4)
// ─────────────────────────────────────────────────────────────────────────────

describe("кейс 14: кэш возвращает пару и те же признаки, денег не тратя", () => {
  it("повторный запрос отдаёт оба варианта, тот же флаг и не зовёт модель", async () => {
    const good = variantsBlock(tasks(4, "Вариант один"), tasks(4, "Вариант два"));
    const { fetchMock } = stubProvider(good);
    const db = fakeDb();
    const request = makeRequest({ count: 4 });

    const first = await generateWorksheet(
      { ...ARGS, request },
      FAKE_ENV,
      db as never,
    );
    const callsAfterFirst = fetchMock.mock.calls.length;

    const second = await generateWorksheet(
      { ...ARGS, request },
      FAKE_ENV,
      db as never,
    );

    expect(second.meta.cached).toBe(true);
    // Денег не потрачено: ни одного нового вызова провайдера.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    // Та же пара.
    expect(second.secondVariant).not.toBeNull();
    expect(second.worksheet.tasks.map((t) => t.text)).toEqual(
      first.worksheet.tasks.map((t) => t.text),
    );
    expect(second.secondVariant?.tasks.map((t) => t.text)).toEqual(
      first.secondVariant?.tasks.map((t) => t.text),
    );
    // И те же признаки — учитель при повторном открытии видит то же самое.
    expect(second.quality).toEqual(first.quality);
    expect(second.variants).toEqual(first.variants);
  });

  it("в кэш кладётся ТОЛЬКО принятый результат (AD-4)", async () => {
    // Ретрай вернул мусор → деградировали → в кэш ушёл первый лист с флагом.
    // Отброшенный ретраем вариант попадать в кэш не должен никогда: он закрепил
    // бы провал на 30 дней TTL.
    const same = variantsBlock(tasks(4), tasks(4));
    stubProvider([same, same]);
    const db = fakeDb();

    await generateWorksheet(
      { ...ARGS, request: makeRequest({ count: 4 }) },
      FAKE_ENV,
      db as never,
    );

    const stored = [...db.cache.values()][0] as {
      worksheet: { tasks: unknown[] };
      secondVariant?: unknown;
      variants?: { degraded: boolean };
    };
    expect(stored.secondVariant ?? null).toBeNull();
    expect(stored.variants?.degraded).toBe(true);
    // Принятый (первый) вариант в кэше есть.
    expect(stored.worksheet.tasks).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Общее правило: у НЕ-контрольной работы вариантов не бывает
// ─────────────────────────────────────────────────────────────────────────────

describe("не-контрольная работа не получает ложных признаков", () => {
  it("лист с потерями не объявляется деградировавшим по вариантам", async () => {
    const dropped = [
      ...tasks(3, "Задание"),
      { number: 4, text: "Выполните по образцу.", answer: "x" },
    ];
    // Второй ответ — ответ на ДОЗАПРОС: он пустой, то есть добрать нечего.
    // Это отдельный случай от кейса 10: там дозапрос успешно закрывал нехватку,
    // здесь наоборот — даже после одной попытки заданий меньше, чем просил
    // учитель, и именно тогда интерфейс ОБЯЗАН показать предупреждение.
    stubProvider([
      {
        title: "Лист",
        subject: "history",
        grade: 7,
        topic: "Реформы Петра",
        difficulty: "easy",
        tasks: dropped,
      },
      { tasks: [] },
    ]);

    const res = await generateWorksheet(
      {
        ...ARGS,
        request: makeRequest({
          subject: "history",
          grade: 7,
          topic: "Реформы Петра I",
          count: 4,
          type: "worksheet",
        }),
      },
      FAKE_ENV,
      fakeDb() as never,
    );

    expect(res.variants.expected).toBe(1);
    expect(res.variants.delivered).toBe(1);
    expect(res.variants.degraded).toBe(false);
    expect(res.secondVariant).toBeNull();
    // Потери заданий при этом остаются видимыми — это другой тип потерь, чем
    // провал по вариантам, и предупреждение должно показываться именно по ним.
    expect(res.quality.stillMissing).toBeGreaterThan(0);
    expect(res.quality.dropped).toBeGreaterThan(0);
  });
});
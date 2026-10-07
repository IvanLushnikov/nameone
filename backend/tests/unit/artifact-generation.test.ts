/**
 * Тесты конвейера генерации пяти типов материалов (plan урока, презентация,
 * КТП, карточки, материалы) — `src/llm/index.ts:generateStructuredArtifact`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * 1. УСПЕХ: из ответа модели получается артефакт той формы, которую потом
 *    проверяет zod-схема сохранения в routes/worksheets.ts (те же поля плюс
 *    server-side id/createdAt). Форма проверяется ПОЭЛЕМЕНТНО, а не «объект
 *    есть»: расхождение формы — это ровно тот класс дыр, который проявляется
 *    через шаг «сохранить» и выглядит как «учитель потратил деньги, а материал
 *    не сохранился».
 *
 * 2. ID И createdAt — ТОЛЬКО СЕРВЕРНЫЕ. Модель в фикстурах намеренно возвращает
 *    свой `id` и свой `createdAt` (такое уже наблюдалось на проде у листов: три
 *    одинаковых запроса возвращали один и тот же `ws_...`, и `INSERT OR
 *    REPLACE` затирал чужую строку). Тест требует, чтобы значение модели было
 *    отброшено ПОЛНОСТЬЮ, а два одинаковых запроса получили РАЗНЫЕ id — в том
 *    числе когда второй попал в кэш (в кэш кладётся содержание без
 *    технических полей, поэтому id выдаётся заново на каждый ответ).
 *
 * 3. ОТКАЗ ПРОВАЙДЕРА — НЕ 200. Если провайдер упал, функция обязана бросить
 *    ошибку. Заглушки в коде нет намеренно: заготовка вместо материала — это
 *    «учителю показали сгенерированный документ, который не генерировали».
 *
 * 4. ЯЗЫКОВОЙ GUARD: ответ не на русском для русскоязычного предмета → одна
 *    регенерация → если и она чужого языка, ошибка, а не заготовка.
 *
 * 5. НЕПРИГОДНЫЙ ОТВЕТ (пустые slides/stages/files) → ошибка, а не пустой
 *    артефакт.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 *
 * Тот же приём, что в self-verify-retry.test.ts: `vi.stubGlobal("fetch")`.
 * Реальный polza.ai — платный API, тест не стучится в сеть и не зависит от неё.
 * D1 — простая заглушка с настоящим счётчиком вызовов и в памяти сделанным
 * semantic_cache. План "plus" выбран сознательно: на нём `checkLlmRateLimit`
 * и `recordUsage` выходят сразу, не требуя схемы usage_counters, а
 * `userId = null` гарантирует, что норма тарифа не пишется.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateCards,
  generateKtp,
  generateLessonPlan,
  generateMaterials,
  generatePresentation,
} from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import type { Env } from "../../src/env";
import type { ArtifactRequest } from "../../src/llm/prompts/artifact-gen";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

// ─────────────────────────────────────────────────────────────────────────────
// Заглушка D1: считаем записи в llm_logs и держим semantic_cache в памяти
// ─────────────────────────────────────────────────────────────────────────────

interface DbLogRow {
  sql: string;
  args: unknown[];
}

function fakeDb() {
  const cache = new Map<string, unknown>();
  const logs: DbLogRow[] = [];
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
                // args: id, cache_key, subject, grade, topic, difficulty, count,
                //       type, response_json, ...
                if (!cache.has(String(args[1]))) {
                  cache.set(String(args[1]), JSON.parse(String(args[8])));
                }
                return { success: true };
              }
              logs.push({ sql, args });
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

// ─────────────────────────────────────────────────────────────────────────────
// Ответы провайдера
// ─────────────────────────────────────────────────────────────────────────────

/** Ответ polza с JSON-полезной нагрузкой. */
function providerResponse(payload: unknown): unknown {
  return {
    model: "deepseek/deepseek-v4-flash",
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 900, completion_tokens: 700, total_tokens: 1600 },
  };
}

/** Технические поля, которые модель обязана НЕ задавать, а сервер — проигнорировать. */
const MODEL_TECHNICAL_FIELDS = {
  id: "model_invented_id_01",
  createdAt: "2020-01-01T00:00:00.000Z",
  generationMs: 999,
};

const LESSON_PLAN_RESPONSE = {
  title: "План урока: Обыкновенные дроби",
  subject: "math",
  grade: 5,
  topic: "Обыкновенные дроби",
  fgosRef: "§ 4 учебника",
  goals: {
    educational: ["умеет сравнивать дроби с одинаковыми знаменателями"],
    developmental: ["развивает умение работать с числовой записью"],
    nurturing: ["учится договариваться в паре"],
  },
  equipment: ["карточки с дробями", "магнитная доска"],
  stages: [
    {
      kind: "org-moment",
      title: "Приветствие и готовность к уроку",
      durationMin: 3,
      teacherActions: "Приветствует класс, просит открыть тетради к нужной странице.",
      studentActions: "Занимают места, открывают тетради.",
    },
    {
      kind: "new-topic",
      title: "Сравнение дробей с одинаковыми знаменателями",
      durationMin: 15,
      teacherActions: "Объясняет правило на доске, разбирает два примера устно.",
      studentActions: "Слушают объяснение, записывают правило в тетрадь.",
    },
    {
      kind: "practice",
      title: "Отработка на карточках",
      durationMin: 20,
      teacherActions: "Раздаёт карточки, проверяет результат по цепочке.",
      studentActions: "Решают примеры в парах, сверяют ответы с соседом.",
    },
    {
      kind: "homework",
      title: "Домашнее задание",
      durationMin: 7,
      teacherActions: "Даёт задание, проговаривает критерии проверки.",
      studentActions: "Записывают домашнее задание.",
    },
  ],
  homework: {
    text: "№ 234–238 (чётные) по учебнику",
    alternatives: ["Составить и решить три примера на сравнение дробей"],
  },
  ...MODEL_TECHNICAL_FIELDS,
};

function presentationResponse(slideCount = 10) {
  const slides = Array.from({ length: slideCount }, (_, i) => ({
    kind:
      i === 0 ? "title" : i === slideCount - 1 ? "summary" : i % 3 === 0 ? "definition" : i % 3 === 1 ? "bullets" : "example",
    title: `Слайд ${i + 1}: сравнение дробей`,
    bullets: [
      "Знаменатель одинаковый у обеих дробей",
      "Сравниваем числители по правилу порядка",
      "Пример: 3/7 больше, чем 2/7",
    ],
    notes: "Спросить у класса, кто понял правило, и разобрать один пример вместе.",
  }));
  return {
    title: "Презентация: Обыкновенные дроби",
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    slideCount,
    theme: "minimal",
    slides,
    ...MODEL_TECHNICAL_FIELDS,
  };
}

function ktpResponse() {
  const weeks = Array.from({ length: 34 }, (_, w) => ({
    weekNum: w + 1,
    entries: [
      {
        // Модель нумерует уроки как попало — серверная нумерация должна это
        // исправить, иначе в КТП будут дубли «урок 1».
        num: w + 1,
        dates: "07.09.2026-11.09.2026",
        topic: `Тема недели ${w + 1}: дроби и действия над ними`,
        kind: "lesson",
        hours: 1,
        fgosRef: "§ 4 учебника",
        uud: "Регулятивные: планирование действия",
      },
      {
        num: w + 1,
        dates: "07.09.2026-11.09.2026",
        topic: `Практикум по теме недели ${w + 1}`,
        kind: "practice-lesson-unknown" in {} ? "lesson" : w % 9 === 8 ? "test" : "lesson",
        hours: 1,
      },
    ],
  }));
  return {
    title: "КТП: математика, 5 класс",
    subject: "math",
    grade: 5,
    topic: "Математика",
    schoolYear: "2026/2027",
    totalHours: 170,
    weeks,
    ...MODEL_TECHNICAL_FIELDS,
  };
}

const CARDS_RESPONSE = {
  title: "Карточки: Обыкновенные дроби",
  subject: "math",
  grade: 5,
  topic: "Обыкновенные дроби",
  difficulty: "medium",
  cards: [
    { front: "Как называется дробь 3/7?", back: "Три седьмых.", category: "Словарь", hint: "числитель" },
    { front: "Сравни 3/7 и 2/7", back: "3/7 больше, знаменатели равны, смотрим на числитель.", category: "Сравнение" },
    { front: "Что такое числитель дроби?", back: "Число над чертой: показывает, сколько частей взяли.", category: "Словарь" },
    { front: "Что такое знаменатель дроби?", back: "Число под чертой: на сколько частей разделили целое.", category: "Словарь" },
    { front: "Какая дробь называется правильной?", back: "Та, у которой числитель меньше знаменателя.", category: "Словарь" },
    { front: "Сложи 2/7 + 3/7", back: "Знаменатель сохраняется, складываем числители: 5/7.", category: "Действия" },
  ],
  ...MODEL_TECHNICAL_FIELDS,
};

const MATERIALS_RESPONSE = {
  title: "Материалы: Обыкновенные дроби",
  subject: "math",
  grade: 5,
  topic: "Обыкновенные дроби",
  files: [
    {
      id: "file-from-model-1",
      kind: "glossary",
      title: "Словарь терминов",
      content:
        "Числитель — число над чертой дроби.\nЗнаменатель — число под чертой.\nДробь называется правильной, если числитель меньше знаменателя.",
      format: "csv",
    },
    {
      kind: "handout",
      title: "Памятка: сравнение дробей",
      content: "Сравни дроби с равными знаменателями по числителям.\nСравни дроби с единицей по знаменателю.",
      format: "txt",
    },
    {
      kind: "checklist",
      title: "Чек-лист к уроку",
      content: "Повторить правило сравнения.\nРешить три примера в тетради.",
      format: "txt",
    },
  ],
  ...MODEL_TECHNICAL_FIELDS,
};

type GeneratorName = "lesson-plan" | "presentation" | "ktp" | "cards" | "materials";

/**
 * Общий тип результата всех пяти функций: `{ artifact, meta, usage }`.
 * Артефакты у типов разной формы, поэтому здесь он описан как
 * `{ id, createdAt } & Record<string, unknown>` — конкретную форму каждый тест
 * проверяет отдельно, уже по названию типа.
 */
type ArtifactRunner = (
  args: Parameters<typeof generateLessonPlan>[0],
  env: Env,
  db: never,
) => Promise<{
  artifact: { id: string; createdAt: string } & Record<string, unknown>;
  meta: { cached: boolean; provider: string; costUsd: number };
}>;

const GENERATORS: Record<GeneratorName, ArtifactRunner> = {
  "lesson-plan": generateLessonPlan as never,
  presentation: generatePresentation as never,
  ktp: generateKtp as never,
  cards: generateCards as never,
  materials: generateMaterials as never,
};

const RESPONSE_BY_TYPE: Record<GeneratorName, () => unknown> = {
  "lesson-plan": () => LESSON_PLAN_RESPONSE,
  presentation: () => presentationResponse(),
  ktp: () => ktpResponse(),
  cards: () => CARDS_RESPONSE,
  materials: () => MATERIALS_RESPONSE,
};

const ID_PREFIX_BY_TYPE: Record<GeneratorName, string> = {
  "lesson-plan": "lp",
  presentation: "pres",
  ktp: "ktp",
  cards: "card",
  materials: "mat",
};

const BASE_REQUEST: ArtifactRequest = {
  subject: "math",
  grade: 5,
  topic: "Обыкновенные дроби",
  difficulty: "medium",
  count: 6,
  withAnswers: true,
  withExplanations: true,
};

/**
 * План «free» и userId = null выбраны сознательно: на этой связке и
 * `checkLlmRateLimit`, и `recordUsage`/`getUsageStatus` выходят, не требуя схемы
 * usage_counters и subscriptions — тесту нужны только llm_logs и
 * semantic_cache, а не весь биллинг.
 */
const ARGS = {
  request: BASE_REQUEST,
  plan: "free" as const,
  userId: null,
  ip: "203.0.113.10",
};

/** Подменить провайдера: `payload` — что он отвечает (последовательность). */
function stubProvider(payloads: unknown[]) {
  const fetchMock = vi.fn(async () => {
    const payload = payloads[Math.min(fetchMock.mock.calls.length - 1, payloads.length - 1)];
    return new Response(JSON.stringify(providerResponse(payload)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Подменить провайдера, который всегда падает. */
function stubFailingProvider() {
  const fetchMock = vi.fn(
    async () => new Response("upstream error", { status: 500 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  _resetPolzaSingleton();
});

afterEach(() => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("пять типов материалов: успешная генерация", () => {
  it.each(Object.keys(GENERATORS) as GeneratorName[])(
    "%s: структура ответа и серверные id/createdAt",
    async (type) => {
      stubProvider([RESPONSE_BY_TYPE[type]()]);
      const db = fakeDb();

      const { artifact, meta } = await GENERATORS[type](ARGS, FAKE_ENV, db as never);

      // 1. id — серверный, с префиксом типа; значение модели отброшено.
      expect(artifact.id).toMatch(new RegExp(`^${ID_PREFIX_BY_TYPE[type]}_[A-Za-z0-9]+$`));
      expect(artifact.id).not.toBe("model_invented_id_01");
      expect("generationMs" in artifact).toBe(false);

      // 2. createdAt — свежий, не модельный 2020 год.
      const createdAt = new Date(artifact.createdAt).getTime();
      expect(Number.isNaN(createdAt)).toBe(false);
      expect(Math.abs(Date.now() - createdAt)).toBeLessThan(60_000);
      expect(artifact.createdAt).not.toBe("2020-01-01T00:00:00.000Z");

      // 3. meta честный: провайдер отвечал, кэша не было.
      expect(meta.cached).toBe(false);
      expect(meta.provider).toBe("polza");
      expect(meta.costUsd).toBeGreaterThanOrEqual(0);

      // 4. В llm_logs попал вызов с задачей роутера этого типа.
      const llmLogs = db.logs.filter((row) => row.sql.includes("INTO llm_logs"));
      expect(llmLogs.length).toBe(1);
    },
  );

  it("lesson-plan: поля формы совпадают с LessonPlanBody (их ждёт сохранение)", async () => {
    stubProvider([LESSON_PLAN_RESPONSE]);
    const { artifact } = await generateLessonPlan(ARGS, FAKE_ENV, fakeDb() as never);
    const plan = artifact as unknown as Record<string, any>;

    expect(typeof plan.title).toBe("string");
    expect(plan.subject).toBe("math");
    expect(plan.grade).toBe(5);
    expect(typeof plan.fgosRef).toBe("string");
    expect(Array.isArray(plan.goals.educational)).toBe(true);
    expect(Array.isArray(plan.equipment)).toBe(true);
    expect(plan.stages.length).toBeGreaterThanOrEqual(3);
    for (const stage of plan.stages) {
      // Ровно те поля, которые требует zod: kind из enum, 1..45 минут, оба текста.
      expect(["org-moment", "motivation", "new-topic", "practice", "reflex", "homework"]).toContain(
        stage.kind,
      );
      expect(stage.durationMin).toBeGreaterThanOrEqual(1);
      expect(stage.durationMin).toBeLessThanOrEqual(45);
      expect(typeof stage.teacherActions).toBe("string");
      expect(typeof stage.studentActions).toBe("string");
    }
    expect(typeof plan.homework.text).toBe("string");
    expect(Array.isArray(plan.homework.alternatives)).toBe(true);
  });

  it("presentation: slideCount из {5,10,15,20}, слайды целиком, kind из enum", async () => {
    stubProvider([presentationResponse(15)]);
    const { artifact } = await generatePresentation(
      { ...ARGS, request: { ...BASE_REQUEST, slideCount: 15 } },
      FAKE_ENV,
      fakeDb() as never,
    );
    const presentation = artifact as unknown as Record<string, any>;

    expect([5, 10, 15, 20]).toContain(presentation.slideCount);
    expect(presentation.slideCount).toBe(15);
    expect(presentation.slides.length).toBe(15);
    expect(["default", "modern", "school", "minimal"]).toContain(presentation.theme);
    for (const slide of presentation.slides) {
      expect(["title", "bullets", "definition", "example", "summary"]).toContain(slide.kind);
      expect(typeof slide.title).toBe("string");
    }
  });

  it("ktp: недели и записи об уроках в форме KtpBody, нумерация сквозная серверная", async () => {
    stubProvider([ktpResponse()]);
    const { artifact } = await generateKtp(
      { ...ARGS, request: { ...BASE_REQUEST, schoolYear: "2026/2027" } },
      FAKE_ENV,
      fakeDb() as never,
    );
    const ktp = artifact as unknown as Record<string, any>;

    expect(ktp.schoolYear).toBe("2026/2027");
    expect(ktp.weeks.length).toBe(34);
    const nums = ktp.weeks.flatMap((w: any) => w.entries.map((e: any) => e.num));
    // Модель нумеровала уроки «номер недели» — сервер перенумеровал сквозно.
    expect(nums).toEqual(nums.map((_: number, i: number) => i + 1));
    for (const entry of ktp.weeks[0].entries) {
      expect(["lesson", "control", "test", "review", "reserve", "project"]).toContain(entry.kind);
      expect([1, 2]).toContain(entry.hours);
      expect(typeof entry.dates).toBe("string");
      expect(typeof entry.topic).toBe("string");
    }
  });

  it("cards: обе стороны карточки и категория", async () => {
    stubProvider([CARDS_RESPONSE]);
    const { artifact } = await generateCards(ARGS, FAKE_ENV, fakeDb() as never);
    const cardSet = artifact as unknown as Record<string, any>;

    expect(cardSet.cards.length).toBe(6);
    expect(cardSet.difficulty).toBe("medium");
    for (const card of cardSet.cards) {
      expect(typeof card.front).toBe("string");
      expect(typeof card.back).toBe("string");
      expect(typeof card.category).toBe("string");
    }
  });

  it("materials: идентификаторы файлов серверные, модель их не задаёт", async () => {
    stubProvider([MATERIALS_RESPONSE]);
    const { artifact } = await generateMaterials(ARGS, FAKE_ENV, fakeDb() as never);
    const bundle = artifact as unknown as Record<string, any>;

    expect(bundle.files.length).toBe(3);
    const ids = bundle.files.map((f: any) => f.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^mf_[A-Za-z0-9]+$/);
    expect(ids).not.toContain("file-from-model-1");
    for (const file of bundle.files) {
      expect(["glossary", "reference", "handout", "checklist"]).toContain(file.kind);
      expect(["txt", "docx", "csv"]).toContain(file.format);
      expect(typeof file.content).toBe("string");
    }
  });
});

describe("пять типов материалов: идентичность материала", () => {
  it.each(Object.keys(GENERATORS) as GeneratorName[])(
    "%s: два одинаковых запроса → два разных серверных id",
    async (type) => {
      const fetchMock = stubProvider([RESPONSE_BY_TYPE[type]()]);
      const db = fakeDb();

      const first = await GENERATORS[type](ARGS, FAKE_ENV, db as never);
      const second = await GENERATORS[type](ARGS, FAKE_ENV, db as never);

      expect(first.artifact.id).not.toBe(second.artifact.id);
      expect(second.artifact.id).not.toBe("model_invented_id_01");

      // Второй запрос попал в кэш (провайдер не звали), но id всё равно новый:
      // в кэше лежит содержание без технических полей.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const cached = [...db.cache.values()][0] as { artifact: Record<string, unknown> };
      expect(cached.artifact.id).toBeUndefined();
      expect(cached.artifact.createdAt).toBeUndefined();
    },
  );
});

describe("пять типов материалов: отказ вместо заготовки", () => {
  it.each(Object.keys(GENERATORS) as GeneratorName[])(
    "%s: провайдер упал → ошибка, а не материал",
    async (type) => {
      stubFailingProvider();
      const db = fakeDb();

      await expect(
        GENERATORS[type](ARGS, FAKE_ENV, db as never),
      ).rejects.toThrow(/provider|all providers|failed/i);

      // Провал не должен остаться в кэше: иначе следующий запрос отдал бы его
      // как «успешный» материал без провайдера.
      expect(db.cache.size).toBe(0);
    },
  );

  it.each(Object.keys(GENERATORS) as GeneratorName[])(
    "%s: непригодный ответ модели → ошибка, а не пустой артефакт",
    async (type) => {
      // Пустые обязательные коллекции: из такого ответа материала не собрать.
      stubProvider([
        type === "cards"
          ? { title: "Пусто", cards: [] }
          : type === "materials"
            ? { title: "Пусто", files: [] }
            : type === "ktp"
              ? { title: "Пусто", weeks: [] }
              : type === "presentation"
                ? { title: "Пусто", slides: [] }
                : { title: "Пусто", stages: [] },
      ]);
      const db = fakeDb();

      await expect(GENERATORS[type](ARGS, FAKE_ENV, db as never)).rejects.toThrow();
      expect(db.cache.size).toBe(0);
    },
  );

  it("cards: ответ на чужом языке → одна регенерация, затем ошибка (не заготовка)", async () => {
    const fetchMock = stubProvider([
      {
        title: "Fractions",
        cards: [
          { front: "How do you compare two fractions?", back: "Compare the numerators when denominators are equal.", category: "Words" },
          { front: "What is a denominator?", back: "The number below the fraction bar showing the parts.", category: "Words" },
        ],
      },
    ]);
    const db = fakeDb();

    await expect(generateCards(ARGS, FAKE_ENV, db as never)).rejects.toThrow(/language/i);

    // Ровно два вызова: исходный и одна регенерация. Третьего ретрая нет —
    // бесконечный повтор сжигал бы деньги на платном API.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.cache.size).toBe(0);
  });

  it("lesson-plan: полностью англоязычный ответ не принимается (guard на документе, не на строке)", async () => {
    stubProvider([
      {
        title: "Lesson plan: Common fractions",
        subject: "math",
        grade: 5,
        topic: "Common fractions",
        goals: {
          educational: ["Can compare fractions with the same denominator"],
          developmental: ["Develops attention while comparing numbers"],
          nurturing: ["Learns to work together with a partner"],
        },
        equipment: ["Fraction cards for every pupil", "Magnetic board"],
        stages: [
          {
            kind: "org-moment",
            title: "Greeting and readiness for the lesson",
            durationMin: 3,
            teacherActions: "Greets the class and asks everybody to open the notebook.",
            studentActions: "Take seats and open the notebooks.",
          },
          {
            kind: "new-topic",
            title: "Comparing fractions with equal denominators",
            durationMin: 15,
            teacherActions: "Explains the rule on the board with two examples.",
            studentActions: "Listen and write the rule down in the notebook.",
          },
          {
            kind: "homework",
            title: "Homework",
            durationMin: 27,
            teacherActions: "Gives the homework and explains how it will be checked.",
            studentActions: "Write down the homework.",
          },
        ],
        homework: { text: "Exercises 234 to 238 from the textbook" },
      },
    ]);
    const db = fakeDb();

    await expect(generateLessonPlan(ARGS, FAKE_ENV, db as never)).rejects.toThrow(/language/i);
    expect(db.cache.size).toBe(0);
  });
});
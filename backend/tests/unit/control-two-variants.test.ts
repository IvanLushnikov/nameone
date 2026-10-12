/**
 * КОНТРОЛЬНАЯ РАБОТА ДОЛЖНА ВЫДАВАТЬ ДВА ВАРИАНТА — ЖАЛОБА 7 (12.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * 1. КЭШ ТЕРЯЕТ ВТОРОЙ ВАРИАНТ. На проде повторный запрос той же контрольной
 *    возвращал `model: "semantic-cache", cached: true` и БЕЗ `secondVariant` —
 *    учитель получал ровно ту жалобу, которую чинили: «просят два варианта,
 *    получают один, и тот кривой». Причина: в кэш уходил только `{ worksheet }`,
 *    а ветка ответа из кэша `secondVariant` не возвращала вовсе.
 *
 *    Тест зовёт generateWorksheet ДВАЖДЫ с одной базой: первый раз мимо кэша,
 *    второй раз — в кэш. Второй обязан вернуть второй вариант, и тексты
 *    вариантов должны различаться. На старом коде здесь `null`.
 *
 * 2. ПОТОЛОК ТОКЕНОВ. Контрольная просит у модели ДВА полных листа одним
 *    ответом. На один лист 4096 токенов хватает, на два — нет: ответ
 *    обрывался, и учитель получал 500 («пустой content» / «invalid JSON»).
 *    Половина живых прогонов контрольной на проде падала именно так.
 *    Тест ловит само значение `max_tokens` в теле запроса к провайдеру —
 *    это проверка поведения, а не комментария.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 *
 * Тот же приём, что в artifact-generation.test.ts: `vi.stubGlobal("fetch")`.
 * Реальный polza.ai — платный API, тест в сеть не ходит. D1 — заглушка с
 * настоящим `semantic_cache` в памяти. План "plus": на нём rate-limit и
 * учёт нормы выходят сразу, `userId = null` гарантирует, что норма не пишется.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import type { Env } from "../../src/env";
import type { GenerationRequest } from "../../src/types";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

// ─────────────────────────────────────────────────────────────────────────────
// Заглушка D1: держим semantic_cache в памяти, всё остальное — заглушка
// ─────────────────────────────────────────────────────────────────────────────

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
                //       type, response_json, ...
                if (!cache.has(String(args[1]))) {
                  cache.set(String(args[1]), JSON.parse(String(args[8])));
                }
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

// ─────────────────────────────────────────────────────────────────────────────
// Ответ провайдера: контрольная приходит двумя вариантами ОДНИМ объектом
// ─────────────────────────────────────────────────────────────────────────────

const CONTROL_RESPONSE = {
  variants: [
    {
      title: "Вариант 1",
      subject: "biology",
      grade: 9,
      topic: "Клеточное строение",
      difficulty: "medium",
      tasks: [
        {
          number: 1,
          text: "Какие органоиды есть и в растительной, и в животной клетке?",
          answer: "Клеточная мембрана, цитоплазма, ядро, митохондрии",
        },
        {
          number: 2,
          text: "Где хранится наследственная информация?",
          answer: "В ядре клетки",
        },
      ],
    },
    {
      title: "Вариант 2",
      subject: "biology",
      grade: 9,
      topic: "Клеточное строение",
      difficulty: "medium",
      tasks: [
        {
          number: 1,
          text: "Чем растительная клетка отличается от животной?",
          answer: "Клеточная стенка, хлоропласты, крупная вакуоль",
        },
        {
          number: 2,
          text: "Какую функцию выполняет рибосома?",
          answer: "Синтез белка",
        },
      ],
    },
  ],
};

function providerResponse(payload: unknown): unknown {
  return {
    model: "anthropic/claude-sonnet-4-6",
    choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1200, completion_tokens: 3600, total_tokens: 4800 },
  };
}

/** Подменить провайдера и запомнить тела ушедших запросов. */
function stubProvider(payload: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response(JSON.stringify(providerResponse(payload)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

const CONTROL_REQUEST: GenerationRequest = {
  subject: "biology",
  grade: 9,
  topic: "Клеточное строение",
  difficulty: "medium",
  count: 2,
  type: "control",
  withAnswers: true,
  withExplanations: true,
};

const ARGS = {
  request: CONTROL_REQUEST,
  plan: "plus" as const,
  userId: null,
  ip: "203.0.113.10",
};

beforeEach(() => {
  _resetPolzaSingleton();
});

afterEach(() => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("контрольная: два варианта, а не один", () => {
  it("первый запрос отдаёт оба варианта, и они разные", async () => {
    stubProvider(CONTROL_RESPONSE);
    const db = fakeDb();

    const res = await generateWorksheet(ARGS, FAKE_ENV, db as never);

    expect(res.worksheet.title).toBe("Вариант 1");
    expect(res.secondVariant).not.toBeNull();
    expect(res.secondVariant?.title).toBe("Вариант 2");

    // Разные задания — иначе это «один вариант, расписанный дважды».
    const v1 = res.worksheet.tasks.map((t) => t.text);
    const v2 = (res.secondVariant?.tasks ?? []).map((t) => t.text);
    expect(v1).toHaveLength(2);
    expect(v2).toHaveLength(2);
    expect(v1).not.toEqual(v2);
  });

  it("повторный запрос из кэша ТОЖЕ возвращает второй вариант", async () => {
    stubProvider(CONTROL_RESPONSE);
    const db = fakeDb();

    const first = await generateWorksheet(ARGS, FAKE_ENV, db as never);
    expect(first.secondVariant).not.toBeNull();

    // Тот же запрос, кэш НЕ обходим — ровно тот путь, на котором прод отдавал
    // `semantic-cache` без второго варианта.
    const second = await generateWorksheet(ARGS, FAKE_ENV, db as never);

    expect(second.meta.cached).toBe(true);
    expect(second.meta.model).toBe("semantic-cache");
    // ГЛАВНОЕ УТВЕРЖДЕНИЕ ТЕСТА. На коде без правки здесь `null`.
    expect(second.secondVariant).not.toBeNull();
    expect(second.secondVariant?.tasks).toHaveLength(2);
    expect(second.secondVariant?.tasks.map((t) => t.text)).not.toEqual(
      second.worksheet.tasks.map((t) => t.text),
    );
  });

  it("обычный лист в кэш ложится без второго варианта — и это не ломает тип", async () => {
    stubProvider({
      title: "Обыкновенные дроби — рабочий лист",
      subject: "math",
      grade: 5,
      topic: "Обыкновенные дроби",
      difficulty: "easy",
      tasks: [{ number: 1, text: "Сократите дробь 8/12", answer: "2/3" }],
    });
    const db = fakeDb();
    const db2 = fakeDb();

    const args = {
      ...ARGS,
      request: { ...CONTROL_REQUEST, type: "worksheet" as const },
    };
    const first = await generateWorksheet(args, FAKE_ENV, db as never);
    expect(first.secondVariant).toBeNull();

    const second = await generateWorksheet(args, FAKE_ENV, db as never);
    expect(second.meta.cached).toBe(true);
    // У листа второго варианта нет и не должно быть — переключатель рисуют
    // только для контрольной.
    expect(second.secondVariant).toBeNull();
    void db2;
  });
});

describe("контрольная: потолок токенов на два листа", () => {
  it("контрольная уходит к провайдеру с двойным max_tokens", async () => {
    const { bodies } = stubProvider(CONTROL_RESPONSE);
    const db = fakeDb();

    await generateWorksheet(ARGS, FAKE_ENV, db as never);

    const sent = bodies.find((b) => typeof b.max_tokens === "number");
    expect(sent).toBeDefined();
    // Два полных листа в одном ответе. На 4096 ответ обрывался, и учитель
    // получал 500. Тест проверяет тело запроса, а не комментарий в коде.
    expect(Number(sent?.max_tokens)).toBeGreaterThanOrEqual(8192);
  });

  it("обычный лист остаётся на прежнем потолке — лишнего не платим", async () => {
    const { bodies } = stubProvider({
      title: "Лист",
      subject: "math",
      grade: 5,
      topic: "Обыкновенные дроби",
      difficulty: "easy",
      tasks: [{ number: 1, text: "Сократите дробь 8/12", answer: "2/3" }],
    });
    const db = fakeDb();

    await generateWorksheet(
      { ...ARGS, request: { ...CONTROL_REQUEST, type: "worksheet" } },
      FAKE_ENV,
      db as never,
    );

    const sent = bodies.find((b) => typeof b.max_tokens === "number");
    expect(Number(sent?.max_tokens)).toBe(4096);
  });
});
/**
 * ЖИВАЯ ПРОВЕРКА КАЧЕСТВА ЛИСТА (ТЗ-26, гейты Г8 и Г9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЭТО ЗАКРЫВАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Г8: пять листов не содержат смешанных чисел в математике 5, «иррациональной
 *     десятичной дроби», дублей навыка и `answer: null`.
 * Г9: контрольная не повторяет навык внутри варианта, и два варианта не совпадают.
 *
 * До сих пор обе проверки держались только на юнит-тестах промпта и фикстурах.
 * Это НЕ ДОКАЗЫВАЕТ, что модель слушается: правило 2 («строго по программе»)
 * было в промпте, и модель всё равно выдала смешанные числа в 5 классе.
 * Проверить поведение правила можно только на живой генерации.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КЛЮЧ И ПРОПУСК
 * ─────────────────────────────────────────────────────────────────────────────
 * Ключ берётся из `POLZA_API_KEY` окружения. Если его нет — тест ПРОПУСКАЕТСЯ,
 * а не падает: без ключа нечего проверять, и падать тут неверно (проверка
 * падает только при реальной генерации, которая выявила дефект).
 *
 * Запуск с ключом:
 *   POLZA_API_KEY=... npx vitest run tests/integration/tz26-live-quality.test.ts
 *
 * По умолчанию тест ЖИВЫХ денег не тратит: `describe.skipIf` без ключа.
 * Этот файл НЕ входит в обычный `npm test` как обязательный гейт — он
 * платный и медленный, поэтому запускается точечно.
 */

import { describe, it, expect, afterEach } from "vitest";
// Ключ лежит в биндинге воркера, а не в process.env: пул
// `@cloudflare/vitest-pool-workers` грузит `.dev.vars` в окружение воркера.
// Через `cloudflare:test` — единственное место, где он виден тесту.
import { env as workerEnv } from "cloudflare:test";

import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { findSkillDupes } from "../../src/llm/validation/skill-dupes";
import type { Env } from "../../src/env";
import type { GenerationRequest } from "../../src/types";

const API_KEY = String((workerEnv as unknown as Record<string, unknown>).POLZA_API_KEY ?? "");

/** Живой прогон стоит денег, поэтому без ключа — пропуск, а не падение. */
const live = API_KEY ? describe : describe.skip;

/**
 * Подмножество листов через `LIVE_ONLY=math,biology`.
 *
 * Живой прогон платит реальными деньгами, а контрольная на Sonnet стоит 12.69 ₽
 * — при почти пустом балансе один запуск съедал остаток и следующий падал с
 * INSUFFICIENT_BALANCE. Фильтр даёт возможность проверить один-два листа,
 * когда денег мало.
 *
 * Значение читается из `env` ВОРКЕРА, а не из `process.env`: в пуле
 * `@cloudflare/vitest-pool-workers` процессных переменных нет вовсе, и
 * фильтр молча не срабатывал, прогоняя все шесть листов вместо одного.
 * Ровно та же ошибка была со флагом `PLAN`.
 */
const ONLY = String((workerEnv as unknown as Record<string, unknown>).LIVE_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const wanted = (key: string) => ONLY.length === 0 || ONLY.includes(key);

/** Ключи листов для фильтра — латиницей, чтобы не зависеть от кириллицы. */
const SHEET_KEYS: Record<string, string> = {
  "русский 8": "russian8",
  "английский 11": "english11",
  "карточки (математика 6)": "cards",
  "математика 5": "math5",
  "биология 7": "bio7",
};

const FAKE_ENV = {
  POLZA_API_KEY: API_KEY,
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

/** D1-заглушка: семантический кэш в памяти + записи вызовов. */
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
                if (!cache.has(String(args[1]))) {
                  cache.set(String(args[1]), JSON.parse(String(args[8])));
                }
                return { success: true };
              }
              if (sql.includes("DELETE FROM semantic_cache")) {
                cache.delete(String(args[0]));
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

function request(over: Partial<GenerationRequest>): GenerationRequest {
  return {
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    difficulty: "medium",
    count: 8,
    type: "worksheet",
    withAnswers: true,
    withExplanations: true,
    ...over,
  };
}

const ARGS = { plan: "plus" as const, userId: null, ip: "203.0.113.10", bypassCache: true };

afterEach(() => {
  _resetPolzaSingleton();
});

// БЕЗ маркера успеха здесь намеренно. `afterAll` печатал его ВСЕГДА, в том
// числе при упавшем тесте, и гейт-чекер видел совпадение на падении —
// ложнозелёный сигнал, самое опасное, что может быть в проверке. Теперь
// ожидание гейта — строка сводки vitest «Tests  6 passed (6)», которая
// печатается только когда прошли все шесть.

/** Текст задания + ответ + пояснение одной строкой. */
function rows(tasks: unknown[]): Array<{ text: string; answer: string; explanation: string }> {
  return (tasks as Array<{ text?: string; answer?: unknown; explanation?: unknown }>).map((t) => ({
    text: String(t.text ?? ""),
    answer: typeof t.answer === "string" ? t.answer : "",
    explanation: typeof t.explanation === "string" ? t.explanation : "",
  }));
}

const SHEETS: Array<{ name: string; req: Partial<GenerationRequest> }> = [
    { name: "русский 8", req: { subject: "russian", grade: 8, topic: "Орфография", count: 10 } },
    { name: "английский 11", req: { subject: "english", grade: 11, topic: "Present Perfect", count: 10 } },
    { name: "карточки (математика 6)", req: { subject: "math", grade: 6, topic: "Рациональные числа", count: 8, type: "cards" } },
    { name: "математика 5", req: { subject: "math", grade: 5, topic: "Обыкновенные дроби", count: 12 } },
    { name: "биология 7", req: { subject: "biology", grade: 7, topic: "Класс растений", count: 10 } },
  ];

// Листы, попавшие под фильтр `LIVE_ONLY`.
const SELECTED_SHEETS = SHEETS.filter((sheet) => wanted(SHEET_KEYS[sheet.name] ?? ""));

// Пустую группу vitest считает ОШИБКОЙ («No test found in suite»), а фильтр
// на контрольной оставляет именно такую пустую группу: гейт краснеет при
// зелёной проверке. Поэтому группу либо создаём с тестами, либо помечаем
// пропущенной — пропуск ошибкой не считается.
const describeSheets = SELECTED_SHEETS.length > 0 ? describe : describe.skip;

describeSheets("ТЗ-26 Г8: пять живых листов без дефектов качества", () => {
  for (const sheet of SELECTED_SHEETS) {
    it(`«${sheet.name}» — нет смешанных чисел, дублей, answer:null и пустых объяснений`, async () => {
      const result = await generateWorksheet(
        { ...ARGS, request: request(sheet.req) },
        FAKE_ENV,
        fakeDb() as never,
      );

      const tasks = rows(result.worksheet.tasks);
      expect(tasks.length, "лист пуст").toBeGreaterThan(0);

      // 1. Задание без ответа не доходит до учителя (Ф-5).
      const withoutAnswer = tasks.filter(
        (t) => !t.answer.trim() || t.answer.trim().toLowerCase() === "индивидуальный ответ",
      );
      expect(
        withoutAnswer.map((t) => t.text.slice(0, 60)),
        "задания без ответа дошли до выдачи",
      ).toEqual([]);

      // 2. Дублей навыка нет (Ф-2).
      const dupes = findSkillDupes(result.worksheet.tasks as never);
      expect(
        dupes.pairs.map((p) => `${p.first}↔${p.second}: ${p.signature}`),
        "детектор нашёл повторяющийся навык",
      ).toEqual([]);

      // 3. Смешанных чисел в математике 5 (Ф-1). Запись вида «2 1/3».
      if (sheet.name === "математика 5") {
        const mixed = tasks
          .map((t) => `${t.text} || ${t.answer}`)
          .filter((s) => /\d\s+\d+\/\d/.test(s));
        expect(mixed, "смешанные числа в 5 классе").toEqual([]);
      }

      // 4. «Иррациональная десятичная дробь» в пояснениях (Ф-4).
      const wrongIrrational = tasks
        .map((t) => t.explanation)
        .filter((e) => /иррационал/i.test(e) && /десятичн/i.test(e));
      expect(wrongIrrational, "иррациональное названо десятичной дробью").toEqual([]);
    }, 300_000);
  }
});

live("ТЗ-26 Г9: живая контрольная не повторяет навык внутри варианта", () => {
  (wanted("control") ? it : it.skip)("алгебра 8 — внутри вариантов дублей нет, варианты не совпадают", async () => {
    const result = await generateWorksheet(
      {
        ...ARGS,
        request: request({
          subject: "algebra",
          grade: 8,
          topic: "Квадратный трёхчлен",
          count: 8,
          type: "control",
        }),
      },
      FAKE_ENV,
      fakeDb() as never,
    );

    // Второй вариант приходит отдельным полем `secondVariant`, а не массивом
    // `variants`: первый раз я написал здесь `worksheet.variants` и получил
    // `undefined` — форма ответа у контрольной другая, чем у листа.
    const second = result.secondVariant;
    expect(second, "второй вариант не вернулся").toBeTruthy();
    expect(second, "модель вернула один вариант вместо двух").not.toBeNull();

    const variants = [
      { tasks: result.worksheet.tasks },
      { tasks: (second as { tasks: unknown[] }).tasks },
    ];
    expect(variants.length).toBe(2);

    for (const [i, variant] of variants.entries()) {
      const tasks = rows(variant.tasks);
      expect(tasks.length, `в варианте ${i + 1} не то число заданий`).toBe(8);

      // Дублей навыка внутри варианта быть не должно.
      const dupes = findSkillDupes(variant.tasks as never);
      expect(
        dupes.pairs.map((p) => `в${i + 1}: ${p.first}↔${p.second} (${p.signature})`),
        `повтор навыка внутри варианта ${i + 1}`,
      ).toEqual([]);

      // И задание без ответа внутри контрольной тоже недопустимо.
      const noAnswer = tasks.filter((t) => !t.answer.trim());
      expect(noAnswer.length, `в варианте ${i + 1} есть задания без ответа`).toBe(0);
    }

    // Варианты не должны быть переставлены копиями друг друга (В-4).
    const textsA = rows(variants[0]!.tasks).map((t) => t.text);
    const textsB = rows(variants[1]!.tasks).map((t) => t.text);
    const identicalPositions = textsA.filter((t, i) => t === textsB[i]);
    expect(
      identicalPositions.length,
      "варианты совпадают по позициям — это параллельные по номерам варианты",
    ).toBeLessThanOrEqual(1);
  }, 600_000);
});
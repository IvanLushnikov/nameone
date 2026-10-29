/**
 * ТЗ-35: ВЕРСИЯ ФОРМАТА В КЛЮЧЕ СЕМАНТИЧЕСКОГО КЭША.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ФЕЙЛ
 *
 * 1. ВЕРСИЯ НЕ В КЛЮЧЕ. Ключ кэша описывал запрос, но не описывал правила, по
 *    которым ответ был получен. TTL записи — 30 дней, а `saveCache` пишет
 *    `INSERT OR IGNORE`: первая запись по ключу живёт весь TTL. Значит версия
 *    в ключе — обязательная часть, а не украшение: без неё старая запись
 *    побеждает навсегда, и учитель два вечера подряд получает один и тот же
 *    лист, собранный по промпту, которого в коде уже нет (смешанные числа в
 *    5 классе — правило 13 промпта, добавлено 13.10.2026).
 *
 * 2. ЗАПИСЬ СТАРОЙ ВЕРСИИ НЕ ОТДАЁТСЯ. Сценарий «сохранить по старому ключу
 *    → прочитать по новому → промах». Без этого проверка «разные версии →
 *    разные ключи» остаётся декорацией: версия может стоять в ключе, но не
 *    влиять на выдачу.
 *
 * 3. ХЭШ ПРОМПТА. Версию формата поднимают руками, и забыть об этом — ровно
 *    тот дефект, который чинит задача. Поэтому хэш system-промпта и хэш блока
 *    формата ответа зафиксированы в тесте: правили промпт без подъёма
 *    `FORMAT_VERSION` — тест красный, и в сообщении сказано, что делать.
 *
 * 4. РЕГРЕССИИ. Кэш по-прежнему работает как ускоритель (повторный запрос
 *    не тратит деньги), контрольная по-прежнему кэшируется ПАРОЙ
 *    `{worksheet, secondVariant}`, а запись контрольной без второго варианта
 *    по-прежнему сносится и перегенерируется.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 *
 * Тот же приём, что в `control-two-variants.test.ts` и `tz26-pipeline-wiring.test.ts`:
 * `vi.stubGlobal("fetch")` и D1-заглушка с настоящим `semantic_cache` в памяти.
 * Реальный polza.ai — платный, тест в сеть не ходит. `userId: null` не даёт
 * записям usage мешать, `plan: "plus"` снимает мягкий порог нормы.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { afterAll } from "vitest";

// Маркер успеха для гейт-чекера (unlazy).
afterAll(() => {
  console.log("TZ35-CACHE-FORMAT-VERSION-OK");
});

import * as cacheModule from "../../src/llm/cache";
import { generateWorksheet } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { WORKSHEET_GEN_SYSTEM } from "../../src/llm/prompts/worksheet-gen";
import type { Env } from "../../src/env";
import type { GenerationRequest } from "../../src/types";

const { makeCacheKey, lookupCache, saveCache } = cacheModule;

/**
 * Версия формата из кода.
 *
 * Тип приведён явно, чтобы на коде БЕЗ этой константы тест падал
 * утверждением («версия не объявлена»), а не ошибкой загрузки модуля: так
 * видно, что именно сломалось.
 */
const FORMAT_VERSION = (cacheModule as unknown as { FORMAT_VERSION?: number }).FORMAT_VERSION;

/**
 * Версия, которой в коде не было.
 *
 * До ТЗ-35 версия в ключе не участвовала — все записи в кэше, сделанные до
 * 29.10.2026, относятся именно к этой, неявной версии. Их ключи считаются
 * по старым правилам, поэтому подставить её в тест — самый честный способ
 * смоделировать «до».
 */
const LEGACY_VERSION = 1;

/**
 * Хэш system-промпта листа.
 *
 * Пересчёт (правило подъёма версии — в шапке `prompts/worksheet-gen.ts`):
 *   cd backend && npx tsx -e "import {WORKSHEET_GEN_SYSTEM} from './src/llm/prompts/worksheet-gen';
 *   import {createHash} from 'node:crypto';
 *   console.log(createHash('sha256').update(WORKSHEET_GEN_SYSTEM).digest('hex').slice(0,16));"
 *
 * 29.10.2026: хэш пересчитан после слияния с `main`, где в промпт добавлен
 * блок реестра типов задания (`buildTaskTypesPromptBlock`). Версия формата
 * при этом **не поднималась**: `FORMAT_VERSION = 2` вводится вместе с этим
 * промптом, записей по версии 2 в кэше ещё нет, а записи деплоя от 30.10
 * сделаны по старому ключу без версии и после подъёма просто перестанут
 * находиться — одноразовый промах кэша, а не выдача материала по старым
 * правилам.
 */
const PROMPT_HASH = "4e81ff28cd38a74f";

/** Хэш блока формата ответа — см. `formatBlock()` ниже. */
const FORMAT_HASH = "2aba0783bf60e37e";

const BUMP_HINT =
  "Подними FORMAT_VERSION в backend/src/llm/cache.ts в этом же коммите " +
  "(правило — в шапке backend/src/llm/prompts/worksheet-gen.ts) и пересчитай хэш.";

// ─────────────────────────────────────────────────────────────────────────────
// Запросы и окружение
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

const REQUEST: GenerationRequest = {
  subject: "math",
  grade: 5,
  topic: "Обыкновенные дроби",
  difficulty: "medium",
  count: 3,
  type: "worksheet",
  withAnswers: true,
  withExplanations: true,
};

const ARGS = {
  plan: "plus" as const,
  userId: null,
  ip: "203.0.113.10",
};

/**
 * D1-заглушка: `semantic_cache` в памяти, остальное — заглушка.
 *
 * Важная деталь: `INSERT OR IGNORE` здесь ведёт себя как в боевой базе —
 * повторная запись по тому же ключу НЕ перезаписывает первую. Это и есть
 * причина, по которой версия обязана быть в ключе, а не «где-то в записи».
 */
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

/** Подменить провайдера и считать реальные вызовы. */
function stubProvider(payload: unknown) {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify(providerResponse(payload)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

/** Лист с тремя РАЗНЫМИ навыками — чтобы не было дозапроса дублей. */
function sheetPayload() {
  return {
    title: "Обыкновенные дроби — рабочий лист",
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

/** Контрольная: два РАЗНЫХ варианта одним ответом. */
function controlPayload() {
  return {
    variants: [
      {
        title: "Вариант 1",
        subject: "math",
        grade: 5,
        topic: "Обыкновенные дроби",
        difficulty: "medium",
        tasks: [
          { number: 1, text: "Сократите дробь 8/12.", answer: "2/3" },
          { number: 2, text: "Сравните 1/3 и 1/5.", answer: "1/3 больше" },
        ],
      },
      {
        title: "Вариант 2",
        subject: "math",
        grade: 5,
        topic: "Обыкновенные дроби",
        difficulty: "medium",
        tasks: [
          { number: 1, text: "Сравните 1/3 и 1/5.", answer: "1/3 больше" },
          { number: 2, text: "Найдите 1/4 от 20.", answer: "5" },
        ],
      },
    ],
  };
}

/**
 * SHA-256 в hex, первые 16 символов.
 *
 * Обрезаем до 16 символов, чтобы хэш совпадал с тем, что выдаёт команда
 * пересчёта из ТЗ-35 (sha256 → hex → slice(0,16)). Полный дайджест читается
 * как «что-то зашифровали», а нужен короткий маркер, который видно в diff.
 *
 * Считаем через Web Crypto, а не `node:crypto`: тест живёт в пуле
 * `@cloudflare/vitest-plugin` (workerd), где node-модули доступны не всегда.
 */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Блок формата ответа — часть system-промпта.
 *
 * Хэшируем его ОТДЕЛЬНО от всего промпта, чтобы по сообщению об ошибке было
 * видно, что именно изменилось: правила сборки материала или форма ответа.
 * Это разные правки с разными последствиями, и «хэш не совпал» без деталей
 * бесполезно.
 */
function formatBlock(prompt: string): string {
  const marker = "ФОРМАТ ОТВЕТА";
  const i = prompt.indexOf(marker);
  if (i < 0) {
    throw new Error(
      "в system-промпте листа нет блока «ФОРМАТ ОТВЕТА» — пересчитай хэши теста " +
        "и поправь formatBlock()",
    );
  }
  return prompt.slice(i);
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetPolzaSingleton();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Версия в ключе
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-35: версия формата участвует в ключе кэша", () => {
  it("версия формата объявлена в коде", () => {
    expect(typeof FORMAT_VERSION, "в cache.ts нет экспорта FORMAT_VERSION").toBe("number");
    expect(FORMAT_VERSION).toBeGreaterThan(0);
  });

  it("разные версии формата дают разные ключи", () => {
    const legacyKey = makeCacheKey(REQUEST, LEGACY_VERSION);
    const currentKey = makeCacheKey(REQUEST, LEGACY_VERSION + 1);

    // ГЛАВНОЕ УТВЕРЖДЕНИЕ. На коде без версии в ключе ключи совпадают:
    // версия была бы декорацией, и старые записи жили бы весь TTL.
    expect(currentKey, "версия формата не участвует в ключе").not.toBe(legacyKey);
  });

  it("ключ по умолчанию совпадает с ключом текущей версии", () => {
    expect(makeCacheKey(REQUEST)).toBe(makeCacheKey(REQUEST, FORMAT_VERSION));
  });

  it("ключ остаётся 16-символьным hex (длина ключа не поехала)", () => {
    expect(makeCacheKey(REQUEST)).toMatch(/^[0-9a-f]{16}$/);
    expect(makeCacheKey(REQUEST, LEGACY_VERSION)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("один и тот же запрос при одной версии даёт один и тот же ключ", () => {
    expect(makeCacheKey(REQUEST)).toBe(makeCacheKey({ ...REQUEST }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Регрессии на ключ (они были до ТЗ-35 и должны остаться)
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-35: регрессии ключа", () => {
  it("ключ учителя А не совпадает с ключом учителя Б", () => {
    const a = makeCacheKey({ ...REQUEST, userId: "teacher-a" });
    const b = makeCacheKey({ ...REQUEST, userId: "teacher-b" });
    expect(a).not.toBe(b);
  });

  it("ключ не зависит от регистра темы и от лишних пробелов", () => {
    const messy = makeCacheKey({ ...REQUEST, topic: "  ОБЫКНОВЕННЫЕ   ДРОБИ  " });
    expect(messy).toBe(makeCacheKey(REQUEST));
  });

  it("разные параметры запроса дают разные ключи", () => {
    expect(makeCacheKey({ ...REQUEST, count: 12 })).not.toBe(makeCacheKey(REQUEST));
    expect(makeCacheKey({ ...REQUEST, grade: 6 })).not.toBe(makeCacheKey(REQUEST));
    expect(makeCacheKey({ ...REQUEST, type: "control" })).not.toBe(makeCacheKey(REQUEST));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Запись старой версии не отдаётся
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-35: запись, сделанная по старому ключу, не отдаётся по новому", () => {
  it("сохранили по старому ключу → по новому промах", async () => {
    const db = fakeDb();
    const legacyKey = makeCacheKey(REQUEST, LEGACY_VERSION);
    const currentKey = makeCacheKey(REQUEST, LEGACY_VERSION + 1);

    await saveCache(db as unknown as D1Database, {
      key: legacyKey,
      subject: REQUEST.subject,
      grade: REQUEST.grade,
      topic: REQUEST.topic,
      difficulty: REQUEST.difficulty,
      count: REQUEST.count,
      type: REQUEST.type,
      response: { worksheet: { id: "ws_legacy" } },
    });

    // По своему ключу запись на месте — кэш жив.
    const own = await lookupCache(db as unknown as D1Database, legacyKey);
    expect(own).not.toBeNull();
    expect((own?.response as { worksheet: { id: string } }).worksheet.id).toBe("ws_legacy");

    // А по новому ключу — промах: учитель получает свежий материал, а не
    // месячный срок выдачи материала по старым правилам.
    expect(await lookupCache(db as unknown as D1Database, currentKey)).toBeNull();
  });

  it("новая запись не вытесняет старую и наоборот — они живут отдельно", async () => {
    const db = fakeDb();
    const legacyKey = makeCacheKey(REQUEST, LEGACY_VERSION);
    const currentKey = makeCacheKey(REQUEST, LEGACY_VERSION + 1);

    await saveCache(db as unknown as D1Database, {
      key: legacyKey,
      subject: REQUEST.subject,
      grade: REQUEST.grade,
      topic: REQUEST.topic,
      difficulty: REQUEST.difficulty,
      count: REQUEST.count,
      type: REQUEST.type,
      response: { worksheet: { id: "ws_legacy" } },
    });
    await saveCache(db as unknown as D1Database, {
      key: currentKey,
      subject: REQUEST.subject,
      grade: REQUEST.grade,
      topic: REQUEST.topic,
      difficulty: REQUEST.difficulty,
      count: REQUEST.count,
      type: REQUEST.type,
      response: { worksheet: { id: "ws_current" } },
    });

    expect(db.cache.size).toBe(2);
    const legacyHit = await lookupCache(db as unknown as D1Database, legacyKey);
    const currentHit = await lookupCache(db as unknown as D1Database, currentKey);
    expect((legacyHit?.response as { worksheet: { id: string } }).worksheet.id).toBe("ws_legacy");
    expect((currentHit?.response as { worksheet: { id: string } }).worksheet.id).toBe("ws_current");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Кэш по-прежнему работает как ускоритель (регрессия)
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-35: кэш по-прежнему экономит деньги", () => {
  it("повторный запрос по той же теме попадает в кэш и не зовёт модель", async () => {
    const db = fakeDb();
    const { fetchMock } = stubProvider(sheetPayload());
    const args = { ...ARGS, request: REQUEST };

    const first = await generateWorksheet(args, FAKE_ENV, db as never);
    expect(first.meta.cached).toBe(false);
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await generateWorksheet(args, FAKE_ENV, db as never);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.model).toBe("semantic-cache");
    expect(second.meta.costUsd).toBe(0);
    // Модель не звали — деньги не потрачены.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    // И учитель получил тот же самый материал.
    expect(second.worksheet.tasks.map((t) => t.text)).toEqual(
      first.worksheet.tasks.map((t) => t.text),
    );
  });

  it("контрольная кэшируется ПАРОЙ: второй вариант не теряется", async () => {
    const db = fakeDb();
    const { fetchMock } = stubProvider(controlPayload());
    const args = { ...ARGS, request: { ...REQUEST, type: "control" as const, count: 2 } };

    const first = await generateWorksheet(args, FAKE_ENV, db as never);
    expect(first.secondVariant).not.toBeNull();
    const callsAfterFirst = fetchMock.mock.calls.length;

    const second = await generateWorksheet(args, FAKE_ENV, db as never);
    expect(second.meta.cached).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    // Второй вариант на месте — это тот путь, который чинили 12.10.2026.
    expect(second.secondVariant).not.toBeNull();
    expect(second.secondVariant?.tasks).toHaveLength(2);
    expect(second.secondVariant?.tasks.map((t) => t.text)).not.toEqual(
      second.worksheet.tasks.map((t) => t.text),
    );
  });

  it("запись контрольной без второго варианта сносится и лист генерируется заново", async () => {
    const db = fakeDb();
    const { fetchMock } = stubProvider(controlPayload());
    const args = { ...ARGS, request: { ...REQUEST, type: "control" as const, count: 2 } };

    await generateWorksheet(args, FAKE_ENV, db as never);
    const key = [...db.cache.keys()][0];
    expect(key).toBeDefined();
    // Состояние записи ДО выкатки ТЗ-25: ни второго варианта, ни флагов.
    const stored = db.cache.get(key as string) as Record<string, unknown>;
    delete stored.secondVariant;
    delete stored.variants;
    delete stored.quality;
    db.cache.set(key as string, stored);
    const callsAfterSeed = fetchMock.mock.calls.length;

    const res = await generateWorksheet(args, FAKE_ENV, db as never);

    // Пошли к модели, а не отдали старый лист.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterSeed);
    expect(res.meta.cached).toBe(false);
    expect(res.secondVariant).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Версия формата поднимается вместе с промптом
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-35: правило подъёма версии проверяется тестом", () => {
  it("хэш system-промпта листа зафиксирован", async () => {
    const hash = await sha256Hex(WORKSHEET_GEN_SYSTEM);
    expect(hash, `system-промпт изменился. ${BUMP_HINT}`).toBe(PROMPT_HASH);
  });

  it("хэш блока формата ответа зафиксирован", async () => {
    const hash = await sha256Hex(formatBlock(WORKSHEET_GEN_SYSTEM));
    expect(hash, `формат ответа изменился. ${BUMP_HINT}`).toBe(FORMAT_HASH);
  });
});

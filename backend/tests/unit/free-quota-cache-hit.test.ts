/// <reference types="@cloudflare/vitest-plugin" />
/**
 * ТЗ-36: попадание в кэш НЕ тратит бесплатную квоту.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 *
 * Жалоба учителя (исследование 29.10.2026, карточка M-02 и Q-06): он нажал
 * «создать» второй раз по той же теме — получил ТОТ ЖЕ лист байт в байт и при
 * этом потерял одну из пяти бесплатных генераций.
 *
 * Причина в коде: `consumeGenerationQuota` вызывался в роуте БЕЗУСЛОВНО, то
 * есть и когда материал взят из кэша. А кэш-хит — это не генерация: провайдеру
 * не заплатили, `meta.costUsd = 0`, нового материала не получили. То есть
 * учитель отдавал месячную квоту за воздух.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ПРОВЕРЯЕТСЯ
 *
 * 1. ГЛАВНОЕ: два одинаковых запроса подряд. Первый — реальная генерация,
 *    второй — попадание в кэш. Остаток бесплатной квоты после второго равен
 *    остатку после первого (а не на единицу меньше).
 * 2. Антифрод при кэш-хите СЧИТАЕТСЯ: `fraud_signals.generations_total`
 *    растёт. Иначе «жми „Новый вариант“ и не трать квоту» становится способом
 *    нагрузить API (AD-4).
 * 3. Реальная генерация квоту уменьшает — регрессия на текущее поведение.
 * 4. Упавшая генерация занятую попытку возвращает.
 * 5. Бесплатная квота по-прежнему кончается после пяти РЕАЛЬНЫХ генераций.
 * 6. Контрольная по-прежнему приходит двумя вариантами одним вызовом и одной
 *    попыткой.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК УСТРОЕН ТЕСТ
 *
 * Настоящий D1 (схема прода) и настоящий роут: запросы идут через
 * `SELF.fetch` в `/api/worksheets/generate`. Провайдер подменён через
 * `vi.stubGlobal("fetch")` — реальный polza.ai платный, тест в сеть не ходит.
 * Ключ провайдера ставится прямо в биндинг `env` (в тестовом окружении
 * биндинги — обычный объект, и он записывается).
 */
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

import {
  FREE_TOTAL_GENERATIONS,
  checkFreeQuota,
  freeQuotaOwnerKey,
} from "../../src/services/usage";
import { fingerprintHash } from "../../src/lib/antifraud";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

/**
 * Локальный workerd не умеет `D1Database.withSession` (тот же трюк, что в
 * freeQuotaAccounting.test.ts): сессия = сам биндинг.
 */
const db: D1Database = new Proxy(env.DB as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    if (prop === "withSession") return () => target;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
}) as unknown as D1Database;

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "tz36-schema", queries: [schemaSql] }]);
});

/** Отпечаток посетителя: тот же, что считает роут. */
async function fingerprintOf(ip: string): Promise<string> {
  const salt = env.FINGERPRINT_SALT ?? "dev-fingerprint-salt";
  return fingerprintHash({ ip, userAgent: UA }, salt);
}

/** Ключ счёта бесплатной квоты для этого посетителя. */
async function ownerOf(ip: string): Promise<string> {
  return freeQuotaOwnerKey(null, await fingerprintOf(ip));
}

/** Сколько попыток зачтено по счётчику квоты (без учёта занятых). */
async function usedQuota(ip: string): Promise<number> {
  const quota = await checkFreeQuota(db, await ownerOf(ip));
  return quota.used;
}

/** Сколько генераций насчитал антифрод этому отпечатку. */
async function fraudGenerations(ip: string): Promise<number> {
  const row = await db
    .prepare(`SELECT generations_total FROM fraud_signals WHERE fingerprint_hash = ?1`)
    .bind(await fingerprintOf(ip))
    .first<{ generations_total: number }>();
  return Number(row?.generations_total ?? 0);
}

/** Лист, каким его отдаёт провайдер. */
function worksheetPayload(topic: string, marker = "1"): unknown {
  return {
    title: "Обыкновенные дроби",
    subject: "math",
    grade: 5,
    topic,
    difficulty: "medium",
    tasks: [
      {
        number: 1,
        text: `Сравните дроби 1/2 и 1/3 (вариант ${marker}). Какая из них больше?`,
        type: "short-answer",
        answer: "1/2",
        explanation: "У знаменателей одинаковый — сравниваем числители.",
        points: 1,
      },
      {
        number: 2,
        text: `Сложите дроби 1/4 и 2/4 (вариант ${marker}). Запишите ответ.`,
        type: "short-answer",
        answer: "3/4",
        explanation: "Складываем дроби с одинаковым знаменателем.",
        points: 1,
      },
      {
        number: 3,
        text: `Представьте дробь 3/5 (вариант ${marker}) в виде дроби со знаменателем 10.`,
        type: "short-answer",
        answer: "6/10",
        explanation: "Знаменатель умножаем на 2, числитель — тоже.",
        points: 1,
      },
    ],
  };
}

/** Провайдер всегда отвечает одним и тем же телом. */
function stubProvider(payload: unknown): void {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "openai/gpt-6-luna",
          choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 900, completion_tokens: 700, total_tokens: 1600 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
}

/** Провайдер всегда падает. */
function stubFailingProvider(): void {
  const fetchMock = vi.fn(async () => new Response("upstream boom", { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
}

interface GenerateResponse {
  status: number;
  json: {
    ok?: boolean;
    worksheet?: { id?: string; tasks?: unknown[] };
    secondVariant?: { id?: string };
    meta?: {
      model?: string;
      cached?: boolean;
      costUsd?: number;
      generation?: string;
    };
    quality?: { delivered?: number };
  };
}

/** Запрос к роуту генерации от анонимного посетителя с заданного IP. */
async function generate(
  ip: string,
  body: Record<string, unknown>,
): Promise<GenerateResponse> {
  const res = await SELF.fetch("https://uchlist.test/api/worksheets/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      "user-agent": UA,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as GenerateResponse["json"];
  return { status: res.status, json };
}

/** Тело запроса рабочего листа. */
function worksheetBody(topic: string, count = 3): Record<string, unknown> {
  return {
    request: {
      subject: "math",
      grade: 5,
      topic,
      difficulty: "medium",
      count,
      type: "worksheet",
      withAnswers: true,
      withExplanations: true,
    },
  };
}

beforeEach(() => {
  // Провайдеру нужен ключ: без него polza-провайдер бросает ошибку ещё до
  // сети. В тестовом окружении биндинги — обычный объект.
  (env as unknown as Record<string, unknown>).POLZA_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ТЗ-36: попадание в кэш не тратит квоту", () => {
  it("второй запрос по той же теме не уменьшает остаток бесплатной квоты", async () => {
    const ip = "203.0.113.10";
    stubProvider(worksheetPayload("Обыкновенные дроби"));

    // ПЕРВАЯ генерация — настоящая: кэша ещё нет.
    const first = await generate(ip, worksheetBody("Обыкновенные дроби"));
    expect(first.status).toBe(200);
    expect(first.json.meta?.cached).toBe(false);
    expect(first.json.meta?.model).not.toBe("semantic-cache");
    expect(first.json.meta?.costUsd).toBeGreaterThan(0);
    expect(await usedQuota(ip)).toBe(1);

    // ВТОРАЯ — тот же запрос: кэш отдаёт прежний материал.
    const second = await generate(ip, worksheetBody("Обыкновенные дроби"));
    expect(second.status).toBe(200);
    expect(second.json.meta?.cached).toBe(true);
    expect(second.json.meta?.model).toBe("semantic-cache");
    expect(second.json.meta?.costUsd).toBe(0);

    // ГЛАВНОЕ: квота не тронута. Материал тот же — генерации не было.
    expect(await usedQuota(ip)).toBe(1);
    // И остаток учителя — тот же, что был после первой генерации.
    const quota = await checkFreeQuota(db, await ownerOf(ip));
    expect(quota.remaining).toBe(FREE_TOTAL_GENERATIONS - 1);
  });

  it("антифрод при попадании в кэш запрос СЧИТАЕТ (AD-4)", async () => {
    const ip = "203.0.113.11";
    stubProvider(worksheetPayload("Кэш и антифрод"));

    await generate(ip, worksheetBody("Кэш и антифрод"));
    expect(await fraudGenerations(ip)).toBe(1);

    // Второй запрос — кэш-хит. Квоту он не тратит (проверено выше), но в
    // счётчик всплесков попасть ОБЯЗАН: иначе обход кэша становится способом
    // нагружать API бесплатно.
    await generate(ip, worksheetBody("Кэш и антифрод"));
    expect(await fraudGenerations(ip)).toBe(2);
  });
});

describe("ТЗ-36: регрессии", () => {
  it("настоящая генерация квоту уменьшает", async () => {
    const ip = "203.0.113.12";
    stubProvider(worksheetPayload("Реальная генерация"));

    expect(await usedQuota(ip)).toBe(0);
    const res = await generate(ip, worksheetBody("Реальная генерация"));
    expect(res.status).toBe(200);
    expect(res.json.meta?.cached).toBe(false);
    expect(await usedQuota(ip)).toBe(1);
  });

  it("упавшая генерация возвращает занятую попытку", async () => {
    const ip = "203.0.113.13";
    stubFailingProvider();

    const res = await generate(ip, worksheetBody("Упавшая генерация"));
    expect(res.status).not.toBe(200);
    // Провайдер виноват — попытка учителя не должна сгореть.
    expect(await usedQuota(ip)).toBe(0);
  });

  it("бесплатная квота кончается после пяти РЕАЛЬНЫХ генераций", async () => {
    const ip = "203.0.113.14";
    stubProvider(worksheetPayload("Пять листов"));

    // Пять РАЗНЫХ тем: одинаковая тема второй раз ушла бы в кэш и не заняла
    // бы попытку — а тут проверяется именно потолок бесплатного тарифа.
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i += 1) {
      const res = await generate(ip, worksheetBody(`Тема номер ${i}`));
      expect(res.status).toBe(200);
      expect(res.json.meta?.cached).toBe(false);
    }
    expect(await usedQuota(ip)).toBe(FREE_TOTAL_GENERATIONS);

    const sixth = await generate(ip, worksheetBody("Тема номер 6"));
    expect(sixth.status).toBe(429);
  });

  it("контрольная приходит двумя вариантами одним вызовом и одной попыткой", async () => {
    const ip = "203.0.113.15";
    stubProvider({
      variants: [
        worksheetPayload("Контрольная · дроби", "1"),
        worksheetPayload("Контрольная · дроби", "2"),
      ],
    });

    const res = await generate(ip, {
      request: {
        subject: "math",
        grade: 5,
        topic: "Контрольная · дроби",
        difficulty: "medium",
        count: 3,
        type: "control",
        withAnswers: true,
        withExplanations: true,
      },
    });

    expect(res.status).toBe(200);
    // Два варианта — из одного ответа модели, а не из двух запросов.
    expect(res.json.worksheet?.id).toBeTruthy();
    expect(res.json.secondVariant?.id).toBeTruthy();
    expect(res.json.secondVariant?.id).not.toBe(res.json.worksheet?.id);
    // Одна попытка за оба варианта.
    expect(await usedQuota(ip)).toBe(1);
  });
});

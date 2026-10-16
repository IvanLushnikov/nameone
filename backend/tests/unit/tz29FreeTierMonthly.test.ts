/// <reference types="@cloudflare/vitest-plugin" />
/**
 * ТЗ-29: бесплатный тариф — 5 листов В МЕСЯЦ вместо трёх навсегда.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * 1) СБРОС 1-ГО ЧИСЛА. Квота месячная: 5 листов, 1-го числа снова 5. Это и есть
 *    содержание задачи — до неё счётчик рос вечно, и учитель, проверивший
 *    сервис в сентябре, в октябре получал отказ.
 *
 * 2) ИСТОРИЯ НЕ ПРОПАДАЕТ. Сброс — это НОВАЯ СТРОКА ПО НОВОМУ МЕСЯЦУ, а не
 *    затирание прежней. Без этого мы бы не смогли ответить на вопрос владельца
 *    «сколько бесплатных учителей доходят до конца квоты», и обнуление счётчика
 *    было бы уничтожением данных.
 *
 * 3) ПИСЬМО ОДИН РАЗ В МЕСЯЦ. На третьей генерации учитель ещё может
 *    доплатить; на пятой письмо повторяться не должно — оно уже было.
 *
 * 4) ПРЕМИум-ТИПЫ ПРИ ИСЧЕРПАННОЙ КВОТЕ — 402 UPGRADE_REQUIRED. КТП,
 *    презентация и варианты ОГЭ/ЕГЭ не входят в бесплатный тариф: учителю
 *    честно говорят «нужен тариф», а не «лимит исчерпан».
 *
 * 5) СЕБЕСТОИМОСТЬ КВОТЫ. 5 листов не должны съедать заметную часть 249 ₽.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * СХЕМА
 * ─────────────────────────────────────────────────────────────────────────────
 * Настоящий src/db/schema.sql плюс миграция 0004 (таблица free_usage). Тест
 * про месячный счёт обязан идти по той же схеме, что прод.
 *
 * Календарь подставляется через nowMs, поэтому тест не ждёт 1-го числа и не
 * зависит от того, в каком месяце его запустили.
 */
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Письмо о квоте подменено: Resend в тестах не отправляет, а нам нужно знать
 * СКОЛЬКО РАЗ дошло до отправки, а не «ушло ли письмо в сеть».
 */
const sentNotices: Array<{ to: string; used: number; limit: number }> = [];
vi.mock("../../src/services/email", () => ({
  sendFreeQuotaNoticeEmail: vi.fn(
    async (_env: unknown, to: string, params: { used: number; limit: number }) => {
      sentNotices.push({ to, used: params.used, limit: params.limit });
      return { sent: true };
    },
  ),
}));

import {
  FREE_QUOTA_NOTICE_AT,
  FREE_TOTAL_GENERATIONS,
  checkFreeQuota,
  consumeFreeQuota,
  freeQuotaOwnerKey,
  freeQuotaForUser,
  freeTierMonthlyCostRub,
  holdFreeQuotaSlot,
} from "../../src/services/usage";
import { readMonthHistory, readMonthRow } from "../../src/db/free-usage";
import { migrateFreeUsage } from "../../src/db/migrations/0007_free_usage";
import { fingerprintHash } from "../../src/lib/antifraud";
import type { Env } from "../../src/env";

const SALT = "test-salt-tz29";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

/**
 * Локальный workerd этого репозитория не умеет `D1Database.withSession`
 * (см. тот же трюк в freeQuotaAccounting.test.ts): подменяем сессию самим
 * биндингом. На проде сессии есть, и код их по-прежнему использует.
 */
const db: D1Database = new Proxy(env.DB as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    if (prop === "withSession") return () => target;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
}) as unknown as D1Database;

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "tz29-schema", queries: [schemaSql] }]);
  await migrateFreeUsage(env.DB);
});

/** 15 октября 2026, 12:00 по Москве. */
const OCT = Date.UTC(2026, 9, 15, 9, 0, 0);
/** 1 ноября 2026, 09:00 по Москве. */
const NOV = Date.UTC(2026, 10, 1, 6, 0, 0);

/** Занять и зачесть генерацию в заданном месяце. */
async function generate(ownerKey: string, nowMs: number): Promise<void> {
  const hold = await holdFreeQuotaSlot(db, ownerKey, [ownerKey], nowMs);
  expect(hold.allowed).toBe(true);
  await consumeFreeQuota(db, ownerKey, { nowMs });
}

describe("ТЗ-29: квота 5 листов в месяц", () => {
  it("в месяце помещается ровно пять листов, шестой — нет", async () => {
    const owner = freeQuotaOwnerKey(null, "tz29-limit-owner");
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      await generate(owner, OCT);
    }
    const sixth = await holdFreeQuotaSlot(db, owner, [owner], OCT);
    expect(sixth.allowed).toBe(false);
    expect((await checkFreeQuota(db, owner, OCT)).remaining).toBe(0);
  });

  it("1-го числа квота обнуляется, а история остаётся", async () => {
    const owner = freeQuotaOwnerKey(null, "tz29-reset-owner");
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      await generate(owner, OCT);
    }

    // Тот же человек, но в новом месяце: всё снова доступно.
    await generate(owner, NOV);

    const october = await readMonthRow(db, owner, "2026-10");
    expect(october?.generations).toBe(FREE_TOTAL_GENERATIONS);

    const november = await readMonthRow(db, owner, "2026-11");
    expect(november?.generations).toBe(1);

    // История по месяцам — оба месяца на месте, ничего не затёрто.
    const history = await readMonthHistory(db, [owner]);
    expect(history.map((h) => [h.month, h.generations])).toEqual([
      ["2026-11", 1],
      ["2026-10", FREE_TOTAL_GENERATIONS],
    ]);
  });

  it("счёт по всем устройствам человека общий: второй браузер не обходит месяц", async () => {
    const userId = await seedUser(`tz29-${Date.now()}@example.com`);
    await db
      .prepare(
        `INSERT OR REPLACE INTO user_fingerprints (user_id, fingerprint, created_at, last_seen_at)
         VALUES (?1, 'phone', 0, 0)`,
      )
      .bind(userId)
      .run();

    const phone = freeQuotaOwnerKey(userId, "phone");
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) await generate(phone, OCT);

    // Ноутбук — другой отпечаток, тот же человек.
    const laptop = freeQuotaOwnerKey(userId, "laptop");
    const hold = await holdFreeQuotaSlot(db, laptop, ["fp:phone", "fp:laptop", `usr:${userId}`], OCT);
    expect(hold.allowed).toBe(false);

    // В новом месяце — снова доступно.
    expect((await holdFreeQuotaSlot(db, laptop, ["fp:phone", "fp:laptop", `usr:${userId}`], NOV)).allowed)
      .toBe(true);
  });

  it("карточка расхода отдаёт «сделано» и дату обновления", async () => {
    const userId = await seedUser(`tz29-card-${Date.now()}@example.com`);
    const owner = freeQuotaOwnerKey(userId, null);
    await consumeFreeQuota(db, owner, { userId, nowMs: OCT });

    const card = await freeQuotaForUser(db, userId, OCT);
    expect(card.used).toBe(1);
    expect(card.limit).toBe(FREE_TOTAL_GENERATIONS);
    expect(card.remaining).toBe(FREE_TOTAL_GENERATIONS - 1);
    expect(card.month).toBe("2026-10");
    // Обновление — 1 ноября 2026 по Москве.
    expect(new Date(card.resetsAt * 1000 + 3 * 3600 * 1000).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });

  it("письмо уходит на третьей генерации и НЕ уходит на пятой", async () => {
    sentNotices.length = 0;
    const owner = freeQuotaOwnerKey("usr_tz29_mail", "tz29-mail-fp");
    const mailEnv = { RESEND_API_KEY: "test-key" } as unknown as Env;

    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      await holdFreeQuotaSlot(db, owner, [owner], OCT);
      await consumeFreeQuota(db, owner, {
        userId: "usr_tz29_mail",
        email: "teacher@example.com",
        env: mailEnv,
        nowMs: OCT,
      });
    }

    expect(sentNotices).toHaveLength(1);
    expect(sentNotices[0]).toMatchObject({ to: "teacher@example.com", used: FREE_QUOTA_NOTICE_AT });
  });

  it("в следующем месяце письмо уходит снова — метка была на прошлом месяце", async () => {
    sentNotices.length = 0;
    const owner = freeQuotaOwnerKey("usr_tz29_mail2", "tz29-mail-fp2");
    const mailEnv = { RESEND_API_KEY: "test-key" } as unknown as Env;
    const send = async (nowMs: number) => {
      sentNotices.length = 0;
      for (let i = 0; i < FREE_QUOTA_NOTICE_AT; i++) {
        await holdFreeQuotaSlot(db, owner, [owner], nowMs);
        await consumeFreeQuota(db, owner, {
          userId: "usr_tz29_mail2",
          email: "teacher2@example.com",
          env: mailEnv,
          nowMs,
        });
      }
      return sentNotices.length;
    };

    expect(await send(OCT)).toBe(1);
    // Помесячная квота обнулилась — и предупреждение приходит заново.
    expect(await send(NOV)).toBe(1);
  });

  it("себестоимость пяти листов — меньше 15% от 249 ₽", () => {
    const cost = freeTierMonthlyCostRub();
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(249 * 0.15);
  });
});

describe("ТЗ-29: при исчерпанной квоте премиум-тип даёт 402", () => {
  /**
   * Квоту исчерпываем ТЕМ ЖЕ посетителем, чьи заголовки поедем в запросе.
   *
   * IP берётся из заголовка cf-connecting-ip (см. middleware/auth.ts → readIp),
   * отпечаток — из пары IP + User-Agent с солью окружения. Поэтому можно
   * вычислить ключ счёта заранее и занять всю квоту до запроса.
   */
  async function exhaustQuotaFor(ip: string): Promise<string> {
    const salt = env.FINGERPRINT_SALT ?? "dev-fingerprint-salt";
    const fingerprint = await fingerprintHash({ ip, userAgent: UA }, salt);
    const owner = freeQuotaOwnerKey(null, fingerprint);
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      const hold = await holdFreeQuotaSlot(db, owner, [owner]);
      expect(hold.allowed).toBe(true);
      await consumeFreeQuota(db, owner);
    }
    return owner;
  }

  const headers = (ip: string) => ({
    "Content-Type": "application/json",
    "cf-connecting-ip": ip,
    "user-agent": UA,
  });

  it("КТП отвечает UPGRADE_REQUIRED, а не «лимит исчерпан»", async () => {
    const ip = "203.0.113.200";
    await exhaustQuotaFor(ip);

    const res = await SELF.fetch("https://uchlist.test/api/ktp/generate", {
      method: "POST",
      headers: headers(ip),
      body: JSON.stringify({
        request: {
          subject: "math",
          grade: 5,
          topic: "Обыкновенные дроби",
          difficulty: "medium",
          count: 4,
          type: "ktp",
        },
      }),
    });
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, details: { code: "UPGRADE_REQUIRED" } });
    // Формулировок про блокировку в ответе быть не должно: учитель не нарушал
    // правило — ему просто нужен другой тариф.
    expect(JSON.stringify(json).toLowerCase()).not.toContain("заблокирован");
    expect(JSON.stringify(json).toLowerCase()).not.toContain("навсегда");
  });

  it("презентация — тот же 402, а не 429 по квоте", async () => {
    const ip = "203.0.113.201";
    await exhaustQuotaFor(ip);

    const res = await SELF.fetch("https://uchlist.test/api/presentations/generate", {
      method: "POST",
      headers: headers(ip),
      body: JSON.stringify({
        request: {
          subject: "math",
          grade: 5,
          topic: "Обыкновенные дроби",
          difficulty: "medium",
          count: 4,
        },
      }),
    });
    expect(res.status).toBe(402);
  });

  it("контроль: квота действительно исчерпана — обычный лист даёт отказ по квоте", async () => {
    const ip = "203.0.113.202";
    await exhaustQuotaFor(ip);

    const res = await SELF.fetch("https://uchlist.test/api/worksheets/generate", {
      method: "POST",
      headers: headers(ip),
      body: JSON.stringify({
        request: {
          subject: "math",
          grade: 5,
          topic: "Обыкновенные дроби",
          difficulty: "medium",
          count: 6,
          type: "worksheet",
          withAnswers: true,
          withExplanations: true,
        },
      }),
    });
    // Не 402: тип входит в бесплатный тариф, отказ здесь только по квоте.
    expect(res.status).not.toBe(402);
    expect(res.status).toBe(429);
  });
});

/**
 * Пользователь с бесплатным тарифом.
 *
 * Строка создаётся внутри каждого теста: хранилище vitest-pool-workers
 * изолировано по тестам, и соседний `it` сюда не попадёт.
 */
async function seedUser(email: string): Promise<string> {
  const userId = `usr_tz29_${Math.random().toString(36).slice(2, 8)}`;
  await db
    .prepare(
      `INSERT OR REPLACE INTO users
         (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
       VALUES (?1, ?2, 'Учитель', 'free', 0, 0, 0, 0, 0)`,
    )
    .bind(userId, email)
    .run();
  return userId;
}

// Соль используется в тестах через fingerprintHash в других файлах; здесь она
// нужна, чтобы тест был самодостаточным при чтении.
void SALT;
void UA;
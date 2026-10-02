/**
 * Норма тарифа в токенах и бесплатная квота.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * 1) Мягкость порога. `recordUsage` при превышении нормы НЕ бросает ошибок и
 *    НЕ запрещает генерацию — он возвращает `over: true`. Если кто-то решит
 *    «лучше заблокировать», тест упадёт, и это ровно тот откат, который
 *    ломает продукт посреди учебного года.
 * 2) Нормы не должны быть ниже реальной нагрузки учителя. Сценарий «домашка
 *    на каждый урок, 24 урока/нед» — это ~14,9 млн взвешенных токенов в
 *    месяц. Если норма «Плюса» опустится ниже, учитель упрётся в баннер и
 *    напишет в поддержку.
 * 3) Бесплатная квота — 3 генерации ВСЕГО, без суточного окна.
 */

import { describe, it, expect } from "vitest";
import {
  PLAN_NORM_PER_MONTH,
  SCHOOL_NORM_PER_CLASS,
  FREE_TOTAL_GENERATIONS,
  TOKENS_PER_WORKSHEET,
  tokensToWorksheets,
  usageWindowFor,
  getUsageStatus,
  ACADEMIC_YEAR_MONTHS,
} from "../../src/services/usage";
import { modelWeight, weightedTokens } from "../../src/llm/config";
import { getPriceKopecks } from "../../src/services/billing";

/**
 * Ставится настоящий D1: workerd-pool даёт его самому, а наша функция ходит
 * в subscriptions и usage_counters настоящими запросами. Мок был бы здесь
 * коварнее: `getActiveSubscription` ожидает unix-секунды, а мок отдавал ISO —
 * и тест проходил бы, не проверяя ничего.
 */
function withSubscription(period: "monthly" | "academicYear") {
  return {
    id: "sub_1",
    user_id: "u1",
    plan: "plus",
    status: "active",
    period,
    starts_at: Math.floor(new Date("2026-10-15T00:00:00Z").getTime() / 1000),
    ends_at: Math.floor(new Date("2027-07-15T00:00:00Z").getTime() / 1000),
    auto_renew: 1,
    yookassa_payment_id: "yk_1",
    created_at: 1,
    updated_at: 1,
  };
}

/** Минимальный D1, который отвечает на два запроса этих функций. */
function fakeDb(sub: Record<string, unknown> | null, counters: Map<string, number>) {
  return {
    prepare(sql: string) {
      if (sql.includes("FROM subscriptions")) {
        return { bind: () => ({ first: async () => sub }) };
      }
      if (sql.includes("FROM usage_counters")) {
        return {
          bind: (userId: string, metric: string, windowStart: number) => ({
            first: async () => {
              const v = counters.get(`${userId}|${metric}|${windowStart}`);
              return v == null ? null : { count: v };
            },
          }),
        };
      }
      throw new Error("незапланированный запрос в тесте: " + sql.slice(0, 60));
    },
  } as never;
}

describe("нормы тарифа", () => {
  it("Плюс: норма покрывает учителя с домашкой на каждый урок", () => {
    // 24 урока/нед × 34 недели / 9 мес ≈ 91 артефакт/мес, средний ~1 800
    // взвешенных токенов в основной массе (листы на Luna) и часть на Sonnet.
    // 14,9 млн — расчётная величина из docs/04-pricing-economics-v2.md §7.1.
    const heavyTeacherPerMonth = 14_900_000;
    expect(PLAN_NORM_PER_MONTH.plus).toBeGreaterThan(heavyTeacherPerMonth);
  });

  it("Базовый: норма с запасом на 150-300 листов в месяц", () => {
    const threeHundredWorksheets = 300 * TOKENS_PER_WORKSHEET;
    expect(PLAN_NORM_PER_MONTH.base).toBeGreaterThan(threeHundredWorksheets);
  });

  it("Плюс даёт заметно больше Базового, иначе апгрейд бессмыслен", () => {
    expect(PLAN_NORM_PER_MONTH.plus).toBeGreaterThan(PLAN_NORM_PER_MONTH.base * 5);
  });

  it("норма школы = 3 × базовая (ориентир до пилота)", () => {
    expect(SCHOOL_NORM_PER_CLASS).toBe(PLAN_NORM_PER_MONTH.base * 3);
  });

  it("экономика нормы сходится с ценой: COGS «Плюса» ≤ 40% выручки", () => {
    // 1 взвешенный токен = цена выхода Luna = 0,35 $ за 1M = 0,0000035 $.
    const costPerWeightedToken = 0.35 / 1_000_000;
    const plusMonthlyRub = getPriceKopecks("plus", "academicYear") / 100 / ACADEMIC_YEAR_MONTHS;
    const costAtNorm = PLAN_NORM_PER_MONTH.plus * costPerWeightedToken * 85; // в рублях
    expect(costAtNorm / plusMonthlyRub).toBeLessThan(0.4);
  });
});

describe("окно нормы", () => {
  const counters = () => new Map<string, number>();

  it("бесплатный тариф: нормы нет вовсе", async () => {
    const w = await usageWindowFor(fakeDb(null, counters()), "u1", "free");
    expect(w.norm).toBeNull();
    expect(w.windowEndsAt).toBeNull();
  });

  it("без подписки нормы нет (план записан, но платить не платил)", async () => {
    const w = await usageWindowFor(fakeDb(null, counters()), "u1", "base");
    expect(w.norm).toBeNull();
  });

  it("анонимный пользователь нормы не имеет", async () => {
    const w = await usageWindowFor(fakeDb(withSubscription("academicYear"), counters()), null, "plus");
    expect(w.norm).toBeNull();
  });

  it("учебный год = 9 месяцев: норма в 9 раз больше помесячной", async () => {
    const w = await usageWindowFor(fakeDb(withSubscription("academicYear"), counters()), "u1", "plus");
    expect(w.months).toBe(ACADEMIC_YEAR_MONTHS);
    expect(w.norm).toBe(PLAN_NORM_PER_MONTH.plus * ACADEMIC_YEAR_MONTHS);
  });

  it("помесячная оплата: норма равна месячной, окно — один месяц", async () => {
    const w = await usageWindowFor(fakeDb(withSubscription("monthly"), counters()), "u1", "plus");
    expect(w.months).toBe(1);
    expect(w.norm).toBe(PLAN_NORM_PER_MONTH.plus);
  });

  it("окно привязано к оплаченному периоду, а не к календарю", async () => {
    const w = await usageWindowFor(fakeDb(withSubscription("academicYear"), counters()), "u1", "plus");
    expect(w.windowStart).toBe(Math.floor(new Date("2026-10-15T00:00:00Z").getTime() / 1000));
    expect(w.windowEndsAt).toBeGreaterThan(w.windowStart);
  });
});

describe("статус потребления", () => {
  it("без нормы over = false и used = 0 (nil вместо NaN)", async () => {
    const s = await getUsageStatus(fakeDb(null, new Map()), null, "free");
    expect(s.over).toBe(false);
    expect(s.used).toBe(0);
    expect(s.remaining).toBeNull();
  });

  it("used < norm → over false, остаток считается", async () => {
    const c = new Map<string, number>();
    const db = fakeDb(withSubscription("monthly"), c);
    const w = await usageWindowFor(db, "u1", "base");
    c.set(`u1|weighted_tokens|${w.windowStart}`, 1_000_000);
    const s = await getUsageStatus(db, "u1", "base");
    expect(s.over).toBe(false);
    expect(s.remaining).toBe(PLAN_NORM_PER_MONTH.base - 1_000_000);
  });

  it("used == norm → over true (мягко: генерация при этом не запрещена)", async () => {
    const c = new Map<string, number>();
    const db = fakeDb(withSubscription("monthly"), c);
    const w = await usageWindowFor(db, "u1", "base");
    c.set(`u1|weighted_tokens|${w.windowStart}`, PLAN_NORM_PER_MONTH.base);
    const s = await getUsageStatus(db, "u1", "base");
    expect(s.over).toBe(true);
    expect(s.remaining).toBe(0);
  });

  it("used > norm → остаток не уходит в минус", async () => {
    const c = new Map<string, number>();
    const db = fakeDb(withSubscription("monthly"), c);
    const w = await usageWindowFor(db, "u1", "base");
    c.set(`u1|weighted_tokens|${w.windowStart}`, PLAN_NORM_PER_MONTH.base * 2);
    const s = await getUsageStatus(db, "u1", "base");
    expect(s.over).toBe(true);
    expect(s.remaining).toBe(0);
  });
});

describe("единица потребления", () => {
  it("токены переводятся в понятные листы", () => {
    expect(tokensToWorksheets(TOKENS_PER_WORKSHEET)).toBe(1);
    expect(tokensToWorksheets(80 * TOKENS_PER_WORKSHEET)).toBe(80);
  });

  it("лист на Luna и вариант ОГЭ на Sonnet стоят по-разному", () => {
    const luna = weightedTokens("gpt-6-luna", 1_600);
    const sonnet = weightedTokens("claude-sonnet-5-5", 1_600);
    expect(sonnet / luna).toBeCloseTo(modelWeight("claude-sonnet-5-5"), 1);
    expect(sonnet).toBeGreaterThan(luna);
  });
});

describe("бесплатная квота", () => {
  it("три генерации, без суток", () => {
    expect(FREE_TOTAL_GENERATIONS).toBe(3);
  });
});

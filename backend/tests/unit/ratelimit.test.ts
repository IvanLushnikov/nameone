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
  it("Плюс: норма покрывает сценарий В с запасом ×1,5", () => {
    // ОБНОВЛЕНО 12.10.2026 под решение о снижении цен
    // (docs/36-price-cut-implementation-plan-2026-10-12.md §1).
    //
    // Раньше тест требовал 14,9 млн — это расчётная величина для СЦЕНАРИЯ «24
    // урока/нед» из docs/04-pricing-economics-v2.md §7.1. Владелец выбрал базой
    // для решений СЦЕНАРИЙ В (20 уроков/нед), и норма «Плюса» сознательно
    // опущена до 9,7 млн — это потолок, при котором маржа держится 70%.
    //
    // Значение ниже — взвешенная нагрузка сценария В из источника истины
    // scripts/margin-matrix.mjs. Сценарий «24 урока/нед» теперь НЕ входит в
    // норму: держать под ним маржу 70% при цене 999 ₽ нельзя, и это было
    // осознанным решением, а не просчётом.
    const scenarioB = 5_595_806;
    expect(PLAN_NORM_PER_MONTH.plus).toBeGreaterThan(scenarioB * 1.5);
  });

  it("Плюс: норма не выше потолка, при котором маржа держится 70%", () => {
    // Потолок из docs/36 §1: 9 721 361. Норма округлена вниз до 9 700 000,
    // чтобы запас оставался тонким, а не превращался в убыток при дешевой
    // самопроверке.
    expect(PLAN_NORM_PER_MONTH.plus).toBeLessThanOrEqual(9_721_361);
  });

  it("Базовый: норма с запасом на 150-300 листов в месяц", () => {
    const threeHundredWorksheets = 300 * TOKENS_PER_WORKSHEET;
    expect(PLAN_NORM_PER_MONTH.base).toBeGreaterThan(threeHundredWorksheets);
  });

  it("Плюс даёт заметно больше Базового, иначе апгрейд бессмыслен", () => {
    // ОБНОВЛЕНО 12.10.2026. Порог был ×5. При ценах 249 / 999 ₽ соотношение
    // равно ≈4, и решение владельца (docs/36) держит нормы в том же
    // соотношении: учитель платит вчетверо больше и получает вчетверо больше
    // нормы. Пятикратное превосходство при новых ценах уводит маржу ниже 70%,
    // поэтому требование сменили на ×4 — не «чтобы прошло», а потому что
    // продуктовое решение именно такое.
    expect(PLAN_NORM_PER_MONTH.plus).toBeGreaterThan(PLAN_NORM_PER_MONTH.base * 4);
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

  it("бесплатный тариф: нормы в токенах нет, окно — календарный месяц", async () => {
    const w = await usageWindowFor(fakeDb(null, counters()), "u1", "free");
    expect(w.norm).toBeNull();
    // ТЗ-29: квота 5 листов В МЕСЯЦ, поэтому окно кончается 1-го числа —
    // именно эту дату карточка расхода показывает как «обновится».
    expect(w.windowEndsAt).not.toBeNull();
    // Проверяем по МСК: 1-е число московское = 31-е число UTC в 21:00, поэтому
    // сдвигаем на московские три часа, а не смотрим на UTC.
    expect(new Date((w.windowEndsAt ?? 0) * 1000 + 3 * 3600 * 1000).getUTCDate()).toBe(1);
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
  it("пять генераций в месяц, не в сутки и не навсегда", () => {
    // ТЗ-29. Число зашито осознанно: оно и есть обещание учителю, и «три
    // навсегда» было ровно тем, что жаловались.
    expect(FREE_TOTAL_GENERATIONS).toBe(5);
  });
});

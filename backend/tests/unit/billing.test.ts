/**
 * Цены и период оплаты.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ИСТОРИЯ РАСХОЖДЕНИЯ (2026-10-02, до правки)
 * ─────────────────────────────────────────────────────────────────────────────
 * Фронт продавал «Базовый» за 500 ₽/мес и 3 800 ₽ за 9 месяцев, а бэк выставлял
 * 590 ₽/мес и 5 880 ₽ за 12 месяцев (590 × 12). Расхождение — 18% помесячно и
 * 55% за «год». Плюс период считался как 365 дней, то есть даже с правильной
 * суммой учитель получал доступ на 12 месяцев вместо 9.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГДЕ ЖИВЁТ СВЕРКА С ФРОНТОМ — И ПОЧЕМУ НЕ ЗДЕСЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Бэк-тесты идут в @cloudflare/vitest-pool-workers (workerd), где `fs`
 * не существует вовсе: readFileSync() → «not yet implemented in Workers».
 * Прочитать plans.ts из бэка физически нельзя.
 *
 * Поэтому сверка живёт на фронте: `tests/integration/plans-price-sources.test.ts`
 * (node-окружение) читает ОБА файла — plans.ts и billing.ts — и падает, если
 * числа разошлись. Это единственное место, где сверка возможна.
 *
 * Этот файл отвечает за то, что бэк вообще держит правильные числа.
 */

import { describe, it, expect } from "vitest";
import {
  PRICES,
  ACADEMIC_YEAR_MONTHS,
  getPriceKopecks,
  SELLABLE_PLANS,
  type PaidPlan,
  type Period,
} from "../../src/services/billing";

describe("PRICES", () => {
  it("base monthly = 500 ₽ = 50000 kop", () => {
    expect(PRICES.base.monthly).toBe(500_00);
  });

  it("base academic year = 3 800 ₽ = 380000 kop", () => {
    expect(PRICES.base.academicYear).toBe(3_800_00);
  });

  it("plus monthly = 1 500 ₽ = 150000 kop", () => {
    expect(PRICES.plus.monthly).toBe(1_500_00);
  });

  it("plus academic year = 11 000 ₽ = 1100000 kop", () => {
    expect(PRICES.plus.academicYear).toBe(11_000_00);
  });

  it("school = 3 000 ₽/мес за класс, учебного года у класса нет", () => {
    expect(PRICES.school.monthly).toBe(3_000_00);
    expect(PRICES.school.academicYear).toBeNull();
  });

  it("getPriceKopecks отдаёт цену периода", () => {
    expect(getPriceKopecks("base", "monthly")).toBe(500_00);
    expect(getPriceKopecks("plus", "academicYear")).toBe(11_000_00);
  });

  it("учебный год дешевле, чем 9 помесячных платежей", () => {
    // Скидка за год заложена во фронте: 9 × 500 = 4 500 против 3 800.
    expect(PRICES.base.academicYear!).toBeLessThan(PRICES.base.monthly * ACADEMIC_YEAR_MONTHS);
    expect(PRICES.plus.academicYear!).toBeLessThan(PRICES.plus.monthly * ACADEMIC_YEAR_MONTHS);
  });

  it("«учебный год» — 9 месяцев, а НЕ календарный год", () => {
    // 12-месячная цена была бы 6 000 ₽ по старой логике (500 × 12) и
    // давала бы доступ на 365 дней. Ни того, ни другого быть не должно.
    expect(ACADEMIC_YEAR_MONTHS).toBe(9);
    expect(PRICES.base.academicYear!).not.toBe(PRICES.base.monthly * 12);
    expect(PRICES.plus.academicYear!).not.toBe(PRICES.plus.monthly * 12);
  });
});

describe("Plans", () => {
  it("PaidPlan — base, plus и school (цену школы зафиксировали заранее)", () => {
    const plans: PaidPlan[] = ["base", "plus", "school"];
    expect(plans).toContain("base");
    expect(plans).toContain("plus");
    expect("school" in PRICES).toBe(true);
  });

  it("тариф «Школа» не продаётся, пока не настанет Q1 2027", () => {
    expect(SELLABLE_PLANS.has("school")).toBe(false);
    expect(SELLABLE_PLANS.has("base")).toBe(true);
    expect(SELLABLE_PLANS.has("plus")).toBe(true);
  });

  it("Period — monthly и academicYear (не yearly)", () => {
    const periods: Period[] = ["monthly", "academicYear"];
    expect(periods).toContain("monthly");
    expect(periods).toContain("academicYear");
    // Старое имя периода ушло вместе с календарным годом: если оно где-то
    // осталось, значит вернётся 365-дневное окно.
    expect(PRICES.base).not.toHaveProperty("yearly");
    expect(PRICES.plus).not.toHaveProperty("yearly");
  });
});

/**
 * Unit-тесты для billing (ЮKassa) — только pure функции, без HTTP/D1.
 *
 * Для полного webhook end-to-end нужен интеграционный тест с Miniflare.
 */

import { describe, it, expect } from "vitest";
import { PRICES, getPriceKopecks, type PaidPlan, type Period } from "../../src/services/billing";

describe("PRICES", () => {
  it("base monthly = 590₽ = 59000 kop", () => {
    expect(PRICES.base.monthly).toBe(590_00);
  });

  it("base yearly = 490₽ × 12 = 58800 kop", () => {
    expect(PRICES.base.yearly).toBe(490_00 * 12);
  });

  it("plus monthly = 1490₽ = 149000 kop", () => {
    expect(PRICES.plus.monthly).toBe(1490_00);
  });

  it("plus yearly = 990₽ × 12 = 118800 kop", () => {
    expect(PRICES.plus.yearly).toBe(990_00 * 12);
  });

  it("getPriceKopecks returns correct value", () => {
    expect(getPriceKopecks("base", "monthly")).toBe(590_00);
    expect(getPriceKopecks("plus", "yearly")).toBe(990_00 * 12);
  });

  it("yearly < 12 × monthly (discount)", () => {
    const baseMonthly = PRICES.base.monthly * 12;
    expect(PRICES.base.yearly).toBeLessThan(baseMonthly);
    const plusMonthly = PRICES.plus.monthly * 12;
    expect(PRICES.plus.yearly).toBeLessThan(plusMonthly);
  });
});

describe("Plans", () => {
  it("PaidPlan accepts base and plus", () => {
    const plans: PaidPlan[] = ["base", "plus"];
    expect(plans).toContain("base");
    expect(plans).toContain("plus");
  });

  it("Period accepts monthly and yearly", () => {
    const periods: Period[] = ["monthly", "yearly"];
    expect(periods).toContain("monthly");
    expect(periods).toContain("yearly");
  });
});

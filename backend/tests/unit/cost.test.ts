/**
 * Unit-тесты для калькулятора стоимости.
 *
 * Тарифы — polza.ai (актуально на 2026-09-27, https://polza.ai/models).
 * Конвертация RUB → USD по курсу ~85 ₽/$.
 *
 * Запуск: `npm run test`
 */

import { describe, it, expect } from "vitest";
import { calcCost, costBreakdown } from "../../src/llm/cost";

describe("calcCost (polza tariffs)", () => {
  it("gpt-6-luna: 3000 input + 2000 output → $0.00091", () => {
    // polza: 5.91 ₽/1M (~$0.07), 29.53 ₽/1M (~$0.35)
    const cost = calcCost("gpt-6-luna", 3000, 2000);
    expect(cost).toBeCloseTo((3000 / 1e6) * 0.07 + (2000 / 1e6) * 0.35, 6);
    // = 0.00021 + 0.0007 = 0.00091
    expect(cost).toBeCloseTo(0.00091, 6);
  });

  it("gpt-6-sol: 3000 input + 2000 output → ~$0.01807", () => {
    // polza: 118.13 ₽/1M (~$1.39), 590.66 ₽/1M (~$6.95)
    const cost = calcCost("gpt-6-sol", 3000, 2000);
    expect(cost).toBeCloseTo((3000 / 1e6) * 1.39 + (2000 / 1e6) * 6.95, 6);
    // = 0.00417 + 0.0139 = 0.01807
    expect(cost).toBeCloseTo(0.01807, 6);
  });

  it("claude-opus-5-5: 3000 input + 2000 output → $0.07228", () => {
    // polza: 472.53 ₽/1M (~$5.56), 2362.64 ₽/1M (~$27.80)
    const cost = calcCost("claude-opus-5-5", 3000, 2000);
    expect(cost).toBeCloseTo(
      (3000 / 1e6) * 5.56 + (2000 / 1e6) * 27.8,
      6,
    );
    // = 0.01668 + 0.0556 = 0.07228
    expect(cost).toBeCloseTo(0.07228, 6);
  });

  it("claude-opus-5-5: with cache read → cache-read at $0.28/1M", () => {
    const cost = calcCost("claude-opus-5-5", 1000, 1000, { cacheRead: 2000 });
    expect(cost).toBeCloseTo(
      (1000 / 1e6) * 5.56 + (1000 / 1e6) * 27.8 + (2000 / 1e6) * 0.28,
      6,
    );
    // = 0.00556 + 0.0278 + 0.00056 = 0.03392
    expect(cost).toBeCloseTo(0.03392, 6);
  });

  it("deepseek-v4-flash: 3000 input + 500 output → ~$0.00024", () => {
    // polza.ai, сверено 06.10.2026: 5.03 ₽ / 10.07 ₽ за 1M → $0.059 / $0.118.
    // Раньше здесь стояло $0.065 / $0.13 — завышено на ~10%.
    const cost = calcCost("deepseek-v4-flash", 3000, 500);
    expect(cost).toBeCloseTo((3000 / 1e6) * 0.059 + (500 / 1e6) * 0.118, 6);
    // = 0.000177 + 0.000059 = 0.000236
    expect(cost).toBeCloseTo(0.000236, 6);
  });

  it("qwen3-embedding-8b: платные эмбеддинги (1.20 ₽/1M, не бесплатно)", () => {
    // Раньше в MODEL_COSTS стоял ноль — модель считалась бесплатной при том,
    // что polza берёт за неё деньги. Ноль в учёте означал невидимый расход.
    const cost = calcCost("qwen3-embedding-8b", 1000, 0);
    expect(cost).toBeCloseTo((1000 / 1e6) * 0.014, 8);
    expect(cost).toBeGreaterThan(0);
  });

  it("text-embedding-3-large on polza: 1000 input → ~$0.000183", () => {
    // 15.58 ₽/1M на polza.ai (сверено 06.10.2026) = $0.183 при курсе 85 ₽/$.
    // Раньше стояло $0.13 с пометкой «уточнить» — занижение на 41%.
    const cost = calcCost("text-embedding-3-large", 1000, 0);
    expect(cost).toBeCloseTo((1000 / 1e6) * 0.183, 8);
  });

  it("unknown model → 0 (with warn)", () => {
    const cost = calcCost("unknown-model", 1000, 1000);
    expect(cost).toBe(0);
  });

  it("costBreakdown returns totalUsd equal to calcCost", () => {
    const bd = costBreakdown(
      { inputPer1M: 0.07, outputPer1M: 0.35 },
      3000,
      2000,
    );
    expect(bd.inputUsd).toBeCloseTo(0.00021, 6);
    expect(bd.outputUsd).toBeCloseTo(0.0007, 6);
    expect(bd.totalUsd).toBeCloseTo(0.00091, 6);
    expect(bd.cacheReadUsd).toBe(0);
    expect(bd.cacheWriteUsd).toBe(0);
  });
});

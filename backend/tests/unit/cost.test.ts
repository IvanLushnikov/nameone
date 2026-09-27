/**
 * Unit-тесты для калькулятора стоимости.
 *
 * Запуск: `npm run test`
 */

import { describe, it, expect } from "vitest";
import { calcCost, costBreakdown } from "../../src/llm/cost";

describe("calcCost", () => {
  it("gpt-6-luna: 3000 input + 2000 output → $0.0013", () => {
    const cost = calcCost("gpt-6-luna", 3000, 2000);
    expect(cost).toBeCloseTo((3000 / 1e6) * 0.10 + (2000 / 1e6) * 0.5, 6);
    // = 0.0003 + 0.001 = 0.0013
    expect(cost).toBeCloseTo(0.0013, 6);
  });

  it("claude-opus-5-5: 3000 input + 2000 output → $0.052", () => {
    const cost = calcCost("claude-opus-5-5", 3000, 2000);
    expect(cost).toBeCloseTo((3000 / 1e6) * 4 + (2000 / 1e6) * 20, 6);
    // = 0.012 + 0.04 = 0.052
    expect(cost).toBeCloseTo(0.052, 6);
  });

  it("claude-opus-5-5: with cache read → cache-read at $0.20/1M", () => {
    const cost = calcCost("claude-opus-5-5", 1000, 1000, { cacheRead: 2000 });
    expect(cost).toBeCloseTo(
      (1000 / 1e6) * 4 + (1000 / 1e6) * 20 + (2000 / 1e6) * 0.20,
      6,
    );
    // = 0.004 + 0.020 + 0.0004 = 0.0244
    expect(cost).toBeCloseTo(0.0244, 6);
  });

  it("deepseek-v4-flash: 3000 input + 500 output → $0.00056", () => {
    const cost = calcCost("deepseek-v4-flash", 3000, 500);
    expect(cost).toBeCloseTo((3000 / 1e6) * 0.14 + (500 / 1e6) * 0.28, 6);
    expect(cost).toBeCloseTo(0.00056, 6);
  });

  it("qwen3-embedding-8b: free embeddings", () => {
    const cost = calcCost("qwen3-embedding-8b", 1000, 0);
    expect(cost).toBe(0);
  });

  it("unknown model → 0 (with warn)", () => {
    const cost = calcCost("unknown-model", 1000, 1000);
    expect(cost).toBe(0);
  });

  it("costBreakdown returns totalUsd equal to calcCost", () => {
    const bd = costBreakdown(
      { inputPer1M: 0.10, outputPer1M: 0.5 },
      3000,
      2000,
    );
    expect(bd.inputUsd).toBeCloseTo(0.0003, 6);
    expect(bd.outputUsd).toBeCloseTo(0.001, 6);
    expect(bd.totalUsd).toBeCloseTo(0.0013, 6);
    expect(bd.cacheReadUsd).toBe(0);
    expect(bd.cacheWriteUsd).toBe(0);
  });
});

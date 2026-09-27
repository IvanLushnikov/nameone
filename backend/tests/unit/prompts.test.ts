/**
 * Unit-тесты для промптов и LLM routing.
 */

import { describe, it, expect } from "vitest";
import { pickModel } from "../../src/llm/router";
import { buildWorksheetPrompt } from "../../src/llm/prompts/worksheet-gen";
import { buildExamPrompt } from "../../src/llm/prompts/exam-gen";
import { buildValidatePrompt } from "../../src/llm/prompts/validate";
import { makeCacheKey } from "../../src/llm/cache";
import { MODEL_COSTS } from "../../src/llm/config";
import type { Env } from "../../src/env";

const envBase: Env = {
  DB: {} as D1Database,
  PDFS: {} as R2Bucket,
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
  OPENAI_API_KEY: "test-openai",
  ANTHROPIC_API_KEY: "test-anthropic",
  DEEPSEEK_API_KEY: "test-deepseek",
};

describe("pickModel", () => {
  it("worksheet-gen + free → gpt-6-luna primary, gpt-6-sol fallback", () => {
    const decision = pickModel("worksheet-gen", "free", envBase);
    expect(decision.primary?.model).toBe("gpt-6-luna");
    expect(decision.fallbacks[0]?.model).toBe("gpt-6-sol");
    expect(decision.generation).toBe("primary");
  });

  it("worksheet-gen + plus → claude-opus-5-5, no fallback", () => {
    const decision = pickModel("worksheet-gen", "plus", envBase);
    expect(decision.primary?.model).toBe("claude-opus-5-5");
    expect(decision.primary?.provider).toBe("anthropic");
    expect(decision.fallbacks).toHaveLength(0);
    expect(decision.generation).toBe("premium");
  });

  it("validate → deepseek-v4-flash", () => {
    const decision = pickModel("validate", "free", envBase);
    expect(decision.primary?.model).toBe("deepseek-v4-flash");
    expect(decision.primary?.provider).toBe("deepseek");
    expect(decision.fallbacks).toHaveLength(0);
  });

  it("embed → dashscope primary, openai fallback", () => {
    const env = { ...envBase, DASHSCOPE_API_KEY: "test-dashscope" };
    const decision = pickModel("embed", "free", env);
    expect(decision.primary?.model).toBe("qwen3-embedding-8b");
    expect(decision.fallbacks[0]?.model).toBe("text-embedding-3-large");
  });

  it("embed without dashscope → openai primary", () => {
    const env = { ...envBase };
    delete env.DASHSCOPE_API_KEY;
    const decision = pickModel("embed", "free", env);
    expect(decision.primary?.model).toBe("text-embedding-3-large");
  });

  it("image-gen → null (not implemented)", () => {
    const decision = pickModel("image-gen", "plus", envBase);
    expect(decision.primary).toBe(null);
  });

  it("no API keys → primary null", () => {
    const env = { ...envBase };
    delete env.OPENAI_API_KEY;
    delete env.OPENROUTER_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    const decision = pickModel("worksheet-gen", "free", env);
    expect(decision.primary).toBe(null);
  });
});

describe("buildWorksheetPrompt", () => {
  it("contains subject + topic", () => {
    const { system, user } = buildWorksheetPrompt({
      subject: "math",
      grade: 5,
      topic: "Площадь треугольника",
      difficulty: "medium",
      count: 6,
      type: "worksheet",
      withAnswers: true,
      withExplanations: true,
    });
    expect(system.length).toBeGreaterThan(100);
    expect(user).toContain("Площадь треугольника");
    expect(user).toContain("math");
    expect(user).toContain('"count": 6');
  });

  it("system prompt includes ФГОС rule", () => {
    const { system } = buildWorksheetPrompt({
      subject: "math",
      grade: 5,
      topic: "X",
      difficulty: "easy",
      count: 5,
      type: "worksheet",
      withAnswers: false,
      withExplanations: false,
    });
    expect(system).toContain("ФГОС");
    expect(system).toContain("JSON");
  });
});

describe("buildExamPrompt", () => {
  it("oge → duration 235", () => {
    const r = buildExamPrompt({ exam: "oge", subject: "math", variantNumber: 1 });
    expect(r.expectedDuration).toBe(235);
    expect(r.system).toContain("ОГЭ");
  });
});

describe("buildValidatePrompt", () => {
  it("contains context", () => {
    const r = buildValidatePrompt('{"tasks":[]}', { subject: "math", grade: 5, topic: "X" });
    expect(r.system).toContain("score");
    expect(r.user).toContain("math");
  });
});

describe("makeCacheKey", () => {
  it("same params → same key", () => {
    const a = makeCacheKey({
      subject: "math",
      grade: 5,
      topic: "Площадь",
      difficulty: "medium",
      count: 6,
      type: "worksheet",
    });
    const b = makeCacheKey({
      subject: "math",
      grade: 5,
      topic: "  ПЛОЩАДЬ  ",
      difficulty: "medium",
      count: 6,
      type: "worksheet",
    });
    expect(a).toBe(b); // topic normalized
  });

  it("different params → different key", () => {
    const a = makeCacheKey({
      subject: "math",
      grade: 5,
      topic: "Площадь",
      difficulty: "medium",
      count: 6,
      type: "worksheet",
    });
    const b = makeCacheKey({
      subject: "math",
      grade: 5,
      topic: "Объём",
      difficulty: "medium",
      count: 6,
      type: "worksheet",
    });
    expect(a).not.toBe(b);
  });

  it("key is 16-char hex", () => {
    const k = makeCacheKey({
      subject: "math",
      grade: 5,
      topic: "X",
      difficulty: "easy",
      count: 5,
      type: "worksheet",
    });
    expect(k).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("MODEL_COSTS", () => {
  it("all 6 models present", () => {
    expect(Object.keys(MODEL_COSTS).sort()).toEqual([
      "claude-opus-5-5",
      "deepseek-v4-flash",
      "gpt-6-luna",
      "gpt-6-sol",
      "qwen3-embedding-8b",
      "text-embedding-3-large",
    ]);
  });

  it("claude-opus-5-5 has cacheRead rate", () => {
    expect(MODEL_COSTS["claude-opus-5-5"]?.cacheReadPer1M).toBe(0.2);
  });
});

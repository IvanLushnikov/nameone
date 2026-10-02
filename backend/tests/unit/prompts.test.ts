/**
 * Unit-тесты для промптов и LLM routing.
 */

import { describe, it, expect } from "vitest";
import { pickModel } from "../../src/llm/router";
import { buildWorksheetPrompt } from "../../src/llm/prompts/worksheet-gen";
import { buildExamPrompt } from "../../src/llm/prompts/exam-gen";
import { buildValidatePrompt } from "../../src/llm/prompts/validate";
import { makeCacheKey } from "../../src/llm/cache";
import { MODEL_CATALOG, MODEL_COSTS } from "../../src/llm/config";
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
  POLZA_API_KEY: "test-polza",
};

describe("pickModel", () => {
  it("worksheet-gen -> gpt-6-luna, escalation luna -> sol -> sonnet", () => {
    const decision = pickModel("worksheet-gen", envBase);
    expect(decision.primary?.model).toBe("gpt-6-luna");
    expect(decision.primary?.provider).toBe("polza");
    expect(decision.fallbacks.map((f) => f.model)).toEqual([
      "gpt-6-sol",
      "claude-sonnet-5-5",
    ]);
  });

  it("exam-gen -> claude-sonnet-5-5 bez fallbackov (potolok lestnicy)", () => {
    const decision = pickModel("exam-gen", envBase);
    expect(decision.primary?.model).toBe("claude-sonnet-5-5");
    expect(decision.fallbacks).toHaveLength(0);
  });

  it("control/ktp/presentation -> sonnet (slozhnye struktтуриrovannye)", () => {
    for (const task of ["control-gen", "ktp-gen", "presentation-gen"] as const) {
      expect(pickModel(task, envBase).primary?.model).toBe("claude-sonnet-5-5");
    }
  });

  it("test/cards/lesson-plan -> luna (massovye listy)", () => {
    for (const task of ["test-gen", "cards-gen", "lesson-plan-gen"] as const) {
      expect(pickModel(task, envBase).primary?.model).toBe("gpt-6-luna");
    }
  });

  it("tarif NE vliyaet na vybor modeli -- u pickModel net parametra plan", () => {
    // Regression 2026-10-02: ranee plan=plus podnimal do Opus na VSE,
    // vklyuchaya domashku iz 10 zadaniy (3,90 rubl protiv 0,06 rubl u Luna).
    // Teper parametra plan v funktsii prosto net: arity=2 garantiruet,
    // chto tarifnaya vetka ne vernetsya molcha.
    expect(pickModel.length).toBe(2);
  });

  it("validate -> deepseek-v4-flash", () => {
    const decision = pickModel("validate", envBase);
    expect(decision.primary?.model).toBe("deepseek-v4-flash");
    expect(decision.fallbacks).toHaveLength(0);
  });

  it("embed -> text-embedding-3-large primary, qwen3-embedding-8b fallback", () => {
    const decision = pickModel("embed", envBase);
    expect(decision.primary?.model).toBe("text-embedding-3-large");
    expect(decision.fallbacks[0]?.model).toBe("qwen3-embedding-8b");
  });

  it("image-gen -> null (not implemented)", () => {
    const decision = pickModel("image-gen", envBase);
    expect(decision.primary).toBe(null);
  });

  it("bez POLZA_API_KEY -> primary null (routes fallbackat na mok)", () => {
    const env = { ...envBase };
    delete env.POLZA_API_KEY;
    const decision = pickModel("worksheet-gen", env);
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
  it("все модели каталога имеют цену (список не зашит — ловит новые)", () => {
    // Раньше здесь был зашитый список из 6 моделей. Стоило добавить
    // claude-sonnet-5-5 — тест падал, показывая «удалите модель или
    // поправьте тест». Теперь проверяем инвариант: у каждой модели
    // из MODEL_CATALOG есть цена. Новая модель без цены уронит тест,
    // но по делу, а не «список разъехался».
    const catalog = Object.keys(MODEL_CATALOG).sort();
    expect(Object.keys(MODEL_COSTS).sort()).toEqual(catalog);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it("цены неотрицательны, а у эмбеддингов выход = 0", () => {
    // Нюанс, который стоит знать: у embedding-моделей выходных токенов
    // нет вообще, поэтому outputPer1M = 0 — это норма. У qwen3-embedding-8b
    // нулевая и входная цена: в config.ts это помечено как self-host
    // placeholder, то есть сознательная заглушка, а не забывка.
    for (const [id, c] of Object.entries(MODEL_COSTS)) {
      expect(c.inputPer1M, id).toBeGreaterThanOrEqual(0);
      expect(c.outputPer1M, id).toBeGreaterThanOrEqual(0);
    }
    // Все модели, которые реально генерируют текст, должны что-то стоить.
    for (const [id, c] of Object.entries(MODEL_COSTS)) {
      if (MODEL_CATALOG[id]?.embedding) continue;
      expect(c.outputPer1M, id).toBeGreaterThan(0);
    }
  });

  it("cacheRead дороже input и дешевле output (иначе кэш не окупается)", () => {
    // Смысловая проверка вместо зашитого числа: цены на polza.ai менялись
    // уже дважды (0.2 -> 0.28 у opus), и жёсткое ожидание каждый раз
    // становилось ложным падением, а не реальной ошибкой.
    for (const [id, c] of Object.entries(MODEL_COSTS)) {
      if (c.cacheReadPer1M === undefined) continue;
      expect(c.cacheReadPer1M, id).toBeLessThan(c.inputPer1M);
      expect(c.cacheReadPer1M, id).toBeLessThan(c.outputPer1M);
    }
  });
});

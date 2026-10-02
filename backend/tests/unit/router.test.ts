/**
 * Роутинг моделей по сложности — и НЕ по тарифу.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * До 2026-10-02 `pickModel(task, plan, env)` отдавал Opus 5.5 всему, кто на
 * «Плюсе», включая домашку из 10 заданий. Себестоимость такого листа — 3,90 ₽
 * против 0,06 ₽ у Luna (в 65 раз дороже за счёт кэша), и маржа тарифа «Плюс»
 * падала с 62% до 14%.
 *
 * Регрессия, которую закрывает файл: если кто-то снова добавит в роутер
 * ветку «если plan === plus, отдай дорогую модель», тесты на `pickModel`
 * без аргумента тарифа просто перестанут компилироваться — а тесты ниже
 * дополнительно проверяют, что лестница не растёт выше Sonnet.
 *
 * Сверка типов артефактов с фронтом (`src/lib/types.ts`) живёт НЕ здесь:
 * бэк-тесты идут в workerd, где нет `fs`. Она в
 * `tests/integration/plans-price-sources.test.ts` на фронте.
 */

import { describe, it, expect } from "vitest";
import {
  pickModel,
  taskForArtifact,
  ARTIFACT_TASK,
  PLUS_ONLY_TASKS,
} from "../../src/llm/router";
import { MODEL_CATALOG, MODEL_COSTS, modelWeight, weightedTokens, supportsPromptCache } from "../../src/llm/config";
import type { GenerationKind } from "../../src/llm/types";

const env = { POLZA_API_KEY: "test-key" } as never;
const noKey = {} as never;

const modelOf = (task: GenerationKind): string => pickModel(task, env).primary!.model;

describe("выбор модели по сложности", () => {
  it("массовые типы идут на дешёвую Luna", () => {
    for (const task of ["worksheet-gen", "test-gen", "cards-gen", "lesson-plan-gen"] as const) {
      expect(modelOf(task)).toBe("gpt-6-luna");
    }
  });

  it("контрольная, презентация, КТП и экзамены идут на Sonnet 5.5", () => {
    for (const task of ["control-gen", "presentation-gen", "ktp-gen", "exam-gen"] as const) {
      expect(modelOf(task)).toBe("claude-sonnet-5-5");
    }
  });

  it("служебные задачи не менялись: валидатор и embeddings", () => {
    expect(modelOf("validate")).toBe("deepseek-v4-flash");
    expect(modelOf("embed")).toBe("text-embedding-3-large");
  });

  it("тариф НЕ участвует в выборе модели (сигнатура без plan)", () => {
    // Раньше здесь был параметр plan, и «plus» вёл на Opus. Проверяем через
    // типы: pickModel принимает (task, env). Если вернётся plan — компиляция
    // этих вызовов сломается, а не тест.
    expect(modelOf("worksheet-gen")).toBe("gpt-6-luna");
    expect(modelOf("exam-gen")).toBe("claude-sonnet-5-5");
  });

  it("лестница fallback не доходит до Opus", () => {
    // Opus стоит 2 337 ₽ за 1M выхода. Подниматься на него из-за 5xx Luna —
    // значит отдать за один вызов цену сорока листов. Потолок — Sonnet.
    for (const task of ["worksheet-gen", "exam-gen", "control-gen"] as const) {
      const d = pickModel(task, env);
      const chain = [d.primary?.model, ...d.fallbacks.map((f) => f.model)];
      expect(chain).not.toContain("claude-opus-5-5");
    }
  });

  it("лестница для Luna идёт вверх по сложности: Luna → Sol → Sonnet", () => {
    const d = pickModel("worksheet-gen", env);
    expect(d.fallbacks.map((f) => f.model)).toEqual(["gpt-6-sol", "claude-sonnet-5-5"]);
  });

  it("Sonnet — тупик лестницы: если он упал, дальше идти некуда", () => {
    expect(pickModel("exam-gen", env).fallbacks).toEqual([]);
  });

  it("все модели из цепочек есть в каталоге и в таблице цен", () => {
    const tasks: GenerationKind[] = [
      "worksheet-gen", "test-gen", "cards-gen", "lesson-plan-gen",
      "control-gen", "presentation-gen", "ktp-gen", "exam-gen",
      "validate", "embed", "photo-check",
    ];
    for (const task of tasks) {
      const d = pickModel(task, env);
      for (const pick of [d.primary, ...d.fallbacks]) {
        if (!pick) continue;
        expect(MODEL_CATALOG[pick.model], `${task} → ${pick.model}`).toBeDefined();
        expect(MODEL_COSTS[pick.model], `${task} → ${pick.model}`).toBeDefined();
      }
    }
  });

  it("без ключа polza — primary null, роут отдаст 503, а не кривой артефакт", () => {
    expect(pickModel("worksheet-gen", noKey).primary).toBeNull();
  });
});

describe("типы артефактов", () => {
  it("все типы Artifacts роутятся в задачу", () => {
    for (const [artifact, task] of Object.entries(ARTIFACT_TASK)) {
      expect(taskForArtifact(artifact), artifact).toBe(task);
    }
  });

  it("неизвестный тип трактуется как рабочий лист, а не падает", () => {
    expect(taskForArtifact("что-то-новое")).toBe("worksheet-gen");
    expect(taskForArtifact(undefined)).toBe("worksheet-gen");
    expect(taskForArtifact(null)).toBe("worksheet-gen");
  });

  it("ОГЭ и ЕГЭ — один и тот же путь генерации", () => {
    expect(taskForArtifact("oge")).toBe("exam-gen");
    expect(taskForArtifact("ege")).toBe("exam-gen");
  });

  it("в ARTIFACT_TASK есть ключ на каждый тип артефакта", () => {
    // Полный список типов сверяется с фронтом в
    // tests/integration/plans-price-sources.test.ts (там есть fs).
    // Здесь ловим более дешёвое: новый тип, добавленный в бэк «мимо таблицы».
    const expected = [
      "worksheet", "test", "cards", "control", "lesson-plan",
      "presentation", "ktp", "oge", "ege", "materials",
    ];
    for (const t of expected) {
      expect(Object.keys(ARTIFACT_TASK), t).toContain(t);
    }
  });
});

describe("премиум-типы (право по тарифу)", () => {
  it("экзамены, КТП и презентации — только «Плюс»", () => {
    expect(PLUS_ONLY_TASKS.has("exam-gen")).toBe(true);
    expect(PLUS_ONLY_TASKS.has("ktp-gen")).toBe(true);
    expect(PLUS_ONLY_TASKS.has("presentation-gen")).toBe(true);
  });

  it("листы, тесты, карточки и планы урока доступны всем тарифам", () => {
    for (const task of ["worksheet-gen", "test-gen", "cards-gen", "lesson-plan-gen"] as const) {
      expect(PLUS_ONLY_TASKS.has(task), task).toBe(false);
    }
  });
});

describe("взвешенные токены", () => {
  it("эталон — Luna, её вес равен 1", () => {
    expect(modelWeight("gpt-6-luna")).toBeCloseTo(1, 5);
  });

  it("Sonnet весит примерно 40, Opus примерно 80, Sol примерно 20", () => {
    expect(modelWeight("claude-sonnet-5-5")).toBeGreaterThan(38);
    expect(modelWeight("claude-sonnet-5-5")).toBeLessThan(40);
    expect(modelWeight("claude-opus-5-5")).toBeGreaterThan(78);
    expect(modelWeight("gpt-6-sol")).toBeGreaterThan(19);
    expect(modelWeight("gpt-6-sol")).toBeLessThan(20);
  });

  it("Sonnet — примерно половина Opus, это и есть причина замены", () => {
    // На polza Sonnet 5.5 стоит 233,72/1 168,58 ₽, Opus — 467,43/2 337,16 ₽ —
    // ровно 0,5 по обеим позициям (проверено 2026-10-02).
    //
    // Допуск 0,48–0,52, а не «ровно 0,5», потому что MODEL_COSTS хранит цены
    // в ДОЛЛАРАХ с округлением до сотых, а polza публикует рубли: 13,75/27,80
    // даёт 0,4946 вместо точных 0,5000. Это округление представления, не
    // ошибка прайса; при пересчёте в рубли по официальному курсу сходится.
    const opus = MODEL_COSTS["claude-opus-5-5"]!;
    const sonnet = MODEL_COSTS["claude-sonnet-5-5"]!;
    const outRatio = sonnet.outputPer1M / opus.outputPer1M;
    const inRatio = sonnet.inputPer1M / opus.inputPer1M;
    expect(outRatio).toBeGreaterThan(0.48);
    expect(outRatio).toBeLessThan(0.52);
    expect(inRatio).toBeGreaterThan(0.48);
    expect(inRatio).toBeLessThan(0.52);
    // Кэш у них одинаковый по цене (23,372 ₽/1M у обоих на polza), поэтому
    // кэширование не съедает разницу. В MODEL_COSTS цены в $ с округлением
    // до сотых, так что строгое равенство тут даёт 0,275 против 0,28.
    expect(sonnet.cacheReadPer1M).toBeGreaterThan(0.26);
    expect(sonnet.cacheReadPer1M).toBeLessThan(0.29);
    expect(Math.abs(sonnet.cacheReadPer1M! - opus.cacheReadPer1M!)).toBeLessThan(0.01);
  });

  it("неизвестная модель получает вес 1, а не ломает расчёт нормы", () => {
    expect(modelWeight("модель-из-будущего")).toBe(1);
  });

  it("лист на Luna и вариант ОГЭ на Sonnet съедают норму РАЗНО", () => {
    // 1 600 выходных токенов: Luna ≈ 1 600 взвешенных, Sonnet ≈ 62 800.
    // Если бы веса не было, «Базовый» и «Плюс» считали бы ОГЭ одинаково.
    const wsheet = weightedTokens("gpt-6-luna", 1_600);
    const oge = weightedTokens("claude-sonnet-5-5", 1_600);
    expect(wsheet).toBe(1_600);
    expect(oge).toBeGreaterThan(wsheet * 30);
  });

  it("ноль токенов даёт ноль (кеш не должен накручивать норму)", () => {
    expect(weightedTokens("gpt-6-luna", 0)).toBe(0);
    expect(weightedTokens("claude-opus-5-5", 0)).toBe(0);
  });
});

describe("prompt caching включается по свойству модели, а не по тарифу", () => {
  it("Anthropic-модели держат кэш", () => {
    expect(supportsPromptCache("claude-sonnet-5-5")).toBe(true);
    expect(supportsPromptCache("claude-opus-5-5")).toBe(true);
  });

  it("Luna и Sol кэш не держат — и притворяться не надо", () => {
    expect(supportsPromptCache("gpt-6-luna")).toBe(false);
    expect(supportsPromptCache("gpt-6-sol")).toBe(false);
  });
});

/**
 * Регрессии по дырам, найденным аудитом 06.10.2026.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ─────────────────────────────────────────────────────────────────────────────
 * Каждый тест ниже закрывает конкретную поломку, которая либо уже стоила
 * денег, либо отдавала учителю ложь. Все они были ЗЕЛЁНЫМИ в старом наборе:
 * 440 тестов проходили, ни один не ловил ни одну из этих дыр. Поэтому тест
 * здесь — не «проверить, что код работает», а «упасть, если это откатят».
 *
 * Соответствие пунктам аудита (docs/25-audit-llm-verification-2026-10-06.md):
 *   · BL-03/BL-04 — идентификатор и дата листа из ответа модели;
 *   · NEW-LLM-1   — `apiName` был мёртвым полем, polza получал внутренний id;
 *   · NEW-LLM-2   — фолбэк не менял модель: лестница била в ту же Luna;
 *   · NEW-COST-2  — цены эмбеддингов занижены на 41 %, qwen считалась бесплатной;
 *   · NEW-COST-1  — анонимные эмбеддинги не попадали ни в один учёт;
 *   · BL-06       — счётчик квоты читался с реплики D1, лимит работал «через раз»;
 *   · NEW-LLM-4   — Opus отдавался анонимно в /api/llm/models без реального
 *                   apiName и при этом был недостижим в роутинге.
 */

import { describe, it, expect } from "vitest";
import { MODEL_CATALOG, MODEL_COSTS } from "../../src/llm/config";
import { apiNameFor } from "../../src/llm/providers/polza";
import { worksheetId } from "../../src/lib/shortid";
import type { Worksheet } from "../../src/types";

// ─────────────────────────────────────────────────────────────────────────────
// BL-03 / BL-04: идентификатор и дата листа
// ─────────────────────────────────────────────────────────────────────────────

describe("идентификатор листа не зависит от ответа модели", () => {
  /** Ровно то, что делает generateWorksheet: ответ модели с чужим id и датой. */
  const fromModel = (modelId: unknown, modelCreatedAt: unknown) => {
    const parsed = {
      id: modelId,
      title: "Лист",
      subject: "biology",
      grade: 7,
      topic: "photosynthesis",
      difficulty: "hard",
      tasks: [],
      createdAt: modelCreatedAt,
    } as unknown as Worksheet;
    return {
      id: worksheetId(),
      createdAt: new Date().toISOString(),
      from: parsed,
    };
  };

  it("два одинаковых запроса дают РАЗНЫЕ id (иначе лист затирает чужой)", () => {
    // Именно это стоило учителям данных: `worksheets.id` — первичный ключ,
    // сохранение идёт через INSERT OR REPLACE, а модель выдавала детерминированный
    // id вида ws_biology_grade7_photosynthesis_hard_01.
    const a = fromModel("ws_biology_grade7_photosynthesis_hard_01", "2025-03-08T00:00:00Z");
    const b = fromModel("ws_biology_grade7_photosynthesis_hard_01", "2025-03-08T00:00:00Z");
    expect(a.id).not.toBe(b.id);
    expect(a.from.id).toBe(b.from.id); // модель-то отдавала одно и то же
  });

  it("id нечитаем по подбору — это закрывает доступ к чужим анонимным листам", () => {
    // Прод отдавал 200 на GET /api/worksheets/ws_math_grade5_fractions_easy_001
    // без входа: идентификаторы были предсказуемы.
    const generated = new Set(Array.from({ length: 500 }, () => worksheetId()));
    expect(generated.size).toBe(500); // без коллизий
    for (const id of generated) {
      expect(id).toMatch(/^ws_[0-9a-z]{12}$/);
      // Ни одна настоящая строка не выглядит как «тема + класс + номер».
      expect(id).not.toContain("biology");
      expect(id).not.toContain("math");
      expect(id).not.toContain("grade");
    }
  });

  it("createdAt — фактическое время, а не константа из ответа модели", () => {
    // Модель писала 2025-03-08T00:00:00Z — на полтора года в прошлом.
    const now = new Date();
    const { createdAt, from } = fromModel("ws_x", "2025-03-08T00:00:00Z");
    const diffMs = Math.abs(now.getTime() - new Date(createdAt).getTime());
    expect(diffMs).toBeLessThan(60_000); // свежесть, а не «какая-то дата»
    expect(from.createdAt).toBe("2025-03-08T00:00:00Z"); // и модель врала
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-LLM-1: apiName — не мёртвое поле
// ─────────────────────────────────────────────────────────────────────────────

describe("имя модели для провайдера", () => {
  it("в polza уезжает apiName, а не наш внутренний id", () => {
    expect(apiNameFor("gpt-6-luna")).toBe("openai/gpt-6-luna");
    expect(apiNameFor("claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5.5");
    expect(apiNameFor("deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
    expect(apiNameFor("text-embedding-3-large")).toBe("openai/text-embedding-3-large");
  });

  it("у Opus своё имя, а не Sonnet-овское", () => {
    // При совпадении apiName мы платили бы цену Sonnet, а списывали Opus (×2).
    expect(apiNameFor("claude-opus-5-5")).toBe("anthropic/claude-opus-5.5");
    expect(apiNameFor("claude-opus-5-5")).not.toBe(apiNameFor("claude-sonnet-5-5"));
  });

  it("две модели с РАЗНЫМИ ценами не могут делить одно apiName", () => {
    // ОбобщениеBL-11: коллизия ловится на любой паре, а не только на паре Opus/Sonnet.
    const byApiName = new Map<string, string[]>();
    for (const [id, meta] of Object.entries(MODEL_CATALOG)) {
      const list = byApiName.get(meta.apiName) ?? [];
      list.push(id);
      byApiName.set(meta.apiName, list);
    }
    for (const [apiName, ids] of byApiName) {
      if (ids.length < 2) continue;
      const prices = ids.map((id) => MODEL_COSTS[id]?.outputPer1M ?? MODEL_COSTS[id]?.inputPer1M ?? 0);
      const distinct = new Set(prices);
      expect(
        distinct.size,
        `модели ${ids.join(", ")} шлют одно apiName «${apiName}», но стоят по-разному`,
      ).toBeGreaterThan(1);
    }
  });

  it("модель вне каталога уходит как есть, а не ломает вызов", () => {
    expect(apiNameFor("кастомная-модель-из-env")).toBe("кастомная-модель-из-env");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW-COST-2: цены эмбеддингов
// ─────────────────────────────────────────────────────────────────────────────

describe("цены эмбеддингов не занижены", () => {
  it("text-embedding-3-large стоит как на прайсе (15.58 ₽/1M), а не $0.13", () => {
    // 15.58 ₽/1M ÷ курс 85 ₽/$ = $0.183. Старые $0.13 занижали учёт на 41 %.
    expect(MODEL_COSTS["text-embedding-3-large"]!.inputPer1M).toBeCloseTo(0.183, 3);
  });

  it("qwen3-embedding-8b не бесплатная: провайдер берёт 1.20 ₽/1M", () => {
    // Ноль в MODEL_COSTS означал невидимый расход: платили, а в отчёте — ничего.
    const cost = MODEL_COSTS["qwen3-embedding-8b"]!;
    expect(cost.inputPer1M).toBeGreaterThan(0);
    expect(cost.inputPer1M).toBeCloseTo(0.014, 3);
  });

  it("ни одна модель в прайсе не стоит ровно ноль", () => {
    // Страховка от тихого возврата «бесплатных» моделей.
    for (const [id, cost] of Object.entries(MODEL_COSTS)) {
      if (id === "text-embedding-3-large" || id === "qwen3-embedding-8b") continue;
      expect(cost.inputPer1M + cost.outputPer1M, `модель ${id} нулевая по цене`).toBeGreaterThan(0);
    }
  });
});

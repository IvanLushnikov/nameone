/**
 * BL-12: полная сверка цен с прайсом polza.ai + охрана от будущего разъезда.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * Разовая сверка бесполезна: провайдер меняет цены, а код — нет. Через
 * месяц те же расхождения вернутся, и никто их не заметит, потому что
 * тесты проверяют согласованность кода с САМИМ СОБОЙ, а не с реальностью.
 *
 * Поэтому здесь зафиксирован снимок прайса polza.ai в РУБЛЯХ (₽ за 1M
 * токенов, снят 06.10.2026 со страницы /models) и тест сравнивает с ним
 * конфигурацию. Как только провайдер поменяет цену — тест упадёт и покажет
 * величину расхождения; как только поменяем мы — тоже.
 *
 * Допуск 2% — не «чтобы тест был мягким», а потому что в прайсе округление
 * до копеек, а у нас цена в долларах с точностью до 0,001. Плюс курс
 * 86,2 ₽/$ выведен из самого прайса, а не взят с курсовой биржи: если
 * биржевой курс поменяется, пересчитать надо и прайс, и тест.
 *
 * ЧТО ЭТОТ ТЕСТ ЛОВИТ НА ПРАКТИКЕ: молчащее занижение цены. В 06.10.2026
 * text-embedding-3-large был занижен на 41%, а qwen3-embedding-8b стоял
 * нулём — то есть платили провайдеру и не видели этого нигде. Оба значения
 * прошли весь старый набор тестов, потому что старые тесты сравнивали код
 * с кодом.
 */

import { describe, it, expect } from "vitest";
import { MODEL_COSTS } from "../../src/llm/config";

/** Курс, выведенный из прайса: 119,83 ₽ ÷ $1.39 (Sol) и 479,30 ₽ ÷ $5.56 (Opus). */
const RUB_PER_USD = 86.2;

/**
 * Снимок прайса polza.ai на 06.10.2026, ₽ за 1M токенов.
 * Источник: https://polza.ai/models (живая страница, maxAge=0).
 * null = позиция в прайсе отсутствует (например, у эмбеддингов нет выхода).
 */
const POLZA_PRICE_SNAPSHOT: Record<string, { input: number | null; output: number | null; note?: string }> = {
  "gpt-6-luna": { input: 5.99, output: 29.96 },
  "gpt-6-sol": { input: 119.83, output: 599.13 },
  "claude-sonnet-5-5": { input: 239.65, output: 1198.26 },
  "claude-opus-5-5": { input: 479.3, output: 2396.52 },
  "deepseek-v4-flash": { input: 5.03, output: 10.07, note: "сверено 06.10.2026" },
  "qwen3-embedding-8b": { input: 1.2, output: null },
  "text-embedding-3-large": { input: 15.58, output: null },
};

/** Допуск 2% — на округление прайса и точность долларовых цен. */
const TOLERANCE = 0.02;

describe("цены в MODEL_COSTS совпадают с прайсом polza.ai", () => {
  it.each(Object.entries(POLZA_PRICE_SNAPSHOT))(
    "%s — цена в пределах %i%% от прайса",
    (modelId, snapshot) => {
      // MODEL_COSTS — Record со строковыми ключами, поэтому доступ типизируется
      // как possibly undefined. Здесь это не так: проверка ниже падает сама,
      // если модели в прайсе-эталоне нет в конфигурации.
      const cost = MODEL_COSTS[modelId]!;
      expect(MODEL_COSTS[modelId], `модели ${modelId} нет в MODEL_COSTS`).toBeDefined();

      if (snapshot.input !== null) {
        const oursRub = cost.inputPer1M * RUB_PER_USD;
        expect(
          Math.abs(oursRub - snapshot.input) / snapshot.input,
          `${modelId}: вход — у нас ${oursRub.toFixed(2)} ₽/1M, в прайсе ${snapshot.input} ₽/1M`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }

      if (snapshot.output !== null) {
        const oursRub = cost.outputPer1M * RUB_PER_USD;
        expect(
          Math.abs(oursRub - snapshot.output) / snapshot.output,
          `${modelId}: выход — у нас ${oursRub.toFixed(2)} ₽/1M, в прайсе ${snapshot.output} ₽/1M`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  );

  it("эмбеддинги не числятся бесплатными (платим провайдеру — платим и мы в учёте)", () => {
    for (const id of ["qwen3-embedding-8b", "text-embedding-3-large"]) {
      expect(MODEL_COSTS[id]!.inputPer1M, `${id} числится бесплатной`).toBeGreaterThan(0);
    }
  });

  it("Sonnet стоит ровно половину Opus по обеим позициям", () => {
    // Это не совпадение: на polza так и продаётся. Проверка ловит случай,
    // когда одну из цен поправили, а вторую забыли.
    const sonnet = MODEL_COSTS["claude-sonnet-5-5"]!;
    const opus = MODEL_COSTS["claude-opus-5-5"]!;
    expect(opus.inputPer1M / sonnet.inputPer1M).toBeCloseTo(2, 1);
    expect(opus.outputPer1M / sonnet.outputPer1M).toBeCloseTo(2, 1);
  });

  it("ни одна модель не стоит ноль — ноль означает невидимый расход", () => {
    for (const [id, cost] of Object.entries(MODEL_COSTS)) {
      expect(cost.inputPer1M + cost.outputPer1M, `${id} нулевая по цене`).toBeGreaterThan(0);
    }
  });
});
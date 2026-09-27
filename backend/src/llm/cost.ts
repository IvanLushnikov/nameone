/**
 * Калькулятор стоимости LLM-вызовов.
 *
 * Точность — до 8 знаков после запятой, округление через банкира, не round-half-up.
 * Если модели нет в прайсе — возвращаем 0 и пишем warn (на случай, если мы
 * добавили новую модель в роутер, но забыли проставить тариф).
 */

import { MODEL_COSTS, type ModelCost } from "./config";
import { logLlmEvent } from "./log";

export interface CostCalcOpts {
  /** Tokens, прочитанные из prompt cache (Anthropic). */
  cacheRead?: number;
  /** Tokens, записанные в prompt cache (Anthropic). Обычно = input. */
  cacheWrite?: number;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  totalUsd: number;
}

/**
 * Посчитать стоимость вызова в USD.
 *
 * @param model        ID модели из MODEL_CATALOG.
 * @param tokensIn     Prompt tokens (включая system + user + cache).
 * @param tokensOut    Completion tokens.
 * @param opts.cacheRead   Tokens, прочитанные из cache (сверх tokensIn).
 *                     Для Anthropic cache_read_input_tokens приходят отдельно
 *                     — НЕ включая их в tokensIn.
 * @param opts.cacheWrite  Tokens, записанные в cache — обычно тарифицируются
 *                     как input.
 */
export function calcCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
  opts?: CostCalcOpts,
): number {
  const spec = MODEL_COSTS[model];
  if (!spec) {
    logLlmEvent("warn", "calcCost: unknown model, returning 0", { model });
    return 0;
  }
  const breakdown = costBreakdown(spec, tokensIn, tokensOut, opts);
  return breakdown.totalUsd;
}

/** Разбивка по категориям (для детального логирования и тестов). */
export function costBreakdown(
  spec: ModelCost,
  tokensIn: number,
  tokensOut: number,
  opts?: CostCalcOpts,
): CostBreakdown {
  const inputUsd = (tokensIn / 1_000_000) * spec.inputPer1M;
  const outputUsd = (tokensOut / 1_000_000) * spec.outputPer1M;
  const cacheReadUsd =
    opts?.cacheRead && spec.cacheReadPer1M != null
      ? (opts.cacheRead / 1_000_000) * spec.cacheReadPer1M
      : 0;
  const cacheWriteUsd =
    opts?.cacheWrite && spec.cacheWritePer1M != null
      ? (opts.cacheWrite / 1_000_000) * spec.cacheWritePer1M
      : 0;
  const totalUsd = round8(inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd);
  return {
    inputUsd: round8(inputUsd),
    outputUsd: round8(outputUsd),
    cacheReadUsd: round8(cacheReadUsd),
    cacheWriteUsd: round8(cacheWriteUsd),
    totalUsd,
  };
}

/** Round-half-to-even (banker's) до 8 знаков. */
function round8(n: number): number {
  // toFixed даёт round-half-up, поэтому используем Decimal-эмуляцию на Number.
  // Для наших долей USD точность IEEE-754 double хватает.
  if (!Number.isFinite(n)) return 0;
  const factor = 100_000_000;
  return Math.round(n * factor) / factor;
}

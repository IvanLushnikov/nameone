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
  /**
   * Image-токены, которые провайдер насчитал В ОТДЕЛЬНЫХ полях usage
   * (некоторые провайдеры отдают `prompt_tokens_details.image_tokens`).
   *
   * Если поле не задано или равно 0, значит картинка уже сидит внутри
   * `tokensIn` (так возвращает polza) — тогда ничего не добавляем.
   * Если задано — прибавляем к входу и тарифицируем по отдельному
   * imageInputPer1M, а при его отсутствии — по обычному inputPer1M.
   */
  imageTokens?: number;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  /** Сколько из `inputUsd` пришлось на картинку (входит в inputUsd, не сверху). */
  imageUsd: number;
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
  // Image-токены тарифицируются по входному тарифу и уже входят в tokensIn
  // у провайдеров, которые не выделяют их отдельно. Если провайдер выделил —
  // берём их из текстовой части и считаем по image-тарифу (или input, если
  // отдельного image-тарифа нет, напр. gpt-6-luna на polza).
  const imageTokens = Math.max(0, opts?.imageTokens ?? 0);
  const hasSeparateImage = imageTokens > 0 && imageTokens <= tokensIn;
  const textTokensIn = hasSeparateImage ? tokensIn - imageTokens : tokensIn;

  const inputUsd = (textTokensIn / 1_000_000) * spec.inputPer1M;
  const imageUsd = hasSeparateImage
    ? (imageTokens / 1_000_000) * (spec.imageInputPer1M ?? spec.inputPer1M)
    : 0;
  const outputUsd = (tokensOut / 1_000_000) * spec.outputPer1M;
  const cacheReadUsd =
    opts?.cacheRead && spec.cacheReadPer1M != null
      ? (opts.cacheRead / 1_000_000) * spec.cacheReadPer1M
      : 0;
  const cacheWriteUsd =
    opts?.cacheWrite && spec.cacheWritePer1M != null
      ? (opts.cacheWrite / 1_000_000) * spec.cacheWritePer1M
      : 0;
  const totalUsd = round8(inputUsd + imageUsd + outputUsd + cacheReadUsd + cacheWriteUsd);
  return {
    inputUsd: round8(inputUsd),
    outputUsd: round8(outputUsd),
    imageUsd: round8(imageUsd),
    cacheReadUsd: round8(cacheReadUsd),
    cacheWriteUsd: round8(cacheWriteUsd),
    totalUsd,
  };
}

/**
 * Грубая оценка image-токенов по размеру картинки и `detail`.
 *
 * Нужна ДО вызова LLM, чтобы прикинуть COGS и залогировать ожидаемую стоимость
 * (см. TZ-11 §5.4). Точной формулы OpenAI нет и она не опубликована, поэтому
 * берём порядок величины из документации: low ≈ 85 токенов на тайл 512px,
 * high ≈ 170 на тайл, плюс базовые ~85 токенов на изображение.
 *
 * ВАЖНО: это оценка для логов и лимитов, а НЕ основание для биллинга. Реальные
 * токены всегда берём из `usage` провайдера — их и тарифицирует calcCost.
 */
export function estimateImageTokens(
  widthPx: number,
  heightPx: number,
  detail: "low" | "high" = "low",
): number {
  const BASE = 85;
  const TILE = detail === "low" ? 170 : 765;
  if (widthPx <= 0 || heightPx <= 0) return BASE;
  // Считаем по 512px-тайлам, минимум 1 тайл.
  const tilesW = Math.max(1, Math.ceil(widthPx / 512));
  const tilesH = Math.max(1, Math.ceil(heightPx / 512));
  return BASE + TILE * tilesW * tilesH;
}

/** Round-half-to-even (banker's) до 8 знаков. */
function round8(n: number): number {
  // toFixed даёт round-half-up, поэтому используем Decimal-эмуляцию на Number.
  // Для наших долей USD точность IEEE-754 double хватает.
  if (!Number.isFinite(n)) return 0;
  const factor = 100_000_000;
  return Math.round(n * factor) / factor;
}

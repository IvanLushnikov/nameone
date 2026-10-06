/**
 * LLM config: ENV keys, supported models, cost table.
 *
 * Один источник правды для всех провайдеров и тарифов.
 * Стоимость — в USD за 1M токенов (см. docs/02-llm-architecture.md, Section 1).
 *
 * Правила:
 *   * API base URL — из env с дефолтами. Позволяет проксировать через OpenRouter
 *     или собственный gateway без правки кода.
 *   * isProviderEnabled(...) — единая проверка наличия ключа (работает и для
 *     OpenAI-ключа, и для OpenRouter-фолбэка на тот же провайдер).
 *   * Polza.ai — primary провайдер для юрлиц в РФ: один POLZA_API_KEY покрывает
 *     все модели из каталога (openai/anthropic/deepseek/qwen). См. router.ts.
 */

import type { Env } from "../env";

// ─────────────────────────────────────────────────────────────────────────────
// Provider env keys (что искать в `c.env`)
// ─────────────────────────────────────────────────────────────────────────────

export const ENV_KEYS = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  polza: "POLZA_API_KEY",
} as const;

export type ProviderId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "openrouter"
  | "dashscope"
  | "polza";

// ─────────────────────────────────────────────────────────────────────────────
// API base URLs (дефолты; перебиваются env)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  polza: "https://polza.ai/api/v1",
};

/** ENV-ключи для override base URL — опциональные, fallback на дефолт. */
const BASE_URL_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
  deepseek: "DEEPSEEK_BASE_URL",
  openrouter: "OPENROUTER_BASE_URL",
  dashscope: "DASHSCOPE_BASE_URL",
  polza: "POLZA_BASE_URL",
};

export function getBaseUrl(env: Env, provider: ProviderId): string {
  const overrideKey = BASE_URL_ENV[provider];
  const override = env[overrideKey as keyof Env] as string | undefined;
  return override || DEFAULT_BASE_URLS[provider];
}

// ─────────────────────────────────────────────────────────────────────────────
// Model catalog: модель → (провайдер, env-ключ API)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  /** API name, который провайдер ждёт в запросе. */
  apiName: string;
  /**
   * Принимает ли модель изображения (`image_url` в content-part).
   *
   * TZ-11 §5.1 (В-1) закрыт решением продакта: распознаём фото тетради через
   * `gpt-6-luna` — по прайсу polza модель мультимодальная. Поле нужно, чтобы
   * роутер не отдал photo-check модели без картинки и чтобы смена модели на
   * финальную была правкой одной строки в MODEL_CATALOG.
   */
  vision?: boolean;
  /**
   * Модель эмбеддингов (не генерирует текст).
   *
   * У таких моделей `outputPer1M` = 0 — выходных токенов у эмбеддинга нет.
   * Флаг нужен, чтобы валидация MODEL_COSTS и любые проверки «модель что-то
   * генерирует» не принимали нулевую цену выхода за ошибку конфигурации.
   */
  embedding?: boolean;
}

/**
 * Каталог моделей.
 *
 * Polza.ai — единственный провайдер для УчЛист. Один POLZA_API_KEY
 * покрывает все модели каталога. Прямые ключи OpenAI/Anthropic/DeepSeek/DashScope
 * больше не используются (см. docs/02-llm-architecture.md Section 5).
 *
 * apiName — что polza хочет видеть в `model` параметре запроса.
 * Формат: `{provider}/{model}` (openai/gpt-6-luna, anthropic/claude-opus-5.5).
 * Все модели ниже проверены в каталоге polza.ai (актуально на 2026-09-27).
 */
export const MODEL_CATALOG: Record<string, ModelSpec> = {
  // gpt-6-luna — рабочая модель и для генерации, и для распознавания фото (TZ-11).
  // `vision: true` — единственный переключатель для смены модели распознавания.
  "gpt-6-luna": { id: "gpt-6-luna", provider: "polza", apiName: "openai/gpt-6-luna", vision: true },
  // Fallback на случай, если Luna временно отдаёт 5xx. Управляем нами
  // (text-lora/RU-экспертиза), цена заметно выше — включается только по факту ошибки.
  "gpt-6-sol": { id: "gpt-6-sol", provider: "polza", apiName: "openai/gpt-6-sol", vision: true },
  // Claude Sonnet 5.5 — рабочая модель для сложных задач (ОГЭ/ЕГЭ, КТП).
  //
  // ПОЧЕМУ НЕ OPUS (решение 2026-10-02, docs/04-pricing-economics-v2.md §3):
  // на polza Sonnet 5.5 стоит РОВНО 0,5× цены Opus по обеим позициям при
  // одинаковом prompt caching (233,72/1 168,58 ₽ против 467,43/2 337,16 ₽,
  // проверено на polza.ai/models/anthropic/claude-sonnet-5.5 2026-10-02).
  // Для генерации учебных материалов разница в качестве не окупает
  // двукратную разницу в цене. Opus остаётся в каталоге и включается
  // только явным решением — дефолтный потолок лестницы fallback (router.ts).
  "claude-sonnet-5-5": { id: "claude-sonnet-5-5", provider: "polza", apiName: "anthropic/claude-sonnet-5.5" },
  "claude-opus-5-5": { id: "claude-opus-5-5", provider: "polza", apiName: "anthropic/claude-opus-5.5" },
  // polza/deepseek/deepseek-v4-flash — есть на polza, V4 Flash (284B total / 13B activated MoE).
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    provider: "polza",
    apiName: "deepseek/deepseek-v4-flash",
  },
  // Qwen3 Embedding 8B — мультиязычный (multilingual instruction-aware, MTEB-R 64+).
  // На polza проксируется под openai/qwen3-embedding-8b или qwen/qwen3-embedding-8b —
  // точное имя зависит от upstream-провайдера; если 404 — fallback на text-embedding-3-large.
  "qwen3-embedding-8b": {
    id: "qwen3-embedding-8b",
    provider: "polza",
    apiName: "qwen/qwen3-embedding-8b",
    embedding: true,
  },
  // OpenAI text-embedding-3-large — точное имя на polza проверено.
  "text-embedding-3-large": {
    id: "text-embedding-3-large",
    provider: "polza",
    apiName: "openai/text-embedding-3-large",
    embedding: true,
  },
};

/** Список ID моделей, у которых есть API-ключ в env. */
export function availableModels(env: Env): string[] {
  const result: string[] = [];
  for (const [modelId, spec] of Object.entries(MODEL_CATALOG)) {
    if (isProviderEnabled(env, spec.provider)) {
      result.push(modelId);
    }
  }
  return result;
}

/**
 * Модель принимает изображения (`image_url` в content-part).
 *
 * Роутер спрашивает это перед тем, как отдать photo-check задачу модели:
 * лучше явный `primary: null` и 503, чем молчаливый текстовый вызов,
 * который вернёт «не могу разобрать фото» как обычный текст.
 */
export function isVisionModel(modelId: string): boolean {
  return MODEL_CATALOG[modelId]?.vision === true;
}

/**
 * Провайдер включён, если есть его ключ.
 *
 * Спецслучай: `openai` разрешён, если есть либо OPENAI_API_KEY, либо
 * OPENROUTER_API_KEY (для пользователей из РФ, у которых один ключ от OpenRouter
 * закрывает все модели OpenAI — см. docs/02-llm-architecture.md Section 5).
 *
 * Polza включён, если есть POLZA_API_KEY. Для моделей каталога (provider: "polza")
 * роутер сначала пробует polza, и только если ключа нет — прямой provider.
 */
export function isProviderEnabled(env: Env, provider: ProviderId): boolean {
  if (provider === "openai") {
    return Boolean(env.OPENAI_API_KEY) || Boolean(env.OPENROUTER_API_KEY);
  }
  const key = ENV_KEYS[provider];
  const v = env[key as keyof Env];
  return Boolean(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost table (USD per 1M tokens)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelCost {
  /** $ за 1M input tokens. */
  inputPer1M: number;
  /** $ за 1M output tokens. */
  outputPer1M: number;
  /**
   * $ за 1M image-токенов, если провайдер тарифицирует картинку ОТДЕЛЬНО от
   * текстового ввода. Если не задано — картинка тарифицируется по inputPer1M
   * (для gpt-6-luna на polza именно так: колонка «Изображение вход» в прайсе —
   * прочерк, см. MODEL_COSTS ниже).
   */
  imageInputPer1M?: number;
  /** $ за 1M cache-read tokens (Anthropic prompt cache). */
  cacheReadPer1M?: number;
  /** $ за 1M cache-write tokens (Anthropic prompt cache, обычно = input). */
  cacheWritePer1M?: number;
}

/**
 * Прайс — тарифы polza.ai (актуально на 2026-09-27, https://polza.ai/models).
 *
 * Конвертация RUB → USD по курсу ~85 ₽/$ (polza берёт курс сам; эта таблица —
 * для нашей аналитики и лимитов). Источники:
 *   - gpt-6-luna: polza.ai/models/openai/gpt-6-luna
 *   - gpt-6-sol:  polza.ai/models/openai/gpt-6-sol
 *   - claude-opus-5.5: polza.ai/models/anthropic/claude-opus-5.5
 *   - deepseek-v4-flash: polza.ai/models/deepseek/deepseek-v4-flash
 *   - qwen3-embedding-8b: open-weight placeholder
 *   - text-embedding-3-large: polza.ai/models/openai/text-embedding-3-large
 *
 * Итоговая стоимость 10k генераций (free/base → Luna + валидация DeepSeek V4 Flash):
 *   Gen: 3k in + 2k out × $0.07 / $0.35 × 10k   = $9.10
 *   Val: 3k in + 0.5k out × $0.065 / $0.13 × 10k = $2.60
 *   Embeddings: 200 tok × $0.13 / 1M × 10k       = $0.26
 *   ───────────────────────────────────────────── = ~$12 / мес
 */
export const MODEL_COSTS: Record<string, ModelCost> = {
  // openai/gpt-6-luna: 5.91 ₽ / 29.53 ₽ за 1M → $0.07 / $0.35
  // Мультимодальная (TZ-11 §5.1): колонка «Изображение вход, 1M» в прайсе polza
  // — прочерк, т.е. картинка тарифицируется по обычному входному тарифу.
  // Поэтому imageInputPer1M НЕ задаём: calcCost сам возьмёт inputPer1M.
  "gpt-6-luna": { inputPer1M: 0.07, outputPer1M: 0.35 },
  // openai/gpt-6-sol: 118.13 ₽ / 590.66 ₽ → $1.39 / $6.95
  "gpt-6-sol": { inputPer1M: 1.39, outputPer1M: 6.95 },
  // anthropic/claude-sonnet-5.5: 233,72 ₽ / 1 168,58 ₽ за 1M; cache_read 23,372 ₽
  // Ровно половина Opus по обеим позициям. Кэш записи у Anthropic = 1,25 × input.
  "claude-sonnet-5-5": {
    inputPer1M: 2.75,
    outputPer1M: 13.75,
    cacheReadPer1M: 0.275,
    cacheWritePer1M: 3.4375,
  },
  // anthropic/claude-opus-5.5: 472.53 ₽ / 2362.64 ₽ за 1M; cache_read 23.63 ₽
  "claude-opus-5-5": {
    inputPer1M: 5.56,
    outputPer1M: 27.8,
    cacheReadPer1M: 0.28,
    cacheWritePer1M: 5.56,
  },
  // deepseek/deepseek-v4-flash: 5.03 ₽ / 10.07 ₽ за 1M (сверено с polza.ai 06.10.2026;
  // раньше стояло 5.54 / 11.08 — завышено на ~10%, что занижало вес модели в норме)
  "deepseek-v4-flash": { inputPer1M: 0.059, outputPer1M: 0.118 },
  // qwen/qwen3-embedding-8b: 1.20 ₽ за 1M входа (polza.ai, сверено 06.10.2026).
  // Раньше стоял ноль — то есть модель в учёте была бесплатной при том, что
  // провайдер берёт за неё деньги. В скобках: рабочее имя на polza — с префиксом
  // qwen/, openai/… отдаёт 404.
  "qwen3-embedding-8b": { inputPer1M: 0.014, outputPer1M: 0.0 },
  // openai/text-embedding-3-large: 15.58 ₽ за 1M входа = $0.183 при курсе 85 ₽/$
  // (polza.ai, сверено 06.10.2026). Раньше стояло $0.13 с пометкой «уточнить» —
  // занижение на 41%, из-за чего весь учёт эмбеддингов был оптимистичным.
  "text-embedding-3-large": { inputPer1M: 0.183, outputPer1M: 0.0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Взвешенные токены — единица потребления, которую вид��т учитель
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Умеет ли модель prompt caching (Anthropic-семейство через polza).
 *
 * Кэш включается по СВОЙСТВУ МОДЕЛИ, а не по тарифу. Раньше флаг ставился как
 * `plan === "plus"` — то есть кэш получал только платящий пользователь, и
 * даже если бы роутер отдал Sonnet учителю с «Базового», system prompt
 * каждый раз уходил бы в полную стоимость. Кэширование тут бесплатное по
 * смыслу (мы платим за cache-read вместо полного input), поэтому включается
 * везде, где модель его держит.
 */
export function supportsPromptCache(modelId: string): boolean {
  return MODEL_COSTS[modelId]?.cacheReadPer1M != null;
}

/**
 * Эталонная модель для тарификации потребления.
 *
 * С 2026-10-02 это gpt-6-luna. Все нормы тарифов считаются в «взвешенных
 * токенах» — токенах Luna-эквивалента:
 *
 *     weightedTokens = tokensOut × (outputPer1M(модель) / outputPer1M(Luna))
 *
 * ЗАЧЕМ ЭТО НУЖНО. Разные артефакты на разных моделях стоят по-разному:
 * лист на Luna — 0,06 ₽, вариант ОГЭ на Sonnet — 7,70 ₽, КТП на Sonnet — 9,45 ₽.
 * Считать «штуки артефактов» нельзя (тогда дорогой артефакт съедает норму
 * бесплатно), а считать «сырые токены» тоже нельзя (тогда 1 токен на Luna и
 * 1 токен на Sonnet считаются одинаково, а стоят в 40 раз разного).
 * Взвешенный токен решает ровно эту задачу: счёт совпадает с себестоимостью
 * до копейки, но остаётся одной линейной единицей.
 *
 * Базовый тариф = 1,44 млн, Плюс = 16 млн взвешенных токенов в месяц.
 * Выбранные значения и их экономика — docs/04-pricing-economics-v2.md §7.1.
 */
export const REFERENCE_MODEL_ID = "gpt-6-luna";

/**
 * Вес модели = во сколько раз её выход дороже выхода эталонной Luna.
 * Luna 1 · Sol 19,9 · Sonnet 39,3 · Opus 79,4 (округляется до 1/2/40/80 в UI).
 *
 * Модели, которых нет в MODEL_COSTS (например, кастомный override из env),
 * получают вес 1 — иначе норму нельзя было бы посчитать вовсе, и это
 * безопасно: недобор нормы заметнее, чем скрытый перерасход.
 */
export function modelWeight(modelId: string): number {
  const cost = MODEL_COSTS[modelId];
  const ref = MODEL_COSTS[REFERENCE_MODEL_ID];
  if (!cost || !ref || ref.outputPer1M <= 0) return 1;
  return cost.outputPer1M / ref.outputPer1M;
}

/**
 * Перевести out-токены провайдера во взвешенные токены тарифа.
 * Input-токены не учитываются: на всех моделях они дешевле выхода в 3-5 раз
 * и почти не влияют на итог (для Luna 1 800 in ≈ 250 выходных по цене).
 */
export function weightedTokens(modelId: string, tokensOut: number): number {
  return Math.round(tokensOut * modelWeight(modelId));
}

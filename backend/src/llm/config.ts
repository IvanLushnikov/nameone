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
}

/**
 * Каталог моделей.
 *
 * Polza.ai — единственный провайдер для РабочиеЛисты AI. Один POLZA_API_KEY
 * покрывает все модели каталога. Прямые ключи OpenAI/Anthropic/DeepSeek/DashScope
 * больше не используются (см. docs/02-llm-architecture.md Section 5).
 *
 * apiName — что polza хочет видеть в `model` параметре запроса.
 * Формат: `{provider}/{model}` (openai/gpt-6-luna, anthropic/claude-opus-5.5).
 * Все модели ниже проверены в каталоге polza.ai (актуально на 2026-09-27).
 */
export const MODEL_CATALOG: Record<string, ModelSpec> = {
  "gpt-6-luna": { id: "gpt-6-luna", provider: "polza", apiName: "openai/gpt-6-luna" },
  "gpt-6-sol": { id: "gpt-6-sol", provider: "polza", apiName: "openai/gpt-6-sol" },
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
  },
  // OpenAI text-embedding-3-large — точное имя на polza проверено.
  "text-embedding-3-large": {
    id: "text-embedding-3-large",
    provider: "polza",
    apiName: "openai/text-embedding-3-large",
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
  "gpt-6-luna": { inputPer1M: 0.07, outputPer1M: 0.35 },
  // openai/gpt-6-sol: 118.13 ₽ / 590.66 ₽ → $1.39 / $6.95
  "gpt-6-sol": { inputPer1M: 1.39, outputPer1M: 6.95 },
  // anthropic/claude-opus-5.5: 472.53 ₽ / 2362.64 ₽ за 1M; cache_read 23.63 ₽
  "claude-opus-5-5": {
    inputPer1M: 5.56,
    outputPer1M: 27.8,
    cacheReadPer1M: 0.28,
    cacheWritePer1M: 5.56,
  },
  // deepseek/deepseek-v4-flash: 5.54 ₽ / 11.08 ₽ за 1M (базовая цена, не cheap-tier)
  "deepseek-v4-flash": { inputPer1M: 0.065, outputPer1M: 0.13 },
  // qwen3-embedding-8b — open-weight, self-host placeholder
  "qwen3-embedding-8b": { inputPer1M: 0.0, outputPer1M: 0.0 },
  // openai/text-embedding-3-large: уточнить точную цену polza; пока берём как у прямого OpenAI
  "text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0.0 },
};

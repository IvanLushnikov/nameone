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
} as const;

export type ProviderId = "openai" | "anthropic" | "deepseek" | "openrouter" | "dashscope";

// ─────────────────────────────────────────────────────────────────────────────
// API base URLs (дефолты; перебиваются env)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

/** ENV-ключи для override base URL — опциональные, fallback на дефолт. */
const BASE_URL_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
  deepseek: "DEEPSEEK_BASE_URL",
  openrouter: "OPENROUTER_BASE_URL",
  dashscope: "DASHSCOPE_BASE_URL",
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

export const MODEL_CATALOG: Record<string, ModelSpec> = {
  "gpt-6-luna": { id: "gpt-6-luna", provider: "openai", apiName: "gpt-6-luna" },
  "gpt-6-sol": { id: "gpt-6-sol", provider: "openai", apiName: "gpt-6-sol" },
  "claude-opus-5-5": { id: "claude-opus-5-5", provider: "anthropic", apiName: "claude-opus-5-5" },
  "deepseek-v4-flash": { id: "deepseek-v4-flash", provider: "deepseek", apiName: "deepseek-v4-flash" },
  "qwen3-embedding-8b": { id: "qwen3-embedding-8b", provider: "dashscope", apiName: "qwen3-embedding-8b" },
  "text-embedding-3-large": {
    id: "text-embedding-3-large",
    provider: "openai",
    apiName: "text-embedding-3-large",
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
 * Прайс — из docs/02-llm-architecture.md Section 1 (на 2026-09-25).
 *
 * Qwen3 embeddings — $0 (open-weight, self-host placeholder).
 * OpenAI text-embedding-3-large — $0.13 / 1M input.
 */
export const MODEL_COSTS: Record<string, ModelCost> = {
  "gpt-6-luna": { inputPer1M: 0.10, outputPer1M: 0.5 },
  "gpt-6-sol": { inputPer1M: 2.0, outputPer1M: 10.0 },
  "claude-opus-5-5": {
    inputPer1M: 4.0,
    outputPer1M: 20.0,
    cacheReadPer1M: 0.2,
    // cache write обычно тарифицируется как input у Anthropic, оставляем тот же rate
    cacheWritePer1M: 4.0,
  },
  "deepseek-v4-flash": { inputPer1M: 0.14, outputPer1M: 0.28 },
  "qwen3-embedding-8b": { inputPer1M: 0.0, outputPer1M: 0.0 },
  "text-embedding-3-large": { inputPer1M: 0.13, outputPer1M: 0.0 },
};

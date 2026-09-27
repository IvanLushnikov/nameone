/**
 * Внутренние типы LLM-слоя.
 *
 * Эти типы НЕ экспортируются за пределы backend/src/llm/.
 * Наружу (в routes/services) выставляются DTO из `backend/src/types.ts`.
 */

import type { Env } from "../env";

// ─────────────────────────────────────────────────────────────────────────────
// Базовые сообщения и запросы
// ─────────────────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  /** ID модели из MODEL_CATALOG (например "gpt-6-luna"). */
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** "json" → попросить провайдера выдать JSON-валидный ответ. */
  responseFormat?: "json" | "text";
  /** Если true — включить prompt caching на system (где провайдер умеет). */
  cacheSystemPrompt?: boolean;
}

/**
 * Унифицированный ответ от любого провайдера.
 *
 * Поля tokensIn/tokensOut — это то, что провайдер реально насчитал.
 * `costUsd` — рассчитан на нашей стороне по MODEL_COSTS.
 */
export interface LLMResponse {
  content: string;
  tokensIn: number;
  tokensOut: number;
  /** Tokens, которые провайдер прочитал из prompt cache (Anthropic). */
  cacheReadTokens?: number;
  /** Tokens, записанные в prompt cache (Anthropic). */
  cacheWriteTokens?: number;
  costUsd: number;
  latencyMs: number;
  /** True, если провайдер явно сообщил, что ответ взят из кэша (на уровне провайдера). */
  cached: boolean;
  /** Сырой ответ провайдера — для отладки, в meta не кладём. */
  raw?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider abstraction
// ─────────────────────────────────────────────────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  complete(req: LLMRequest, env: Env, opts?: { signal?: AbortSignal }): Promise<LLMResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain types — задача/тариф
// ─────────────────────────────────────────────────────────────────────────────

/** Тип генерации — что именно делаем через LLM. */
export type GenerationKind =
  | "worksheet-gen" // генерация рабочего листа
  | "exam-gen" // генерация ОГЭ/ЕГЭ варианта
  | "validate" // пост-валидация (DeepSeek)
  | "embed" // embeddings для поиска/дедупликации
  | "image-gen"; // генерация картинок (заглушка на старте)

/** Тариф юзера. Влияет на routing (Luna vs Opus). */
export type Plan = "free" | "base" | "plus";

/** Pick провайдера+модели (или null — не реализовано). */
export interface ProviderPick {
  provider: ProviderId;
  model: string;
}

export interface RoutingDecision {
  primary: ProviderPick | null; // null = ничего не подключено (например, image-gen)
  fallbacks: ProviderPick[];
  generation: "primary" | "boost" | "premium";
}

// Re-export provider id from config to avoid circular import pain at call site.
import type { ProviderId } from "./config";

/**
 * Типы LLM-слоя РабочиеЛисты AI.
 * Версия архитектуры: 2026-09-25.
 */

import type { WorksheetTask, Worksheet, GenerationRequest } from "@/lib/types";

/** Каталог поддерживаемых моделей. Имена — это slug, а не полные API-имена. */
export type ModelId =
  | "gpt-6-luna"
  | "gpt-6-sol"
  | "claude-opus-5-5"
  | "deepseek-v4-flash"
  | "qwen3-embedding-8b"
  | "text-embedding-3-large"
  | "mercury-2-5";

/** Какие задачи решает LLM-слой. */
export type LlmTask =
  | "worksheet-gen"        // генерация рабочего листа
  | "worksheet-validate"   // валидация структуры и качества
  | "worksheet-boost"      // повторная генерация с reasoning
  | "embed"                // embeddings для поиска/дедупликации
  | "preview-fast"         // быстрый preview при наборе
  | "seo-meta";            // метатеги для листа (title, description, keywords)

/** Тариф юзера — влияет на выбор модели. */
export type UserPlan = "free" | "base" | "plus";

/** Контекст вызова LLM. */
export interface LlmContext {
  task: LlmTask;
  plan: UserPlan;
  subject?: string;
  grade?: number;
  /** Опционально — для кэширования. */
  cacheKey?: string;
  /** Если true — кэширование отключено (force regenerate). */
  bypassCache?: boolean;
}

/** Результат решения роутера. */
export interface RoutingDecision {
  primary: ModelId;
  fallback: ModelId[];
  /** Нужно ли включать reasoning/boost. */
  reasoning: boolean;
  /** Включить ли prompt caching (только для Anthropic). */
  cacheSystemPrompt: boolean;
}

/** Аргументы вызова LLM. */
export interface LlmCallArgs {
  model: ModelId;
  system: string;
  user: string;
  /** JSON schema или просто строка "json" — для провайдеров без strict-mode. */
  responseFormat?: "json" | { type: "json_schema"; schema: Record<string, unknown> };
  /** Температура. */
  temperature?: number;
  /** Макс. токенов. */
  maxTokens?: number;
  /** Таймаут в мс. */
  timeoutMs?: number;
}

/** Результат вызова LLM. */
export interface LlmCallResult {
  model: ModelId;
  content: string;
  /** Для JSON-ответов — распарсенный объект. */
  parsed?: unknown;
  /** Использование токенов (если вернул провайдер). */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  };
  /** Секунды на запрос. */
  latencyMs: number;
  /** Стоимость в USD (расчётная). */
  costUsd: number;
}

/** Структура результата генерации листа — она стабильна между моделями. */
export interface GeneratedWorksheet {
  title: string;
  instructions?: string;
  tasks: WorksheetTask[];
}

/** Аргументы для генерации листа. */
export interface GenerateWorksheetArgs {
  request: GenerationRequest;
  /** Plan юзера — определяет модель. */
  plan: UserPlan;
  /** Если уже был кэш — пропускаем LLM. */
  bypassCache?: boolean;
}

/** Аргументы для валидации. */
export interface ValidateWorksheetArgs {
  worksheet: Worksheet;
  /** subject + grade + topic — для проверки соответствия ФГОС. */
  context: { subject: string; grade: number; topic: string };
}

/** Результат валидации. */
export interface ValidationResult {
  ok: boolean;
  /** Общая оценка 0..1. */
  score: number;
  /** Найденные проблемы. */
  issues: ValidationIssue[];
  /** Предложение: оставить как есть или перегенерировать. */
  recommendation: "accept" | "fix" | "regenerate";
}

export interface ValidationIssue {
  type: "duplicate-task" | "wrong-answer" | "wrong-difficulty" | "wrong-grade" | "duplicate-options" | "missing-answer" | "other";
  taskNumber?: number;
  message: string;
  severity: "low" | "medium" | "high";
}

/** Аргументы для embeddings. */
export interface EmbedArgs {
  texts: string[];
  model?: ModelId; // по умолчанию text-embedding-3-large
}

/** Результат embeddings. */
export interface EmbedResult {
  model: ModelId;
  vectors: number[][];
  usage: { inputTokens: number };
  costUsd: number;
}

/** Аргументы генерации изображения. */
export interface ImageGenArgs {
  prompt: string;
  negative?: string;
  size?: { width: number; height: number };
  seed?: number;
}

/** Результат генерации изображения. */
export interface ImageGenResult {
  provider: "replicate" | "inception";
  model: string;
  url: string;
  width: number;
  height: number;
  costUsd: number;
  latencyMs: number;
}

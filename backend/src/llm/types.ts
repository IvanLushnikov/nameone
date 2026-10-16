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

/**
 * Часть мультимодального сообщения (формат OpenAI-совместимый, TZ-11 §4.4).
 *
 * `text` идёт в content-part без обёртки, `image_url` — картинка. Политика
 * провайдера по изображению (base64 data-URL против отдельного URL) решается
 * на стороне провайдера, наружу отдаём только `{ url }`.
 */
export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } };

/**
 * Контент сообщения: строка ИЛИ массив content-part.
 *
 * Обратная совместимость — главное свойство этого типа: весь существующий код
 * (worksheet-gen, exam-gen, validate) передаёт строку и не должен сломаться.
 * Строка остаётся валидным значением, поэтому менять вызывающий код не нужно.
 * Для мультимодальных задач (photo-check) собирается массив частей.
 */
export type LLMContent = string | LLMContentPart[];

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: LLMContent;
}

/** Есть ли в сообщении хотя бы одна картинка. */
export function hasImagePart(content: LLMContent): boolean {
  return Array.isArray(content) && content.some((p) => p.type === "image_url");
}

/**
 * Вытащить весь текст из контента — для логов, подсчёта токенов и провайдеров,
 * которые умеют только строку (Anthropic требует `system` отдельной строкой).
 * Текстовые части склеиваются переводом строки, картинки игнорируются.
 */
export function contentToText(content: LLMContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<LLMContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
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
  /**
   * ФАКТИЧЕСКОЕ списание в рублях, если провайдер его отдаёт.
   *
   * polza.ai в каждом ответе кладёт `usage.cost_rub` — «готовая стоимость в
   * рублях, уже списанная» (https://polza.ai/docs/osobennosti/usage). Это факт
   * со стороны провайдера, тогда как `costUsd` выше — наш расчёт по прайсу,
   * зашитому в `llm/config.ts`. Две разные цифры, и обе нужны: расхождение
   * между ними и есть сигнал, что прайс устарел.
   *
   * null/undefined у провайдеров, которые такого поля не отдают (OpenAI,
   * Anthropic, DeepSeek напрямую). В этом случае падать нельзя — работаем на
   * расчёте по прайсу.
   */
  costRub?: number | null;
  latencyMs: number;
  /** True, если провайдер явно сообщил, что ответ взят из кэша (на уровне провайдера). */
  cached: boolean;
  /**
   * Почему провайдер остановил генерацию (ТЗ-25, разрыв 4).
   *
   * ⚠️ `length` = ответ ОБОРВАН по потолку токенов. Такой ответ неполон, и
   * раньше он уходил вверх как обычный успех: у русскоязычного предмета его
   * ловил JSON-парсер (обрезанный JSON не парсится → InternalError), а у
   * иностранных предметов `language-guard` пропускает текст всегда, и обрыв
   * проходил как нормальный результат. Теперь причина есть в ответе провайдера,
   * и конвейер может сказать об этом прямо.
   *
   * `null`/`undefined` = провайдер не сообщил. Это НЕ значит «ответ целый» —
   * отсутствие причины нельзя читать как разрешение пройти.
   */
  finishReason?: string | null;
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

/**
 * Тип генерации — что именно делаем через LLM.
 *
 * ПРОМЫШЛЕННО РАЗДЕЛЕНО НА ДВА УРОВНЯ (2026-10-02):
 *   * `worksheet-gen` / `exam-gen` / … — продуктовые задачи. По ним роутер
 *     выбирает модель ПО СЛОЖНОСТИ (router.ts).
 *   * `validate` / `embed` / `photo-check` — служебные вызовы,
 *     у каждого своя фиксированная модель, тариф на них не влияет.
 */
export type GenerationKind =
  // ── продуктовые задачи ──
  | "worksheet-gen" // рабочий лист (домашка, карточка, раздаточный)
  | "control-gen" // контрольная, 2 варианта
  | "test-gen" // тест с автопроверкой
  | "cards-gen" // карточки для запоминания
  | "lesson-plan-gen" // план урока по ФГОС
  | "presentation-gen" // презентация (PPTX)
  | "ktp-gen" // календарно-тематическое планирование на год
  | "exam-gen" // вариант ОГЭ/ЕГЭ
  // ── служебные вызовы ──
  | "validate" // пост-валидация (DeepSeek)
  | "embed" // embeddings для поиска/дедупликации
  | "photo-check" // распознавание фото работы по эталону (vision, TZ-11)
  // Сверка короткого ответа ученика с эталоном (лист 3.1.2). Служебный вызов:
  // это не генерация материала, а проверка, поэтому тариф на модель не влияет.
  | "short-answer-check"
  // Схема графика для задания (лист 2.1.8). Служебный вызов: короткий, дешёвый,
  // и только когда задание текстом просит картинку — на остальных листах он
  // не вызывается вовсе и токенов не стоит.
  | "svg-graph-gen";
// ТЗ-30 AD-4: `image-gen` убран. Провайдера генерации изображений нет, роут
// отдавал 503, а кнопка в конструкторе обещала картинку. Использования в
// боевой базе нет (см. комментарий в router.ts, ARTIFACT_TASK).

/**
 * Продуктовый тип артефакта — зеркало фронтового `TaskType`
 * (`src/lib/types.ts` в корне репозитория).
 *
 * Дублируем строкой, а не импортом: бэк — отдельный npm-проект и не видит
 * файлы фронта. Сверка строк между проектами закрыта тестом
 * `tests/unit/router.test.ts` (список типов обязан совпадать).
 */
export type ArtifactType =
  | "worksheet"
  | "test"
  | "cards"
  | "control"
  | "lesson-plan"
  | "presentation"
  | "ktp"
  | "oge"
  | "ege"
  | "materials"
  | "lesson-bundle"
  | "interactive";
// ТЗ-30 AD-4: тип `image` убран — см. ARTIFACT_TASK в router.ts.

/** Тариф юзера. Влияет на НОРМУ и на право на премиум-типы, но НЕ на выбор модели. */
export type Plan = "free" | "base" | "standard" | "plus";

/** Pick провайдера+модели (или null — не реализовано). */
export interface ProviderPick {
  provider: ProviderId;
  model: string;
}

export interface RoutingDecision {
  primary: ProviderPick | null; // null = ничего не подключено (например, провайдер выключен)
  fallbacks: ProviderPick[];
  generation: "primary" | "boost" | "premium";
}

// Re-export provider id from config to avoid circular import pain at call site.
import type { ProviderId } from "./config";

/**
 * OpenAI provider — также проксирует OpenRouter (для РФ).
 *
 * Если в env есть только `OPENROUTER_API_KEY` (без `OPENAI_API_KEY`) —
 * используем OpenRouter как baseURL. Так юзер из РФ может работать с одним
 * ключом от OpenRouter на все модели OpenAI (см. docs/02-llm-architecture.md
 * Section 5).
 *
 * Поддерживает:
 *   * Chat completions (gpt-6-luna, gpt-6-sol).
 *   * Embeddings (text-embedding-3-large) через отдельный helper.
 *   * JSON-mode через response_format.
 */

import OpenAI from "openai";
import { getBaseUrl, ENV_KEYS } from "../config";
import { calcCost } from "../cost";
import { InternalError } from "../../lib/errors";
import { logLlmEvent } from "../log";
import type { Env } from "../../env";
import type { LLMResponse, Provider } from "../types";
import { contentToText } from "../types";

interface OpenAIProviderState {
  client: OpenAI;
  /** "openai" или "openrouter" — для логов и метрик. */
  actualProvider: "openai" | "openrouter";
}

let cached: OpenAIProviderState | null = null;

/** Какой реально провайдер под капотом (openai vs openrouter). */
export type OpenAIProviderKind = "openai" | "openrouter";

/** Сбросить singleton (для тестов). */
export function _resetOpenAISingleton(): void {
  cached = null;
}

/** Получить state напрямую (для embeddings и тестов). */
export function getOpenAIState(env: Env): OpenAIProviderState {
  if (!cached) {
    cached = createOpenAIProvider(env);
  }
  return cached;
}

/**
 * Получить OpenAI-совместимый провайдер как LLM-Provider.
 *
 * Бросает InternalError с понятным сообщением, если ключа нет.
 */
export function getOpenAIProvider(env: Env): Provider {
  const state = getOpenAIState(env);

  return {
    id: state.actualProvider,
    name: state.actualProvider === "openai" ? "OpenAI" : "OpenRouter (OpenAI-compat)",
    async complete(req, _env, opts): Promise<LLMResponse> {
      void _env;
      const start = Date.now();

      // `LLMContent` = строка | массив частей. OpenAI-совместимый chat API в
      // этой ветке принимает только строку, поэтому приводим через
      // contentToText — так же, как это делает anthropic.ts. Задачи с картинкой
      // (photo-check) идут через polza, у которого свой путь сборки частей.
      // `role` приводим к union из трёх значений и переносим в `messages`
      // как `ChatCompletionMessageParam[]`. Без явного `as` TypeScript не может
      // связать `content: string` с конкретной веткой объединения по `role`
      // (у assistant-сообщения content — только строка, у system — тоже),
      // и ошибка вылезает как «not assignable to ChatCompletionMessageParam».
      const messages = req.messages.map((m) => ({
        role: m.role,
        content: contentToText(m.content),
      })) as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: req.model,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
      };

      if (req.responseFormat === "json") {
        body.response_format = { type: "json_object" };
      }

      const headers: Record<string, string> = {};
      if (state.actualProvider === "openrouter" && req.cacheSystemPrompt) {
        headers["X-Title"] = "uchlist-ai";
      }

      try {
        const response = await state.client.chat.completions.create(body, {
          ...(opts?.signal ? { signal: opts.signal } : {}),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        });
        const latencyMs = Date.now() - start;

        const content = response.choices?.[0]?.message?.content ?? "";
        const tokensIn = response.usage?.prompt_tokens ?? 0;
        const tokensOut = response.usage?.completion_tokens ?? 0;
        const costUsd = calcCost(req.model, tokensIn, tokensOut);

        if (!content) {
          throw new Error("OpenAI returned empty content");
        }

        return {
          content,
          tokensIn,
          tokensOut,
          costUsd,
          latencyMs,
          cached: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logLlmEvent("error", "openai.complete failed", {
          model: req.model,
          provider: state.actualProvider,
          error: msg.slice(0, 500),
        });
        throw new InternalError(
          `LLM provider (${state.actualProvider}) failed: ${msg}`,
          {
            provider: state.actualProvider,
            model: req.model,
          },
        );
      }
    },
  };
}

function createOpenAIProvider(env: Env): OpenAIProviderState {
  // Приоритет: прямой OpenAI → OpenRouter.
  if (env.OPENAI_API_KEY) {
    const apiKey = env.OPENAI_API_KEY;
    const client = new OpenAI({
      apiKey,
      baseURL: getBaseUrl(env, "openai"),
    });
    return { client, actualProvider: "openai" };
  }

  if (env.OPENROUTER_API_KEY) {
    const apiKey = env.OPENROUTER_API_KEY;
    const client = new OpenAI({
      apiKey,
      baseURL: getBaseUrl(env, "openrouter"),
      defaultHeaders: {
        // OpenRouter требует identifying headers (можно отключить, но лучше честно).
        // Фолбэк раньше был на uchlist.ai / rabochielisty.ai — оба домена не
        // резолвятся, OpenRouter их отбраковывал. Ставим рабочий uchlist.ru.
        "HTTP-Referer": env.FRONTEND_URL || "https://uchlist.ru",
        "X-Title": "УчЛист",
      },
    });
    return { client, actualProvider: "openrouter" };
  }

  throw new InternalError(
    `Provider 'openai' not configured (${ENV_KEYS.openai} or ${ENV_KEYS.openrouter} missing)`,
  );
}

/**
 * Embeddings через OpenAI (text-embedding-3-large) или OpenRouter.
 * Не входит в Provider-complete API — отдельный путь, потому что API другой.
 */
export async function callOpenAIEmbedding(
  texts: string[],
  model: string,
  env: Env,
): Promise<{ vectors: number[][]; inputTokens: number; costUsd: number }> {
  const state = getOpenAIState(env);

  const start = Date.now();
  try {
    const response = await state.client.embeddings.create({
      model,
      input: texts,
    });
    const latencyMs = Date.now() - start;
    const vectors = response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const costUsd = calcCost(model, inputTokens, 0);
    logLlmEvent("info", "embeddings ok", {
      provider: state.actualProvider,
      model,
      count: texts.length,
      inputTokens,
      costUsd,
      latencyMs,
    });
    return { vectors, inputTokens, costUsd };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InternalError(`Embeddings failed: ${msg}`, {
      provider: state.actualProvider,
      model,
    });
  }
}

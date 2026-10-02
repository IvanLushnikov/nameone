/**
 * Polza.ai provider — заглушка.
 *
 * Polza — primary провайдер для РФ (юрлица, ФЗ-152, ₽), OpenAI-совместимый API
 * (см. llm/config.ts, docs/02-llm-architecture.md). Файл был удалён, импорты
 * остались — этот stub восстанавливает API чтобы билд прошёл и существующие
 * вызовы не падали в module-not-found.
 *
 * Что stub делает:
 *   * getPolzaProvider() — возвращает провайдер, который вызывает polza через
 *     OpenAI-совместимый /chat/completions с POLZA_API_KEY.
 *   * callPolzaEmbedding() — отдельный helper для embeddings через
 *     /embeddings. Поддержка text-embedding-3-large.
 *
 * Что нужно сделать дальше (отдельная задача):
 *   1. Добавить покрытие тестами: поднять mock-сервер polza и прогнать
 *      generateWorksheet через эту реализацию.
 *   2. Добавить retry / circuit breaker (как у openai.ts).
 *   3. Перенести тарифы из llm/config.ts в llm/cost.ts, чтобы они применялись
 *      и в провайдере, а не только в роутере.
 */

import { InternalError } from "../../lib/errors";
import { calcCost } from "../cost";
import { getBaseUrl } from "../config";
import { logLlmEvent } from "../log";
import type { Env } from "../../env";
import type { LLMResponse, Provider } from "../types";

interface PolzaProviderState {
  baseUrl: string;
  apiKey: string;
}

let cached: PolzaProviderState | null = null;

export function _resetPolzaSingleton(): void {
  cached = null;
}

function getState(env: Env): PolzaProviderState {
  if (cached) return cached;
  const apiKey = env.POLZA_API_KEY;
  if (!apiKey) {
    throw new InternalError("POLZA_API_KEY не задан — polza-провайдер недоступен");
  }
  // baseUrl берём через getBaseUrl(env, "polza"): в типе Env есть только
  // POLZA_API_KEY, поля POLZA_BASE_URL не существует. Раньше здесь стояло
  // env.POLZA_BASE_URL — файл не компилировался.
  const baseUrl = getBaseUrl(env, "polza");
  cached = { baseUrl, apiKey };
  return cached;
}

export function getPolzaProvider(env: Env): Provider {
  const state = getState(env);

  return {
    id: "polza",
    name: "Polza.ai (OpenAI-compat)",
    async complete(args, _env, _opts): Promise<LLMResponse> {
      void _env;
      const body: Record<string, unknown> = {
        model: args.model,
        // TZ-11 §4.4: content может быть строкой (все существующие задачи) или
        // массивом content-part с картинкой (photo-check). Провайдер polza
        // OpenAI-совместимый, поэтому массив уходит без преобразований —
        // ровно в том формате, который ждёт /chat/completions.
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: args.maxTokens ?? 4096,
        temperature: args.temperature ?? 0.7,
      };
      if (args.responseFormat === "json") body.response_format = { type: "json_object" };

      const start = Date.now();
      let res: Response;
      try {
        res = await fetch(`${state.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logLlmEvent("error", "polza network error", {
          provider: "polza",
          model: args.model,
          error: msg,
          latencyMs: Date.now() - start,
        });
        throw new InternalError(`polza network error: ${msg}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logLlmEvent("error", `polza HTTP ${res.status}`, {
          provider: "polza",
          model: args.model,
          error: text.slice(0, 200),
          latencyMs: Date.now() - start,
        });
        throw new InternalError(`polza HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
        model?: string;
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;
      const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const latencyMs = Date.now() - start;

      // Ключевой момент: тариф берём по ID модели из MODEL_CATALOG, а не по
      // имени провайдера. Раньше здесь было calcCost("polza", model, ...) —
      // первый аргумент попадал в параметр `model`, MODEL_COSTS["polza"]
      // не существует, и ВСЕ вызовы polza тарифицировались как 0 USD.
      // Подробности: docs/tz/11-photo-check.md §2.5 (расхождение №2).
      const costUsd = calcCost(args.model, tokensIn, tokensOut);

      logLlmEvent("info", "polza.complete ok", {
        provider: "polza",
        model: data.model ?? args.model,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        costUsd,
        latencyMs,
      });

      if (!content) {
        throw new InternalError("polza вернул пустой content");
      }

      return {
        content,
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs,
        cached: cachedTokens > 0,
        raw: data,
      };
    },
  };
}

/**
 * Embeddings через polza.ai (OpenAI-совместимый /embeddings endpoint).
 *
 * Используется для text-embedding-3-large и qwen/qwen3-embedding-8b (см. config.ts).
 */
export async function callPolzaEmbedding(args: {
  env: Env;
  model: string; // например "openai/text-embedding-3-large"
  input: string[];
}): Promise<{ vectors: number[][]; model: string; costUsd: number }> {
  const state = getState(args.env);
  const start = Date.now();

  const res = await fetch(`${state.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.apiKey}`,
    },
    body: JSON.stringify({ model: args.model, input: args.input }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logLlmEvent("error", `polza embed HTTP ${res.status}`, {
      provider: "polza",
      model: args.model,
      error: text.slice(0, 200),
      latencyMs: Date.now() - start,
    });
    throw new InternalError(`polza embed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    model?: string;
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  const vectors = (data.data ?? []).map((d) => d.embedding);
  const totalTokens = data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0;
  // Раньше было calcCost("polza", args.model, totalTokens, 0) — 4 аргумента
  // против сигнатуры (model, tokensIn, tokensOut, opts). "polza" уезжал в
  // параметр model, MODEL_COSTS["polza"] не существует → 0 USD.
  const costUsd = calcCost(args.model, totalTokens, 0);

  return { vectors, model: data.model ?? args.model, costUsd };
}
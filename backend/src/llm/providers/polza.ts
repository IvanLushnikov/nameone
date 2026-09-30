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
import { logLlmEvent } from "../log";
import type { Env } from "../../env";
import type { LLMResponse, Provider } from "../types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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
  const baseUrl = env.POLZA_BASE_URL ?? "https://polza.ai/api/v1";
  cached = { baseUrl, apiKey };
  return cached;
}

export function getPolzaProvider(env: Env): Provider {
  const state = getState(env);

  return {
    id: "polza",
    async complete(args: {
      model: string;
      messages: ChatCompletionMessageParam[];
      maxTokens: number;
      temperature?: number;
      jsonMode?: boolean;
    }): Promise<LLMResponse> {
      const body: Record<string, unknown> = {
        model: args.model,
        messages: args.messages,
        max_tokens: args.maxTokens,
      };
      if (args.temperature !== undefined) body.temperature = args.temperature;
      if (args.jsonMode) body.response_format = { type: "json_object" };

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
        logLlmEvent({
          env,
          provider: "polza",
          model: args.model,
          status: "network_error",
          error: msg,
          latencyMs: Date.now() - start,
        });
        throw new InternalError(`polza network error: ${msg}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logLlmEvent({
          env,
          provider: "polza",
          model: args.model,
          status: "http_error",
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
          latencyMs: Date.now() - start,
        });
        throw new InternalError(`polza HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        model?: string;
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      const usage = {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
        total: data.usage?.total_tokens ?? 0,
      };
      const costUsd = calcCost("polza", args.model, usage.input, usage.output);

      logLlmEvent({
        env,
        provider: "polza",
        model: data.model ?? args.model,
        status: "ok",
        inputTokens: usage.input,
        outputTokens: usage.output,
        costUsd,
        latencyMs: Date.now() - start,
      });

      return {
        content,
        model: data.model ?? args.model,
        usage,
        costUsd,
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
    logLlmEvent({
      env: args.env,
      provider: "polza",
      model: args.model,
      status: "http_error",
      error: `embed HTTP ${res.status}: ${text.slice(0, 200)}`,
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
  const costUsd = calcCost("polza", args.model, totalTokens, 0);

  return { vectors, model: data.model ?? args.model, costUsd };
}
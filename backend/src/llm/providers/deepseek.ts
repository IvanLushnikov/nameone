/**
 * DeepSeek provider — для валидатора (deepseek-v4-flash).
 *
 * DeepSeek использует OpenAI-совместимое API, поэтому переиспользуем
 * `openai`-клиент с другим baseURL и ключом. Provider.complete — отдельный
 * (не merge с OpenAI provider), потому что routing обращается к нему
 * независимо: ошибка валидатора не должна fallback'ить на генератор.
 */

import OpenAI from "openai";
import { getBaseUrl, ENV_KEYS } from "../config";
import { calcCost } from "../cost";
import { InternalError } from "../../lib/errors";
import { logLlmEvent } from "../log";
import type { Env } from "../../env";
import type { LLMResponse, Provider } from "../types";
import { contentToText } from "../types";

let cachedClient: OpenAI | null = null;

export function _resetDeepSeekSingleton(): void {
  cachedClient = null;
}

function getClient(env: Env): OpenAI {
  if (!cachedClient) {
    if (!env.DEEPSEEK_API_KEY) {
      throw new InternalError(
        `Provider 'deepseek' not configured (${ENV_KEYS.deepseek} missing)`,
      );
    }
    cachedClient = new OpenAI({
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: getBaseUrl(env, "deepseek"),
    });
  }
  return cachedClient;
}

export function getDeepSeekProvider(env: Env): Provider {
  const client = getClient(env);

  return {
    id: "deepseek",
    name: "DeepSeek",
    async complete(req, _env, opts): Promise<LLMResponse> {
      void _env;
      const start = Date.now();

      // Как и в openai.ts: `role` не сужается до конкретной ветки
      // `ChatCompletionMessageParam` автоматически, а `LLMContent` — это
      // строка | массив частей, тогда как chat API ждёт строку. Поэтому
      // приводим контент через contentToText (тот же паттерн, что в
      // anthropic.ts), а массив — точечным кастом по `role`.
      const messages = req.messages.map((m) => ({
        role: m.role,
        content: contentToText(m.content),
      })) as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: req.model,
        messages,
        // Валидатор любит низкую температуру для детерминированности.
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 2048,
      };
      if (req.responseFormat === "json") {
        body.response_format = { type: "json_object" };
      }

      try {
        const response = await client.chat.completions.create(body, {
          ...(opts?.signal ? { signal: opts.signal } : {}),
        });
        const latencyMs = Date.now() - start;

        const content = response.choices?.[0]?.message?.content ?? "";
        const tokensIn = response.usage?.prompt_tokens ?? 0;
        const tokensOut = response.usage?.completion_tokens ?? 0;
        const costUsd = calcCost(req.model, tokensIn, tokensOut);

        if (!content) {
          throw new Error("DeepSeek returned empty content");
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
        logLlmEvent("error", "deepseek.complete failed", {
          model: req.model,
          error: msg.slice(0, 500),
        });
        throw new InternalError(`LLM provider (deepseek) failed: ${msg}`, {
          provider: "deepseek",
          model: req.model,
        });
      }
    },
  };
}

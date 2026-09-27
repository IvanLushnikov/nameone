/**
 * Anthropic provider — Claude Opus 5.5 с prompt caching.
 *
 * Prompt caching включается на system-блоке через cache_control: ephemeral.
 * Anthropic возвращает usage.cache_creation_input_tokens и
 * usage.cache_read_input_tokens — учитываем их в стоимости (cache_read
 * по тарифу $0.20 / 1M вместо $4 / 1M).
 *
 * ВАЖНО: Anthropic API требует `system` ОТДЕЛЬНЫМ полем, не в messages.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getBaseUrl, ENV_KEYS } from "../config";
import { calcCost } from "../cost";
import { InternalError } from "../../lib/errors";
import { logLlmEvent } from "../log";
import type { Env } from "../../env";
import type { LLMResponse, Provider } from "../types";

let cachedClient: Anthropic | null = null;

export function _resetAnthropicSingleton(): void {
  cachedClient = null;
}

function getClient(env: Env): Anthropic {
  if (!cachedClient) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new InternalError(
        `Provider 'anthropic' not configured (${ENV_KEYS.anthropic} missing)`,
      );
    }
    cachedClient = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: getBaseUrl(env, "anthropic"),
    });
  }
  return cachedClient;
}

export function getAnthropicProvider(env: Env): Provider {
  const client = getClient(env);

  return {
    id: "anthropic",
    name: "Anthropic (Claude)",
    async complete(req, _env, opts): Promise<LLMResponse> {
      void _env;
      // Anthropic требует system отдельным полем. Достаём из messages[0].
      let systemText: string | undefined;
      let chatMessages: { role: "user" | "assistant"; content: string }[];

      const first = req.messages[0];
      if (first && first.role === "system") {
        systemText = first.content;
        chatMessages = req.messages.slice(1).map((m) => ({
          role: m.role === "system" ? "user" : m.role, // safety: остальные system не должны попасть
          content: m.content,
        }));
      } else {
        chatMessages = req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      }

      // Система с prompt cache (только если cacheSystemPrompt === true).
      const useCache = req.cacheSystemPrompt === true && !!systemText;
      const systemBlocks: Anthropic.Messages.TextBlockParam[] = systemText
        ? [
            {
              type: "text",
              text: systemText,
              ...(useCache
                ? { cache_control: { type: "ephemeral" as const } }
                : {}),
            },
          ]
        : [];

      const body: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
        ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
        messages: chatMessages,
        ...(useCache ? { extra_headers: { "anthropic-beta": "prompt-caching-2024-07-31" } } : {}),
      };

      // Для JSON — даём hint в последнем user message (Anthropic не имеет JSON-mode).
      if (req.responseFormat === "json" && chatMessages.length > 0) {
        const last = chatMessages[chatMessages.length - 1];
        if (last && last.role === "user") {
          last.content =
            `${last.content}\n\nОтвет верни строго в формате JSON без markdown-обёрток. Только один объект JSON начиная с { и заканчивая }.`;
        }
      }

      const start = Date.now();
      try {
        const response = await client.messages.create(body, {
          ...(opts?.signal ? { signal: opts.signal } : {}),
        });
        const latencyMs = Date.now() - start;

        // Берём первый text-блок.
        const textBlock = response.content.find(
          (b): b is Anthropic.Messages.TextBlock => b.type === "text",
        );
        const content = textBlock?.text ?? "";
        const tokensIn = response.usage.input_tokens ?? 0;
        const tokensOut = response.usage.output_tokens ?? 0;
        const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
        const cacheWriteTokens = response.usage.cache_creation_input_tokens ?? 0;

        const costUsd = calcCost(req.model, tokensIn, tokensOut, {
          cacheRead: cacheReadTokens,
          cacheWrite: cacheWriteTokens,
        });

        if (!content) {
          throw new Error("Anthropic returned empty content");
        }

        return {
          content,
          tokensIn,
          tokensOut,
          cacheReadTokens,
          cacheWriteTokens,
          costUsd,
          latencyMs,
          cached: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logLlmEvent("error", "anthropic.complete failed", {
          model: req.model,
          error: msg.slice(0, 500),
        });
        throw new InternalError(`LLM provider (anthropic) failed: ${msg}`, {
          provider: "anthropic",
          model: req.model,
        });
      }
    },
  };
}

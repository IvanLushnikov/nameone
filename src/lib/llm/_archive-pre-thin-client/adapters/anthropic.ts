/**
 * Anthropic-адаптер: Claude Opus 5.5.
 * Поддерживает prompt caching (cache_control на system-блоке).
 */

import type { LlmCallArgs, LlmCallResult } from "../types";
import { MODELS, PROVIDER_BASE_URLS, ENV_KEYS, calcCostUsd } from "../config";

export function isAnthropicAvailable(): boolean {
  return !!process.env[ENV_KEYS.anthropic];
}

interface AnthropicResponse {
  id: string;
  content: { type: "text"; text: string }[];
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export async function callAnthropic(args: LlmCallArgs, opts: { useCache: boolean } = { useCache: true }): Promise<LlmCallResult> {
  const apiKey = process.env[ENV_KEYS.anthropic];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY не задан в env");

  const spec = MODELS[args.model];
  if (spec.provider !== "anthropic") throw new Error(`Модель ${args.model} не от Anthropic`);

  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? PROVIDER_BASE_URLS.anthropic;

  // System prompt с cache_control (если включено).
  const systemBlocks: unknown[] = opts.useCache
    ? [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }]
    : [{ type: "text", text: args.system }];

  // Для JSON-ответа просим модель вернуть только JSON.
  let userMessage = args.user;
  if (args.responseFormat) {
    userMessage += "\n\nОтвет строго в формате JSON, без пояснений вокруг. Никакого markdown.";
  }

  const body: Record<string, unknown> = {
    model: spec.apiName,
    max_tokens: args.maxTokens ?? 4096,
    temperature: args.temperature ?? 0.7,
    system: systemBlocks,
    messages: [{ role: "user", content: userMessage }],
  };

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Anthropic ${spec.apiName} ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const content = data.content?.[0]?.text ?? "";
  const inTok = data.usage.input_tokens ?? 0;
  const outTok = data.usage.output_tokens ?? 0;
  const cachedIn = data.usage.cache_read_input_tokens ?? 0;

  let parsed: unknown | undefined;
  if (args.responseFormat) {
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
      } catch {
        parsed = undefined;
      }
    }
  }

  return {
    model: args.model,
    content,
    parsed,
    usage: { inputTokens: inTok, outputTokens: outTok, cachedInputTokens: cachedIn },
    latencyMs,
    costUsd: calcCostUsd(args.model, inTok, outTok, cachedIn),
  };
}

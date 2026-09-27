/**
 * DeepSeek-адаптер: V4 Flash. OpenAI-compatible API.
 */

import type { LlmCallArgs, LlmCallResult } from "../types";
import { MODELS, PROVIDER_BASE_URLS, ENV_KEYS, calcCostUsd } from "../config";

export function isDeepSeekAvailable(): boolean {
  return !!process.env[ENV_KEYS.deepseek];
}

export async function callDeepSeek(args: LlmCallArgs): Promise<LlmCallResult> {
  const apiKey = process.env[ENV_KEYS.deepseek];
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY не задан в env");

  const spec = MODELS[args.model];
  if (spec.provider !== "deepseek") throw new Error(`Модель ${args.model} не от DeepSeek`);

  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? PROVIDER_BASE_URLS.deepseek;

  const body: Record<string, unknown> = {
    model: spec.apiName,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    temperature: args.temperature ?? 0.5, // для валидации — ниже
    max_tokens: args.maxTokens ?? 4096,
  };

  if (args.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
    throw new Error(`DeepSeek ${spec.apiName} ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices: { message: { role: "assistant"; content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  const inTok = data.usage?.prompt_tokens ?? 0;
  const outTok = data.usage?.completion_tokens ?? 0;

  let parsed: unknown | undefined;
  if (args.responseFormat) {
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = undefined;
    }
  }

  return {
    model: args.model,
    content,
    parsed,
    usage: { inputTokens: inTok, outputTokens: outTok },
    latencyMs,
    costUsd: calcCostUsd(args.model, inTok, outTok),
  };
}

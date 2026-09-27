/**
 * OpenAI-адаптер: GPT-6 Luna, GPT-6 Sol, text-embedding-3-large.
 * Без SDK — чистый fetch для уменьшения зависимостей.
 */

import type { LlmCallArgs, LlmCallResult } from "../types";
import { MODELS, PROVIDER_BASE_URLS, ENV_KEYS, calcCostUsd } from "../config";

export function isOpenAIAvailable(): boolean {
  return !!process.env[ENV_KEYS.openai];
}

interface OpenAiChatResponse {
  id: string;
  choices: { message: { role: "assistant"; content: string }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function callOpenAi(args: LlmCallArgs): Promise<LlmCallResult> {
  const apiKey = process.env[ENV_KEYS.openai];
  if (!apiKey) throw new Error("OPENAI_API_KEY не задан в env");

  const spec = MODELS[args.model];
  if (spec.provider !== "openai") throw new Error(`Модель ${args.model} не от OpenAI`);

  const baseUrl = process.env.OPENAI_BASE_URL ?? PROVIDER_BASE_URLS.openai;

  const body: Record<string, unknown> = {
    model: spec.apiName,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 4096,
  };

  // Structured outputs: либо json_schema, либо просто json_object.
  if (args.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  } else if (args.responseFormat && typeof args.responseFormat === "object" && "schema" in args.responseFormat) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "WorksheetSchema",
        schema: args.responseFormat.schema,
        strict: true,
      },
    };
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
    const text = await response.text().catch(() => "(нет тела)");
    throw new Error(`OpenAI ${spec.apiName} ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as OpenAiChatResponse;
  const content = data.choices?.[0]?.message?.content ?? "";
  const inTok = data.usage?.prompt_tokens ?? 0;
  const outTok = data.usage?.completion_tokens ?? 0;

  let parsed: unknown | undefined;
  if (args.responseFormat) {
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = undefined; // не штрафуем — роутер сам решит, слать ли в fallback
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

interface OpenAiEmbedResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

export async function callOpenAiEmbedding(texts: string[], modelId: "text-embedding-3-large"): Promise<{
  vectors: number[][];
  inputTokens: number;
  costUsd: number;
}> {
  const apiKey = process.env[ENV_KEYS.openai];
  if (!apiKey) throw new Error("OPENAI_API_KEY не задан в env");
  const baseUrl = process.env.OPENAI_BASE_URL ?? PROVIDER_BASE_URLS.openai;

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, input: texts }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as OpenAiEmbedResponse;
  const vectors = data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const costUsd = calcCostUsd(modelId, inputTokens, 0);
  return { vectors, inputTokens, costUsd };
}

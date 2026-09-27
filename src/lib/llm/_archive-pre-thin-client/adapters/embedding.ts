/**
 * Embeddings: Qwen3 (DashScope, OpenAI-compatible) + OpenAI text-embedding-3-large.
 */

import { callOpenAiEmbedding } from "./openai";
import { ENV_KEYS } from "../config";
import type { EmbedResult, ModelId } from "../types";

export async function embed(texts: string[], model?: ModelId): Promise<EmbedResult> {
  const useModel = model ?? "qwen3-embedding-8b";

  // Qwen3 / DashScope — дефолт, если ключ есть.
  if (useModel === "qwen3-embedding-8b") {
    return embedDashScope(texts);
  }

  // OpenAI fallback.
  if (useModel === "text-embedding-3-large") {
    const r = await callOpenAiEmbedding(texts, "text-embedding-3-large");
    return {
      model: "text-embedding-3-large",
      vectors: r.vectors,
      usage: { inputTokens: r.inputTokens },
      costUsd: r.costUsd,
    };
  }

  throw new Error(`Неизвестная embedding-модель: ${useModel}`);
}

async function embedDashScope(texts: string[]): Promise<EmbedResult> {
  const apiKey = process.env[ENV_KEYS.dashscope];
  if (!apiKey) {
    // Фолбэк на OpenAI если DashScope ключа нет.
    return embed(texts, "text-embedding-3-large");
  }

  const baseUrl = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "qwen3-embedding-8b", input: texts }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`DashScope embeddings ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    data: { embedding: number[]; index: number }[];
    usage?: { input_tokens: number };
  };

  const vectors = data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  const inputTokens = data.usage?.input_tokens ?? 0;
  // DashScope pricing: примерно $0.05/1M (см. config.ts).
  const costUsd = 0.05 * (inputTokens / 1_000_000);

  return {
    model: "qwen3-embedding-8b",
    vectors,
    usage: { inputTokens },
    costUsd,
  };
}

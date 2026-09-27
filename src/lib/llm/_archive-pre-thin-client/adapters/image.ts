/**
 * Image generation: FLUX через Replicate (primary), Mercury 2.5 (fallback).
 *
 * На сентябрь 2026:
 * - FLUX.2-schnell через Replicate: ~$0.003/картинка, надёжный API, A4-friendly
 * - Mercury 2.5 (Inception): text-to-image на 785 tok/s, быстрее, но API менее стандартизован
 */

import type { ImageGenResult } from "../types";
import { calcCostUsd } from "../config";
import { MODELS } from "../config";

export function isImageGenAvailable(): boolean {
  return !!process.env.REPLICATE_API_TOKEN || !!process.env.INCEPTION_API_KEY;
}

interface ImageGenArgs {
  prompt: string;
  /** Negative prompt — что НЕ генерировать. */
  negative?: string;
  size?: { width: number; height: number };
  seed?: number;
}

/** Главная точка входа. Сам выберет провайдера по доступности. */
export async function generateImage(args: ImageGenArgs): Promise<ImageGenResult> {
  if (process.env.REPLICATE_API_TOKEN) {
    return generateViaReplicate(args);
  }
  if (process.env.INCEPTION_API_KEY) {
    return generateViaMercury(args);
  }
  throw new Error("Ни REPLICATE_API_TOKEN, ни INCEPTION_API_KEY не заданы — image-gen недоступен");
}

/** FLUX через Replicate. */
async function generateViaReplicate(args: ImageGenArgs): Promise<ImageGenResult> {
  const token = process.env.REPLICATE_API_TOKEN!;
  const size = args.size ?? { width: 1024, height: 1024 };

  // Версия модели фиксируем — иначе при обновлении модели результат «поплывёт».
  // FLUX.2-schnell, актуальная версия на сентябрь 2026.
  const modelVersion = process.env.REPLICATE_FLUX_VERSION ?? "black-forest-labs/flux-2-schnell:abc123";

  const start = Date.now();

  // Запускаем генерацию.
  const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      version: modelVersion.split(":")[1] ?? modelVersion,
      input: {
        prompt: args.prompt,
        negative_prompt: args.negative ?? "",
        width: size.width,
        height: size.height,
        num_outputs: 1,
        seed: args.seed,
      },
    }),
  });

  if (!createResponse.ok) {
    const text = await createResponse.text().catch(() => "");
    throw new Error(`Replicate create ${createResponse.status}: ${text.slice(0, 500)}`);
  }

  const prediction = (await createResponse.json()) as { id: string; urls: { get: string } };

  // Polling — Replicate работает асинхронно.
  const deadline = Date.now() + 60_000;
  let output: unknown[] | undefined;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    const pollResponse = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pollResponse.ok) continue;
    const status = (await pollResponse.json()) as { status: string; output?: unknown[]; error?: string };
    if (status.status === "succeeded") {
      output = status.output;
      break;
    }
    if (status.status === "failed") {
      throw new Error(`Replicate failed: ${status.error ?? "(unknown)"}`);
    }
  }

  if (!output || output.length === 0) {
    throw new Error("Replicate: пустой output / timeout");
  }

  const url = String(output[0]);
  const costUsd = 0.003; // FLUX schnell ~$0.003/изображение на сентябрь 2026
  return {
    provider: "replicate",
    model: "flux-2-schnell",
    url,
    width: size.width,
    height: size.height,
    costUsd,
    latencyMs: Date.now() - start,
  };
}

/** Mercury 2.5 через Inception. */
async function generateViaMercury(args: ImageGenArgs): Promise<ImageGenResult> {
  const key = process.env.INCEPTION_API_KEY!;
  const size = args.size ?? { width: 1024, height: 1024 };

  const start = Date.now();
  const response = await fetch("https://api.inception.ai/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "mercury-2-5",
      prompt: args.prompt,
      negative_prompt: args.negative,
      width: size.width,
      height: size.height,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Mercury ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as { data: { url: string }[] };
  const url = data.data[0]?.url;
  if (!url) throw new Error("Mercury: пустой output");

  const costUsd = calcCostUsd("mercury-2-5", args.prompt.length / 3, 0); // оценка через input-токены
  return {
    provider: "inception",
    model: "mercury-2-5",
    url,
    width: size.width,
    height: size.height,
    costUsd,
    latencyMs: Date.now() - start,
  };
}

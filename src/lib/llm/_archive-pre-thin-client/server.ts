/**
 * Server-side генерация: LLM → fallback на mock если ключей нет.
 *
 * Импортируется ТОЛЬКО из API routes (server), не из client.
 * В client import'ы должны идти через /api/...
 */

import "server-only";

import type { Worksheet, GenerationRequest, ExamVariant } from "@/lib/types";
import { generateWorksheet as mockGenerateWorksheet, generateExamVariant as mockGenerateExamVariant } from "@/lib/mock/generator";
import { generateAndValidate } from "./index";
import { availableModels } from "./router";
import type { UserPlan } from "./types";

export interface GenerationOutcome {
  worksheet?: Worksheet;
  variant?: ExamVariant;
  /** LLM был использован или mock (demo). */
  source: "llm" | "mock";
  /** Через какую модель сгенерировано (или "mock"). */
  model: string;
  costUsd: number;
  latencyMs: number;
}

/** Есть ли хоть одна работающая LLM-модель? */
export function hasLiveLlm(): boolean {
  return availableModels().length > 0;
}

/** Сгенерировать рабочий лист — LLM или mock, в зависимости от доступности ключей. */
export async function generateWorksheetSmart(
  request: GenerationRequest,
  plan: UserPlan = "free"
): Promise<GenerationOutcome> {
  const start = Date.now();
  if (hasLiveLlm()) {
    try {
      const r = await generateAndValidate({ request, plan });
      return finalize(r.worksheet, r.costUsd, start, "llm", r.totalLatencyMs);
    } catch (e) {
      // LLM упал — падаем на mock, чтобы UX не ломался.
      // eslint-disable-next-line no-console
      console.warn("[generate] LLM упал, fallback на mock:", String(e).slice(0, 200));
    }
  }

  // Fallback — mock.
  const ws = mockGenerateWorksheet(request);
  return finalize(ws, 0, start, "mock", Date.now() - start);
}

/** Сгенерировать экзаменационный вариант — пока только mock (LLM промпт для ЕГЭ ещё в работе). */
export function generateVariantSmart(
  exam: "oge" | "ege",
  subject: string,
  variantNumber: number
): GenerationOutcome {
  const start = Date.now();
  const variant = mockGenerateExamVariant(exam, subject, variantNumber);
  return { variant, source: "mock", model: "mock", costUsd: 0, latencyMs: Date.now() - start };
}

function finalize(
  worksheet: Worksheet,
  costUsd: number,
  start: number,
  source: "llm" | "mock",
  latencyMs: number
): GenerationOutcome {
  return {
    worksheet,
    source,
    model: source === "mock" ? "mock" : (worksheet as Worksheet & { _model?: string })._model ?? "unknown",
    costUsd,
    latencyMs,
  };
}

// чтобы TS не ругался на _model (опционально, для аналитики в meta):
declare module "@/lib/types" {
  interface Worksheet {
    _model?: string;
  }
}

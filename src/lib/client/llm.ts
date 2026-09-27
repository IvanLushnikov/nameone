/**
 * Клиентский wrapper для бэка РабочиеЛисты AI.
 *
 * Если бэк доступен и ключи у него настроены — идёт реальный LLM-вызов.
 * Если нет — fallback на mock (тот же, что был до LLM-слоя), UX не ломается.
 *
 * URL бэка: NEXT_PUBLIC_API_URL — опциональная переменная.
 * Без неё — сразу mock.
 */

import type { Worksheet, LessonPlan, Presentation, Ktp, GenerationRequest } from "@/lib/types";
import { generateWorksheet as mockWorksheet } from "@/lib/mock/generator";
import { generateLessonPlan as mockLessonPlan } from "@/lib/mock/lesson-plan";
import { generatePresentation as mockPresentation } from "@/lib/mock/presentation";
import { generateKtp as mockKtp } from "@/lib/mock/ktp";

interface ArtifactResult<T> {
  data: T;
  source: "llm" | "mock";
  isDemo: boolean;
  costUsd: number;
  latencyMs: number;
}

interface GenerateOpts {
  /** Имя эндпоинта бэка, например "worksheets" или "lesson-plans". */
  endpoint: string;
  /** Поле-результат в JSON ответа бэка ("worksheet" | "lessonPlan" | ...). */
  dataKey: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

async function callBackend<T>(
  path: string,
  body: unknown,
  dataKey: string,
): Promise<T | null> {
  if (!API_URL) return null;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return (data?.[dataKey] as T) ?? null;
  } catch {
    return null;
  }
}

async function wrapMock<T>(
  reason: string,
  fn: () => Promise<T>,
  startMs: number,
): Promise<ArtifactResult<T>> {
  console.info(`[client-llm] demo-режим (${reason})`);
  const data = await fn();
  return { data, source: "mock", isDemo: true, costUsd: 0, latencyMs: Date.now() - startMs };
}

async function smartGenerate<T>(
  req: GenerationRequest,
  opts: GenerateOpts,
  mockFn: () => Promise<T>,
): Promise<ArtifactResult<T>> {
  const start = Date.now();
  const remote = await callBackend<T>(`/api/${opts.endpoint}/generate`, { request: req }, opts.dataKey);
  if (remote) {
    return { data: remote, source: "llm", isDemo: false, costUsd: 0, latencyMs: Date.now() - start };
  }
  return wrapMock(`NEXT_PUBLIC_API_URL не задан или ${opts.endpoint}/generate недоступен`, mockFn, start);
}

export interface WorksheetClientResult {
  worksheet: Worksheet;
  source: "llm" | "mock";
  isDemo: boolean;
  costUsd: number;
  latencyMs: number;
}

export type LessonPlanClientResult = ArtifactResult<LessonPlan>;
export type PresentationClientResult = ArtifactResult<Presentation>;
export type KtpClientResult = ArtifactResult<Ktp>;

export async function generateWorksheetSmart(request: GenerationRequest): Promise<WorksheetClientResult> {
  const r = await smartGenerate<Worksheet>(request, { endpoint: "worksheets", dataKey: "worksheet" }, () => mockWorksheet(request));
  return { worksheet: r.data, source: r.source, isDemo: r.isDemo, costUsd: r.costUsd, latencyMs: r.latencyMs };
}

export async function generateLessonPlanSmart(request: GenerationRequest): Promise<LessonPlanClientResult> {
  return smartGenerate<LessonPlan>(request, { endpoint: "lesson-plans", dataKey: "lessonPlan" }, () => mockLessonPlan(request));
}

export async function generatePresentationSmart(request: GenerationRequest): Promise<PresentationClientResult> {
  return smartGenerate<Presentation>(request, { endpoint: "presentations", dataKey: "presentation" }, () => mockPresentation(request));
}

export async function generateKtpSmart(request: GenerationRequest): Promise<KtpClientResult> {
  return smartGenerate<Ktp>(request, { endpoint: "ktp", dataKey: "ktp" }, () => mockKtp(request));
}

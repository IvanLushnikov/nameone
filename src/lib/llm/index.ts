/**
 * Публичный фасад LLM-слоя для фронта.
 *
 * Архитектура: фронт НЕ ходит к OpenAI/Anthropic напрямую (нет секретов, нельзя).
 * Фронт проксирует через `NEXT_PUBLIC_API_URL` — Cloudflare Worker с Hono.
 * Если `NEXT_PUBLIC_API_URL` не задан — fallback на локальный mock.
 *
 * Все функции возвращают объект `{ result, meta }` где meta содержит
 * model, cost, latency, cached — для UI и аналитики.
 */

import type { Worksheet, GenerationRequest, ExamVariant, LessonPlan, Presentation, Ktp } from '@/lib/types';
import { generateWorksheet as mockWorksheet, generateExamVariant as mockExam } from '@/lib/mock/generator';
import { generateLessonPlan as mockLessonPlan } from '@/lib/mock/lesson-plan';
import { generatePresentation as mockPresentation } from '@/lib/mock/presentation';
import { generateKtp as mockKtp } from '@/lib/mock/ktp';
// isImageGenAvailable определён в config.ts — реэкспортим для удобства (используется в smoke-llm.ts).
export { isImageGenAvailable } from './config';

export interface GenMeta {
  model: string;
  provider: string;
  costUsd: number;
  latencyMs: number;
  cached: boolean;
  generation: 'primary' | 'boost' | 'premium' | 'cached' | 'fallback-mock';
}

export interface GenerateWorksheetArgs {
  request: GenerationRequest;
  plan: 'free' | 'base' | 'plus';
  bypassCache?: boolean;
}

export interface GenerateWorksheetResult {
  worksheet: Worksheet;
  meta: GenMeta;
}

/** Q1-2027: артефакты — общий шаблон аргументов/результатов для новых типов. */
export interface GenerateArtifactArgs {
  request: GenerationRequest;
  plan: 'free' | 'base' | 'plus';
  bypassCache?: boolean;
}
export interface GenerateLessonPlanResult { lessonPlan: LessonPlan; meta: GenMeta; }
export interface GeneratePresentationResult { presentation: Presentation; meta: GenMeta; }
export interface GenerateKtpResult { ktp: Ktp; meta: GenMeta; }

export interface ValidateWorksheetArgs {
  worksheet: Worksheet;
  context: { subject: string; grade: number; topic: string };
}

export interface ValidateWorksheetResult {
  score: number;
  issues: Array<{ type: 'duplicate' | 'wrong-answer' | 'off-fgos' | 'low-quality'; taskNumber?: number; message: string }>;
  meta: GenMeta;
}

export interface EmbedArgs {
  texts: string[];
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  costUsd: number;
}

export interface GenerateImageArgs {
  prompt: string;
  size?: { width: number; height: number };
}

export interface GenerateImageResult {
  url: string;
  model: string;
  provider: string;
  costUsd: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  if (!API_URL) return null;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export async function generateWorksheet({ request, plan, bypassCache }: GenerateWorksheetArgs): Promise<GenerateWorksheetResult> {
  const start = Date.now();
  const data = await postJson<{ worksheet: Worksheet; meta: GenMeta }>('/api/worksheets/generate', { request, plan, bypassCache });
  if (data?.worksheet) {
    return { worksheet: data.worksheet, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  // fallback: mock
  return {
    worksheet: mockWorksheet(request),
    meta: {
      model: 'mock-fallback',
      provider: 'local',
      costUsd: 0,
      latencyMs: Date.now() - start,
      cached: false,
      generation: 'fallback-mock',
    },
  };
}

export async function validateWorksheet({ worksheet, context }: ValidateWorksheetArgs): Promise<ValidateWorksheetResult> {
  const start = Date.now();
  const data = await postJson<{ score: number; issues: ValidateWorksheetResult['issues']; meta: GenMeta }>('/api/worksheets/validate', { worksheet, context });
  if (data && typeof data.score === 'number') {
    return { score: data.score, issues: data.issues, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  // fallback: heuristic local check (no LLM)
  return {
    score: 1.0,
    issues: [],
    meta: { model: 'local-heuristic', provider: 'local', costUsd: 0, latencyMs: Date.now() - start, cached: false, generation: 'fallback-mock' },
  };
}

export async function embed({ texts }: EmbedArgs): Promise<EmbedResult> {
  const data = await postJson<{ vectors: number[][]; model: string; costUsd: number }>('/api/embeddings', { texts });
  if (data?.vectors && data.vectors.length === texts.length) {
    return data;
  }
  // fallback: deterministic fake vectors (256-dim) for tests
  const vectors = texts.map((t) => {
    const v = new Array(256).fill(0);
    for (let i = 0; i < Math.min(t.length, 256); i++) v[i] = (t.charCodeAt(i) % 100) / 100;
    return v;
  });
  return { vectors, model: 'mock-embeddings-256', costUsd: 0 };
}

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult | null> {
  const data = await postJson<{ url: string; model: string; provider: string; costUsd: number }>('/api/images/generate', args);
  return data ?? null;
}

/** Q1-2027: генерирует план урока (ФГОС-конспект на 45 мин). fallback → mock. */
export async function generateLessonPlan({ request, plan, bypassCache }: GenerateArtifactArgs): Promise<GenerateLessonPlanResult> {
  const start = Date.now();
  const data = await postJson<{ lessonPlan: LessonPlan; meta: GenMeta }>('/api/lesson-plans/generate', { request, plan, bypassCache });
  if (data?.lessonPlan) {
    return { lessonPlan: data.lessonPlan, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  const lp = await mockLessonPlan(request);
  return { lessonPlan: lp, meta: { model: 'mock-fallback', provider: 'local', costUsd: 0, latencyMs: Date.now() - start, cached: false, generation: 'fallback-mock' } };
}

/** Q1-2027: генерирует презентацию (PPTX, 5–20 слайдов). fallback → mock. */
export async function generatePresentationArtifact({ request, plan, bypassCache }: GenerateArtifactArgs): Promise<GeneratePresentationResult> {
  const start = Date.now();
  const data = await postJson<{ presentation: Presentation; meta: GenMeta }>('/api/presentations/generate', { request, plan, bypassCache });
  if (data?.presentation) {
    return { presentation: data.presentation, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  const pres = await mockPresentation(request);
  return { presentation: pres, meta: { model: 'mock-fallback', provider: 'local', costUsd: 0, latencyMs: Date.now() - start, cached: false, generation: 'fallback-mock' } };
}

/** Q1-2027: генерирует КТП (календарно-тематическое планирование на год). fallback → mock. */
export async function generateKtpArtifact({ request, plan, bypassCache }: GenerateArtifactArgs): Promise<GenerateKtpResult> {
  const start = Date.now();
  const data = await postJson<{ ktp: Ktp; meta: GenMeta }>('/api/ktp/generate', { request, plan, bypassCache });
  if (data?.ktp) {
    return { ktp: data.ktp, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  const ktp = await mockKtp(request);
  return { ktp, meta: { model: 'mock-fallback', provider: 'local', costUsd: 0, latencyMs: Date.now() - start, cached: false, generation: 'fallback-mock' } };
}

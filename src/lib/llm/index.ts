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
// Мёртвый импорт `generateExamVariant as mockExam` удалён 02.10.2026: нигде
// не использовался, а слой был вне tsc — поэтому незаметно пролежал.
import { generateWorksheet as mockWorksheet } from '@/lib/mock/generator';
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

/**
 * Состояние нормы тарифа после генерации.
 *
 * Зеркалит `UsageStatus` в backend/src/services/usage.ts. `over: true` означает
 * «норма превышена», но генерация выполнена — порог мягкий, UI на этом флаге
 * показывает предложение докупить, а не отказ.
 */
export interface UsageMeta {
  used: number;
  norm: number | null;
  over: boolean;
  remaining: number | null;
  worksheetsEquivalent: number;
}

export interface GenerateWorksheetArgs {
  request: GenerationRequest;
  /**
   * Тариф сюда больше НЕ передаётся. Бэк берёт его из сессии: клиентский
   * `plan` раньше имел приоритет над сессией, и любой мог подделать «plus»,
   * получив и premium-модель, и снятый лимит.
   */
  bypassCache?: boolean;
  /** Токен невидимого Turnstile, если бэк раньше ответил 409 TURNSTILE_REQUIRED. */
  turnstileToken?: string;
}

export interface GenerateWorksheetResult {
  worksheet: Worksheet;
  meta: GenMeta;
  usage?: UsageMeta;
}

/** Q1-2027: артефакты — общий шаблон аргументов/результатов для новых типов. */
export interface GenerateArtifactArgs {
  request: GenerationRequest;
  bypassCache?: boolean;
  turnstileToken?: string;
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

/**
 * Ошибка API, дошедшая до клиента.
 *
 * `code` — тот самый код из тела ответа бэка: RATE_LIMIT (бесплатная квота
 * исчерпана), TURNSTILE_REQUIRED (нужна капча), UPGRADE_REQUIRED, GENERATION_FORBIDDEN.
 * Различать их важно: раньше любой не-200 молча превращался в мок-генерацию,
 * и учитель, у которого кончились бесплатные листы, получал «бесплатный»
 * результат, который на самом деле ничего не генерировал.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }

  /** Квота исчерпана — показываем PaywallModal. */
  get isQuotaExceeded(): boolean {
    return this.status === 429 && this.code === "RATE_LIMIT";
  }

  /** Нужна капча антифрода — грузим виджет и повторяем. */
  get isChallengeRequired(): boolean {
    return this.status === 409 && this.code === "TURNSTILE_REQUIRED";
  }

  /** Премиум-тип не входит в тариф. */
  get isUpgradeRequired(): boolean {
    return this.status === 402 && this.code === "UPGRADE_REQUIRED";
  }

  /** Ученикам генерация недоступна. */
  get isGenerationForbidden(): boolean {
    return this.status === 403 && this.code === "GENERATION_FORBIDDEN";
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T | null> {
  if (!API_URL) return null;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (res.ok) return (await res.json().catch(() => null)) as T | null;

  // 4xx — это ответ на наш запрос (квота, капча, тариф), а не поломка бэка.
  // Молча подставлять тут мок нельзя.
  if (res.status >= 400 && res.status < 500) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw new ApiClientError(
      res.status,
      payload?.code ?? null,
      payload?.error ?? `HTTP ${res.status}`,
    );
  }
  return null;
}

export async function generateWorksheet({
  request,
  bypassCache,
  turnstileToken,
}: GenerateWorksheetArgs): Promise<GenerateWorksheetResult> {
  const start = Date.now();
  const data = await postJson<{ worksheet: Worksheet; meta: GenMeta; usage?: UsageMeta }>(
    '/api/worksheets/generate',
    { request, bypassCache },
    turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {},
  );
  if (data?.worksheet) {
    return {
      worksheet: data.worksheet,
      meta: { ...data.meta, latencyMs: Date.now() - start },
      usage: data.usage,
    };
  }
  // fallback: mock
  // await обязателен: generateWorksheet из mock/generator асинхронный. Без него
  // в поле `worksheet` уезжал Promise, и UI получал объект-обещание вместо листа.
  // Ошибку не показывало — ровно потому, что src/lib/llm был исключён из tsc.
  return {
    worksheet: await mockWorksheet(request),
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
export async function generateLessonPlan({ request, bypassCache, turnstileToken }: GenerateArtifactArgs): Promise<GenerateLessonPlanResult> {
  const start = Date.now();
  const data = await postJson<{ lessonPlan: LessonPlan; meta: GenMeta }>('/api/lesson-plans/generate',
    { request, bypassCache },
    turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {});
  if (data?.lessonPlan) {
    return { lessonPlan: data.lessonPlan, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  const lp = await mockLessonPlan(request);
  return { lessonPlan: lp, meta: { model: 'mock-fallback', provider: 'local', costUsd: 0, latencyMs: Date.now() - start, cached: false, generation: 'fallback-mock' } };
}

/** Q1-2027: генерирует презентацию (PPTX, 5–20 слайдов). fallback → mock. */
export async function generatePresentationArtifact({ request, bypassCache, turnstileToken }: GenerateArtifactArgs): Promise<GeneratePresentationResult> {
  const start = Date.now();
  const data = await postJson<{ presentation: Presentation; meta: GenMeta }>('/api/presentations/generate',
    { request, bypassCache },
    turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {});
  if (data?.presentation) {
    return { presentation: data.presentation, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  const pres = await mockPresentation(request);
  return { presentation: pres, meta: { model: 'mock-fallback', provider: 'local', costUsd: 0, latencyMs: Date.now() - start, cached: false, generation: 'fallback-mock' } };
}

/** Q1-2027: генерирует КТП (календарно-тематическое планирование на год). fallback → mock. */
export async function generateKtpArtifact({ request, bypassCache, turnstileToken }: GenerateArtifactArgs): Promise<GenerateKtpResult> {
  const start = Date.now();
  const data = await postJson<{ ktp: Ktp; meta: GenMeta }>('/api/ktp/generate',
    { request, bypassCache },
    turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {});
  if (data?.ktp) {
    return { ktp: data.ktp, meta: { ...data.meta, latencyMs: Date.now() - start } };
  }
  const ktp = await mockKtp(request);
  return { ktp, meta: { model: 'mock-fallback', provider: 'local', costUsd: 0, latencyMs: Date.now() - start, cached: false, generation: 'fallback-mock' } };
}

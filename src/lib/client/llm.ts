/**
 * Клиентский wrapper для бэка УчЛист.
 *
 * Если бэк доступен и ключи у него настроены — идёт реальный LLM-вызов.
 * Если нет — fallback на mock (тот же, что был до LLM-слоя), UX не ломается.
 *
 * URL бэка: NEXT_PUBLIC_API_URL — опциональная переменная.
 * Без неё — сразу mock.
 */

import type {
  Worksheet,
  LessonPlan,
  Presentation,
  Ktp,
  CardSet,
  MaterialBundle,
  LessonBundle,
  GenerationRequest,
} from "@/lib/types";
import { generateWorksheet as mockWorksheet } from "@/lib/mock/generator";
import { generateLessonPlan as mockLessonPlan } from "@/lib/mock/lesson-plan";
import { generatePresentation as mockPresentation } from "@/lib/mock/presentation";
import { generateKtp as mockKtp } from "@/lib/mock/ktp";
import { mockCards } from "@/lib/mock/cards";
import { mockMaterials } from "@/lib/mock/materials";
import { mockLessonBundle } from "@/lib/mock/lesson-bundle";
import { passChallenge } from "@/lib/turnstile";

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

/**
 * Ошибка, дошедшая от бэка. Нужна, чтобы НЕ путать «квота кончилась» с
 * «бэк лежит»: раньше оба случая давали null, и учитель с исчерпанными
 * бесплатными листами получал мок-генерацию с формулировкой «демо-режим».
 */
export class BackendError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.code = code;
  }
  get isQuotaExceeded(): boolean {
    return this.status === 429 && this.code === "RATE_LIMIT";
  }
  get isChallengeRequired(): boolean {
    return this.status === 409 && this.code === "TURNSTILE_REQUIRED";
  }
  get isUpgradeRequired(): boolean {
    return this.status === 402 && this.code === "UPGRADE_REQUIRED";
  }
  get isGenerationForbidden(): boolean {
    return this.status === 403 && this.code === "GENERATION_FORBIDDEN";
  }
}

/**
 * Один запрос к бэку.
 *
 * null = «сервер не ответил или ответил не-2xx 5xx» → можно упасть в мок.
 * 4xx = это ОТВЕТ на наш запрос (квота, капча, тариф), и мок тут неуместен:
 * бросаем BackendError, чтобы вызывающий показал учителю внятное объяснение.
 */
async function callBackendOnce<T>(
  path: string,
  body: unknown,
  dataKey: string,
  turnstileToken?: string,
): Promise<T | null> {
  if (!API_URL) return null;
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
    },
    body: JSON.stringify(body),
    // Без cookie бэк не видит пользователя и считает его анонимом: платящий
    // учитель упирается в анонимный лимит, а вся школа за одним IP делит
    // одну квоту. Раньше здесь credentials не было — тариф на сервере не работал.
    credentials: "include",
    // Без таймаута зависшая сеть держит учителя на спиннере бесконечно.
    signal: AbortSignal.timeout(90_000),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return (data?.[dataKey] as T) ?? null;
  }
  if (res.status >= 400 && res.status < 500) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw new BackendError(res.status, payload?.code ?? null, payload?.error ?? `HTTP ${res.status}`);
  }
  return null;
}

/**
 * Запрос с автоматическим прохождением капчи.
 *
 * При 409 TURNSTILE_REQUIRED один раз показываем невидимый Turnstile и
 * повторяем тот же запрос с токеном. Не более одного повтора: если капча не
 * помогла, второй круг только замкнёт нагрузку на Cloudflare.
 */
async function callBackend<T>(
  path: string,
  body: unknown,
  dataKey: string,
): Promise<T | null> {
  try {
    return await callBackendOnce<T>(path, body, dataKey);
  } catch (e) {
    if (e instanceof BackendError && e.isChallengeRequired) {
      const token = await passChallenge();
      if (token) {
        return await callBackendOnce<T>(path, body, dataKey, token);
      }
      // Капча недоступна — fail-open, как и на бэке.
      return null;
    }
    throw e;
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
  // Здесь BackendError НЕ глотается. «Квота кончилась» и «этот тип не входит
  // в тариф» — это ответы пользователю (PaywallModal / предложение Плюс),
  // а не повод подсунуть мок. Мок — только когда бэка нет или он упал (5xx,
  // сеть), то есть когда настоящую генерацию получить нечем.
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
export type CardsClientResult = ArtifactResult<CardSet>;
export type MaterialsClientResult = ArtifactResult<MaterialBundle>;
export type BundleClientResult = ArtifactResult<LessonBundle>;

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

/**
 * TZ-16 §3.1: карточки. Эндпоинт бэка появится вместе с LLM-ранклером;
 * пока бэк его не отдаёт — `callBackend` вернёт null и сработает мок.
 */
export async function generateCardsSmart(request: GenerationRequest): Promise<CardsClientResult> {
  return smartGenerate<CardSet>(request, { endpoint: "cards", dataKey: "cardSet" }, () => mockCards(request));
}

/** TZ-16 §3.2: комплект материалов (словарь / справочник / раздатка). */
export async function generateMaterialsSmart(request: GenerationRequest): Promise<MaterialsClientResult> {
  return smartGenerate<MaterialBundle>(request, { endpoint: "materials", dataKey: "materialBundle" }, () => mockMaterials(request));
}

/**
 * TZ-16 §3.4: «Урок целиком» — 4 артефакта одной темы.
 *
 * Эндпоинт `/api/bundles/generate` в этом ТЗ не создаётся (§11), поэтому
 * `callBackend` вернёт null и сработает мок. Сама оркестрация 4 слотов лежит
 * в моке (`buildLessonBundle`) и уже параллельна — здесь мы её не дублируем.
 */
export async function generateBundleSmart(request: GenerationRequest): Promise<BundleClientResult> {
  return smartGenerate<LessonBundle>(request, { endpoint: "bundles", dataKey: "lessonBundle" }, () => mockLessonBundle(request));
}

"use client";

/**
 * Клиент генерации вариантов ОГЭ/ЕГЭ — тонкая обёртка над бэкенд-воркером.
 *
 * Контракт (backend/src/routes/exams.ts + backend/src/middleware/error.ts):
 *   POST ${NEXT_PUBLIC_API_URL}/api/exams/generate
 *     body:    { exam: "oge"|"ege", subject: SubjectSlug, variantNumber: 1..999 }
 *     success: { ok: true, variant: ExamVariant, meta: {...} }
 *     error:   { ok: false, error: string, code: string, details?: unknown }
 *
 * ФОРМАТ ОШИБОК — важная деталь: поле с кодом называется `code` и лежит в
 * КОРНЕ ответа (backend/src/middleware/error.ts:27). Но маршрут экзаменов
 * кладёт свой, более конкретный код ВНУТРЬ `details`:
 *   402 → code: "PAYMENT_REQUIRED",  details.code: "UPGRADE_REQUIRED"
 *   403 → code: "FORBIDDEN",         details.code: "GENERATION_FORBIDDEN"
 *   429 → code: "RATE_LIMIT",        details.kind: "free_total"
 *   409 → code: "TURNSTILE_REQUIRED"
 * Поэтому код ищем сначала в details.code, потом в code. НЕ гадаем по статусу:
 * 403 у бэка бывает и «ученик» (GENERATION_FORBIDDEN), и «чужой Origin»
 * (CSRF_ORIGIN_REJECTED) — это разные ситуации для разных людей.
 *
 * Стиль скопирован с `src/lib/auth/api.ts` (credentials:"include", cache:"no-store",
 * чтение NEXT_PUBLIC_API_URL). Свой класс ошибки — нам нужен `reason`, а не
 * сырой код: UI должен различать «нужен тариф», «кончилась квота» и «сервис
 * недоступен», а учитель этих терминов видеть не должен.
 */

import type { ExamVariant, SubjectSlug } from "@/lib/types";
import { generateExamVariant } from "@/lib/mock/generator";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Что именно просили у бэка. */
export type ExamKind = "oge" | "ege";

/**
 * Причина, по которой настоящий вариант получить не удалось.
 * `unavailable` — единственное состояние, в котором разрешено показать мок,
 * и даже там мок обязан быть помечен как демонстрационный.
 */
export type ExamFailureReason =
  | "upgrade" // 402 — варианты ОГЭ/ЕГЭ только в тарифе «Плюс»
  | "forbidden" // 403 GENERATION_FORBIDDEN — вход ученический
  | "rate_limit" // 429 — бесплатная квота исчерпана
  | "challenge" // 409 TURNSTILE_REQUIRED — подтвердить, что не робот
  | "unavailable"; // 5xx, сеть, нет NEXT_PUBLIC_API_URL, кривой ответ

/**
 * Стадия генерации. Считается по РЕАЛЬНЫМ вехам запроса, а не по таймеру:
 *  - `collecting` — запрос ушёл, ответ не пришёл;
 *  - `checking`   — ответ пришёл, проверяем формулировки;
 *  - `explaining`— формулировки в порядке, наполняем разбор.
 * Искусственных задержек здесь нет: быстрый ответ = быстрый переход.
 */
export type ExamPhase = "collecting" | "checking" | "explaining";

export class ExamApiError extends Error {
  readonly reason: ExamFailureReason;
  /** HTTP-статус, либо 0 для сетевой ошибки/незаданного API_URL. */
  readonly status: number;
  /** Код бэка: details.code ?? code. Для логов, не для показа учителю. */
  readonly code: string;
  /** Текст бэка — он написан по-русски и без терминов, его можно показать. */
  readonly serverMessage: string | null;
  /** 429: сработала ли квота «на весь период» (сброса нет). */
  readonly quotaIsTotal: boolean;

  constructor(
    reason: ExamFailureReason,
    status: number,
    code: string,
    serverMessage: string | null,
    quotaIsTotal = false,
  ) {
    super(serverMessage ?? "Не удалось получить вариант");
    this.name = "ExamApiError";
    this.reason = reason;
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
    this.quotaIsTotal = quotaIsTotal;
  }
}

interface GenerateParams {
  exam: ExamKind;
  subject: SubjectSlug;
  /** Номер задаёт учитель, 1..999 — бэк проверяет диапазон (zod). */
  variantNumber: number;
}

interface GenerateHooks {
  /** Вызывается на каждой реальной вехе; блокирует и повторный клик. */
  onPhase?: (phase: ExamPhase) => void;
  signal?: AbortSignal;
}

interface ErrorBody {
  ok?: false;
  error?: string;
  code?: string;
  details?: unknown;
}

/** Границы номера варианта — те же, что в zod-схеме бэка. */
export const VARIANT_MIN = 1;
export const VARIANT_MAX = 999;

/**
 * Привести строку из поля ввода к валидному номеру.
 * Мусор на месте — не повод показывать ошибку: молча берём границу,
 * потому что номер варианта выбирает учитель, а не он валидирует API.
 */
export function clampVariantNumber(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return VARIANT_MIN;
  return Math.min(VARIANT_MAX, Math.max(VARIANT_MIN, Math.trunc(n)));
}

/** `true`, если параметр можно положить в URL. */
export function isValidVariantNumber(raw: string | null): boolean {
  if (raw === null) return false;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= VARIANT_MIN && n <= VARIANT_MAX;
}

/**
 * POST /api/exams/generate — настоящий вариант с бэка.
 *
 * Бросает {@link ExamApiError} на любой неуспех. `AbortError` пробрасывается
 * как есть: отмена запроса — это не сбой сервиса, и показывать по ней
 * демо-вариант было бы враньём.
 */
export async function generateExam(
  params: GenerateParams,
  hooks: GenerateHooks = {},
): Promise<ExamVariant> {
  hooks.onPhase?.("collecting");

  if (!API_URL) {
    // Нет адреса бэка — сборки без NEXT_PUBLIC_API_URL (dev/CI) упадут сюда.
    throw new ExamApiError(
      "unavailable",
      0,
      "NO_API_URL",
      "Сервис генерации пока не подключён к этой сборке",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/exams/generate`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        exam: params.exam,
        subject: params.subject,
        variantNumber: params.variantNumber,
      }),
      cache: "no-store",
      signal: hooks.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ExamApiError(
      "unavailable",
      0,
      "NETWORK",
      "Не удалось связаться с сервисом генерации",
    );
  }

  const body = (await res.json().catch(() => null)) as
    | { ok: true; variant?: unknown }
    | ErrorBody
    | null;

  if (!res.ok) throw toExamError(res.status, body);

  // 200 без валидного варианта — это тоже сбой сервиса, а не успех.
  const variant = readVariant(body);
  if (!variant) {
    throw new ExamApiError(
      "unavailable",
      res.status,
      "BAD_PAYLOAD",
      "Сервис ответил без готового варианта",
    );
  }

  return variant;
}

/**
 * Стадия 2: проверяем, что вариант пригоден для показа.
 *
 * Это настоящая работа, а не украшение прогресса: если у задания нет текста
 * или ответа, тренажёр учителя не запустится. `problems` нормализуется здесь же.
 */
export function checkVariant(variant: ExamVariant): boolean {
  return Array.isArray(variant.problems) && variant.problems.length > 0;
}

/** Стадия 3: разбор есть у каждого задания — иначе «готовим разбор» врало бы. */
export function hasExplanations(variant: ExamVariant): boolean {
  return variant.problems.every((p) => typeof p.explanation === "string" && p.explanation.trim() !== "");
}

/**
 * ДЕМОНСТРАЦИОННЫЙ вариант из мока — только на случай, когда сервис недоступен.
 *
 * Живёт здесь, а не в `src/app/oge/page.tsx`, по двум причинам. Первая: страница
 * не должна знать про мок вообще — единственный способ получить такой вариант
 * это явный вызов этой функции. Вторая: подпись «это демонстрационный вариант»
 * обязана быть неотделима от самого варианта, иначе рано или поздно её забудут
 * на одной из веток рендера.
 *
 * Вызывать ТОЛЬКО из состояния `unavailable` и ТОЛЬКО с пометкой в интерфейсе.
 */
export function loadDemoVariant(params: GenerateParams): ExamVariant {
  return generateExamVariant(params.exam, params.subject, params.variantNumber);
}

// ─── internals ──────────────────────────────────────────────────────────────

function toExamError(status: number, body: unknown): ExamApiError {
  const err = (body ?? {}) as ErrorBody;
  const details = err.details;
  const detailCode =
    details && typeof details === "object" && typeof (details as { code?: unknown }).code === "string"
      ? (details as { code: string }).code
      : null;
  const code = detailCode ?? err.code ?? `HTTP_${status}`;
  const message = typeof err.error === "string" ? err.error : null;
  const kind =
    details && typeof details === "object" && typeof (details as { kind?: unknown }).kind === "string"
      ? (details as { kind: string }).kind
      : null;

  // 403: различаем «это ученический вход» и «запрос с чужого источника».
  // Второе — проблема развёртывания, а не вина учителя, поэтому уходит
  // в «сервис недоступен» с демо, а не в «вам нужен тариф».
  if (status === 403 && code === "FORBIDDEN") {
    return new ExamApiError("unavailable", status, code, "Сервис отклонил запрос");
  }
  if (status === 403) return new ExamApiError("forbidden", status, code, message);

  if (status === 402) return new ExamApiError("upgrade", status, code, message);
  if (status === 409) return new ExamApiError("challenge", status, code, message);
  if (status === 429) {
    return new ExamApiError("rate_limit", status, code, message, kind === "free_total");
  }

  // 5xx и всё неожиданное.
  return new ExamApiError("unavailable", status, code, null);
}

function readVariant(body: unknown): ExamVariant | null {
  if (!body || typeof body !== "object") return null;
  const ok = (body as { ok?: unknown }).ok;
  const variant = (body as { variant?: unknown }).variant;
  if (ok !== true || !variant || typeof variant !== "object") return null;
  const v = variant as Partial<ExamVariant>;
  if (!Array.isArray(v.problems) || v.problems.length === 0) return null;
  return v as ExamVariant;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "AbortError" : false;
}

/**
 * listai-self-verify — Cloudflare Worker
 *
 * REST endpoint POST /verify
 *
 * Принимает задачу, делает 2 прохода через LLM:
 *   1. solve  — модель решает задачу.
 *   2. verify — та же модель проверяет корректность ответа.
 *
 * Возвращает JSON: { verified, answer, explanation, latency_ms, model, mock? }
 *
 * Mock fallback: если OPENROUTER_API_KEY не задан в env (через `wrangler secret put`),
 * Worker возвращает mock-результат без обращения к внешнему API.
 * Это нужно, чтобы фронт мог интегрироваться и в дев-режиме без ключа.
 *
 * CORS: разрешены все origin (MVP). В проде сужается через ALLOWED_ORIGINS.
 *
 * Лимиты:
 *   - Hard timeout Worker = 30s. Мы ставим AbortController на 25s — запас на ответ.
 *   - Тело запроса лимитировано — в проде можно добавить maxLength, пока не критично.
 */

import { SOLVE_PROMPT, VERIFY_PROMPT } from "./prompts";

// =============== Types ===============

interface VerifyRequest {
  subject: string;
  grade: number;
  topic: string;
  task: {
    text: string;
    expectedAnswer?: string;
  };
}

interface SolveResult {
  answer: string;
  raw: string;
}

interface VerifyResult {
  verified: boolean;
  reason: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string; code?: number };
}

interface Env {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  WORKER_NAME?: string;
  APP_ENV?: string;
}

// =============== Constants ===============

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 25_000;
const MOCK_LATENCY_MS = 50;

// =============== Helpers ===============

function jsonResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...(extraHeaders as Record<string, string>),
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(status: number, message: string, details?: unknown): Response {
  return jsonResponse({ error: message, details: details ?? null }, status);
}

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    if (!text || text.length === 0) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Извлекает финальный ответ из свободного текста решения.
 * Модель возвращает текст вида "...Ответ: 7/3" — берём последнее вхождение.
 */
function extractAnswer(solveText: string): string {
  const lines = solveText.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    const match = line.match(/(?:^|\s)(?:ответ|answer)\s*[:=]\s*(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  // fallback — последняя непустая строка, обрезанная до 200 символов
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      return lines[i].trim().slice(0, 200);
    }
  }
  return solveText.trim().slice(0, 200);
}

/**
 * Парсит JSON-ответ от verify-прохода. Допускаем обрамляющий текст и ```json fences.
 */
function parseVerifyJson(raw: string): VerifyResult | null {
  // Убираем markdown-обрамление, если модель его добавила
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  // Ищем первый {...} блок
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  try {
    const parsed = JSON.parse(objMatch[0]) as Partial<VerifyResult>;
    if (typeof parsed.verified !== "boolean") return null;
    return {
      verified: parsed.verified,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return null;
  }
}

// =============== OpenRouter call ===============

async function callOpenRouter(
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 800,
  };

  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://listai-prototype.pages.dev",
      "X-Title": "listai-self-verify",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenRouter HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as OpenRouterChatResponse;
  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }
  return content;
}

async function solveStep(
  apiKey: string,
  model: string,
  req: VerifyRequest,
  signal: AbortSignal,
): Promise<SolveResult> {
  const prompt = SOLVE_PROMPT({
    subject: req.subject,
    grade: req.grade,
    topic: req.topic,
    taskText: req.task.text,
    expectedAnswer: req.task.expectedAnswer,
  });
  const raw = await callOpenRouter(apiKey, model, prompt, signal);
  return { raw, answer: extractAnswer(raw) };
}

async function verifyStep(
  apiKey: string,
  model: string,
  req: VerifyRequest,
  solveRaw: string,
  signal: AbortSignal,
): Promise<VerifyResult> {
  const prompt = VERIFY_PROMPT({
    subject: req.subject,
    grade: req.grade,
    taskText: req.task.text,
    proposedAnswer: solveRaw,
    expectedAnswer: req.task.expectedAnswer,
  });
  const raw = await callOpenRouter(apiKey, model, prompt, signal);
  const parsed = parseVerifyJson(raw);
  if (!parsed) {
    // Если не распарсили JSON — консервативно НЕ верифицируем.
    return { verified: false, reason: `verify-ответ не в JSON: ${raw.slice(0, 120)}` };
  }
  return parsed;
}

// =============== Mock fallback ===============

function mockVerify(req: VerifyRequest): {
  verified: boolean;
  answer: string;
  explanation: string;
  latency_ms: number;
  model: string;
  mock: true;
} {
  // Простейшая эвристика: если в задаче есть expectedAnswer, считаем что mock подтвердит.
  // Это нужно только для разработки фронта без ключа.
  const hasExpected =
    typeof req.task.expectedAnswer === "string" && req.task.expectedAnswer.length > 0;
  return {
    verified: hasExpected,
    answer: hasExpected ? req.task.expectedAnswer! : "mock-answer",
    explanation: hasExpected
      ? "Mock-режим: ответ совпал с эталоном (эвристика)."
      : "Mock-режим: эталон не задан, ответ не верифицирован.",
    latency_ms: MOCK_LATENCY_MS,
    model: "mock",
    mock: true,
  };
}

// =============== Validation ===============

function validateRequest(body: unknown): { ok: true; data: VerifyRequest } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "body должен быть объектом" };
  }
  const b = body as Partial<VerifyRequest>;
  if (typeof b.subject !== "string" || b.subject.length === 0) {
    return { ok: false, reason: "subject обязателен (string)" };
  }
  if (typeof b.grade !== "number" || !Number.isFinite(b.grade)) {
    return { ok: false, reason: "grade обязателен (number)" };
  }
  if (typeof b.topic !== "string" || b.topic.length === 0) {
    return { ok: false, reason: "topic обязателен (string)" };
  }
  if (!b.task || typeof b.task !== "object") {
    return { ok: false, reason: "task обязателен (object)" };
  }
  if (typeof b.task.text !== "string" || b.task.text.length === 0) {
    return { ok: false, reason: "task.text обязателен (string)" };
  }
  if (b.task.expectedAnswer !== undefined && typeof b.task.expectedAnswer !== "string") {
    return { ok: false, reason: "task.expectedAnswer должен быть string если задан" };
  }
  return { ok: true, data: body as VerifyRequest };
}

// =============== Handler ===============

async function handleVerify(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();

  // 1. Parse body
  const body = await parseJsonBody<unknown>(request);
  if (body === null) {
    return errorResponse(400, "Невалидный JSON в теле запроса");
  }

  // 2. Validate
  const validation = validateRequest(body);
  if (!validation.ok) {
    return errorResponse(400, validation.reason);
  }
  const req = validation.data;

  // 3. Mock fallback: если ключа нет — возвращаем mock без обращения к внешнему API.
  if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY.length === 0) {
    const result = mockVerify(req);
    const latency = Date.now() - startedAt;
    return jsonResponse({ ...result, latency_ms: latency });
  }

  // 4. Real path: solve → verify
  const model = env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const solve = await solveStep(env.OPENROUTER_API_KEY, model, req, controller.signal);
    const verify = await verifyStep(
      env.OPENROUTER_API_KEY,
      model,
      req,
      solve.raw,
      controller.signal,
    );

    const latency = Date.now() - startedAt;
    return jsonResponse({
      verified: verify.verified,
      answer: solve.answer,
      explanation: verify.reason,
      latency_ms: latency,
      model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Если timeout/Abort — отдаём 504, иначе 500.
    const isAbort =
      (err instanceof Error && err.name === "AbortError") ||
      message.toLowerCase().includes("aborted");
    return errorResponse(isAbort ? 504 : 500, isAbort ? "Timeout: LLM не ответил за 25 секунд" : "LLM call failed", message);
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============== Entry ===============

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Health-check
    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        ok: true,
        worker: env.WORKER_NAME || "listai-self-verify",
        env: env.APP_ENV || "development",
        has_key: Boolean(env.OPENROUTER_API_KEY),
        model: env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      });
    }

    // Verify endpoint
    if (url.pathname === "/verify") {
      if (request.method !== "POST") {
        return errorResponse(405, "Method not allowed. Use POST.");
      }
      return handleVerify(request, env);
    }

    return errorResponse(404, "Not found", `path: ${url.pathname}`);
  },
};
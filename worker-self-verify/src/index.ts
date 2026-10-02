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
 * LLM-провайдер: **polza.ai** (OpenAI-совместимый). Все модели каталога доступны
 * по единому ключу POLZA_API_KEY. Модель задаётся через POLZA_MODEL (дефолт
 * `deepseek/deepseek-v4-flash` — самый дешёвый валидатор для self-verify на сентябрь 2026).
 *
 * Mock fallback: если POLZA_API_KEY не задан в env (через `wrangler secret put`),
 * Worker возвращает mock-результат без обращения к внешнему API.
 * Это нужно, чтобы фронт мог интегрироваться и в дев-режиме без ключа.
 *
 * Fallback chain: если primary-модель вернула сетевую/HTTP ошибку — пробуем
 * fallback (POLZA_FALLBACK_MODEL, по дефолту `openai/gpt-6-luna`). Если и та
 * упала — возвращаем mock с `model: "polza-unavailable"` и диагностикой в `polza_error`.
 *
 * Soft-fail:
 *   - task.text > MAX_TASK_LINES строк — усекаем до первых MAX_TASK_LINES + warn в лог.
 *   - verify-ответ не парсится в JSON — mock с `model: "parse-fail"` (НЕ fallback,
 *     это model-quality issue, не network).
 *
 * CORS: разрешены все origin (MVP). В проде сужается через ALLOWED_ORIGINS.
 *
 * Лимиты:
 *   - Hard timeout Worker = 30s. Мы ставим AbortController на 25s — запас на ответ.
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

interface PolzaChatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  error?: { message?: string; code?: number };
}

interface Env {
  POLZA_API_KEY?: string;
  POLZA_MODEL?: string;
  POLZA_FALLBACK_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  WORKER_NAME?: string;
  APP_ENV?: string;
  /**
   * Общий секрет для server-to-server вызовов.
   *
   * ВАЖНО: пока `/verify` вызывается прямо из браузера (src/lib/llm/self-verify.ts),
   * секрет бесполезен — всё, что лежит в NEXT_PUBLIC_*, видно пользователю.
   * Поэтому режим включается отдельно, через REQUIRE_SECRET: когда вызов
   * переедет за основной API (где есть своя сессия и лимиты), достаточно
   * поставить REQUIRE_SECRET="true" и задать INTERNAL_TOKEN — и воркер
   * перестанет быть открытым прокси без переписывания кода воркера.
   */
  INTERNAL_TOKEN?: string;
  REQUIRE_SECRET?: string;
}

interface PolzaModelInfo {
  id: string;
  input_per_1m: string;
  output_per_1m: string;
  tier: "cheap" | "validator" | "complex_reasoning" | "premium";
}

// =============== Constants ===============

const POLZA_URL = "https://polza.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 25_000;
const MOCK_LATENCY_MS = 50;
const MAX_TASK_LINES = 50;

// ── Ограничение нагрузки ─────────────────────────────────────────────────────
// Раньше его не было вообще: любой, кто знал адрес воркера (а он публичный на
// *.workers.dev), мог дёргать платный LLM-вызов сколько угодно раз за наш счёт.
// Счётчик живёт в памяти инстанса: для защиты от массового злоупотребления этого
// достаточно, гонять каждого пользователя по отдельному инстансу бессмысленно.
const RATE_LIMIT_MAX = 20; // запросов
const RATE_LIMIT_WINDOW_MS = 60_000; // в минуту
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

// Не даём карте расти бесконечно из-за спуфинга IP.
function pruneRateBuckets(now: number): void {
  if (rateBuckets.size < 5_000) return;
  for (const [key, value] of rateBuckets) {
    if (value.resetAt <= now) rateBuckets.delete(key);
  }
}

/**
 * Разрешённые origin'ы: список из ALLOWED_ORIGINS (через запятую).
 *
 * Раньше здесь стоял литерал `Access-Control-Allow-Origin: "*"`, а
 * ALLOWED_ORIGINS в wrangler.toml был сужением, которое никто не применял.
 * Теперь список действительно работает.
 */
function resolveAllowedOrigins(env: Env): Set<string> {
  const raw = (env.ALLOWED_ORIGINS ?? "").trim();
  if (!raw || raw === "*") return new Set(["*"]);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
}

function corsOriginFor(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null; // не браузер
  const allowed = resolveAllowedOrigins(env);
  if (allowed.has("*")) return origin;
  return allowed.has(origin.replace(/\/+$/, "")) ? origin : null;
}

// Дефолтная primary-модель: DeepSeek V4 Flash — самый дешёвый валидатор на polza.ai.
const DEFAULT_POLZA_MODEL = "deepseek/deepseek-v4-flash";
// Fallback: GPT-6 Luna — самый дешёвый тариф, запасной вариант если primary
// недоступен (HTTP 5xx, network error, пустой ответ).
const DEFAULT_POLZA_FALLBACK_MODEL = "openai/gpt-6-luna";

// Каталог актуальных моделей на сентябрь 2026 (для info endpoint `/`).
// Цены в USD за 1M токенов (input/output).
const AVAILABLE_MODELS: PolzaModelInfo[] = [
  { id: "openai/gpt-6-luna", input_per_1m: "$0.10", output_per_1m: "$0.50", tier: "cheap" },
  { id: "deepseek/deepseek-v4-flash", input_per_1m: "$0.30", output_per_1m: "$1.20", tier: "validator" },
  { id: "openai/gpt-6-sol", input_per_1m: "$2", output_per_1m: "$10", tier: "complex_reasoning" },
  { id: "anthropic/claude-opus-5.5", input_per_1m: "$4", output_per_1m: "$20", tier: "premium" },
];

// =============== Metrics (in-memory, сбрасываются на cold start) ===============

interface WorkerMetrics {
  total_requests: number;
  mock_responses: number;
  real_responses: number;
  fallback_uses: number;
  parse_fails: number;
  polza_unavailable: number;
  started_at: number;
}

const metrics: WorkerMetrics = {
  total_requests: 0,
  mock_responses: 0,
  real_responses: 0,
  fallback_uses: 0,
  parse_fails: 0,
  polza_unavailable: 0,
  started_at: Date.now(),
};

// =============== Helpers ===============

function jsonResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
 * Soft-fail: если task.text слишком большой (например, lesson_plan с 100 уроками),
 * усекаем до первых MAX_TASK_LINES строк и логируем warning.
 * Возвращаем mutated request + флажок truncated=true для трассировки.
 */
function truncateTaskText(text: string): { text: string; truncated: boolean; original_lines: number } {
  const lines = text.split(/\r?\n/);
  if (lines.length <= MAX_TASK_LINES) {
    return { text, truncated: false, original_lines: lines.length };
  }
  console.warn(
    `[self-verify] task.text truncated: ${lines.length} -> ${MAX_TASK_LINES} lines`,
  );
  return {
    text: lines.slice(0, MAX_TASK_LINES).join("\n"),
    truncated: true,
    original_lines: lines.length,
  };
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

// =============== Polza call ===============

async function callPolza(
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

  const resp = await fetch(POLZA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Polza HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as PolzaChatResponse;
  if (data.error) {
    throw new Error(`Polza error: ${data.error.message}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Polza returned empty content");
  }
  return content;
}

type PolzaCallResult =
  | { ok: true; content: string; model: string }
  | { ok: false; error: string };

/**
 * Fallback chain: пробует primary, при network/HTTP/empty ошибке — fallback.
 * Возвращает ok+content если хотя бы одна модель ответила, иначе ok=false с диагностикой.
 */
async function callPolzaWithFallback(
  apiKey: string,
  primaryModel: string,
  fallbackModel: string,
  prompt: string,
  signal: AbortSignal,
): Promise<PolzaCallResult> {
  const models = [primaryModel, fallbackModel];
  let lastError = "";
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const content = await callPolza(apiKey, model, prompt, signal);
      if (i > 0) {
        // Дошли до fallback — значит primary упал.
        metrics.fallback_uses++;
        console.warn(
          `[self-verify] primary=${primaryModel} failed, fallback=${model} succeeded`,
        );
      }
      return { ok: true, content, model };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
      // Продолжаем к следующей модели (если есть).
    }
  }
  return { ok: false, error: lastError };
}

async function solveStep(
  apiKey: string,
  primaryModel: string,
  fallbackModel: string,
  req: VerifyRequest,
  signal: AbortSignal,
): Promise<{ result: PolzaCallResult; answer: string }> {
  const prompt = SOLVE_PROMPT({
    subject: req.subject,
    grade: req.grade,
    topic: req.topic,
    taskText: req.task.text,
    expectedAnswer: req.task.expectedAnswer,
  });
  const result = await callPolzaWithFallback(
    apiKey,
    primaryModel,
    fallbackModel,
    prompt,
    signal,
  );
  const answer = result.ok ? extractAnswer(result.content) : "";
  return { result, answer };
}

// =============== Mock fallback ===============

function mockVerify(
  req: VerifyRequest,
  override?: { model?: string; explanation?: string; extra?: Record<string, unknown> },
): {
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
    explanation: override?.explanation ?? (
      hasExpected
        ? "Mock-режим: ответ совпал с эталоном (эвристика)."
        : "Mock-режим: эталон не задан, ответ не верифицирован."
    ),
    latency_ms: MOCK_LATENCY_MS,
    model: override?.model ?? "mock",
    mock: true,
    ...(override?.extra ?? {}),
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
  metrics.total_requests++;

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

  // 3. Soft-fail: усечение очень большого task.text (lesson_plan со 100+ уроками).
  const truncation = truncateTaskText(req.task.text);
  const effectiveReq: VerifyRequest = truncation.truncated
    ? { ...req, task: { ...req.task, text: truncation.text } }
    : req;

  // 4. Mock fallback: если ключа нет — возвращаем mock без обращения к внешнему API.
  if (!env.POLZA_API_KEY || env.POLZA_API_KEY.length === 0) {
    metrics.mock_responses++;
    const result = mockVerify(effectiveReq);
    const latency = Date.now() - startedAt;
    return jsonResponse({
      ...result,
      latency_ms: latency,
      ...(truncation.truncated
        ? { input_truncated: { original_lines: truncation.original_lines, kept_lines: MAX_TASK_LINES } }
        : {}),
    });
  }

  // 5. Real path: solve → verify с fallback chain.
  const primaryModel = env.POLZA_MODEL || DEFAULT_POLZA_MODEL;
  const fallbackModel = env.POLZA_FALLBACK_MODEL || DEFAULT_POLZA_FALLBACK_MODEL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // ─── solve (с fallback chain) ───
    const solve = await solveStep(
      env.POLZA_API_KEY,
      primaryModel,
      fallbackModel,
      effectiveReq,
      controller.signal,
    );
    if (!solve.result.ok) {
      // Обе модели упали — soft-fail mock с диагностикой.
      metrics.polza_unavailable++;
      console.error(
        `[self-verify] polza unavailable: primary=${primaryModel} fallback=${fallbackModel} err=${solve.result.error}`,
      );
      const latency = Date.now() - startedAt;
      return jsonResponse({
        ...mockVerify(effectiveReq, {
          model: "polza-unavailable",
          explanation: "LLM недоступен (primary и fallback вернули ошибку).",
          extra: { polza_error: solve.result.error },
        }),
        latency_ms: latency,
      });
    }

    // ─── verify (с fallback chain) ───
    const verifyPrompt = VERIFY_PROMPT({
      subject: effectiveReq.subject,
      grade: effectiveReq.grade,
      taskText: effectiveReq.task.text,
      proposedAnswer: solve.result.content,
      expectedAnswer: effectiveReq.task.expectedAnswer,
    });
    const verifyCall = await callPolzaWithFallback(
      env.POLZA_API_KEY,
      primaryModel,
      fallbackModel,
      verifyPrompt,
      controller.signal,
    );
    if (!verifyCall.ok) {
      // solve ок, verify упал (обе модели) — отдаём solve answer, помечаем polza-unavailable.
      metrics.polza_unavailable++;
      console.error(
        `[self-verify] verify-step failed: primary=${primaryModel} fallback=${fallbackModel} err=${verifyCall.error}`,
      );
      const latency = Date.now() - startedAt;
      return jsonResponse({
        ...mockVerify(effectiveReq, {
          model: "polza-unavailable",
          explanation: "verify-проход: LLM недоступен (primary и fallback вернули ошибку).",
          extra: { polza_error: verifyCall.error, solve_answer: solve.answer },
        }),
        latency_ms: latency,
      });
    }

    // ─── parse verify JSON ───
    const parsed = parseVerifyJson(verifyCall.content);
    if (!parsed) {
      // Модель ответила, но не в формате JSON — soft-fail mock с parse-fail.
      metrics.parse_fails++;
      console.warn(
        `[self-verify] verify-ответ не в JSON (model=${verifyCall.model}): ${verifyCall.content.slice(0, 200)}`,
      );
      const latency = Date.now() - startedAt;
      return jsonResponse({
        verified: false,
        answer: solve.answer,
        explanation: `verify-ответ не в JSON (model=${verifyCall.model}): ${verifyCall.content.slice(0, 120)}`,
        latency_ms: latency,
        model: "parse-fail",
        parse_fail: {
          attempted_model: verifyCall.model,
          raw_preview: verifyCall.content.slice(0, 200),
        },
      });
    }

    // ─── success ───
    metrics.real_responses++;
    const latency = Date.now() - startedAt;
    return jsonResponse({
      verified: parsed.verified,
      answer: solve.answer,
      explanation: parsed.reason,
      latency_ms: latency,
      model: verifyCall.model,
      ...(truncation.truncated
        ? { input_truncated: { original_lines: truncation.original_lines, kept_lines: MAX_TASK_LINES } }
        : {}),
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

/**
 * Самопроверка конфигурации при каждом холодном старте.
 *
 * Зачем. `/verify` не требует входа: запрос без секрета уходит в платный
 * LLM на наш счёт. Лимит 20 запросов/мин на IP ограничивает частоту, но не
 * расход: счёт живёт в памяти, обнуляется на каждом холодном старте,
 * а с одного IP это до 28 800 запросов в сутки. CORS тут не помогает —
 * curl и Postman его игнорируют.
 *
 * Поэтому состояние воркера должно быть видно в логах, а не вычисляться
 * по чтению конфига. Особенно опасна починка «по инструкции в
 * wrangler.toml»: REQUIRE_SECRET поставлен в верхний [vars], а прод-деплой
 * идёт с `--env production` и верхний [vars] игнорирует — флаг включится
 * в файле и не подействует на сервере. Ниже это выводится явно.
 */
function checkSelfVerifyExposure(env: Env): void {
  const problems: string[] = [];

  if (env.REQUIRE_SECRET !== "true") {
    problems.push(
      'REQUIRE_SECRET не включён ("' + (env.REQUIRE_SECRET ?? "—") + '") — /verify открыт: ' +
        "запросы без секрета уходят в платный LLM",
    );
  } else if (!env.INTERNAL_TOKEN) {
    problems.push(
      "REQUIRE_SECRET=true, но INTERNAL_TOKEN не задан — /verify отвечает 401 всем, " +
        "включая бота. Проверь: npx wrangler secret put INTERNAL_TOKEN --env production",
    );
  }

  if (env.ALLOWED_ORIGINS === "*") {
    problems.push(
      'ALLOWED_ORIGINS="*" — воркер принимает вызовы с любого сайта. ' +
        "Прод-значение живёт в [env.production.vars]; при деплое без --env " +
        "публикуется верхний [vars] с этой настройкой.",
    );
  }

  if (problems.length === 0) return;
  // eslint-disable-next-line no-console
  console.error(
    "[config] КРИТИЧНО: self-verify открыт для внешних вызовов. " +
      problems.join("; ") +
      ". Подробности и порядок закрытия — worker-self-verify/wrangler.toml.",
  );
}

export default {
  /**
   * Внешняя обёртка: проверки безопасности ДО бизнес-логики.
   *
   * Внутри `route()` CORS-шапки по-прежнему ставятся как "*" — это локальная
   * деталь, чтобы его не трогать по частям. Здесь мы перетираем их на честное
   * значение из ALLOWED_ORIGINS: браузер увидит то, что реально разрешено.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    checkSelfVerifyExposure(env);
    const corsOrigin = corsOriginFor(request, env);
    const headers: Record<string, string> = { Vary: "Origin" };
    if (corsOrigin) headers["Access-Control-Allow-Origin"] = corsOrigin;

    // Preflight: отвечаем только разрешённому origin'у. Чужому — без шапок,
    // и его браузер всё равно не даст прочитать ответ.
    if (request.method === "OPTIONS") {
      if (!corsOrigin) return new Response(null, { status: 403, headers });
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Internal-Token",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const response = await route(request, env);
    response.headers.delete("Access-Control-Allow-Origin");
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Health-check / info
  if (request.method === "GET" && url.pathname === "/") {
    return jsonResponse({
      ok: true,
      worker: env.WORKER_NAME || "listai-self-verify",
      env: env.APP_ENV || "development",
      has_key: Boolean(env.POLZA_API_KEY),
      model: env.POLZA_MODEL || DEFAULT_POLZA_MODEL,
      fallback_model: env.POLZA_FALLBACK_MODEL || DEFAULT_POLZA_FALLBACK_MODEL,
      available_models: AVAILABLE_MODELS,
      // soft-fail режимы (для интегратора)
      soft_fail: {
        input_truncation: { max_lines: MAX_TASK_LINES },
        parse_fail_model: "parse-fail",
        unavailable_model: "polza-unavailable",
      },
      metrics: {
        ...metrics,
        uptime_ms: Date.now() - metrics.started_at,
      },
      endpoints: {
        "POST /verify": "two-pass solve+verify через LLM (Polza)",
        "GET /": "этот health/info",
      },
    });
  }

  // Verify endpoint
  if (url.pathname === "/verify") {
    if (request.method !== "POST") {
      return errorResponse(405, "Method not allowed. Use POST.");
    }

    // ── Внутренний режим: вызов только по общему секрету ────────────────────
    // Включается флагом REQUIRE_SECRET. Нужен после того, как вызов `/verify`
    // переедет за основной API: там уже есть сессия, лимиты и контроль расхода.
    if (env.REQUIRE_SECRET === "true") {
      const presented = request.headers.get("X-Internal-Token");
      if (!env.INTERNAL_TOKEN || presented !== env.INTERNAL_TOKEN) {
        return errorResponse(401, "Unauthorized");
      }
    }

    // ── Ограничение нагрузки ────────────────────────────────────────────────
    // Единственная мера, которая работает и против curl/Postman: CORS такие
    // клиенты игнорируют, а лимит по IP — нет.
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    pruneRateBuckets(Date.now());
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
      const retryAfter = String(limit.retryAfterSec);
      return new Response(
        JSON.stringify({ error: "Too many requests", retry_after_sec: limit.retryAfterSec }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": retryAfter,
          },
        },
      );
    }

    return handleVerify(request, env);
  }

  return errorResponse(404, "Not found", `path: ${url.pathname}`);
}

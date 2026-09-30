/**
 * Публичный фасад LLM-слоя для routes.
 *
 * Импортируется как `import { generateWorksheet, validateWorksheet, embed, generateExam } from "../llm";`
 *
 * Контракт:
 *  - generateWorksheet(...) → { worksheet, meta }
 *  - generateExam(...)      → { variant, meta }
 *  - validateWorksheet(...) → { score, issues, meta }
 *  - embed(texts, env)      → { vectors, model, costUsd }
 *
 * Все вызовы автоматически:
 *  1) Проверяют семантический кэш (если !bypassCache) → возвращают с generation='cached'
 *  2) Применяют pre-LLM moderation (для gen) → 400 если плохой ввод
 *  3) Применяют rate-limit (на user или IP) → 429 если лимит превышен
 *  4) Зовут LLM через callWithFallback → fallback chain при ошибке
 *  5) Пишут результат в semantic_cache (только для gen)
 *  6) Логируют вызов в llm_logs
 *
 * Без ключей в env — generateWorksheet бросит InternalError (нет провайдера).
 * routes должны fallback на локальный mock, если нужно.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import { BadRequestError, InternalError } from "../lib/errors";
import { logLlmEvent } from "./log";
import { moderateGenerationRequest } from "./moderation";
import { checkLlmRateLimit, ipHashFromHeaders } from "./ratelimit";
import { callWithFallback, pickModel } from "./router";
import { lookupCache, makeCacheKey, saveCache } from "./cache";
import { buildWorksheetPrompt } from "./prompts/worksheet-gen";
import { buildExamPrompt } from "./prompts/exam-gen";
import { buildValidatePrompt } from "./prompts/validate";
import { checkContentLanguage, collectExamTexts } from "./language-guard";
import { callPolzaEmbedding } from "./providers/polza";
import { isProviderEnabled } from "./config";
import type { GenerationRequest, Worksheet, ExamVariant, SubjectSlug, GenerateWorksheetMeta } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// generateWorksheet
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateWorksheetArgs {
  request: GenerationRequest;
  plan: "free" | "base" | "plus";
  bypassCache?: boolean;
  userId: string | null;
  ip: string;
}

export interface GenerateWorksheetResult {
  worksheet: Worksheet;
  meta: GenerateWorksheetMeta;
}

/**
 * Сгенерировать рабочий лист через LLM с кэшем, rate-limit, fallback.
 */
export async function generateWorksheet(
  args: GenerateWorksheetArgs,
  env: Env,
  db: D1Database,
): Promise<GenerateWorksheetResult> {
  const start = Date.now();
  const { request, plan, bypassCache = false, userId, ip } = args;

  // 1. Moderation
  const mod = moderateGenerationRequest({ subject: request.subject, topic: request.topic });
  if (!mod.ok) {
    throw new BadRequestError(`Invalid input: ${mod.reason}`, { reason: mod.reason });
  }

  // 2. Rate-limit (только для gen — для других задач не вызываем)
  const ipHash = await ipHashFromHeaders(new Headers({ "cf-connecting-ip": ip }));
  await checkLlmRateLimit(db, { userId, ipHash, plan });

  // 3. Cache lookup
  const cacheKey = makeCacheKey(request);
  if (!bypassCache) {
    const cached = await lookupCache(db, cacheKey);
    if (cached && typeof cached === "object" && cached.response) {
      const ws = (cached.response as { worksheet: Worksheet }).worksheet;
      const meta: GenerateWorksheetMeta = {
        model: "semantic-cache",
        provider: "internal",
        costUsd: 0,
        latencyMs: Date.now() - start,
        cached: true,
        generation: "cached",
      };
      await logLlmCall(db, {
        userId,
        task: "worksheet-gen",
        provider: "cache",
        model: cacheKey.slice(0, 12),
        plan,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: meta.latencyMs,
        cached: true,
        fallback: false,
      });
      return { worksheet: ws, meta };
    }
  }

  // 4. LLM call с fallback
  const decision = pickModel("worksheet-gen", plan, env);
  const { system, user } = buildWorksheetPrompt(request);
  const result = await callWithFallback(
    {
      model: decision.primary?.model ?? "gpt-6-luna",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: "json",
      temperature: 0.7,
      maxTokens: 4096,
      cacheSystemPrompt: plan === "plus",
    },
    decision,
    env,
  );

  // 5. Parse JSON
  let worksheet: Worksheet;
  try {
    const parsed = JSON.parse(result.response.content) as Worksheet;
    // Гарантируем, что id/title/createdAt есть.
    worksheet = {
      id: parsed.id ?? `ws_${Date.now().toString(36)}`,
      title: parsed.title ?? request.topic,
      subject: parsed.subject ?? request.subject,
      grade: parsed.grade ?? request.grade,
      topic: parsed.topic ?? request.topic,
      difficulty: parsed.difficulty ?? request.difficulty,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
  } catch {
    throw new InternalError("LLM returned invalid JSON for worksheet");
  }

  const meta: GenerateWorksheetMeta = {
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    latencyMs: Date.now() - start,
    cached: false,
    generation: result.generation,
  };

  // 6. Save to cache
  await saveCache(db, {
    key: cacheKey,
    subject: request.subject,
    grade: request.grade,
    topic: request.topic,
    difficulty: request.difficulty,
    count: request.count,
    type: request.type,
    response: { worksheet },
  });

  // 7. Log
  await logLlmCall(db, {
    userId,
    task: "worksheet-gen",
    provider: result.provider,
    model: result.model,
    plan,
    tokensIn: result.response.tokensIn,
    tokensOut: result.response.tokensOut,
    costUsd: result.response.costUsd,
    latencyMs: meta.latencyMs,
    cached: false,
    fallback: result.generation === "boost",
  });

  return { worksheet, meta };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateExam
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateExamArgs {
  exam: "oge" | "ege";
  subject: SubjectSlug;
  variantNumber: number;
  plan: "free" | "base" | "plus";
  userId: string | null;
  ip: string;
}

/**
 * TZ-13: безопасный fallback, когда LLM дважды вернул контент на иностранном
 * языке для не-языкового предмета. Лучше пустой вариант с честным сообщением,
 * чем задание не по тому предмету (учитель теряет доверие к продукту).
 */
function emptyVariant(
  exam: "oge" | "ege",
  subject: SubjectSlug,
  variantNumber: number,
): ExamVariant {
  return {
    id: `exam_${Date.now().toString(36)}`,
    exam,
    subject,
    variantNumber,
    title: `${exam === "oge" ? "ОГЭ" : "ЕГЭ"} · ${subject} · Вариант ${variantNumber}`,
    duration: 235,
    problems: [],
  };
}

export async function generateExam(
  args: GenerateExamArgs,
  env: Env,
  db: D1Database,
): Promise<{ variant: ExamVariant; meta: GenerateWorksheetMeta }> {
  const start = Date.now();
  const { exam, subject, variantNumber, plan, userId, ip } = args;

  const ipHash = await ipHashFromHeaders(new Headers({ "cf-connecting-ip": ip }));
  await checkLlmRateLimit(db, { userId, ipHash, plan });

  const decision = pickModel("exam-gen", plan, env);
  const { system, user } = buildExamPrompt({ exam, subject, variantNumber });

  const result = await callWithFallback(
    {
      model: decision.primary?.model ?? "gpt-6-luna",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: "json",
      temperature: 0.7,
      maxTokens: 6000,
      cacheSystemPrompt: plan === "plus",
    },
    decision,
    env,
  );

  let variant: ExamVariant;
  try {
    const parsed = JSON.parse(result.response.content) as ExamVariant;
    variant = {
      id: parsed.id ?? `exam_${Date.now().toString(36)}`,
      exam,
      subject,
      variantNumber,
      title: parsed.title ?? `${exam === "oge" ? "ОГЭ" : "ЕГЭ"} · ${subject} · Вариант ${variantNumber}`,
      duration: parsed.duration ?? (exam === "oge" ? 235 : 235),
      problems: Array.isArray(parsed.problems) ? parsed.problems : [],
    };
  } catch {
    throw new InternalError("LLM returned invalid JSON for exam");
  }

  // TZ-13: LLM может отдать задания на иностранном языке для не-языкового предмета
  // (напр. «Open the brackets: She (read) a book now.» для физики). Промпт уже
  // содержит language-constraint, но он не гарантирован — нужен детерминированный guard.
  // Одна регенерация с явным указанием языка, потом fallback на mock.
  const langCheck = checkContentLanguage(
    collectExamTexts(variant.problems as unknown as Array<Record<string, unknown>>),
    subject,
  );
  if (!langCheck.ok) {
    console.warn(
      `[exam-gen] language guard tripped: subject=${subject} cyrillic=${(langCheck.cyrillicRatio * 100).toFixed(0)}% latinWords=${langCheck.latinWordCount} — regenerating with strict language instruction`,
    );

    const { system: strictSystem, user: strictUser } = buildExamPrompt({
      exam,
      subject,
      variantNumber,
    });
    const retry = await callWithFallback(
      {
        model: decision.primary?.model ?? "gpt-6-luna",
        messages: [
          { role: "system", content: strictSystem },
          {
            role: "user",
            content:
              strictUser +
              "\n\nВНИМАНИЕ: предыдущая попытка вернула задания на иностранном языке. " +
              "Это ошибка. Перегенерируй вариант — ВСЕ задания строго на русском языке " +
              "(если предмет не английский/немецкий).",
          },
        ],
        responseFormat: "json",
        temperature: 0.5,
        maxTokens: 6000,
        cacheSystemPrompt: false,
      },
      decision,
      env,
    ).catch(() => null);

    if (retry) {
      try {
        const parsed = JSON.parse(retry.response.content) as ExamVariant;
        const retryVariant: ExamVariant = {
          ...variant,
          title: parsed.title ?? variant.title,
          duration: parsed.duration ?? variant.duration,
          problems: Array.isArray(parsed.problems) ? parsed.problems : variant.problems,
        };
        const retryCheck = checkContentLanguage(
          collectExamTexts(
            retryVariant.problems as unknown as Array<Record<string, unknown>>,
          ),
          subject,
        );
        if (retryCheck.ok) {
          variant = retryVariant;
        } else {
          // Вторая попытка тоже не помогла — не отдаём мусор, уходим в mock.
          console.error(
            `[exam-gen] language guard failed twice for subject=${subject}; falling back to mock`,
          );
          variant = emptyVariant(exam, subject, variantNumber);
        }
      } catch {
        variant = emptyVariant(exam, subject, variantNumber);
      }
    } else {
      variant = emptyVariant(exam, subject, variantNumber);
    }
  }

  const meta: GenerateWorksheetMeta = {
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    latencyMs: Date.now() - start,
    cached: false,
    generation: result.generation,
  };

  await logLlmCall(db, {
    userId,
    task: "exam-gen",
    provider: result.provider,
    model: result.model,
    plan,
    tokensIn: result.response.tokensIn,
    tokensOut: result.response.tokensOut,
    costUsd: result.response.costUsd,
    latencyMs: meta.latencyMs,
    cached: false,
    fallback: result.generation === "boost",
  });

  return { variant, meta };
}

// ─────────────────────────────────────────────────────────────────────────────
// validateWorksheet
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidateWorksheetArgs {
  worksheet: Worksheet;
  context: { subject: string; grade: number; topic: string };
}

export interface ValidateWorksheetResult {
  score: number;
  issues: Array<{ type: "duplicate" | "wrong-answer" | "off-fgos" | "low-quality"; taskNumber?: number; message: string }>;
  meta: GenerateWorksheetMeta;
}

export async function validateWorksheet(
  args: ValidateWorksheetArgs,
  env: Env,
  db: D1Database,
): Promise<ValidateWorksheetResult> {
  const start = Date.now();
  const decision = pickModel("validate", "free", env);
  if (!decision.primary) {
    throw new InternalError("Validator provider (deepseek) not configured");
  }

  const wsJson = JSON.stringify(args.worksheet);
  const { system, user } = buildValidatePrompt(wsJson, args.context);

  const result = await callWithFallback(
    {
      model: decision.primary.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: "json",
      temperature: 0.2,
      maxTokens: 2000,
    },
    decision,
    env,
  );

  let score = 1.0;
  let issues: ValidateWorksheetResult["issues"] = [];
  try {
    const parsed = JSON.parse(result.response.content) as { score: number; issues: ValidateWorksheetResult["issues"] };
    score = typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : 1.0;
    issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  } catch {
    logLlmEvent("warn", "validateWorksheet: invalid JSON from validator", {
      content: result.response.content.slice(0, 200),
    });
  }

  const meta: GenerateWorksheetMeta = {
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    latencyMs: Date.now() - start,
    cached: false,
    generation: "primary",
  };

  await logLlmCall(db, {
    userId: null,
    task: "validate",
    provider: result.provider,
    model: result.model,
    plan: "free",
    tokensIn: result.response.tokensIn,
    tokensOut: result.response.tokensOut,
    costUsd: result.response.costUsd,
    latencyMs: meta.latencyMs,
    cached: false,
    fallback: false,
  });

  return { score, issues, meta };
}

// ─────────────────────────────────────────────────────────────────────────────
// embed
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbedArgs {
  texts: string[];
  /** Какую модель embeddings использовать. Если не задано — берётся из routing. */
  preferredModel?: "qwen3-embedding-8b" | "text-embedding-3-large";
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  costUsd: number;
}

/**
 * Получить embeddings для списка текстов.
 *
 * Polza — единственный провайдер. По умолчанию — text-embedding-3-large
 * (точно есть на polza, проверено). Fallback внутри router → qwen3-embedding-8b
 * (мультиязычный, для русских текстов; точное имя на polza не подтверждено).
 *
 * Если POLZA_API_KEY не задан — бросаем InternalError. routes должен fallback на mock.
 */
export async function embed(args: EmbedArgs, env: Env): Promise<EmbedResult> {
  if (!isProviderEnabled(env, "polza")) {
    throw new InternalError(
      "Embeddings: POLZA_API_KEY not configured (set it in wrangler secret put or .dev.vars)",
    );
  }
  const model = args.preferredModel ?? "text-embedding-3-large";
  const { vectors, costUsd } = await callPolzaEmbedding(args.texts, model, env);
  return { vectors, model, costUsd };
}

// ─────────────────────────────────────────────────────────────────────────────
// logLlmCall
// ─────────────────────────────────────────────────────────────────────────────

export interface LogLlmCallParams {
  userId: string | null;
  task: string;
  provider: string;
  model: string;
  plan: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  cached: boolean;
  fallback: boolean;
  error?: string;
}

export async function logLlmCall(db: D1Database, params: LogLlmCallParams): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO llm_logs
           (id, user_id, task, provider, model, plan,
            tokens_in, tokens_out, cost_usd, latency_ms, cached, fallback, error, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
        `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        params.userId,
        params.task,
        params.provider,
        params.model,
        params.plan,
        params.tokensIn,
        params.tokensOut,
        params.costUsd,
        params.latencyMs,
        params.cached ? 1 : 0,
        params.fallback ? 1 : 0,
        params.error ?? null,
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch (e) {
    logLlmEvent("error", "logLlmCall failed", { error: String(e) });
  }
}

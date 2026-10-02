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
import { callWithFallback, pickModel, taskForArtifact } from "./router";
import { lookupCache, makeCacheKey, saveCache } from "./cache";
import { buildWorksheetPrompt, sanitizeTextLatex } from "./prompts/worksheet-gen";
import { buildExamPrompt } from "./prompts/exam-gen";
import { buildValidatePrompt } from "./prompts/validate";
import { buildPhotoCheckPrompt, type PhotoCheckTask } from "./prompts/photo-check";
import { calcCost, estimateImageTokens } from "./cost";
import { gradePhotoCheck, type PhotoCheckSummary } from "../services/photoCheckGrading";
import { findLanguageViolation } from "./validation/language-guard";
import { callPolzaEmbedding } from "./providers/polza";
import { isProviderEnabled, supportsPromptCache, weightedTokens } from "./config";
import { recordUsage, getUsageStatus, type UsageStatus } from "../services/usage";
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
  /**
   * Состояние нормы после генерации. `over: true` = норма превышена, но
   * генерация всё равно выполнена (мягкий порог). UI по нему рисует баннер.
   */
  usage: UsageStatus | null;
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

  // Тип артефакта → задача роутера. Определяем ДО кэша: задача нужна и в
  // записи cache-hit, и для выбора модели.
  const task = taskForArtifact(request.type);

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
        task,
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
      // Попадание в кэш не тратит токены, поэтому норма не меняется: честно
      // возвращаем текущее состояние, чтобы UI не показывал «израсходовано».
      const usage = await getUsageStatus(db, userId, plan);
      return { worksheet: ws, meta, usage };
    }
  }

  // 4. LLM call с fallback.
  // Модель выбирается по ТИПУ АРТЕФАКТА (сложности), а не по тарифу:
  // листы/тесты/карточки/планы урока — Luna, контрольные и ОГЭ — Sonnet.
  const decision = pickModel(task, env);
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
      // Кэш — по свойству модели, а не по тарифу (см. supportsPromptCache).
      cacheSystemPrompt: supportsPromptCache(decision.primary?.model ?? "gpt-6-luna"),
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
      // Прогоняем ответы заданий через санитайзер `text_latex`:
      // модель иногда отдаёт блок `$...$` на пол-экрана или незакрытую
      // конструкцию — такое рендерить нельзя, блок выкидывается целиком,
      // и задание показывается обычным текстом. `text` НЕ трогаем: он
      // остаётся эталоном для self-verification и сверки ответов.
      tasks: Array.isArray(parsed.tasks)
        ? parsed.tasks.map((task) => {
            if (!task || typeof task !== "object") return task;
            const sanitized = sanitizeTextLatex(
              (task as { text_latex?: unknown }).text_latex,
            );
            // `as Record<string, unknown>` не проходит: у `WorksheetTask` нет
            // индексируемой подписи, и TypeScript считает приведение натянутым.
            // Промежуточный `unknown` — честное «смотрю как на словарь».
            const next = { ...(task as unknown as Record<string, unknown>) };
            if (sanitized) next.text_latex = sanitized;
            else delete next.text_latex;
            return next as unknown as Worksheet["tasks"][number];
          })
        : [],
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
    task,
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

  // 7b. Потребление по нормам тарифа (взвешенные токены). Мягкий порог:
  // recordUsage не бросает ошибок, только возвращает флаг `over`.
  const usage = await recordUsage(db, env, {
    userId,
    plan,
    weightedTokens: weightedTokens(result.model, result.response.tokensOut),
  });

  return { worksheet, meta, usage };
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
): Promise<{ variant: ExamVariant; meta: GenerateWorksheetMeta; usage: UsageStatus | null }> {
  const start = Date.now();
  const { exam, subject, variantNumber, plan, userId, ip } = args;

  const ipHash = await ipHashFromHeaders(new Headers({ "cf-connecting-ip": ip }));
  await checkLlmRateLimit(db, { userId, ipHash, plan });

  const decision = pickModel("exam-gen", env);
  const { system, user } = buildExamPrompt({ exam, subject, variantNumber });

  // TZ-13: language-guard с retry. До 2 ретраев, если LLM выдал не на том языке.
  // Каждый retry — новый вызов с тем же промптом. Если guard всё ещё нарушен —
  // принимаем последний результат как есть (лучше странный текст, чем 500).
  const MAX_LANG_RETRIES = 2;
  let result: Awaited<ReturnType<typeof callWithFallback>> | null = null;
  let variant: ExamVariant | null = null;
  let lastViolation: string | null = null;

  for (let attempt = 0; attempt <= MAX_LANG_RETRIES; attempt++) {
    result = await callWithFallback(
      {
        model: decision.primary?.model ?? "gpt-6-luna",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        responseFormat: "json",
        temperature: 0.7,
        maxTokens: 6000,
        cacheSystemPrompt: supportsPromptCache(decision.primary?.model ?? "gpt-6-luna"),
      },
      decision,
      env,
    );

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

    lastViolation = findLanguageViolation(variant, subject);
    if (!lastViolation) break;

    logLlmEvent("warn", "generateExam: language_guard violation, retrying", {
      attempt: attempt + 1,
      maxAttempts: MAX_LANG_RETRIES + 1,
      subject,
      violation: lastViolation,
    });
  }

  if (!variant || !result) {
    throw new InternalError("LLM: generateExam failed (no result)");
  }

  // TZ-13: LLM может отдать задания на иностранном языке для не-языкового предмета
  // (напр. «Open the brackets: She (read) a book now.» для физики). Промпт уже
  // содержит language-constraint, но он не гарантирован — нужен детерминированный guard.
  // Одна регенерация с явным указанием языка, потом fallback на mock.
  const langViolation = findLanguageViolation(variant, subject);
  if (langViolation) {
    console.warn(
      `[exam-gen] language guard tripped: subject=${subject} — ${langViolation}; regenerating with strict language instruction`,
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
        const retryViolation = findLanguageViolation(retryVariant, subject);
        if (!retryViolation) {
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

  const usage = await recordUsage(db, env, {
    userId,
    plan,
    weightedTokens: weightedTokens(result.model, result.response.tokensOut),
  });

  return { variant, meta, usage };
}

// ─────────────────────────────────────────────────────────────────────────────
// validateWorksheet
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidateWorksheetArgs {
  worksheet: Worksheet;
  context: { subject: string; grade: number; topic: string };
  /**
   * Тариф и личность вызывающего.
   *
   * Раньше здесь их не было, и `validateWorksheet` вообще не проверял квоту —
   * в отличие от `generateWorksheet`, `generateExam` и `photoCheck`, где лимит
   * есть. Ручка анонимная, поэтому проверка лимита оставшись единственным
   * ограничителем: она единственная преграда между публичным эндпоинтом и
   * платным LLM-вызовом. Нужны оба поля: userId для счёта по человеку, ip —
   * для анонимов.
   */
  plan?: "free" | "base" | "plus";
  userId?: string | null;
  ip?: string;
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

  // Квота. Раньше её не было — см. комментарий у ValidateWorksheetArgs.
  // Аноним считаем по IP: у него нет userId, иначе ключ счёта был бы пустым
  // и все анонимы делили бы один счётчик (или, что хуже, обходили лимит).
  const ipHash = await ipHashFromHeaders(new Headers({ "cf-connecting-ip": args.ip ?? "0.0.0.0" }));
  await checkLlmRateLimit(db, {
    userId: args.userId ?? null,
    ipHash,
    plan: args.plan ?? "free",
  });
  const decision = pickModel("validate", env);
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
  // callPolzaEmbedding принимает один объект-аргумент { env, model, input }.
  // Раньше здесь передавались три позиционных аргумента — не компилировалось.
  const { vectors, costUsd } = await callPolzaEmbedding({ env, model, input: args.texts });
  return { vectors, model, costUsd };
}

// ─────────────────────────────────────────────────────────────────────────────
// checkPhoto (TZ-11)
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckPhotoArgs {
  /** Фото страницы тетради в байтах (уже сжатое на клиенте). */
  imageBytes: ArrayBuffer;
  mimeType: string;
  /** Эталоны из тела запроса. */
  tasks: PhotoCheckTask[];
  subject?: string;
  grade?: number;
  /** `low` — черновик/массовая проверка, `high` — финальная сверка. */
  detail?: "low" | "high";
  plan: "free" | "base" | "plus";
  userId: string | null;
  ip: string;
}

export interface CheckPhotoResult {
  summary: PhotoCheckSummary;
  model: string;
  provider: string;
  costUsd: number;
  latencyMs: number;
  /** Оценка ожидаемой стоимости ДО вызова — для логов и лимитов. */
  estimatedCostUsd: number;
  estimatedImageTokens: number;
}

/**
 * Распознать фото работы и сверить с эталоном.
 *
 * Отличие от остальных задач слоя: сообщение мультимодальное — в content-part
 * кладётся data-URL картинки. Сам data-URL собирает вызывающий роут (у него
 * есть байты); здесь мы только строим content-part и считаем картинку.
 */
export async function checkPhoto(
  args: CheckPhotoArgs,
  env: Env,
  db: D1Database,
): Promise<CheckPhotoResult> {
  const start = Date.now();
  const detail = args.detail ?? "low";

  await checkLlmRateLimit(db, { userId: args.userId, ipHash: await ipHashFromHeaders(new Headers({ "cf-connecting-ip": args.ip })), plan: args.plan });

  const decision = pickModel("photo-check", env);
  if (!decision.primary) {
    throw new InternalError(
      "photo-check: vision-модель недоступна (нужен POLZA_API_KEY)",
    );
  }

  const { system, user } = buildPhotoCheckPrompt(args.tasks, {
    subject: args.subject,
    grade: args.grade,
  });

  // Оценка стоимости ДО вызова: грубая, по размеру картинки (см. cost.ts).
  // Реальную стоимость вернёт провайдер в usage — её и тарифицирует calcCost.
  const estimatedImageTokens = estimateImageTokens(
    args.imageBytes.byteLength > 0 ? 1600 : 0,
    args.imageBytes.byteLength > 0 ? 1600 : 0,
    detail,
  );
  const estimatedCostUsd = calcCost(decision.primary.model, estimatedImageTokens, 1000);

  // Картинку кладём data-URL прямо в content-part — OpenAI-совместимый формат,
  // polza такой принимает наравне с внешним URL. Отдельный R2-URL тут не нужен:
  // он всё равно просидел бы в логах провайдера как ссылка на ПДн ребёнка.
  const dataUrl = `data:${args.mimeType};base64,${arrayBufferToBase64(args.imageBytes)}`;

  const result = await callWithFallback(
    {
      model: decision.primary.model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: user },
            { type: "image_url", image_url: { url: dataUrl, detail } },
          ],
        },
      ],
      responseFormat: "json",
      temperature: 0.1, // распознавание — почти детерминированная задача
      maxTokens: 4000,
    },
    decision,
    env,
  );

  const summary = gradePhotoCheck(result.response.content, args.tasks);
  const latencyMs = Date.now() - start;

  await logLlmCall(db, {
    userId: args.userId,
    task: "photo-check",
    provider: result.provider,
    model: result.model,
    plan: args.plan,
    tokensIn: result.response.tokensIn,
    tokensOut: result.response.tokensOut,
    costUsd: result.response.costUsd,
    latencyMs,
    cached: false,
    fallback: result.generation === "boost",
  });

  return {
    summary,
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    latencyMs,
    estimatedCostUsd,
    estimatedImageTokens,
  };
}

/** ArrayBuffer → base64 без btoa (в Workers btoa есть, но принимает только latin1). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000; // по кускам, иначе спред упрётся в лимит аргумента
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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

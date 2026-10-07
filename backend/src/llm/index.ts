/**
 * Публичный фасад LLM-слоя для routes.
 *
 * Импортируется как `import { generateWorksheet, validateWorksheet, embed, generateExam } from "../llm";`
 *
 * Контракт:
 *  - generateWorksheet(...) → { worksheet, meta }
 *  - generateExam(...)      → { variant, meta }
 *  - generateLessonPlan/generatePresentation/generateKtp/generateCards/
 *    generateMaterials(...) → { artifact: { id, createdAt, ... }, meta, usage }
 *    (общий конвейер generateStructuredArtifact; ключ ответа у роутов свой:
 *     lessonPlan / presentation / ktp / cardSet / materialBundle)
 *  - validateWorksheet(...) → { score, issues, meta }
 *  - verifySelfTask(...)    → { verified, answer, explanation, latencyMs, model }
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
import { BadRequestError, InternalError, throwApiError } from "../lib/errors";
import { logLlmEvent } from "./log";
import { moderateGenerationRequest } from "./moderation";
import { checkLlmRateLimit, ipHashFromHeaders } from "./ratelimit";
import { callWithFallback, pickModel, taskForArtifact } from "./router";
import { lookupCache, makeCacheKey, saveCache } from "./cache";
import { buildWorksheetPrompt, sanitizeTextLatex } from "./prompts/worksheet-gen";
import { buildExamPrompt } from "./prompts/exam-gen";
import type { ArtifactRequest } from "./prompts/artifact-gen";
import {
  buildLessonPlanPrompt,
  normalizeLessonPlan,
  type LessonPlanContent,
} from "./prompts/lesson-plan-gen";
import {
  buildPresentationPrompt,
  normalizePresentation,
  type PresentationContent,
} from "./prompts/presentation-gen";
import { buildKtpPrompt, normalizeKtp, type KtpContent } from "./prompts/ktp-gen";
import { buildCardsPrompt, normalizeCardSet, type CardSetContent } from "./prompts/cards-gen";
import {
  buildMaterialsPrompt,
  normalizeMaterialBundle,
  type MaterialBundleContent,
} from "./prompts/materials-gen";
import { buildValidatePrompt } from "./prompts/validate";
import { SOLVE_PROMPT, VERIFY_PROMPT } from "./prompts/self-verify";
import { buildPhotoCheckPrompt, type PhotoCheckTask } from "./prompts/photo-check";
import { calcCost, estimateImageTokens } from "./cost";
import { gradePhotoCheck, type PhotoCheckSummary } from "../services/photoCheckGrading";
import { findLanguageViolation, passesLanguageGuard } from "./validation/language-guard";
import { reconcileSelfVerifyVerdict } from "./validation/answer-check";
import { callPolzaEmbedding } from "./providers/polza";
import {
  isProviderEnabled,
  supportsPromptCache,
  weightedTokens,
  MODEL_COSTS,
  REFERENCE_MODEL_ID,
} from "./config";
import { recordUsage, getUsageStatus, type UsageStatus, type UsagePlan } from "../services/usage";
import { shortId, worksheetId } from "../lib/shortid";
import type { GenerationKind } from "./types";
import type { GenerationRequest, Worksheet, ExamVariant, SubjectSlug, GenerateWorksheetMeta } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// generateWorksheet
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateWorksheetArgs {
  request: GenerationRequest;
  plan: "free" | "base" | "standard" | "plus";
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
  // Кэш персональный по владельцу: см. NEW-COST-6 в llm/cache.ts. Анонимные
  // запросы (userId = null) делят один адрес кэша — иначе пришлось бы либо
  // отдавать анонимам чужое, либо не кэшировать вовсе.
  const cacheKey = makeCacheKey({ ...request, userId });
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
    // BL-08: без этого отказ писался бы как «отказ неизвестного у неизвестной
    // задачи», и по базе было нельзя понять, какой тип материала ломается.
    { task, userId, plan },
  );

  // 5. Parse JSON
  let worksheet: Worksheet;
  try {
    const parsed = JSON.parse(result.response.content) as Worksheet;
    // id и createdAt — ТОЛЬКО серверные, значение от модели игнорируется
    // полностью (не «подставляем, если пусто»).
    //
    // Почему именно так, а не `parsed.id ?? серверный`:
    //
    //  1. ПОТЕРЯ ДАННЫХ. `worksheets.id` — первичный ключ, а сохранение идёт
    //     через `INSERT OR REPLACE` (services/worksheet.ts). Идентификатор,
    //     придуманный моделью, детерминирован: один и тот же запрос
    //     (предмет+класс+тема) даёт один и тот же `id`. Два учителя с
    //     одинаковым запросом писали в одну строку — лист второго затирал
    //     лист первого вместе с его `user_id`. Это подтверждено на проде:
    //     три запроса подряд возвращали `ws_biology_grade7_photosynthesis_hard_01`.
    //  2. ЧУЖИЕ ЛИСТЫ ПО УГАДАННОМУ НОМЕРУ. Номера предсказуемы, а анонимный
    //     лист (`user_id = null`) отдаёт по `GET /api/worksheets/:id` без входа
    //     (routes/worksheets.ts:254). Отсюда: `GET ws_math_grade5_fractions_easy_001`
    //     без авторизации отдавал чужой анонимный лист — HTTP 200.
    //
    // createdAt — по той же причине: модель писала туда константу
    // (`2025-03-08T00:00:00Z` на проде), и это значение уходило в базу как
    // время создания листа, отстоящее на полтора года.
    worksheet = {
      id: worksheetId(),
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
      createdAt: new Date().toISOString(),
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
  plan: "free" | "base" | "standard" | "plus";
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
// Пять «документных» типов: план урока, презентация, КТП, карточки, материалы
//
// Общий конвейер generateStructuredArtifact. Разбирать его в пяти копиях
// generateWorksheet незачем: шаги одни и те же (moderation → rate-limit → кэш →
// выбор модели по задаче → LLM → JSON → нормализация → server-side id →
// llm_logs → норма тарифа), различаются только промпт и разбор ответа.
//
// Отличие от generateExam в одном принципиальном месте: там language-guard,
// сработав дважды, уводит в `emptyVariant` — то есть отдаёт заготовку. Здесь
// такого нет: заготовка вместо материала здесь означала бы, что учителю отдали
// сгенерированный документ, которого не генерировали (ровно та нечестность,
// ради которой эти пять эндпоинтов и делаются). Если разбор или язык не годятся —
// бросаем ошибку, фронт сам покажет пользователю, что генерация не удалась.
// ─────────────────────────────────────────────────────────────────────────────

export interface ArtifactGenerationArgs {
  request: ArtifactRequest;
  plan: "free" | "base" | "standard" | "plus";
  bypassCache?: boolean;
  userId: string | null;
  ip: string;
}

export interface ArtifactSpec<T> {
  /** Тип артефакта: ключ кэша и поле `task` в llm_logs. */
  artifactType: string;
  /** Задача роутера — по ней выбирается модель. */
  task: GenerationKind;
  /** Сборка промпта. */
  buildPrompt: (req: ArtifactRequest) => { system: string; user: string };
  /**
   * Разбор ответа модели в артефакт. Возвращает объект БЕЗ `id`/`createdAt` —
   * технические поля проставляет сервер.
   * Бросает Error, если из ответа не получается содержательный материал.
   */
  normalize: (raw: unknown, req: ArtifactRequest) => T;
  /** Префикс серверного id: `lp_`, `pres_`, `ktp_`, `card_`, `mat_`. */
  idPrefix: string;
  /** Влияет на maxTokens: KTP на год — самый объёмный документ. */
  maxTokens: number;
}

export interface ArtifactResult<T> {
  /** Артефакт с серверными `id` и `createdAt`. */
  artifact: T & { id: string; createdAt: string };
  meta: GenerateWorksheetMeta;
  usage: UsageStatus | null;
}

/**
 * Что кладём в semantic_cache: артефакт БЕЗ технических полей.
 *
 * Это не только экономит пару полей. Идентификатор материала выдаётся на
 * каждый ответ: если хранить его в кэше, два одинаковых запроса вернут один и
 * тот же `id`, а фронт по нему ключует историю и сохраняет материал — второй
 * учитель (или второй tab) молча перезаписал бы первый материал тем же самым
 * ключом. Поэтому в кэше лежит только содержание, а `id`/`createdAt`
 * проставляются при каждой отдаче.
 */
type CachedArtifact = Record<string, unknown>;

const MAX_LANG_RETRIES = 1;

export async function generateStructuredArtifact<T extends object>(
  spec: ArtifactSpec<T>,
  args: ArtifactGenerationArgs,
  env: Env,
  db: D1Database,
): Promise<ArtifactResult<T>> {
  const start = Date.now();
  const { request, plan, bypassCache = false, userId, ip } = args;

  // 1. Moderation — до всего остального, чтобы заведомо мусорный ввод не дошёл
  // до платного вызова.
  const mod = moderateGenerationRequest({ subject: request.subject, topic: request.topic });
  if (!mod.ok) {
    throw new BadRequestError(`Invalid input: ${mod.reason}`, { reason: mod.reason });
  }

  const { artifactType, task } = spec;

  // 2. Rate-limit (та же проверка, что в generateWorksheet).
  const ipHash = await ipHashFromHeaders(new Headers({ "cf-connecting-ip": ip }));
  await checkLlmRateLimit(db, { userId, ipHash, plan });

  // 3. Cache lookup. Кэш персональный по владельцу (NEW-COST-6, llm/cache.ts).
  const cacheKey = makeCacheKey({ ...request, type: artifactType, userId });
  if (!bypassCache) {
    const cached = await lookupCache(db, cacheKey);
    const cachedArtifact = extractCachedArtifact(cached);
    if (cachedArtifact) {
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
      // Попадание в кэш не тратит токены → норма не меняется (как в generateWorksheet).
      const usage = await getUsageStatus(db, userId, plan);
      return {
        artifact: stampArtifact(cachedArtifact as T, spec.idPrefix),
        meta,
        usage,
      };
    }
  }

  // 4. LLM call. Модель выбирается по задаче роутера (lesson-plan-gen / presentation-gen /
  //    ktp-gen / cards-gen / worksheet-gen), тариф на выбор модели не влияет.
  const decision = pickModel(task, env);
  const model = decision.primary?.model ?? "gpt-6-luna";
  const { system, user } = spec.buildPrompt(request);

  let result: Awaited<ReturnType<typeof callWithFallback>> | null = null;
  let content: T | null = null;
  let lastViolation: string | null = null;

  for (let attempt = 0; attempt <= MAX_LANG_RETRIES; attempt++) {
    const strictRetry = attempt > 0;
    result = await callWithFallback(
      {
        model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: strictRetry
              ? user +
                "\n\nВНИМАНИЕ: предыдущая попытка вернула материал на иностранном языке. " +
                "Это ошибка. Перегенерируй — ВЕСЬ материал строго на русском языке " +
                "(если предмет не английский/немецкий)."
              : user,
          },
        ],
        responseFormat: "json",
        temperature: 0.7,
        maxTokens: spec.maxTokens,
        // На retry системный промпт другой (с добавленным требованием) — кэш
        // провайдера по нему бессмысленен.
        cacheSystemPrompt: !strictRetry && supportsPromptCache(model),
      },
      decision,
      env,
      { task, userId, plan },
    );

    // 5. Parse + нормализация.
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.response.content);
    } catch {
      throw new InternalError(`LLM returned invalid JSON for ${artifactType}`);
    }

    try {
      content = spec.normalize(parsed, request);
    } catch (err) {
      // Модель ответила чем-то, из чего не получается материал (пустые стадии,
      // слайды без заголовков, нет домашнего задания). Заглушку не подставляем:
      // 500 честнее материала, которого нет.
      logLlmEvent("error", `generateStructuredArtifact: unparsable ${artifactType}`, {
        task,
        artifactType,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new InternalError(`LLM returned unusable ${artifactType}: ${errorMessage(err)}`);
    }

    // 6. Language guard. Детерминированная проверка на тексте самого материала:
    // модель периодически уходит в английский на русскоязычных предметах.
    lastViolation = findArtifactLanguageViolation(content, request.subject);
    if (!lastViolation) break;

    logLlmEvent("warn", `generateStructuredArtifact: language guard violation, ${artifactType}`, {
      attempt: attempt + 1,
      maxAttempts: MAX_LANG_RETRIES + 1,
      subject: request.subject,
      violation: lastViolation,
    });
  }

  if (!content || !result) {
    throw new InternalError(`LLM: ${artifactType} generation failed (no result)`);
  }

  // Guard не отпустил даже после retry — ошибка, а не заготовка. Причина в том,
  // что учитель получил бы чужой язык в оплаченном материале и не смог бы
  // понять, почему.
  if (lastViolation) {
    throw new InternalError(
      `LLM returned ${artifactType} in wrong language (${lastViolation}) after ${MAX_LANG_RETRIES} retries`,
    );
  }

  // 7. id и createdAt — ТОЛЬКО серверные, значение от модели не принимается
  //    вообще (разбор в generateWorksheet: почему именно так).
  const artifact = stampArtifact(content, spec.idPrefix);

  const meta: GenerateWorksheetMeta = {
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    latencyMs: Date.now() - start,
    cached: false,
    generation: result.generation,
  };

  // 8. В кэш — содержание без технических полей (см. CachedArtifact).
  await saveCache(db, {
    key: cacheKey,
    subject: request.subject,
    grade: request.grade,
    topic: request.topic,
    difficulty: request.difficulty,
    count: request.count,
    type: artifactType,
    response: { artifact: content },
  });

  // 9. Log
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

  // 9b. Норма тарифа (мягкий порог, recordUsage не бросает ошибок).
  const usage = await recordUsage(db, env, {
    userId,
    plan,
    weightedTokens: weightedTokens(result.model, result.response.tokensOut),
  });

  return { artifact, meta, usage };
}

/** Технические поля: только сервер и только свежие. */
function stampArtifact<T extends object>(
  content: T,
  idPrefix: string,
): T & { id: string; createdAt: string } {
  return {
    ...content,
    id: `${idPrefix}_${shortId()}`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Достать артефакт из записи кэша.
 *
 * Битая запись (старый формат, обрезанный JSON) считается промахом: лучше
 * сходить к провайдеру, чем отдать учителю половину материала.
 */
function extractCachedArtifact(cached: unknown): CachedArtifact | null {
  if (!cached || typeof cached !== "object" || !("response" in cached)) return null;
  const response = (cached as { response?: unknown }).response;
  if (!response || typeof response !== "object") return null;
  const artifact = (response as Record<string, unknown>).artifact;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return null;
  return artifact as CachedArtifact;
}

/**
 * Language guard для произвольного артефакта.
 *
 * У листа и экзамена есть типизированный `findLanguageViolation` (по варианту
 * задания). Здесь артефакты пяти разных форм, поэтому проверяем текст целиком:
 * JSON без технических полей — это просто весь учебный текст документа.
 */
function findArtifactLanguageViolation(content: unknown, subject: string): string | null {
  if (!passesLanguageGuard(JSON.stringify(content), subject as SubjectSlug)) {
    return `subject=${subject} (требуется русский текст)`;
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Пять типов: тонкие обёртки над общим конвейером ────────────────────────

export async function generateLessonPlan(
  args: ArtifactGenerationArgs,
  env: Env,
  db: D1Database,
): Promise<ArtifactResult<LessonPlanContent>> {
  return generateStructuredArtifact<LessonPlanContent>(
    {
      artifactType: "lesson-plan",
      task: "lesson-plan-gen",
      buildPrompt: buildLessonPlanPrompt,
      normalize: normalizeLessonPlan,
      idPrefix: "lp",
      maxTokens: 4096,
    },
    args,
    env,
    db,
  );
}

export async function generatePresentation(
  args: ArtifactGenerationArgs,
  env: Env,
  db: D1Database,
): Promise<ArtifactResult<PresentationContent>> {
  return generateStructuredArtifact<PresentationContent>(
    {
      artifactType: "presentation",
      task: "presentation-gen",
      buildPrompt: buildPresentationPrompt,
      normalize: normalizePresentation,
      idPrefix: "pres",
      // Слайды с подписями и заметками учителя — больше токенов, чем лист.
      maxTokens: 8000,
    },
    args,
    env,
    db,
  );
}

export async function generateKtp(
  args: ArtifactGenerationArgs,
  env: Env,
  db: D1Database,
): Promise<ArtifactResult<KtpContent>> {
  return generateStructuredArtifact<KtpContent>(
    {
      artifactType: "ktp",
      task: "ktp-gen",
      buildPrompt: buildKtpPrompt,
      normalize: normalizeKtp,
      idPrefix: "ktp",
      // Годовой план на 34–36 недель — самый объёмный документ из пяти.
      maxTokens: 16000,
    },
    args,
    env,
    db,
  );
}

export async function generateCards(
  args: ArtifactGenerationArgs,
  env: Env,
  db: D1Database,
): Promise<ArtifactResult<CardSetContent>> {
  return generateStructuredArtifact<CardSetContent>(
    {
      artifactType: "cards",
      task: "cards-gen",
      buildPrompt: buildCardsPrompt,
      normalize: normalizeCardSet,
      idPrefix: "card",
      maxTokens: 4096,
    },
    args,
    env,
    db,
  );
}

export async function generateMaterials(
  args: ArtifactGenerationArgs,
  env: Env,
  db: D1Database,
): Promise<ArtifactResult<MaterialBundleContent>> {
  return generateStructuredArtifact<MaterialBundleContent>(
    {
      artifactType: "materials",
      // Отдельной GenerationKind для материалов нет: комплект раздаток — тот же
      // дешёвый класс документа, что и рабочий лист (см. ARTIFACT_TASK в router.ts).
      task: "worksheet-gen",
      buildPrompt: buildMaterialsPrompt,
      normalize: normalizeMaterialBundle,
      idPrefix: "mat",
      // Несколько файлов с длинным текстом.
      maxTokens: 8000,
    },
    args,
    env,
    db,
  );
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
  plan?: "free" | "base" | "standard" | "plus";
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
    // BL-08: задача «validate» вместо «unknown» — иначе в разборе причин
    // проверка листа и её генерация слипались бы в одну строку.
    { task: "validate", userId: args.userId ?? null, plan: args.plan ?? "free" },
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
// verifySelfTask (F-05-B) — двухпроходная проверка одного задания
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfVerifyTaskInput {
  subject: string;
  grade: number;
  topic: string;
  text: string;
  expectedAnswer?: string;
}

export interface SelfVerifyArgs {
  task: SelfVerifyTaskInput;
  userId: string | null;
  plan: "free" | "base" | "standard" | "plus";
}

export interface SelfVerifyResult {
  verified: boolean;
  answer: string;
  explanation: string;
  latencyMs: number;
  /** Модель, которая ответила на verify-проход (она же решала задачу). */
  model: string;
}

/**
 * Поймать ли «провайдер вернул пустой content» в ошибке callWithFallback.
 *
 * callWithFallback проглатывает ошибку провайдера и перебрасывает свою
 * (`LLM: all providers failed (N attempts). Last: <текст ошибки провайдера>`),
 * поэтому узнать причину можно только по тексту. Строка «вернул пустой content» —
 * наш собственный текст из providers/polza.ts, и она же уезжает в тело 500,
 * который видит учитель на фронте: если поменяем формулировку в polza.ts, retry
 * просто перестанет срабатывать, и это будет видно по логу, а не молча.
 *
 * Намеренно ловится ТОЛЬКО пустой ответ, а не любая ошибка провайдера:
 *  - сетевой сбой и HTTP 500 у polza уже прогоняются своей логикой
 *    (fallback-цепочка в роутере), дублировать её здесь — значит удвоить
 *    число запросов к платному провайдеру на ровно тех же ошибках;
 *  - «пустой content» — единственный отказ, который наблюдался на проде
 *    (500 «LLM: all providers failed (1 attempts). Last: polza вернул пустой
 *    content»), и единственный, где повтор заведомо безопасен.
 */
function isEmptyContentFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("вернул пустой content");
}

/**
 * Временный отказ провайдера, при котором повтор обычно срабатывает (BL-09).
 *
 * Это НЕ те же отказы, что `isEmptyContentFailure`: «пустой content» — про
 * модель, которая ответила, но ничем; здесь — про провайдера, который не
 * ответил вовсе. Различать важно, потому что лечатся они по-разному: пустой
 * content бывает и на устойчивом сбое модели (повтор бесполезен), а 429/503 —
 * почти всегда про momentarily перегрузку, где повтор через пару секунд
 * обычно проходит.
 *
 * Повтор делается ровно один раз, и общий бюджет не растёт: этот блок и так
 * ограничен одной дополнительной попыткой.
 */
function isTransientProviderFailure(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  // 429 — лимит на стороне провайдера, 503/502 — провайдер недоступен или
  // прокси сброснул соединение. Сетевой сбой ловится по типовым формулировкам.
  return (
    /http (429|500|502|503|504)\b/.test(msg) ||
    msg.includes("all providers failed") ||
    msg.includes("network failure") ||
    msg.includes("fetch failed")
  );
}

/**
 * Проверить одно задание двумя проходами через LLM: solve → verify.
 *
 * Логика перенесена из отдельного воркера `worker-self-verify/` (10.10.2026),
 * где ключа POLZA_API_KEY не было, а отсутствие ключа молча возвращало подставной
 * `verified: true`. Здесь ключ один — тот же, что у генерации, и ПОДСТАВНОЙ
 * ОТВЕТ НЕДОПУСТИМ: по нему решается, зачтена ли ученику работа. Нет ключа,
 * провайдер упал или JSON не распарсился → ошибка (503/502), фронт показывает
 * «не проверено». Ни одна ветка этого кода не отдаёт 200 без реального
 * ответа модели.
 *
 * Задача роутера — существующая «validate» (deepseek-v4-flash через polza):
 * новый GenerationKind не заводим, матрица роутинга закрыта тестами.
 *
 * Про `checkLlmRateLimit` здесь сознательно НЕТ, хотя он есть в llm/ratelimit.ts:
 * он тянет бесплатную квоту «3 генерации всего», а self-verify зовётся по одному
 * разу на КАЖДОЕ задание листа (src/lib/mock/generator.ts) — квота кончалась бы
 * на третьем задании, и проверка молча выключалась бы на всех листах. Лимит
 * частоты тут ставит HTTP-слой (rateLimitMiddleware в routes/llm.ts).
 *
 * Что гарантирует честность вердикта (06.10.2026):
 *  1. Проход 1 НЕ видит эталон — иначе проверка сравнивала бы подстроенное
 *     решение с той же подсказкой и всегда отвечала «верно».
 *  2. Проход 2 получает извлечённый финальный ответ, а не текст решения.
 *  3. Поверх ответа модели идёт детерминированная сверка ответа с эталоном
 *     (validation/answer-check.ts): модель не может подтвердить заведомо
 *     неверный ответ.
 */
export async function verifySelfTask(
  args: SelfVerifyArgs,
  env: Env,
  db: D1Database,
): Promise<SelfVerifyResult> {
  const start = Date.now();
  const { userId, plan } = args;
  const task = args.task;

  const decision = pickModel("validate", env);
  if (!decision.primary) {
    throw throwApiError(
      503,
      "LLM_UNAVAILABLE",
      "Проверка ответа недоступна: не настроен POLZA_API_KEY. Ответ НЕ проверен.",
    );
  }
  const model = decision.primary.model;

  // ── Проход 1: решить ──────────────────────────────────────────────────────
  const solveRequest = {
    model,
    messages: [
      {
        role: "user" as const,
        content: SOLVE_PROMPT({
          subject: task.subject,
          grade: task.grade,
          topic: task.topic,
          taskText: task.text,
          // `expectedAnswer` сюда НЕ передаётся и не должен: первый проход обязан
          // решать независимо. С эталоном, подставленным в решающий промпт,
          // проверка превращалась в равенство «подстроили → сравнили с тем же
          // самым» и всегда давала verified: true. Подробности — в шапке
          // prompts/self-verify.ts.
        }),
      },
    ],
    // Решение — свободный текст с «Ответ: …», JSON тут не нужен.
    temperature: 0,
    // 800 → 2000 (06.10.2026). 800 — это потолок для ЦЕЛОГО развёрнутого
    // решения, и для модели с размышлением этого мало: внутреннее
    // «обдумывание» идёт в том же счётчике токенов, что и видимый ответ, и
    // на задачу в два-три шага оно может забрать большую часть 800, оставив
    // наружу пустоту. Именно это, судя по прод-симптому, и происходит.
    //
    // Почему 2000, а не «с запасом»:
    //  - типичное решение из двух-трёх шагов — это 150–400 токенов видимого
    //    текста, плюс размышление сверху; 2000 переживает эту картину с
    //    запасом и не превращается в «потолок не считается»;
    //  - лишнее платить НЕ придётся: max_tokens — это потолок, а не счёт.
    //    Провайдер тарифицирует фактически сгенерированное: если модель
    //    уложилась в 400 токенов, мы платим за 400, а не за 2000. Поднимаем
    //    потолок, а не расход — расход растёт только если модель правда
    //    генерирует больше;
    //  - даже в худшем случае 2000 токенов на deepseek-v4-flash — это
    //    0.13 $/1M выхода ≈ $0.00026 (≈0.02 ₽) за вызов, против цены
    //    отказа, который учитель видит как «не проверено».
    maxTokens: 2000,
  };

  // ── Ровно ОДИН повтор при пустом ответе (06.10.2026) ──────────────────────
  //
  // Прод-симптом: ручка /api/llm/verify на ОДНОЙ И ТОЙ ЖЕ задаче («2/5 + 3/5»)
  // из 6 одинаковых запросов отвечала 4 раза, а 2 раза — 500 «polza вернул
  // пустой content». Промпт один и тот же, temperature: 0 — то есть ответ НЕ
  // детерминирован, и та же задача второй раз отвечает нормально. Значит
  // повтор реально помогает, а отказ — не «модель не может», а обрыв.
  //
  // Почему повтор здесь, а НЕ в провайдере polza.ts (общим правилом на пустой
  // ответ): такой retry поменял бы поведение ВСЕХ эндпоинтов сразу — генерация
  // листов, экзаменов, КТП, проверка фото. Это другая задача и другой риск по
  // деньгам (там объём вызовов на два-три порядка больше). Здесь повтор — точечная
  // правка одной ручки.
  //
  // Почему ровно ОДИН, а не цикл: иначе отказ превращается в шторм запросов к
  // платному провайдеру — ровно тот сценарий, в котором система отвечает «не
  // проверено» и одновременно жжёт деньги. Один повтор стоит максимум один
  // лишний вызов на задание и закрывает большинство случаев (повтор успешен
  // примерно в половине — столько же, сколько было успехов среди первых
  // попыток).
  //
  // Повтор идёт ТЕМ ЖЕ запросом и тем же тарифом: его расход попадает в учёт
  // и логи как обычный вызов (см. logLlmCall ниже и блок recordUsage — обе
  // строки считаются по фактическим `solve`/`verify`, а retry лишь меняет, какой
  // именно CallResult стал `solve`). Отдельной «бесплатной» строки в счёте не
  // появляется: неуспешная попытка токенов не вернула — их нечего тарифицировать,
  // и провайдер за пустой ответ не берёт деньги.
  let solve: Awaited<ReturnType<typeof callWithFallback>>;
  try {
    solve = await callWithFallback(solveRequest, decision, env);
  } catch (e) {
    // BL-09: повтор срабатывал ТОЛЬКО на «пустой content». То есть при 429
    // (лимит провайдера) и 503 (провайдер недоступен) — самых частых и самых
    // временных отказах — повтор не делался, и учитель сразу получал «не
    // проверено». Асимметрия была обратной ожидаемому: повторяли ровно тот
    // случай, где повтор бесполезен (модель стабильно не отвечает), и не
    // повторяли там, где он обычно срабатывает (кратковременная перегрузка).
    //
    // Один повтор здесь безопасен: это максимум один лишний вызов, и он не
    // превращается в шторм — всего одна попытка сверх первой.
    if (!isEmptyContentFailure(e) && !isTransientProviderFailure(e)) throw e;
    logLlmEvent("warn", "verifySelfTask: solve не ответил, одна повторная попытка", {
      model,
      attempt: 1,
      maxAttempts: 2,
      reason: isEmptyContentFailure(e) ? "empty_content" : "transient_provider",
    });
    // Второй вызов — вне try: если он тоже не ответит, ошибка уходит наверх
    // как раньше (500), а не превращается в бесконечный повтор.
    solve = await callWithFallback(solveRequest, decision, env);
    logLlmEvent("info", "verifySelfTask: повтор solve дал ответ", {
      model: solve.model,
      provider: solve.provider,
    });
  }

  const answer = extractSelfVerifyAnswer(solve.response.content);

  // Модель ответила пустотой: извлекать нечего, а отправлять пустую строку в
  // verify-проход означало бы отдать проверяющему задачу без ответа и получить
  // от него случайный вердикт. Это та же категория, что и неразбираемый JSON
  // ниже: «проверка не выполнена», а не «работа неверна» → 502, фронт рисует
  // «не проверено».
  if (!answer) {
    throw throwApiError(
      502,
      "LLM_BAD_RESPONSE",
      "Проверка ответа не выполнена: модель не вернула финальный ответ задачи",
      { model: solve.model, preview: solve.response.content.slice(0, 200) },
    );
  }

  // ── Проход 2: проверить ───────────────────────────────────────────────────
  const verify = await callWithFallback(
    {
      model,
      messages: [
        {
          role: "user",
          content: VERIFY_PROMPT({
            subject: task.subject,
            grade: task.grade,
            taskText: task.text,
            // Именно извлечённый финальный ответ, а не весь текст решения.
            // Раньше сюда уходил `solve.response.content` — проверяющий
            // сравнивал формулировки («Шаг 1: складываем дроби…») вместо ответов,
            // и это ещё один путь к безусловному `true`.
            proposedAnswer: answer,
            expectedAnswer: task.expectedAnswer,
          }),
        },
      ],
      responseFormat: "json",
      temperature: 0,
      maxTokens: 800,
    },
    decision,
    env,
  );

  const parsed = parseSelfVerifyJson(verify.response.content);
  if (!parsed) {
    // Модель ответила, но не тем форматом, который мы разобрать можем.
    // Отвечаем 502, а НЕ `verified: false`: «не смогли разобрать» и «решение
    // неверное» — разные вещи, и учитель должен видеть первую, а не вторую.
    throw throwApiError(502, "LLM_BAD_RESPONSE", "Проверка ответа не выполнена: модель вернула неожиданный формат ответа", {
      model: verify.model,
      preview: verify.response.content.slice(0, 200),
    });
  }

  // ── Учёт: оба вызова платные, оба и тарифицируются ───────────────────────
  const latencyMs = Date.now() - start;

  // Две строки в llm_logs — по одной на вызов: сходимость расхода с биллингом
  // проверяется по вызовам, а не по сумме одной записи.
  for (const step of [
    { stage: "solve", res: solve },
    { stage: "verify", res: verify },
  ]) {
    await logLlmCall(db, {
      userId,
      task: "validate",
      provider: step.res.provider,
      model: step.res.model,
      plan,
      tokensIn: step.res.response.tokensIn,
      tokensOut: step.res.response.tokensOut,
      costUsd: step.res.response.costUsd,
      latencyMs,
      cached: false,
      fallback: step.res.generation === "boost",
    });
    logLlmEvent("info", "verifySelfTask: step done", {
      stage: step.stage,
      model: step.res.model,
      provider: step.res.provider,
      tokensIn: step.res.response.tokensIn,
      tokensOut: step.res.response.tokensOut,
      costUsd: step.res.response.costUsd,
    });
  }

  await recordUsage(db, env, {
    userId,
    plan,
    // Сумма взвешенных токенов обоих проходов — «изобретать свою формулу»
    // нельзя, норма тарифа считается ровно этой единицей.
    weightedTokens:
      weightedTokens(solve.model, solve.response.tokensOut) +
      weightedTokens(verify.model, verify.response.tokensOut),
  });

  // Страховка поверх ответа модели: если модель сказала «верно», а извлечённый
  // ответ заведомо не совпадает с эталоном — итог всё равно «неверно».
  // Обоснование и границы метода — в validation/answer-check.ts; там же о том,
  // почему сверка может только ЗАПРЕТИТЬ «верно», но не выдать его.
  const verdict = reconcileSelfVerifyVerdict({
    modelVerified: parsed.verified,
    proposedAnswer: answer,
    expectedAnswer: task.expectedAnswer,
  });
  if (verdict.overridden) {
    logLlmEvent("warn", "verifySelfTask: модель подтвердила расхождение с эталоном", {
      model: verify.model,
      proposed: answer.slice(0, 100),
      expected: (task.expectedAnswer ?? "").slice(0, 100),
    });
  }

  return {
    verified: verdict.verified,
    answer,
    // Пояснение дополняем заметкой сверки: по одному тексту модели непонятно,
    // откуда взялся вердикт, а учитель видит именно строку explanation.
    explanation: verdict.note
      ? parsed.reason
        ? `${parsed.reason} ${verdict.note}`
        : verdict.note
      : parsed.reason,
    latencyMs,
    model: verify.model,
  };
}

/**
 * Извлечь финальный ответ из свободного текста решения (перенесено из воркера).
 * Модель возвращает текст вида "...Ответ: 7/3" — берём последнее вхождение.
 */
export function extractSelfVerifyAnswer(solveText: string): string {
  const lines = solveText.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    const match = line.match(/(?:^|\s)(?:ответ|answer)\s*[:=]\s*(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  // fallback — последняя непустая строка, обрезанная до 200 символов
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (line.length > 0) {
      return line.slice(0, 200);
    }
  }
  return solveText.trim().slice(0, 200);
}

/**
 * Разобрать JSON-ответ verify-прохода (перенесено из воркера).
 * Допускаем обрамляющий текст и ```json fences. null = разобрать нельзя.
 */
export function parseSelfVerifyJson(raw: string): { verified: boolean; reason: string } | null {
  // Убираем markdown-обрамление, если модель его добавила
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? (fenced[1] ?? raw) : raw;
  // Ищем первый {...} блок
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  try {
    const parsed = JSON.parse(objMatch[0]) as { verified?: unknown; reason?: unknown };
    if (typeof parsed.verified !== "boolean") return null;
    return {
      verified: parsed.verified,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// embed
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbedArgs {
  texts: string[];
  /** Какую модель embeddings использовать. Если не задано — берётся из routing. */
  preferredModel?: "qwen3-embedding-8b" | "text-embedding-3-large";
  /** Кто спрашивает: для llm_logs и мягкой нормы. Аноним → null/free. */
  userId?: string | null;
  plan?: UsagePlan;
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
 *
 * УЧЁТ (06.10.2026). До этого вызов эмбеддингов не попадал НИ в llm_logs,
 * НИ в норму: единственным его следом был `costUsd`, который ручка сразу
 * выбрасывала. При цене text-embedding-3-large это до ~4 ₽ за запрос
 * (100 текстов × 8000 символов ≈ 265k токенов), то есть анонимный ручкой
 * можно было вытянуть ~250 ₽ в час с одного адреса, и в отчётах этого
 * не было видно вообще. Теперь каждый вызов пишется в llm_logs и, для
 * платного тарифа, списывается в мягкую норму.
 */
export async function embed(
  args: EmbedArgs,
  env: Env,
  db?: D1Database,
): Promise<EmbedResult> {
  if (!isProviderEnabled(env, "polza")) {
    throw new InternalError(
      "Embeddings: POLZA_API_KEY not configured (set it in wrangler secret put or .dev.vars)",
    );
  }
  const model = args.preferredModel ?? "text-embedding-3-large";
  const start = Date.now();
  // callPolzaEmbedding принимает один объект-аргумент { env, model, input }.
  // Раньше здесь передавались три позиционных аргумента — не компилировалось.
  const { vectors, costUsd, tokensIn } = await callPolzaEmbedding({
    env,
    model,
    input: args.texts,
  });

  if (db) {
    const userId = args.userId ?? null;
    const plan: UsagePlan = args.plan ?? (userId ? "base" : "free");
    await logLlmCall(db, {
      userId,
      task: "embed",
      provider: "polza",
      model,
      plan,
      tokensIn,
      tokensOut: 0,
      costUsd,
      latencyMs: Date.now() - start,
      cached: false,
      fallback: false,
    });
    // recordUsage сам выходит на `plan === "free"` и без userId — анонимный
    // расход остаётся видимым в llm_logs, но не в чьей-то норме: превысить
    // норму без аккаунта нельзя. Для платного тарифа токены идут в счётчик.
    //
    // Взвешиваем САМИ, а не через `weightedTokens()`: та функция считает по
    // ВЫХОДНЫМ токенам, а у эмбеддинга выхода нет — только вход. Считаем
    // теми же деньгами, что и в llm_logs, иначе норма и журнал разойдутся.
    const embedCost = MODEL_COSTS[model];
    const refCost = MODEL_COSTS[REFERENCE_MODEL_ID];
    const weightedIn =
      embedCost && refCost && refCost.outputPer1M > 0
        ? Math.round(tokensIn * (embedCost.inputPer1M / refCost.outputPer1M))
        : 0;
    await recordUsage(db, env, {
      userId,
      plan,
      weightedTokens: weightedIn,
    });
  }

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
  plan: "free" | "base" | "standard" | "plus";
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

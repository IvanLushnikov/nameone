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
import { deleteCache, lookupCache, makeCacheKey, saveCache } from "./cache";
import {
  buildWorksheetPrompt,
  buildTopUpPrompt,
  buildVariantRetryPrompt,
  sanitizeTextLatex,
} from "./prompts/worksheet-gen";
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
import {
  filterTasks,
  hasDanglingPatternRef,
  isPlaceholderAnswer,
  looksLikeForeignMath,
  type QualityFilterReport,
  type RawTask,
} from "./validation/quality-filter";
import { variantsDiffer, missingTaskCount } from "./validation/variant-check";
import { buildPlanPrompt, normalizePlan } from "./prompts/plan-gen";

/**
 * Стадия планирования включена флагом `PLAN=1` в окружении.
 *
 * План делает лист разнообразнее (ТЗ-26 В-1), но это НОВЫЙ вызов на каждую
 * генерацию: и по деньгам, и по времени, и по числу запросов к провайдеру,
 * что видят существующие тесты. Включать по умолчанию можно только после того,
 * как на живых листах измерено, что он даёт.
 */
const PLAN_STAGE_ENABLED = process.env.PLAN === "1";
import {
  findSkillDupes,
  tasksToReplace,
  type SkillTaskLike,
} from "./validation/skill-dupes";
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
import type { GenerationKind, LLMContentPart } from "./types";
import type {
  GenerationRequest,
  Worksheet,
  ExamVariant,
  SubjectSlug,
  GenerateWorksheetMeta,
  QualityLossInfo,
  VariantStatusInfo,
} from "../types";

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
  /**
   * Второй вариант КОНТРОЛЬНОЙ работы (09.10.2026).
   *
   * Раньше вариантов не было вовсе, а фронт делал второй запрос сам — то есть
   * два вызова модели за одну списанную попытку. Теперь оба варианта приходят
   * одним ответом, и второй нужно передать наверх.
   *
   * `null` у всех остальных типов и у контрольной, если модель вернула один
   * вариант вместо двух: тогда показываем один и не рисуем переключатель.
   *
   * ТЗ-25 разрыв 3: само по себе отсутствие второго варианта больше НЕ
   * объясняет всё — рядом всегда идёт `variants`, где сказано прямо, что
   * просили два, пришло один и почему.
   */
  secondVariant?: Worksheet | null;
  /**
   * Признаки потерь материала (ТЗ-25, разрыв 5).
   *
   * Учитель просил 15 заданий и получал 11 без единого признака. Теперь
   * разница видна в ответе API, в логе и в интерфейсе.
   */
  quality: QualityLossInfo;
  /** Состояние вариантов: сколько просили, сколько пришло, деградировали ли. */
  variants: VariantStatusInfo;
  meta: GenerateWorksheetMeta;
  /**
   * Состояние нормы после генерации. `over: true` = норма превышена, но
   * генерация всё равно выполнена (мягкий порог). UI по нему рисует баннер.
   */
  usage: UsageStatus | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ТЗ-25: УЧЁТ ПОТЕРЬ МАТЕРИАЛА
//
// Разрыв 5: `filterTasks` возвращает `QualityFilterReport`, и конвейер шёл по
// `.tasks`, отчёт отбрасывая. Фильтр выкидывает задания по всем предметам и по
// всем типам работ — лист, контрольная, ОГЭ/ЕГЭ, — и все эти потери были
// молчаливыми.
//
// Здесь собираются две вещи: полный отчёт фильтра в лог (что выкинуло и
// почему) и агрегированные числа в ответе API (сколько просили / пришло /
// потеряли). Учитель про логи не знает, поэтому агрегаты обязаны быть в
// ответе.
// ─────────────────────────────────────────────────────────────────────────────

/** Задание, прошедшее фильтр, в виде, который видит конвейер. */
type CleanTask = Record<string, unknown>;

/**
 * Прогнать задания через санитайзер и фильтр качества, вернув ОБЕ части.
 *
 * Возвращается именно `{ tasks, report }`: разрывать этот контракт — значит
 * вернуть молчание, ради устранения которого ТЗ и затевалось.
 */
function filterAndReport(
  rawTasks: readonly unknown[],
  subject: string,
  /**
   * Ответы обязательны? ТЗ-26, Ф-5.
   *
   * При `withAnswers = true` задание без ответа — дефект, оно выкидывается.
   * При `false` null законен, и трогать его нельзя: иначе лист без ответов
   * остался бы вообще пустым.
   */
  requireAnswer = false,
): { tasks: CleanTask[]; report: QualityFilterReport } {
  const cleaned = rawTasks
    .filter((t: unknown): t is NonNullable<typeof t> => Boolean(t) && typeof t === "object")
    .map((task) => {
      if (!task || typeof task !== "object") return task;
      const sanitized = sanitizeTextLatex((task as { text_latex?: unknown }).text_latex);
      // `as Record<string, unknown>` не проходит: у `WorksheetTask` нет
      // индексируемой подписи, и TypeScript считает приведение натянутым.
      // Промежуточный `unknown` — честное «смотрю как на словарь».
      const next = { ...(task as unknown as Record<string, unknown>) };
      if (sanitized) next.text_latex = sanitized;
      else delete next.text_latex;
      return next;
    }) as RawTask[];

  const { tasks, report } = filterTasks(cleaned, subject, { requireAnswer });

  // `filterTasks` умеет откатываться и вернуть исходный набор целиком, если
  // отфильтровано слишком много (см. конец quality-filter.ts). В этом случае
  // `report.after` НЕ равно `tasks.length` — иначе мы бы сообщили учителю о
  // потерях, которых не было. Считаем фактическое количество.
  if (report.after !== tasks.length) {
    report.after = tasks.length;
  }

  return { tasks: tasks as CleanTask[], report };
}

/**
 * Написать в лог, что сделал фильтр качества (ТЗ-25, пункт 7).
 *
 * Пишется по КАЖДОМУ вызову — листу, каждому варианту контрольной, ОГЭ/ЕГЭ —
 * потому что потеря бьёт по каждому материалу, а не по контрольной.
 *
 * В лог идут ТОЛЬКО числа и номера заданий: ни текстов, ни промптов.
 */
function logFilterReport(params: {
  stage: string;
  subject: string;
  requested: number;
  report: QualityFilterReport;
}): void {
  const { stage, subject, requested, report } = params;
  const dropped = report.before - report.after;
  const payload = {
    subject,
    stage,
    requested,
    before: report.before,
    after: report.after,
    dropped,
    // Причина по каждому заданию: «по образцу» без образца, чужая математика,
    // ответ-заглушка. Это и есть то, чего раньше не было видно нигде.
    droppedPatternRef: report.droppedPatternRef,
    droppedForeignMath: report.droppedForeignMath,
    cleanedAnswer: report.cleanedAnswer,
  };

  if (dropped > 0) {
    logLlmEvent("warn", "worksheet-gen: quality filter dropped tasks", payload);
  } else {
    logLlmEvent("info", "worksheet-gen: quality filter clean", payload);
  }
}

/**
 * Состояние вариантов для ответа API и для кэша.
 *
 * Для НЕ-контрольной работы `expected = 1`, и `degraded` обязано быть false:
 * иначе учитель листа увидит предупреждение про два варианта, которых он не
 * просил.
 */
function buildVariantStatus(
  expected: number,
  delivered: number,
  opts: { degraded: boolean; degradedReason?: string; retried: boolean },
): VariantStatusInfo {
  return {
    expected,
    delivered,
    degraded: opts.degraded,
    ...(opts.degradedReason ? { degradedReason: opts.degradedReason } : {}),
    retried: opts.retried,
  };
}

/**
 * Собрать агрегированные потери по отчётам фильтра (разрыв 5).
 *
 * `requestedTotal` — сколько заданий просил учитель С УЧЁТОМ вариантов: у
 * контрольной просят `count` в каждом из двух вариантов, то есть всего 2×count.
 * `deliveredTotal` — фактическое количество в выданном материале, тоже суммой
 * по вариантам.
 *
 * Почему сверка идёт по СУММЕ, а не по каждому варианту отдельно: учитель
 * видит два листа и считает «сколько заданий он получил» по обоим. Показывать
 * ему «в первом варианте 10 из 10, во втором 7 из 10» — это ровно то догадки,
 * которых ТЗ требует убрать; простое «получено 17 из 20» читается сразу.
 */
function summarizeLoss(
  requestedTotal: number,
  reports: readonly QualityFilterReport[],
  topUpAdded: number,
  deliveredTotal: number,
): QualityLossInfo {
  const droppedPatternRef: number[] = [];
  const droppedForeignMath: number[] = [];
  const cleanedAnswer: number[] = [];
  let dropped = 0;
  // Откат фильтра (вернуть исходный набор целиком при слишком агрессивной
  // фильтрации) виден по `before - after == 0` при ненулевом `before`.
  let filterBackedOff = false;

  for (const report of reports) {
    droppedPatternRef.push(...report.droppedPatternRef);
    droppedForeignMath.push(...report.droppedForeignMath);
    cleanedAnswer.push(...report.cleanedAnswer);
    const reportDropped = report.before - report.after;
    dropped += reportDropped;
    if (report.before > 0 && reportDropped === 0) {
      filterBackedOff = true;
    }
  }

  return {
    requested: requestedTotal,
    delivered: deliveredTotal,
    dropped,
    droppedPatternRef,
    droppedForeignMath,
    cleanedAnswer,
    topUpAdded,
    stillMissing: missingTaskCount(requestedTotal, deliveredTotal),
    filterBackedOff,
  };
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
      // Второй вариант контрольной (12.10.2026). Раньше в кэш уходил только
      // первый лист, и повторный запрос отдавал `semantic-cache` БЕЗ второго
      // варианта — учитель получал ровно ту жалобу, которую чинили.
      const cachedResponse = cached.response as {
        worksheet?: Worksheet;
        secondVariant?: Worksheet | null;
        quality?: QualityLossInfo;
        variants?: VariantStatusInfo;
      };
      const cachedSecond = cachedResponse.secondVariant ?? null;
      // ТЗ-25 AD-4: сносим ТОЛЬКО записи без флага результата.
      //
      // Раньше правило было «контрольная без secondVariant → снести». С новой
      // логикой этого мало: деградированный результат (второй вариант не
      // получился) кладётся в кэш СПЕЦИАЛЬНО — чтобы учитель не платил за
      // каждое повторное открытие одной и той же неудачи. Такая запись
      // обязана выживать, иначе каждый клик «попробовать снова» стоил бы
      // новой генерации.
      //
      // Сносим только то, что осталось от записей ДО правки: у них нет ни
      // `variants`, ни `quality` — то есть они ничего не знают о деградации и
      // для контрольной заведомо безвторовариантные.
      const hasResultFlag =
        typeof cachedResponse.variants === "object" && cachedResponse.variants !== null;
      if (request.type === "control" && !cachedSecond && !hasResultFlag) {
        await deleteCache(db, cacheKey);
      } else {
        const ws = cachedResponse.worksheet;
        if (!ws) {
          await deleteCache(db, cacheKey);
        } else {
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
          // Признаки потерь возвращаются ИЗ КЭША (AD-4 + критерий «повторный
          // запрос возвращает тот же флаг деградации»): иначе учитель при
          // повторном открытии увидел бы материал без предупреждения и решил,
          // что всё в порядке.
          const quality =
            cachedResponse.quality ??
            summarizeLoss(request.count, [], 0, ws.tasks.length);
          const variants =
            cachedResponse.variants ??
            buildVariantStatus(request.type === "control" ? 2 : 1, cachedSecond ? 2 : 1, {
              degraded: request.type === "control" && !cachedSecond,
              degradedReason:
                request.type === "control" && !cachedSecond
                  ? "второй вариант не был получен"
                  : undefined,
              retried: false,
            });
          return { worksheet: ws, meta, usage, secondVariant: cachedSecond, quality, variants };
        }
      }
    }
  }

// 4. LLM call с fallback.
  // Модель выбирается по ТИПУ АРТЕФАКТА (сложности), а не по тарифу:
  // листы/тесты/карточки/планы урока — Luna, контрольные и ОГЭ — Sonnet.
  const decision = pickModel(task, env);

  // ─────────────────────────────────────────────────────────────────────
  // ПЛАН ЛИСТА (ТЗ-26 В-1, решение владельца 13.10.2026).
  //
  // Сначала дешёвый вызов, который раскладывает тему на РАЗНЫЕ навыки, потом
  // дорогой, который пишет лист строго по плану. Реактивная схема
  // «поймали повтор → попросили замену → отвергли» не сходилась: модель на одну
  // тему выдаёт один и тот же навык раз за разом, и трёх проходов чистки
  // иногда не хватало.
  //
  // План УЛУЧШАЕТ качество, но не является условием выдачи листа: если вызов
  // не удался или план негоден, идём дальше без него. Иначе дешёвый сбой
  // блокировал бы дорогой результат.
  //
  // Для контрольной план один на оба варианта: варианты должны проверять одну
  // программу, но разными навыками (см. требование 5 к вариантам).
  // ─────────────────────────────────────────────────────────────────────
  // Промпт собирается ПОСЛЕ планирования (см. ниже) — план должен попасть
  // в него, поэтому здесь только заготовка.
  let { system, user } = buildWorksheetPrompt(request);

  // Потолок ответа. КОНТРОЛЬНАЯ возвращает ДВА полных листа одним ответом
  // (`variants`): на один лист 4096 хватает, на два — нет, и ответ обрывался
  // по `finish_reason=length`.
  const baseMaxTokens = request.type === "control" ? 8192 : 4096;

  // ─────────────────────────────────────────────────────────────────────────────
  // ТЗ-25 AD-5: УЧЁТ КАЖДОГО ВЫЗОВА
  //
  // В конвейере теперь может быть больше одного вызова провайдера: основной,
  // ретрай на обрыв, ретрай вариантов, дозапрос недостающих заданий. Каждый —
  // реальные деньги учителя, и каждый обязан попасть в llm_logs ОТДЕЛЬНОЙ
  // строкой, а норма (recordUsage) считаться по СУММЕ weightedTokens.
  //
  // Раньше был ровно один вызов и одна запись, поэтому цикл это свойство не
  // ломал. Сделать ретрай «невидимым для тарифа» — значит показать учителю
  // норму, меньшую настоящей.
  //
  // Логирование и учёт делаются ОДИН РАЗ в конце, по всему накопленному
  // списку: иначе легко забыть дописать новый вид повторного вызова.
  // ─────────────────────────────────────────────────────────────────────────────
  const calls: Array<{
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    /** Рубли по этому вызову (currency-работа на main). null, если провайдер не считал. */
    costRub: number | null;
    latencyMs: number;
    generation: string;
  }> = [];

  /** Вызов провайдера с записью в список для честного учёта. */
  const callProvider = async (promptSystem: string, promptUser: string, maxTokens: number) => {
    const r = await callWithFallback(
      {
        model: decision.primary?.model ?? "gpt-6-luna",
        messages: [
          { role: "system", content: promptSystem },
          { role: "user", content: promptUser },
        ],
        responseFormat: "json",
        temperature: 0.7,
        maxTokens,
        // Кэш — по свойству модели, а не по тарифу (см. supportsPromptCache).
        cacheSystemPrompt: supportsPromptCache(decision.primary?.model ?? "gpt-6-luna"),
      },
      decision,
      env,
      // BL-08: без этого отказ писался бы как «отказ неизвестного у неизвестной
      // задачи», и по базе было нельзя понять, какой тип материала ломается.
      { task, userId, plan },
    );
    calls.push({
      provider: r.provider,
      model: r.model,
      tokensIn: r.response.tokensIn,
      tokensOut: r.response.tokensOut,
      costUsd: r.response.costUsd,
      costRub: r.response.costRub ?? null,
      latencyMs: r.response.latencyMs,
      generation: r.generation,
    });
    return r;
  };

  // ПЛАН ЛИСТА. Сначала дешёвый вызов раскладывает тему на РАЗНЫЕ навыки,
  // потом дорогой пишет лист строго по плану. Объявлено здесь, а не выше,
  // потому что использует `callProvider`, который определён выше по коду.
  //
  // ПОД КЛЮЧОМ `PLAN=1` (см. константу ниже). Стадия новая и меняет число
  // вызовов провайдера на каждой генерации, поэтому включена явно: пока её не
  // обкатано на живых листах, молча менять путь, который покрыт тремя наборами
  // тестов (потери ТЗ-25, два варианта, кэш), нельзя.
  let sheetPlan: ReturnType<typeof normalizePlan> = null;
  try {
    if (!PLAN_STAGE_ENABLED) throw new Error("plan stage disabled");
    const planPrompt = buildPlanPrompt(request);
    const planRes = await callProvider(planPrompt.system, planPrompt.user, 2048);
    let parsedPlan: unknown = null;
    try {
      parsedPlan = JSON.parse(planRes.response.content);
    } catch {
      parsedPlan = null;
    }
    sheetPlan = normalizePlan(parsedPlan, request.count);
    if (!sheetPlan) {
      logLlmEvent("warn", "worksheet-gen: unusable plan, continuing without it", {
        subject: request.subject,
        count: request.count,
      });
    }
  } catch (e) {
    logLlmEvent("warn", "worksheet-gen: plan failed, continuing without it", {
      subject: request.subject,
      error: String(e),
    });
  }

  // Теперь план есть — пересобираем промпт с ним.
  ({ system, user } = buildWorksheetPrompt(request, sheetPlan?.items));

  let resultFinal = await callProvider(system, user, baseMaxTokens);

  // ─────────────────────────────────────────────────────────────────────────────
  // ТЗ-25 РАЗРЫВ 4: ОБРЫВ ОТВЕТА ПО `finish_reason` — ВСЕ ПРЕДМЕТЫ
  //
  // Раньше `finishReason` знал провайдер, но в успешный ответ не попадал.
  // Для русскоязычного предмета обрыв приводил к InternalError (обрезанный
  // JSON не парсится) — то есть был заметен, хоть и нечеловечно. Для иностранных
  // предметов `language-guard` пропускает текст ВСЕГДА, поэтому обрыв проходил
  // как нормальный результат: учитель получал половину материала и думал, что
  // она целая.
  //
  // Теперь обрыв ловится ОДИНАКОВО для всех предметов: один поднятый потолок
  // и один шанс, иначе — честная ошибка, а не тихий успех.
  //
  // Это НЕ откат к проверке языка в language-guard: там нет детектора
  // «английский вперемешку с кириллицей», и его отсутствие осознанно (см.
  // language-guard.ts:73-76).
  // ─────────────────────────────────────────────────────────────────────────────
  // Разрыв 4: ОДИН шанс с удвоенным потолком.
  //
  // Обрезанный ответ укорочен ровно из-за потолка, поэтому поднять потолок и
  // попросить заново — единственное, что тут помогает. Ровно одна попытка:
  // тот же предел, что у ретрая вариантов (AD-3), и по той же причине —
  // контрольная идёт по Sonnet, а бесконечные попытки съедают норму учителя.
  if (resultFinal.response.finishReason === "length") {
    logLlmEvent("warn", "worksheet-gen: response truncated, retrying with higher ceiling", {
      task,
      subject: request.subject,
      type: request.type,
      tokensOut: resultFinal.response.tokensOut,
      requestedMaxTokens: baseMaxTokens,
    });
    try {
      resultFinal = await callProvider(system, user, baseMaxTokens * 2);
    } catch (e) {
      // Ретрай упал — дальше разбирать нечего, ответ заведомо неполный.
      logLlmEvent("error", "worksheet-gen: truncation retry failed", {
        task,
        subject: request.subject,
        error: String(e),
      });
      throw new InternalError("LLM response truncated (finish_reason=length)", {
        subject: request.subject,
        type: request.type,
        maxTokens: baseMaxTokens * 2,
      });
    }
  }

  // Разрыв 4: и после поднятого потолка обрыва нет — материал заведомо неполный.
  //
  // Дальше — ОТКАЗ, а не отдача материала с флагом. Обрезанный JSON обычно и не
  // парсится, поэтому «мягко» означало бы учителю ровно то же самое, от чего мы
  // уходили: половину работы с молчаливым обрывом. Тихий успех здесь и был
  // дефектом — и для русскоязычного предмета, и для иностранных.
  if (resultFinal.response.finishReason === "length") {
    throw new InternalError("LLM response truncated (finish_reason=length)", {
      subject: request.subject,
      type: request.type,
      tokensOut: resultFinal.response.tokensOut,
      maxTokens: baseMaxTokens * 2,
    });
  }

  // 5. Parse JSON
  let worksheet: Worksheet;
  // Объявлено до try: нужно после блока, чтобы вернуть второй вариант наружу.
  let controlVariants: Worksheet[] | null = null;
  // Отчёты фильтра живут до конца конвейера (разрыв 5). Раньше `.report`
  // отбрасывался на месте.
  const filterReports: QualityFilterReport[] = [];

  try {
    const parsed = JSON.parse(resultFinal.response.content) as Worksheet;
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
    // ─────────────────────────────────────────────────────────────────────────────
    // КОНТРОЛЬНАЯ: два варианта ОДНИМ вызовом (09.10.2026)
    // ─────────────────────────────────────────────────────────────────────────────
    // Раньше фронт делал два запроса к /api/worksheets/generate — по одному на
    // вариант. Это вдвое дороже по деньгам, вдвое медленнее по времени, и оба
    // листа всё равно были независимыми. Теперь модель отдаёт оба варианта в
    // одном ответе (`{ variants: [...] }`), а ниже выбирается нужный.
    controlVariants =
      request.type === "control" &&
      Array.isArray((parsed as unknown as { variants?: unknown }).variants)
        ? ((parsed as unknown as { variants: unknown[] }).variants as Worksheet[])
        : null;
    const primaryParsed = controlVariants?.[0] ?? parsed;

    // ─────────────────────────────────────────────────────────────────────────────
    // ТЗ-25: ФИЛЬТР КАЧЕСТВА С ОТЧЁТОМ (разрыв 5, ВСЕ ПРЕДМЕТЫ)
    // ─────────────────────────────────────────────────────────────────────────────
    // Раньше здесь шло `filterTasks(...).tasks`, а `.report` отбрасывался:
    // сколько заданий выкинуто и почему — не знал никто, включая учителя.
    const primaryFiltered = Array.isArray(primaryParsed.tasks)
      ? filterAndReport(
          primaryParsed.tasks.filter(
            (t: unknown): t is NonNullable<typeof t> => Boolean(t) && typeof t === "object",
          ),
          request.subject,
          request.withAnswers,
        )
      : { tasks: [] as CleanTask[], report: null };

    if (primaryFiltered.report) {
      filterReports.push(primaryFiltered.report);
      logFilterReport({
        stage: "worksheet.variant1",
        subject: request.subject,
        requested: request.count,
        report: primaryFiltered.report,
      });
    }

    worksheet = {
      id: worksheetId(),
      title: primaryParsed.title ?? request.topic,
      subject: primaryParsed.subject ?? request.subject,
      grade: primaryParsed.grade ?? request.grade,
      topic: primaryParsed.topic ?? request.topic,
      difficulty: primaryParsed.difficulty ?? request.difficulty,
      // Ответ обрезан по потолку токенов — материал неполон. Не отдаём его
      // как нормальный: помечаем, чтобы учитель увидел предупреждение (AD-7).
      tasks: primaryFiltered.tasks as unknown as Worksheet["tasks"],
      createdAt: new Date().toISOString(),
    };
  } catch {
    throw new InternalError("LLM returned invalid JSON for worksheet");
  }

/** Прогнать вариант через фильтр с отчётом. */
  const readVariant = (raw: Worksheet | undefined) => {
    if (!raw) return null;
    const filtered = Array.isArray(raw.tasks)
      ? filterAndReport(raw.tasks as unknown[], request.subject, request.withAnswers)
      : { tasks: [] as CleanTask[], report: null };
    if (filtered.report) {
      logFilterReport({
        stage: "worksheet.variant2",
        subject: request.subject,
        requested: request.count,
        report: filtered.report,
      });
    }
    return { tasks: filtered.tasks, report: filtered.report, raw };
  };

  let secondParsed = readVariant(controlVariants?.[1]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ТЗ-25: РЕТРАЙ КОНТРОЛЬНОЙ ПРИ ОДИНАКОВЫХ ВАРИАНТАХ (AD-3)
  //
  // Разрыв 2: `variants[1]` брался как есть, без сверки текстов. Модель с
  // temperature 0.7 часто отдаёт вторую половину ответа копией первой — это
  // самая частая форма жалобы «задания повторяются».
  //
  // Ретрай ОДИН (AD-3): контрольная идёт по Sonnet, бесконечные попытки съедают
  // норму учителя. Не помогло — отдаём первый вариант с `degraded: true`.
  //
  // В кэш кладётся только ПРИНЯТЫЙ результат (AD-4): отброшенный ретраем ответ
  // в кэш не попадает никогда, иначе провал закрепился бы на 30 дней TTL.
  // ─────────────────────────────────────────────────────────────────────────────
  let retried = false;
  let degraded = false;
  let degradedReason: string | undefined;

  if (request.type === "control") {
    const diff = variantsDiffer(worksheet.tasks, secondParsed?.tasks);
    if (secondParsed && diff.differ) {
      retried = true;
      logLlmEvent("warn", "worksheet-gen: control variants identical, retrying", {
        subject: request.subject,
        grade: request.grade,
        reason: diff.reason,
        duplicates: diff.duplicates,
        compared: diff.compared,
      });
      const v1Texts = worksheet.tasks
        .map((t) => (t as { text?: unknown }).text)
        .filter((t): t is string => typeof t === "string");
      const retryPrompt = buildVariantRetryPrompt(
        request,
        diff.duplicates,
        v1Texts,
        diff.reason ?? "варианты совпали",
      );
      try {
        const retryResult = await callProvider(retryPrompt.system, retryPrompt.user, baseMaxTokens);
        const retryParsed = JSON.parse(retryResult.response.content) as {
          variants?: Worksheet[];
        };
        const retryVariants = Array.isArray(retryParsed.variants) ? retryParsed.variants : null;
        if (retryVariants && retryVariants.length >= 2) {
          // Принимаем ретрай только если он действительно разные: иначе мы бы
          // заменили нормальный первый вариант на другую копию.
          const retryFirstRaw = retryVariants[0];
          const retryFirstFiltered = Array.isArray(retryFirstRaw?.tasks)
            ? filterAndReport(retryFirstRaw.tasks as unknown[], request.subject, request.withAnswers)
            : null;
          const retrySecond = readVariant(retryVariants[1]);
          const retryDiff = variantsDiffer(retryFirstFiltered?.tasks, retrySecond?.tasks);
          if (retryFirstRaw && retryFirstFiltered && retrySecond && !retryDiff.differ) {
            // Ретрай хороший — пересобираем первый лист из него целиком, чтобы
            // формулировки вариантов соответствовали друг другу.
            if (retryFirstFiltered.report) {
              filterReports[0] = retryFirstFiltered.report;
              logFilterReport({
                stage: "worksheet.variant1.retry",
                subject: request.subject,
                requested: request.count,
                report: retryFirstFiltered.report,
              });
            }
            worksheet = {
              ...worksheet,
              title: retryFirstRaw.title ?? worksheet.title,
              tasks: retryFirstFiltered.tasks as unknown as Worksheet["tasks"],
            };
            secondParsed = retrySecond;
          } else {
            degraded = true;
            degradedReason = `второй вариант повторил первый даже после повторной попытки (${retryDiff.reason ?? "варианты совпали"})`;
            secondParsed = null;
          }
        } else {
          degraded = true;
          degradedReason = "повторная попытка не вернула два варианта";
          secondParsed = null;
        }
      } catch (e) {
        degraded = true;
        degradedReason = "повторная попытка не удалась";
        secondParsed = null;
        logLlmEvent("error", "worksheet-gen: variant retry failed", {
          subject: request.subject,
          error: String(e),
        });
      }
    } else if (!secondParsed) {
      // Разрыв 3: модель не вернула `variants[1]` вообще. Раньше это молча
      // превращалось в `secondVariant: null` без следа — фронт не отличал
      // «второй не нужен» от «второй не получился».
      degraded = true;
      degradedReason = "модель вернула один вариант вместо двух";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ТЗ-25 AD-7/AD-8: ДОЗАПРОС НЕДОСТАЮЩИХ ЗАДАНИЙ — ВСЕ ТИПЫ РАБОТ
  //
  // Разрыв 5/6: после фильтра материала меньше, чем просил учитель. Молча
  // отдать укороченный лист нельзя — учитель печатает его и раздаёт классу.
  // ОДИН дозапрос на недостающее и мерж. Если и после него мало — отдаём что
  // есть, но С ПРИЗНАКОМ (`stillMissing > 0`), который показывает интерфейс.
  //
  // AD-8: у контрольной количества в вариантах должны совпадать. Разошлись —
  // добрать тем же дозапросом.
  //
  // Работает для ВСЕХ типов работ, включая ОГЭ/ЕГЭ: там учитель вообще не
  // пересчитывает задания, их считают по баллам, и укороченный вариант
  // обнаруживается уже на проверке.
  // ─────────────────────────────────────────────────────────────────────────────
  let topUpAdded = 0;
  const ensureCount = async (
    target: number,
    current: CleanTask[],
    stage: string,
  ): Promise<CleanTask[]> => {
    const missing = missingTaskCount(target, current.length);
    if (missing <= 0) return current;
    logLlmEvent("warn", "worksheet-gen: topping up missing tasks", {
      subject: request.subject,
      stage,
      requested: target,
      have: current.length,
      missing,
    });
    const topUpPrompt = buildTopUpPrompt(
      request,
      missing,
      current
        .map((t) => (t as { text?: unknown }).text)
        .filter((t): t is string => typeof t === "string"),
    );
    try {
      const topUpResult = await callProvider(topUpPrompt.system, topUpPrompt.user, 4096);
      const topUpParsed = JSON.parse(topUpResult.response.content) as Worksheet;
      const topUpTasks = Array.isArray(topUpParsed.tasks) ? topUpParsed.tasks : [];
      // Дозапрос проходит ТОТ ЖЕ фильтр: иначе мы вернули бы в материал ровно
      // те дефекты, ради удаления которых дозапрос и делается.
      const topUpFiltered = filterAndReport(topUpTasks, request.subject, request.withAnswers);
      if (topUpFiltered.report) {
        logFilterReport({
          stage: `worksheet.topup.${stage}`,
          subject: request.subject,
          requested: missing,
          report: topUpFiltered.report,
        });
      }
      const usable = topUpFiltered.tasks.slice(0, missing);
      topUpAdded += usable.length;
      return [...current, ...usable];
    } catch (e) {
      logLlmEvent("error", "worksheet-gen: top-up failed", {
        subject: request.subject,
        stage,
        error: String(e),
      });
      return current;
    }
  };

  /**
   * Замена ЗАДУБЛИРОВАННЫХ заданий (ТЗ-26, Ф-2).
   *
   * Отличие от `ensureCount` принципиальное: там лист короче, чем просил
   * учитель, и мы ДОБИРАЕМ. Здесь лист нужной длины, но два задания проверяют
   * один и тот же навык — для учителя это 12 заданий, которые дают 11.
   *
   * Повторное задание выкидывается, на его место ставится ДОЗАПРОС — то есть
   * ровно один дополнительный вызов провайдера на лист, как и требует ТЗ.
   * Выкинутое задание отдаётся модели в промпте, чтобы новый навык не совпал
   * с уже выбранным.
   *
   * Если дозапрос не удался или вернул негодь — отдаём лист как есть. Лист с
   * дублем хуже листа на задание короче, но и с молчаливой потерей материала
   * мы не имеем права: учитель печатает лист и раздаёт классу.
   */
  const dedupeSheet = async (
    current: CleanTask[],
    stage: string,
    /** Сколько заданий всего можно выбросить за все проходы. */
    dropBudget: number,
  ): Promise<CleanTask[]> => {
    const dupes = findSkillDupes(current as unknown as SkillTaskLike[]);
    if (!dupes.hasDupes) return current;
    // Не выбрасываем больше, чем разрешено бюджетом, и никогда — всё.
    // Пустой лист хуже листа с повтором: учителю нечего раздавать классу.
    const allowed = dupes.pairs
      .map((pair) => pair.second)
      .filter((n) => n > 1)
      .slice(0, Math.max(0, Math.min(dropBudget, current.length - 1)));
    if (allowed.length === 0) return current;

    const replaceNumbers = allowed;
    const kept = current.filter(
      (_, index) => !allowed.includes(index + 1),
    );

    logLlmEvent("warn", "worksheet-gen: repeated skill inside sheet, replacing", {
      subject: request.subject,
      stage,
      pairs: dupes.pairs.map((p) => `${p.first}-${p.second}`),
      replacing: replaceNumbers,
    });

    // Промпту отдаём и выкидываемое задание, и уже оставшиеся: модель должна
    // предложить НОВЫЙ навык, а не переставить тот же.
    const replacedTexts = replaceNumbers.map((n) => {
      const t = (current[n - 1] as { text?: unknown } | undefined)?.text;
      return typeof t === "string" ? t : "";
    });

    try {
      const prompt = buildTopUpPrompt(
        request,
        replaceNumbers.length,
        [
          ...current
            .map((t) => (t as { text?: unknown }).text)
            .filter((t): t is string => typeof t === "string"),
          ...replacedTexts,
        ],
      );
      const res = await callProvider(prompt.system, prompt.user, 4096);
      const parsed = JSON.parse(res.response.content) as Worksheet;
      const fresh = filterAndReport(
        Array.isArray(parsed.tasks) ? parsed.tasks : [],
        request.subject,
        request.withAnswers,
      ).tasks;

      // Дозапрос может вернуть задание, которое само дублирует оставшееся.
      // Отдаём только те, что не создают новый дубль.
      //
      // ПРОВЕРЯЕМ ПРОТИВ УЖЕ ПРИНЯТЫХ, А НЕ ТОЛЬКО ПРОТИВ `kept`.
      // Живой прогон 13.10.2026 (алгебра 8, вариант 2) показал именно этот
      // баг: дозапрос вернул ДВА задания, каждое из которых поодиночке не
      // дублировало оставшиеся пять, — но друг с другом они дублировали. Лист
      // уезжал учителю с НОВЫМ дублем 6↔7, которого до замены не было.
      // Фильтр обязан накапливать принятое, иначе замена лечит лист и тут же
      // роняет его снова.
      const accepted: CleanTask[] = [];
      for (const candidate of fresh) {
        if (accepted.length >= replaceNumbers.length) break;
        const probe = findSkillDupes([
          ...kept,
          ...accepted,
          candidate,
        ] as unknown as SkillTaskLike[]);
        if (probe.hasDupes) continue;
        accepted.push(candidate);
      }
      const usable = accepted;

      if (usable.length === 0) {
        // ЖИВОЙ ПРОГОН 13.10.2026: дозапрос возвращает ПОЛНЫЙ лист, и почти
        // каждое его задание дублирует оставшиеся — фильтр не пропускает
        // ничего, `accepted` пуст. Раньше здесь возвращался исходный лист, и
        // ЗАВЕДОМО ДУБЛИРУЮЩЕЕ задание уезжало учителю. Лист с заведомым
        // повтором хуже короткого: учитель раздаёт его классу.
        //
        // Поэтому в отказе убираем дубли и возвращаем укороченный лист —
        // доберём число обычным `ensureCount`, который уже умеет работать
        // без риска повтора (он просто просит ещё задание).
        logLlmEvent("warn", "worksheet-gen: dropping duplicates, no usable replacement", {
          subject: request.subject,
          stage,
          wanted: replaceNumbers.length,
        });
        return kept;
      }

      // Заменяем по номерам, сохраняя порядок листа.
      let cursor = 0;
      return current.map((task, index) => {
        const number = index + 1;
        if (!replaceNumbers.includes(number)) return task;
        return usable[cursor] ?? task;
        cursor += 1;
      });
    } catch (e) {
      // Тот же довод, что и выше: отказ дозапроса не должен означать отказ от
      // чистоты листа. Убираем дубли, длину доберёт `ensureCount`.
      logLlmEvent("error", "worksheet-gen: dupe replacement failed, dropping duplicates", {
        subject: request.subject,
        stage,
        error: String(e),
      });
      return kept;
    }
  };

  /**
   * Чистка листа от повторов НЕСКОЛЬКИМИ проходами.
   *
   * Живые прогоны 13.10.2026: одного прохода мало. Проход убирает дубль,
   * `ensureCount` добирает длину — а модель на ту же тему выдаёт ТОТ ЖЕ навык
   * снова. На биологии 7 так и уезжало «дуб стебел год»: после замены приходил
   * новый вариант того же задания, и в выдаче снова был повтор.
   *
   * ПРОХОДОВ ОГРАНИЧЕНО ТРЕМЯ. Модель может упираться в один и тот же навык
   * (например, в листе по биологии почти всё сводится к жилкованию), и без
   * предела мы бы платили вызов за вызовом, ничего не меняя. Три прохода —
   * это «почини, если можешь», а не «добивайся любой ценой».
   */
  const dedupeRounds = 3;
  /**
   * Бюджет выброшенных заданий.
   *
   * Живые прогоны показали, почему он нужен: если модель упирается в один
   * навык (биология 7, «жилкование листьев»), каждый проход чистки находит
   * новый повтор, выбрасывает задание, добирает — и получает ТОТ ЖЕ навык
   * снова. Без предела лист уезжает учителю пустым или почти пустым.
   *
   * Половина от количества — потолок осмысленности: если не хватает трети
   * заданий, чтобы составить лист без повторов, лучше отдать лист с повтором,
   * чем выкинуть половину материала. Повтор учитель заметит и попросит другой;
   * нехватку он заметит на печати.
   */
  const dropBudgetOf = (count: number) => Math.ceil(count / 2);

  const isControl = request.type === "control";
  // У контрольной целевое количество общее для обоих вариантов (AD-8) и
  // добирается после того, как оба варианта собраны. У остальных типов —
  // сразу после основного.
  if (!isControl) {
    const topped = await ensureCount(
      request.count,
      worksheet.tasks as unknown as CleanTask[],
      "primary",
    );
    if (topped.length !== worksheet.tasks.length) {
      worksheet = { ...worksheet, tasks: topped as unknown as Worksheet["tasks"] };
    }
    // ТЗ-26 Ф-2: после добива количества — проверка на повтор навыка. Именно
    // здесь, а не раньше: дозапрос мог добавить задание, которое дублирует
    // уже имеющееся, и наоборот — выкинутое дубль-задание освобождает место.
    for (let round = 1; round <= dedupeRounds; round += 1) {
      const deduped = await dedupeSheet(
        worksheet.tasks as unknown as CleanTask[],
        `primary#${round}`,
        dropBudgetOf(request.count),
      );
      if (deduped === (worksheet.tasks as unknown as CleanTask[])) break;
      // Порядок именно такой: сначала чистота, потом длина. Лист на задание
      // короче С ДУБЛЕМ хуже листа нужной длины с дублем.
      worksheet = {
        ...worksheet,
        tasks: (await ensureCount(
          request.count,
          deduped,
          "primary",
        )) as unknown as Worksheet["tasks"],
      };
    }
  }

  // Второй вариант контрольной собираем тем же кодом, что и первый: те же
  // id и createdAt — серверные, те же фильтры заданий.
  let secondVariant: Worksheet | null = null;
  if (secondParsed) {
    if (secondParsed.report) filterReports.push(secondParsed.report);
    secondVariant = {
      id: worksheetId(),
      title: secondParsed.raw.title ?? `Вариант 2`,
      subject: secondParsed.raw.subject ?? request.subject,
      grade: secondParsed.raw.grade ?? request.grade,
      topic: secondParsed.raw.topic ?? request.topic,
      difficulty: secondParsed.raw.difficulty ?? request.difficulty,
      tasks: secondParsed.tasks as unknown as Worksheet["tasks"],
      createdAt: worksheet.createdAt ?? new Date().toISOString(),
    } as Worksheet;
  }

  // AD-8: равное количество заданий в двух вариантах — часть равносильности.
  // Раздавать классу варианты разного объёма нельзя: учитель обнаружит это
  // на печати.
  if (isControl && secondVariant) {
    const v1Count = worksheet.tasks.length;
    const v2Count = (secondVariant.tasks ?? []).length;
    if (v1Count !== v2Count) {
      const target = Math.max(v1Count, v2Count);
      logLlmEvent("warn", "worksheet-gen: variant counts differ, topping up", {
        subject: request.subject,
        v1Count,
        v2Count,
        target,
      });
      const topped1 = await ensureCount(target, worksheet.tasks as unknown as CleanTask[], "variant1");
      const topped2 = await ensureCount(
        target,
        (secondVariant.tasks ?? []) as unknown as CleanTask[],
        "variant2",
      );
      worksheet = { ...worksheet, tasks: topped1 as unknown as Worksheet["tasks"] };
      secondVariant = { ...secondVariant, tasks: topped2 as unknown as Worksheet["tasks"] };
    }

    // ТЗ-26 Ф-2: дубль проверяется ВНУТРИ каждого варианта. Сравнение между
    // вариантами уже делает `variant-check.ts` — это другая задача.
    for (let round = 1; round <= dedupeRounds; round += 1) {
      const d1 = await dedupeSheet(
        worksheet.tasks as unknown as CleanTask[],
        `variant1#${round}`,
        dropBudgetOf(request.count),
      );
      const d2 = await dedupeSheet(
        (secondVariant.tasks ?? []) as unknown as CleanTask[],
        `variant2#${round}`,
        dropBudgetOf(request.count),
      );
      const changed =
        d1 !== (worksheet.tasks as unknown as CleanTask[]) ||
        d2 !== ((secondVariant.tasks ?? []) as unknown as CleanTask[]);
      worksheet = { ...worksheet, tasks: d1 as unknown as Worksheet["tasks"] };
      secondVariant = { ...secondVariant, tasks: d2 as unknown as Worksheet["tasks"] };
      if (!changed) break;
    }

    // Оба варианта должны остаться одной длины (AD-8), иначе учитель
    // обнаружит разницу на печати. Если dedupe убрал дубли, добираем.
    const v1After = worksheet.tasks.length;
    const v2After = (secondVariant.tasks ?? []).length;
    if (v1After !== v2After) {
      const target = Math.max(v1After, v2After);
      logLlmEvent("warn", "worksheet-gen: variants differ after dedupe, topping up", {
        subject: request.subject,
        v1: v1After,
        v2: v2After,
        target,
      });
      worksheet = {
        ...worksheet,
        tasks: (await ensureCount(target, worksheet.tasks as unknown as CleanTask[], "variant1")) as unknown as Worksheet["tasks"],
      };
      secondVariant = {
        ...secondVariant,
        tasks: (await ensureCount(target, (secondVariant.tasks ?? []) as unknown as CleanTask[], "variant2")) as unknown as Worksheet["tasks"],
      };
    }
  }

  // Разрыв 4: обрезанный ответ выше уже отбит (ретрай с удвоенным потолком, а
  // при неудаче — честная ошибка). Сюда конвейер доходит только с целым ответом.

  const meta: GenerateWorksheetMeta = {
    model: resultFinal.model,
    provider: resultFinal.provider,
    // Сумма по ВСЕМ вызовам: ретрай и дозапрос тоже стоили денег (AD-5).
    costUsd: calls.reduce((sum, c) => sum + c.costUsd, 0),
    // Суммируем только те вызовы, у которых провайдер вернул рубли: null — это
    // «не считал», а не «ноль», и складывать его с нулём значило бы выдумать
    // цену, которой нет.
    costRub: calls.some((c) => c.costRub != null)
      ? calls.reduce((sum, c) => sum + (c.costRub ?? 0), 0)
      : null,
    latencyMs: Date.now() - start,
    cached: false,
    generation: resultFinal.generation as GenerateWorksheetMeta["generation"],
  };

  // Log — ПО КАЖДОМУ вызову провайдера (AD-5).
  for (const call of calls) {
    await logLlmCall(db, {
      userId,
      task,
      provider: call.provider,
      model: call.model,
      plan,
      tokensIn: call.tokensIn,
      tokensOut: call.tokensOut,
      costUsd: call.costUsd,
      costRub: call.costRub,
      latencyMs: call.latencyMs,
      cached: false,
      fallback: call.generation === "boost",
    });
  }

  // Потребление по нормам тарифа (взвешенные токены), тоже по всем вызовам.
  const usage = await recordUsage(db, env, {
    userId,
    plan,
    weightedTokens: calls.reduce((sum, c) => sum + weightedTokens(c.model, c.tokensOut), 0),
  });

  // Итог по потерям — учитель должен видеть это без догадок (AD-7).
  const deliveredTotal =
    worksheet.tasks.length + (secondVariant?.tasks?.length ?? 0);
  const variantCount = secondVariant ? 2 : 1;
  const quality = summarizeLoss(
    request.count * variantCount,
    filterReports,
    topUpAdded,
    deliveredTotal,
  );

  const variantsInfo = buildVariantStatus(isControl ? 2 : 1, secondVariant ? 2 : 1, {
    degraded: isControl && (degraded || !secondVariant),
    degradedReason:
      isControl && (degraded || !secondVariant)
        ? degradedReason ?? "второй вариант не был получен"
        : undefined,
    retried,
  });

  // Save to cache. Второй вариант контрольной кладём рядом с первым:
  // без этого повторный запрос отдавал один лист вместо двух (12.10.2026).
  // Признаки quality/variants кладём ТОЖЕ (AD-4): повторный запрос обязан
  // вернуть ту же пару и тот же флаг деградации, не тратя денег.
  await saveCache(db, {
    key: cacheKey,
    subject: request.subject,
    grade: request.grade,
    topic: request.topic,
    difficulty: request.difficulty,
    count: request.count,
    type: request.type,
    response: { worksheet, secondVariant, quality, variants: variantsInfo },
  });

  return { worksheet, meta, usage, secondVariant, quality, variants: variantsInfo };
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
): Promise<{
  variant: ExamVariant;
  meta: GenerateWorksheetMeta;
  usage: UsageStatus | null;
  /** ТЗ-25: потери, которые фильтр нанёс варианту ОГЭ/ЕГЭ. */
  quality: QualityLossInfo;
}> {
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
  // ТЗ-25: отчёты фильтра по всем попыткам — по ним и лог, и признаки потерь.
  const examReports: QualityFilterReport[] = [];

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
      // Тот же фильтр, что у рабочего листа (08.10.2026): ОГЭ/ЕГЭ — это тоже
      // задания с текстом и ответом, жалобы на «математику в биологии» и
      // «задания по образцу» прилетают оттуда точно так же.
      //
      // ТЗ-25 разрыв 5: `.report` больше не отбрасывается. Для ОГЭ/ЕГЭ потери
      // бьют по учителю ОСОБЕННО неприятно — там задания считают по баллам, и
      // укороченный вариант обнаруживается уже на проверке работ, а не дома.
      // Ф-5 НЕ применили к ОГЭ/ЕГЭ: у задания КИМ ключ может лежать не в
      // `answer`, а в другом поле, и `GenerateExamArgs` не знает про
      // `withAnswers`. Считать все такие задания пустыми — значит выкинуть
      // нормальный вариант на ровном месте. Дефект из отчёта был на ЛИСТЕ
      // (русский 8), там путь и закрыт.
      const examFiltered = filterAndReport(
        variant.problems as unknown[],
        subject,
        false,
      );
      variant.problems = examFiltered.tasks as unknown as ExamVariant["problems"];
      examReports.push(examFiltered.report);
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
        // ТЗ-25: и здесь отчёт фильтра не отбрасывается — та же потеря,
        // та же причина. Если эта попытка будет принята, её отчёт и есть
        // актуальный.
        const retryFiltered = filterAndReport(
          retryVariant.problems as unknown[],
          subject,
          false,
        );
        retryVariant.problems = retryFiltered.tasks as unknown as ExamVariant["problems"];
        examReports.push(retryFiltered.report);
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

  // ТЗ-25 разрыв 5: потери ОГЭ/ЕГЭ видны в логе наравне с листом и
  // контрольной. Раньше отчёт фильтра здесь просто отбрасывался — по бюро
  // варианта нельзя было понять, выкинулось что-то или нет.
  for (const report of examReports) {
    logFilterReport({
      stage: "exam.problems",
      subject,
      // У ОГЭ/ЕГЭ учитель не заказывает число заданий: оно задано форматом
      // экзамена. Поэтому здесь пишем фактическое «до фильтра» и честно
      // помечаем, что потерь не было — при нулевом `dropped` в лог падает
      // уровень info, и такие строки отделяются от потерь одним фильтром.
      requested: report.before,
      report,
    });
  }

  const meta: GenerateWorksheetMeta = {
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    costRub: result.response.costRub ?? null,
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
    costRub: result.response.costRub ?? null,
    latencyMs: meta.latencyMs,
    cached: false,
    fallback: result.generation === "boost",
  });

  const usage = await recordUsage(db, env, {
    userId,
    plan,
    weightedTokens: weightedTokens(result.model, result.response.tokensOut),
  });

  // Потери по варианту ОГЭ/ЕГЭ — в ответе, чтобы учитель видел их и на экране.
  // `requested` здесь = «до фильтра», потому что число заданий задаёт формат
  // экзамена, а не учитель; `delivered` — фактическое.
  const examQuality = summarizeLoss(
    variant.problems.length +
      examReports.reduce((sum, r) => sum + (r.before - r.after), 0),
    examReports,
    0,
    variant.problems.length,
  );

  return { variant, meta, usage, quality: examQuality };
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
  // Причина, по которой ждём перегенерацию. language — это исходная причина
  // retry, quality добавлена 08.10.2026 и приходит с той же силой.
  let lastViolationKind: "language" | "quality" | null = null;

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
              ? user + retryInstruction(lastViolationKind)
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

    // 6a. Language guard. Детерминированная проверка на тексте самого материала:
    // модель периодически уходит в английский на русскоязычных предметах.
    const langViolation = findArtifactLanguageViolation(content, request.subject);
    if (langViolation) {
      lastViolation = langViolation;
      lastViolationKind = "language";
    } else {
      // 6b. Quality guard (08.10.2026): запрет чужого предмета, ссылок на
      // несуществующий образец и ответов-заглушек.
      //
      // Здесь нельзя «выкинуть плохой элемент», как делает filterTasks у листа:
      // у КТП элемент — это тема недели, у презентации — тезис слайда, и
      // выбрасывать их значит разбирать материал вручную. Поэтому единственный
      // честный способ заставить модель переделать — повторить запрос.
      const qualityViolation = findArtifactQualityViolation(content, request.subject);
      if (qualityViolation) {
        lastViolation = qualityViolation;
        lastViolationKind = "quality";
      }
    }
    if (!lastViolation) break;

    logLlmEvent("warn", `generateStructuredArtifact: guard violation, ${artifactType}`, {
      attempt: attempt + 1,
      maxAttempts: MAX_LANG_RETRIES + 1,
      subject: request.subject,
      kind: lastViolationKind,
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
    // Формулировка «wrong language» сохранена прежней намеренно: на неё
    // завязаны логи и алерты (и тесты контракта), переименование текста ошибки
    // не должно ломать наблюдаемость. Quality — отдельная ветка, чтобы по
    // сообщению было видно, ЧТО именно не так.
    const what =
      lastViolationKind === "quality" ? "with content-quality violations" : "in wrong language";
    throw new InternalError(
      `LLM returned ${artifactType} ${what} (${lastViolation}) after ${MAX_LANG_RETRIES} retries`,
    );
  }

  // 7. id и createdAt — ТОЛЬКО серверные, значение от модели не принимается
  //    вообще (разбор в generateWorksheet: почему именно так).
  const artifact = stampArtifact(content, spec.idPrefix);

  const meta: GenerateWorksheetMeta = {
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    costRub: result.response.costRub ?? null,
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
    costRub: result.response.costRub ?? null,
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

/**
 * Качество содержания для произвольного артефакта (08.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТО, ЕСЛИ ФИЛЬТР ЖИВЁТ В `quality-filter.ts`
 * ─────────────────────────────────────────────────────────────────────────────
 * `filterTasks` работает по массиву `tasks` и может выкинуть плохое задание —
 * так он и применён к рабочему листу. Но у карточек, КТП, плана урока,
 * презентации и ОГЭ/ЕГЭ другой контейнер, и «выкинуть элемент» там нельзя:
 * у КТП это тема недели, у презентации — тезис слайда.
 *
 * Для них единственный честный способ ЗАСТАВИТЬ модель переделать — повторить
 * запрос. Так здесь и сделано: тот же цикл retry, что у language guard, только
 * проверяем не язык, а содержание.
 *
 * Почему не «починить текст на месте»: замена чужой математики на русский
 * текст получается выдумкой — учитель получил бы задание, которого никто не
 * проверял. Переделать целиком дешевле и честнее.
 *
 * Возвращаем строку-причину, чтобы она попала в лог и в сообщение об ошибке:
 * молча проглоченное нарушение читается как «всё хорошо».
 */
function findArtifactQualityViolation(content: unknown, subject: string): string | null {
  const texts = collectArtifactTexts(content);
  for (const text of texts) {
    if (hasDanglingPatternRef(text)) {
      return `ссылка на образец, которого нет в задании: «${clip(text)}»`;
    }
    if (looksLikeForeignMath(text, subject)) {
      return `математика в задании по предмету «${subject}»: «${clip(text)}»`;
    }
    if (isPlaceholderAnswer(text)) {
      return `ответ-заглушка вместо ответа: «${clip(text)}»`;
    }
  }
  return null;
}

/** Все осмысленные строки артефакта — рекурсивный обход без технических полей. */
function collectArtifactTexts(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 400) return out;
  if (typeof value === "string") {
    // Короткие служебные значения (даты, слаг, «1») содержанием не являются.
    if (value.trim().length >= 25) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactTexts(item, out, depth + 1);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectArtifactTexts(item, out, depth + 1);
    }
  }
  return out;
}

/**
 * Добавка к промпту при повторной попытке.
 *
 * Модели нужна конкретика: «переделай» без указания, что именно не так,
 * повторяет ту же ошибку. Поэтому здесь называем и причину, и что делать.
 */
function retryInstruction(kind: "language" | "quality" | null): string {
  if (kind === "language") {
    return (
      "\n\nВНИМАНИЕ: предыдущая попытка вернула материал на иностранном языке. " +
      "Это ошибка. Перегенерируй — ВЕСЬ материал строго на русском языке " +
      "(если предмет не английский/немецкий)."
    );
  }
  return (
    "\n\nВНИМАНИЕ: предыдущая попытка нарушила требования к содержанию. Это ошибка. " +
    "Перегенерируй материал с учётом этого:\n" +
    "· НИКАКОЙ математики в заданиях, если предмет не математический. Проверь каждое " +
    "задание: оно решается средствами СВОЕГО предмета.\n" +
    "· НИКАКИХ ссылок на образец, если образца нет в самом задании. Если пишете " +
    "«по образцу» — приведите этот образец прямо в тексте задания.\n" +
    "· НИКАКИХ ответов-заглушек («индивидуальный ответ», «зависит от ученика»). " +
    "Либо конкретный ответ, либо пустой ответ с критериями проверки в пояснении.\n" +
    "Каждое задание должно даваться ученику этого класса в обычном школьном кабинете."
  );
}

/** Обрезка для лога: причина должна помещаться в строку, а не в абзац. */
function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
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
    costRub: result.response.costRub ?? null,
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
    costRub: result.response.costRub ?? null,
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
      costRub: step.res.response.costRub ?? null,
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
    costRub: step.res.response.costRub ?? null,
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

/**
 * Габариты страницы для ГРУБОЙ оценки vision-токенов.
 *
 * Точной разбивки у нас нет: клиент шлёт уже сжатый снимок, а декодировать его
 * в воркере дорого. Раньше здесь были голые `1600` в двух местах — берём те
 * же числа, просто вынесём в именованные константы, потому что теперь по ним
 * считается не одна картинка, а каждая страница.
 */
const PHOTO_EST_WIDTH_PX = 1600;
const PHOTO_EST_HEIGHT_PX = 1600;

/** Одна страница работы для photo-check. */
export interface CheckPhotoImage {
  bytes: ArrayBuffer;
  mimeType: string;
}

export interface CheckPhotoArgs {
  /**
   * Страницы работы ПО ПОРЯДКУ: от 1 до 3 штук (лимит — в роуте, MAX_PHOTOS).
   *
   * Раньше здесь был один `imageBytes` + `mimeType`, и вторая-третья страница
   * работы просто не доезжала до модели: учитель получал неполный вердикт.
   * Порядок в массиве значим — по нему модель читает страницы как страницы.
   */
  images: CheckPhotoImage[];
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
  /** Фактическое списание в рублях от провайдера (`usage.cost_rub`), null если
   *  провайдер такого поля не отдаёт. См. LLMResponse.costRub. */
  costRub?: number | null;
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
    pageCount: args.images.length,
  });

  // Оценка стоимости ДО вызова: грубая, по размеру картинки (см. cost.ts).
  // Реальную стоимость вернёт провайдер в usage — её и тарифицирует calcCost.
  //
  // ВАЖНО: считаем ПО КАЖДОЙ странице. Раньше картинка была одна, и оценка
  // молча делилась на количество снимков: три фото выглядели бы как одно, и
  // предварительная стоимость была бы занижена втрое — платные планы
  // ограничивают бюджет именно по этой оценке.
  const estimatedImageTokens = args.images.reduce(
    (sum, image) =>
      sum + (image.bytes.byteLength > 0 ? estimateImageTokens(PHOTO_EST_WIDTH_PX, PHOTO_EST_HEIGHT_PX, detail) : 0),
    0,
  );
  const estimatedCostUsd = calcCost(decision.primary.model, estimatedImageTokens, 1000);

  // Каждую страницу кладём отдельным image_url в content — OpenAI-совместимый
  // формат, polza такой принимает наравне с внешним URL (см. providers/polza.ts:
  // массив content уходит без преобразований). Отдельный R2-URL тут не нужен:
  // он всё равно просидел бы в логах провайдера как ссылка на ПДн ребёнка.
  // Порядок частей = порядок страниц, и модель обязана видеть их именно так.
  const content: LLMContentPart[] = [
    { type: "text", text: user },
    ...args.images.map(
      (image): LLMContentPart => ({
        type: "image_url",
        image_url: {
          url: `data:${image.mimeType};base64,${arrayBufferToBase64(image.bytes)}`,
          detail,
        },
      }),
    ),
  ];

  const result = await callWithFallback(
    {
      model: decision.primary.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
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
    costRub: result.response.costRub ?? null,
    latencyMs,
    cached: false,
    fallback: result.generation === "boost",
  });

  return {
    summary,
    model: result.model,
    provider: result.provider,
    costUsd: result.response.costUsd,
    costRub: result.response.costRub ?? null,
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
  /**
   * Фактическое списание в рублях от провайдера (`usage.cost_rub` у polza.ai).
   *
   * Опционально НЕ для удобства, а потому что большинство провайдеров такого
   * поля не отдаёт: там фактических денег у нас просто нет, и выдумывать их
   * из `costUsd` нельзя (это разные величины). Если значения нет — в
   * `llm_costs_actual` ничего не пишется, и расход по этому провайдеру
   * считается исключительно по нашему расчёту.
   */
  costRub?: number | null;
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

    // Фактические деньги — отдельной строкой и только если провайдер их назвал.
    // Пишем после llm_logs, потому что главная запись важнее: если упадёт она,
    // теряется наблюдаемость вызова, а не отчётность по деньгам.
    if (typeof params.costRub === "number" && Number.isFinite(params.costRub)) {
      await db
        .prepare(
          `INSERT INTO llm_costs_actual
             (id, user_id, task, provider, model, cost_rub, cost_usd_est, latency_ms, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          params.userId,
          params.task,
          params.provider,
          params.model,
          params.costRub,
          params.costUsd,
          params.latencyMs,
          Math.floor(Date.now() / 1000),
        )
        .run();
    }
  } catch (e) {
    logLlmEvent("error", "logLlmCall failed", { error: String(e) });
  }
}

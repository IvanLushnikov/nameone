/**
 * LLM routing: выбрать провайдера+модель ПО СЛОЖНОСТИ ЗАДАЧИ.
 *
 * ГЛАВНОЕ ПРАВИЛО (решение 2026-10-02, docs/04-pricing-economics-v2.md §2.4):
 * выбор модели НЕ зависит от тарифа. Тариф задаёт норму и право на
 * премиум-типы задач, но не модель.
 *
 *   Раньше: plan=plus → Opus на ВСЁ, включая домашку из 10 заданий.
 *   Одна задача — один выход: Luna = 0,06 ₽ за лист, Opus = 3,90 ₽ (в 65 раз
 *   дороже) за счёт кэша. Учитель на «Плюсе» платил за Opus там, где Luna
 *   даёт тот же ответ за 15 копеек — маржа тарифа была 14% вместо 62%.
 *
 *   Теперь:
 *     worksheet / test / cards / lesson-plan / materials → Luna
 *     control / oge / ege / ktp / presentation              → Sonnet 5.5
 *     validate / embed / photo-check / image-gen            → своя модель
 *
 * С 2026-09-27 — polza.ai единственный провайдер для УчЛист.
 * Один POLZA_API_KEY покрывает все модели. Без ключа → primary = null
 * (routes должны fallback на mock или вернуть ошибку).
 *
 * `callWithFallback` — обёртка: пробует primary, на ошибке — fallbacks.
 * На полном падении бросает InternalError.
 */

import type { Env } from "../env";
import { InternalError } from "../lib/errors";
import { logLlmEvent } from "./log";
import { isProviderEnabled, isVisionModel } from "./config";
import { getProvider, hasCompleteImpl } from "./providers/base";
import type {
  LLMRequest,
  LLMResponse,
  ProviderPick,
  RoutingDecision,
  GenerationKind,
  ArtifactType,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Продуктовый тип артефакта → задача роутера
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Единственное место, где продуктовый тип артефакта превращается в задачу
 * для роутера. Новый тип артефакта на фронте обязан появиться здесь.
 * Строки обязаны совпадать с фронтовым `TaskType` (`src/lib/types.ts` в корне
 * репозитория) — сверка закрыта тестом tests/unit/router.test.ts.
 */
export const ARTIFACT_TASK: Record<ArtifactType, GenerationKind> = {
  worksheet: "worksheet-gen",
  test: "test-gen",
  cards: "cards-gen",
  control: "control-gen",
  "lesson-plan": "lesson-plan-gen",
  presentation: "presentation-gen",
  ktp: "ktp-gen",
  oge: "exam-gen",
  ege: "exam-gen",
  materials: "worksheet-gen",
  // TZ-16. Три типа из Этапа 1: сами артефакты реализуются в Этапах 2–7,
  // но роутинг для них уже должен быть решён, иначе первый же вызов уедет
  // по ветке «неизвестный тип → worksheet-gen» случайно.
  "lesson-bundle": "worksheet-gen", // урок целиком = 4 массовых артефакта
  interactive: "worksheet-gen", // форма для учеников генерируется как контент
  image: "image-gen", // иллюстрации: провайдера пока нет, роут отдаст 503
};

/**
 * Типы задач, которые входят только в тариф «Плюс».
 *
 * Проверяется в роутах ДО вызова LLM: на «Базовом» пользователь получает
 * 402 с предложением апгрейда, а не сгенерированный на дешёвой модели
 * экзаменационный вариант. Основано на фичах тарифа в `plans.ts`
 * («Всё из Базового» + «Варианты ОГЭ/ЕГЭ с разбором» + «Презентации и КТП»).
 */
export const PLUS_ONLY_TASKS: ReadonlySet<GenerationKind> = new Set<GenerationKind>([
  "exam-gen",
  "ktp-gen",
  "presentation-gen",
]);

/** Задача по типу артефакта. Неизвестный тип трактуем как рабочий лист. */
export function taskForArtifact(type: string | null | undefined): GenerationKind {
  if (!type) return "worksheet-gen";
  return ARTIFACT_TASK[type as ArtifactType] ?? "worksheet-gen";
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Лестница эскалации. Срабатывает ТОЛЬКО при фактической ошибке провайдера
 * (см. callWithFallback), а не по тарифу и не по «хочу подешевле поделать».
 *
 * Потолок по умолчанию — Sonnet. Opus сюда не входит намеренно: перепрыгивать
 * на 2 337 ₽/1M выхода из-за 5xx Luna — значит отдать за один вызов цену
 * сорока листов. Opus включается только явной правкой этого массива
 * (см. docs/04-pricing-economics-v2.md §10 «риск 3»).
 */
const ESCALATION: Record<string, string[]> = {
  "gpt-6-luna": ["gpt-6-sol", "claude-sonnet-5-5"],
  "gpt-6-sol": ["claude-sonnet-5-5"],
  "claude-sonnet-5-5": [],
};

/** Первичная модель по сложности задачи. Единственное место с этим знанием. */
const PRIMARY_BY_TASK: Partial<Record<GenerationKind, string>> = {
  "worksheet-gen": "gpt-6-luna",
  "test-gen": "gpt-6-luna",
  "cards-gen": "gpt-6-luna",
  "lesson-plan-gen": "gpt-6-luna",
  // Сложные структурированные документы и экзаменационная точность.
  // Sonnet 5.5 = ровно половина Opus по цене при том же prompt caching.
  "control-gen": "claude-sonnet-5-5",
  "presentation-gen": "claude-sonnet-5-5",
  "ktp-gen": "claude-sonnet-5-5",
  "exam-gen": "claude-sonnet-5-5",
};

// ─────────────────────────────────────────────────────────────────────────────
// Routing matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Возвращает primary + fallbacks для заданной задачи.
 *
 * Polza = единственный провайдер. Если POLZA_API_KEY нет — primary = null
 * и routes должен fallback'нуть на mock или вернуть 503.
 *
 * Параметра `plan` здесь нет намеренно: с 2026-10-02 тариф не влияет на
 * выбор модели. Он влияет на норму (ratelimit.ts) и на право на премиум-тип
 * (PLUS_ONLY_TASKS), но не на то, какая модель ответит.
 */
export function pickModel(task: GenerationKind, env: Env): RoutingDecision {
  if (!isProviderEnabled(env, "polza")) {
    // Polza не сконфигурирован — routes должен fallback на mock.
    return { primary: null, fallbacks: [], generation: "primary" };
  }

  switch (task) {
    case "worksheet-gen":
    case "test-gen":
    case "cards-gen":
    case "lesson-plan-gen":
    case "control-gen":
    case "presentation-gen":
    case "ktp-gen":
    case "exam-gen": {
      const model = PRIMARY_BY_TASK[task]!;
      const fallbacks = (ESCALATION[model] ?? []).map((m) => ({
        provider: "polza" as const,
        model: m,
      }));
      return { primary: { provider: "polza", model }, fallbacks, generation: "primary" };
    }

    case "validate": {
      return {
        primary: { provider: "polza", model: "deepseek-v4-flash" },
        fallbacks: [],
        generation: "primary",
      };
    }

    case "embed": {
      // text-embedding-3-large — primary (точно есть на polza, проверено).
      // qwen3-embedding-8b — fallback (мультиязычный, для русских текстов;
      // точное имя на polza не подтверждено, может зависнуть если 404 не возвращается).
      return {
        primary: { provider: "polza", model: "text-embedding-3-large" },
        fallbacks: [{ provider: "polza", model: "qwen3-embedding-8b" }],
        generation: "primary",
      };
    }

    case "image-gen":
      // Заглушка на старте — нет провайдера. Вызывающий должен вернуть null.
      return { primary: null, fallbacks: [], generation: "primary" };

    case "photo-check": {
      // TZ-11 §5.1: распознаём фото тетради мультимодальной gpt-6-luna.
      // Смена модели = одна строка в MODEL_CATALOG (vision: true).
      // Тариф тут не играет: цена проверки ~0.05 ₽, plus-модель тут была бы
      // пустой тратой денег (Opus на фото рукописи ничего не даёт сверху).
      const VISION_MODEL = "gpt-6-luna";
      if (!isVisionModel(VISION_MODEL)) {
        // Страховка от тихой поломки: модель убрали из каталога или сняли флаг.
        logLlmEvent("error", "pickModel(photo-check): модель не vision", {
          model: VISION_MODEL,
        });
        return { primary: null, fallbacks: [], generation: "primary" };
      }
      return {
        primary: { provider: "polza", model: VISION_MODEL },
        // Fallback — та же vision-модель по другому apiName-маршруту не нужен:
        // у polza один провайдер, второй вызов той же модели проблему не решит.
        fallbacks: [],
        generation: "primary",
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// callWithFallback
// ─────────────────────────────────────────────────────────────────────────────

export interface CallResult {
  response: LLMResponse;
  provider: string;
  model: string;
  /** Какой pick сработал: 'primary' | 'boost' | 'premium'. */
  generation: "primary" | "boost" | "premium";
}

/**
 * Вызвать LLM с fallback chain.
 *
 * Логика:
 *  1) Попробовать primary.
 *  2) На ошибке — каждый fallback по очереди.
 *  3) Если primary и все fallbacks упали — бросить InternalError.
 *  4) Если primary == null (нет ключа polza) — бросить InternalError.
 */
export async function callWithFallback(
  req: LLMRequest,
  decision: RoutingDecision,
  env: Env,
): Promise<CallResult> {
  const allPicks: ProviderPick[] = [];
  if (decision.primary) allPicks.push(decision.primary);
  allPicks.push(...decision.fallbacks);

  if (allPicks.length === 0) {
    throw new InternalError(
      "LLM: POLZA_API_KEY not configured (set it in wrangler secret put or .dev.vars)",
    );
  }

  let lastError: unknown = null;
  for (let i = 0; i < allPicks.length; i++) {
    const pick = allPicks[i]!;
    const isLast = i === allPicks.length - 1;
    try {
      // Раньше здесь стояло `pick.provider as "polza"` — каст, из-за которого
      // любой другой provider в цепочке фолбэков молча превращался в polza,
      // то есть провайдеры openai/anthropic/deepseek были недостижимы.
      // Теперь ID проверяется по-настоящему: неизвестный/не-callable
      // провайдер (openrouter, dashscope) считается неуспешной попыткой
      // и цепочка фолбэков идёт дальше.
      if (!hasCompleteImpl(pick.provider)) {
        throw new InternalError(
          `LLM: provider "${pick.provider}" не имеет реализации complete() — ` +
            `fallback пропущен (см. hasCompleteImpl в providers/base.ts)`,
        );
      }
      const provider = getProvider(pick.provider, env);
      // Модель в запросе ОБЯЗАНА совпадать с тем pick, который мы сейчас
      // пробуем. Раньше здесь стоял неизменённый `req`, из-за чего вся
      // лестница `ESCALATION` (Luna → Sol → Sonnet) била в ту же Luna:
      // роутер менял провайдера в цикле, но `req.model` оставался
      // первичной моделью, то есть фолбэк не фолбэчил, а повторял тот же
      // вызов — и платил за него цену дорогой модели повторно.
      // Побочный эффект был и в учёте: успешный «фолбэк» записывался в
      // llm_logs как `pick.model`, хотя фактически отработала `req.model`,
      // то есть аналитика роутинга врала о том, какая модель ответила.
      const attemptReq: LLMRequest =
        req.model === pick.model ? req : { ...req, model: pick.model };
      const response = await provider.complete(attemptReq, env);
      const generation: "primary" | "boost" | "premium" =
        i === 0
          ? (decision.generation ?? "primary")
          : pick.model.includes("sol")
            ? "boost"
            : "primary";
      logLlmEvent("info", "callWithFallback: success", {
        provider: provider.id,
        model: pick.model,
        generation,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
      });
      return { response, provider: provider.id, model: pick.model, generation };
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      logLlmEvent("warn", "callWithFallback: attempt failed", {
        provider: pick.provider,
        model: pick.model,
        attempt: i + 1,
        totalAttempts: allPicks.length,
        error: msg.slice(0, 300),
        isLast,
      });

      // НЕУДАЧНАЯ ПОПЫТКА — ТОЖЕ ПИШЕТСЯ В llm_logs (06.10.2026).
      //
      // Раньше строка в базу появлялась только на успехе. То есть цепочка
      // «Luna 5xx → ушли на Sol → ушли на Sonnet → всё упало» не оставляла
      // в базе НИ ОДНОЙ записи: провайдер отработал, деньги потрачены, а в
      // отчёте — ноль. Именно поэтому по итогам аудита нельзя было сказать,
      // сколько отказов у провайдера и по каким причинам.
      //
      // Пишем best-effort: ошибка записи не должна ломать генерацию, поэтому
      // всё обёрнуто в try/catch, а детали ошибки кладутся в поле `error`.
      await recordFailedAttempt(env, pick, e, i + 1, allPicks.length);

      if (isLast) break;
    }
  }

  throw new InternalError(
    `LLM: all providers failed (${allPicks.length} attempts). Last: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    { attempts: allPicks.length },
  );
}

/**
 * Записать неудачную попытку вызова в `llm_logs`.
 *
 * Строка отличается от успешной пустым `cost_usd` и заполненным `error`,
 * поэтому существующая выборка в admin.ts (`AND error IS NULL` — «без ошибок»)
 * продолжает считать только успешные вызовы, а полная картина расхода видна
 * по всем строкам.
 */
async function recordFailedAttempt(
  env: Env,
  pick: ProviderPick,
  error: unknown,
  attempt: number,
  totalAttempts: number,
): Promise<void> {
  const db = (env as { DB?: D1Database }).DB;
  if (!db) return;
  const message = error instanceof Error ? error.message : String(error);
  // Детали (finishReason / reasoningTokens и т.п.) провайдер кладёт в details —
  // без них строка «пустой content» не отличима от «сеть отвалилась».
  const details =
    error && typeof error === "object" && "details" in error
      ? (error as { details?: unknown }).details
      : null;
  try {
    await db
      .prepare(
        `INSERT INTO llm_logs
           (id, user_id, task, provider, model, plan,
            tokens_in, tokens_out, cost_usd, latency_ms, cached, fallback, error, created_at)
         VALUES (?1, NULL, 'unknown', ?2, ?3, 'free', 0, 0, 0, 0, 0, ?4, ?5, ?6)`,
      )
      .bind(
        `log_fail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        pick.provider,
        pick.model,
        attempt > 1 ? 1 : 0,
        // Ограничиваем длину: error идёт в колонку TEXT, но разбор причин
        // читают глазами, и тысячи символов там не нужны.
        `${message.slice(0, 400)}${details ? ` | ${JSON.stringify(details).slice(0, 400)}` : ""}`,
        Math.floor(Date.now() / 1000),
      )
      .run();
    logLlmEvent("info", "callWithFallback: failed attempt recorded", {
      provider: pick.provider,
      model: pick.model,
      attempt,
      totalAttempts,
    });
  } catch (e) {
    // Запись в базу сама упала — молча ронять генерацию из-за этого нельзя.
    logLlmEvent("warn", "callWithFallback: не удалось записать отказ в llm_logs", {
      error: String(e),
    });
  }
}

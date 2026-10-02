/**
 * Потребление: взвешенные токены, норма тарифа, МЯГКИЙ порог.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Почему токены, а не «штуки листов»
 * ─────────────────────────────────────────────────────────────────────────────
 * Один и тот же артефакт стоит по-разному в зависимости от модели: лист на Luna
 * — 0,06 ₽, вариант ОГЭ на Sonnet — 7,70 ₽ (в 128 раз дороже). Норма в штуках
 * не работает: дорогой артефакт съедает квоту бесплатно. Норма в сырых токенах
 * тоже не работает: 1 токен на Luna и 1 токен на Sonnet считались бы одинаково,
 * а стоят в 39 раз разного.
 *
 * Взвешенный токен снимает противоречие:
 *
 *     weighted = tokensOut × (price_out(модели) / price_out(Luna))
 *
 * Это ровно Luna-эквивалент: счёт совпадает с себестоимостью до копейки, но
 * остаётся одной линейной единицей, которую можно складывать и показывать.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Почему порог МЯГКИЙ
 * ─────────────────────────────────────────────────────────────────────────────
 * Решение владельца продукта: при исчерпании нормы показываем «докупить»,
 * но НЕ блокируем генерацию. Жёсткий блок посреди учебного года ломает
 * продукт сильнее, чем ограничивает убыток: учитель сдаёт урок, а продукт
 * отказывает. Экономику прикрывают три вещи, а не блокировкой:
 *   1) роутинг по сложности (листы → Luna, экзамены → Sonnet);
 *   2) нормы, посчитанные с запасом от реальной нагрузки учителя;
 *   3) админский алерт по cost/выручка (см. routes/admin.ts).
 *
 * Пересечение нормы — это СОБЫТИЕ И ПРЕДЛОЖЕНИЕ, а не ошибка. Единственное,
 * что возвращает 4xx по генерации, — исчерпанная бесплатная квота.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { ACADEMIC_YEAR_MONTHS } from "./billing";
import { getActiveSubscription } from "../db/userResources";
import { getUserById } from "../db/queries";
import { sendQuotaAlert } from "./alerts";
import { logLlmEvent } from "../llm/log";
import { MODEL_COSTS, REFERENCE_MODEL_ID } from "../llm/config";
import type { Env } from "../env";

/** Курс, зашитый в MODEL_COSTS: цены там в долларах. */
const RUB_PER_USD = 85;
/** Цена выхода эталонной модели (Luna) за 1M токенов в долларах. */
const REFERENCE_OUTPUT_PER_1M_USD = MODEL_COSTS[REFERENCE_MODEL_ID]?.outputPer1M ?? 0.35;

// Норма живёт в файле про потребление, а длительность периода — в billing.
// Реэкспортируем, чтобы тестам и вызывающим не нужно было знать, где что лежит.
export { ACADEMIC_YEAR_MONTHS };

/**
 * Норма тарифа в взвешенных токенах на МЕСЯЦ.
 *
 * Числа из docs/04-pricing-economics-v2.md §7.1. Проверка сценариев:
 *   Базовый: 1,44 млн × 0,00002921 ₽ = 42 ₽ COGS при выручке 422 ₽/мес → 90% маржа.
 *   Плюс:    16,0 млн × 0,00002921 ₽ = 467 ₽ COGS при выручке 1 222 ₽/мес → 62% маржа.
 *
 * Сценарий «учитель генерирует домашку на каждый урок, 24 урока/нед» — это
 * 14,9 млн взвешенных токенов в месяц, то есть влезает в норму «Плюса» с
 * запасом. Норма занижена не должна быть: при мягком пороге упереться в стену
 * нельзя, а вот недобрать тарифом можно.
 */
export const PLAN_NORM_PER_MONTH: Record<"base" | "plus", number> = {
  base: 1_440_000,
  plus: 16_000_000,
};

/** Школа: норма на класс = 3 × базовая (ориентир до пилота с реальными школами). */
export const SCHOOL_NORM_PER_CLASS = PLAN_NORM_PER_MONTH.base * 3;

/** Норма для бесплатного тарифа — в штуках генераций, а не в токенах. */
export const FREE_TOTAL_GENERATIONS = 3;

/** Среднее число out-токенов в листе-домашки — для перевода токенов в листы. */
export const TOKENS_PER_WORKSHEET = 1_600;

const MONTH_SECONDS = 30 * 86400;

export type UsagePlan = "free" | "base" | "plus";

/** Метрики в таблице usage_counters. */
export const METRIC_WEIGHTED = "weighted_tokens";
export const METRIC_GENERATIONS = "generations";

export interface UsageWindow {
  /** Начало окна (unix seconds). Для подписки — starts_at, для free — 0. */
  windowStart: number;
  /** Окно кончится (unix seconds) или null для бесконечного окна free. */
  windowEndsAt: number | null;
  /** Норма в взвешенных токенах за ВЕСЬ период, null = нормы нет. */
  norm: number | null;
  /** Число месяцев в окне — нужно, чтобы масштабировать помесячную норму. */
  months: number;
}

export interface UsageStatus {
  used: number;
  norm: number | null;
  /** Превышена норма. Генерация при этом НЕ блокируется. */
  over: boolean;
  /** Остаток; null, если нормы нет (free / без подписки). */
  remaining: number | null;
  window: UsageWindow;
}

/**
 * Окно нормы для пользователя.
 *
 * Окно привязано к ОПЛАЧЕННОМУ периоду, а не к календарю: оплатив 15 октября
 * «учебный год», учитель получает одно окно на 9 месяцев, и норма на это окно
 * в 9 раз больше помесячной. Календарное «с 1-го по 1-е» тут не годится —
 * тогда норма обнулялась бы в произвольный момент, посреди учебного года.
 */
export async function usageWindowFor(
  db: D1Database,
  userId: string | null,
  plan: UsagePlan,
): Promise<UsageWindow> {
  const never: UsageWindow = {
    windowStart: 0,
    windowEndsAt: null,
    norm: null,
    months: 0,
  };
  if (!userId || plan === "free") return never;

  const sub = await getActiveSubscription(db, userId);
  if (!sub) return never;

  // Помесячная оплата = окно в месяц; «учебный год» = окно на 9 месяцев.
  const months = sub.period === "academicYear" ? ACADEMIC_YEAR_MONTHS : 1;
  const perMonth = PLAN_NORM_PER_MONTH[plan as "base" | "plus"] ?? PLAN_NORM_PER_MONTH.base;
  const start = new Date(sub.startsAt).getTime();
  const norm = Math.round(perMonth * months);
  return {
    windowStart: Math.floor(start / 1000),
    windowEndsAt: Math.floor(new Date(sub.endsAt).getTime() / 1000),
    norm,
    months,
  };
}

/** Текущее значение счётчика по метрике в окне. */
export async function getCounter(
  db: D1Database,
  userId: string,
  metric: string,
  windowStart: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count FROM usage_counters
       WHERE user_id = ?1 AND metric = ?2 AND window_start = ?3`,
    )
    .bind(userId, metric, windowStart)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Инкремент счётчика. Insert-or-update: два SQL без транзакции.
 *
 * Атомарности на уровне D1 хватает — параллельных генераций одного учителя
 * (две вкладки) может быть две, и потеря одного инкремента не сдвинет норму.
 * Для прода (выручка) это неприемлемо, для счётчика потребования — достаточно.
 */
export async function bumpCounter(
  db: D1Database,
  userId: string,
  metric: string,
  windowStart: number,
  delta: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO usage_counters (id, user_id, metric, window_start, count, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(user_id, metric, window_start)
       DO UPDATE SET count = count + ?5, updated_at = ?6`,
    )
    .bind(`uc_${metric}_${windowStart}_${userId}`.slice(0, 60), userId, metric, windowStart, delta, now)
    .run();
}

/** Текущий статус потребления. Ничего не меняет — чистое чтение. */
export async function getUsageStatus(
  db: D1Database,
  userId: string | null,
  plan: UsagePlan,
): Promise<UsageStatus> {
  const window = await usageWindowFor(db, userId, plan);
  if (!userId || window.norm == null) {
    return { used: 0, norm: null, over: false, remaining: null, window };
  }
  const used = await getCounter(db, userId, METRIC_WEIGHTED, window.windowStart);
  return {
    used,
    norm: window.norm,
    over: used >= window.norm,
    remaining: Math.max(0, window.norm - used),
    window,
  };
}

/**
 * Записать фактическое потребление после успешной генерации.
 *
 * Взвешенные токены пишутся ТУТ, в момент вызова, а не пересчитываются при
 * агрегации из llm_logs: цены моделей на polza.ai уже менялись дважды, и
 * пересчёт задним числом тихо переписал бы норму всем, кто заплатил.
 */
export async function recordUsage(
  db: D1Database,
  env: Env,
  params: { userId: string | null; plan: UsagePlan; weightedTokens: number },
): Promise<UsageStatus | null> {
  const { userId, plan, weightedTokens } = params;
  if (!userId || plan === "free" || weightedTokens <= 0) return null;

  const window = await usageWindowFor(db, userId, plan);
  if (window.norm == null) return null;

  await bumpCounter(db, userId, METRIC_WEIGHTED, window.windowStart, weightedTokens);
  await bumpCounter(db, userId, METRIC_GENERATIONS, window.windowStart, 1);

  const used = await getCounter(db, userId, METRIC_WEIGHTED, window.windowStart);
  const over = used >= window.norm;

  if (over) {
    // Не блокируем. Пишем событие (на нём построен алерт) и возвращаем флаг,
    // чтобы UI показал «докупить».
    logLlmEvent("warn", "usage: quota exceeded (soft)", {
      userId,
      plan,
      used,
      norm: window.norm,
      period: new Date(window.windowStart * 1000).toISOString(),
    });

    // Письмо админу — best effort и без await: генерация не должна ждать
    // сторонний SMTP. Функция сама себя отсекает по суткам и не бросает.
    void notifyQuotaExceeded(db, env, {
      userId,
      plan,
      used,
      norm: window.norm,
      windowEndsAt: window.windowEndsAt,
    }).catch(() => {
      /* алерт не ушёл — это не повод трогать генерацию */
    });
  }

  return {
    used,
    norm: window.norm,
    over,
    remaining: Math.max(0, window.norm - used),
    window,
  };
}

/**
 * Бесплатная квота: N генераций ВСЕГО, без сброса.
 *
 * Раньше было 3 в сутки, и счётчик жил в localStorage фронта — то есть
 * обнулялся сменой системного времени браузера и не виден бэку. Сейчас счёт
 * на сервере, ключ привязан к аккаунту (или к отпечатку для анонимов), окно
 * бесконечное. Это единственное место, где бесплатный тариф ограничен жёстко.
 */
export async function checkFreeQuota(
  db: D1Database,
  ownerKey: string,
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  const key = `freetotal:${ownerKey}`;
  const row = await db
    .prepare(`SELECT count FROM rate_limits WHERE key = ?1`)
    .bind(key)
    .first<{ count: number }>();
  const used = row?.count ?? 0;
  return {
    allowed: used < FREE_TOTAL_GENERATIONS,
    used,
    limit: FREE_TOTAL_GENERATIONS,
    remaining: Math.max(0, FREE_TOTAL_GENERATIONS - used),
  };
}

/** Списать одну генерацию из бесплатной квоты. Вызывается ПОСЛЕ успешной генерации. */
export async function consumeFreeQuota(db: D1Database, ownerKey: string): Promise<void> {
  const key = `freetotal:${ownerKey}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO rate_limits (id, key, count, window_start)
       VALUES (?1, ?2, 1, 0)
       ON CONFLICT(key) DO UPDATE SET count = count + 1`,
    )
    .bind(`rl_free_${key.slice(0, 40)}`, key)
    .run();
  void now;
}

/**
 * Сколько листов это в токенах — для понятной подписи в UI.
 */
export function tokensToWorksheets(tokens: number): number {
  return Math.round(tokens / TOKENS_PER_WORKSHEET);
}

/** Цена одного взвешенного токена в рублях (эталон — выход Luna). */
const RUB_PER_WEIGHTED_TOKEN = (REFERENCE_OUTPUT_PER_1M_USD / 1_000_000) * RUB_PER_USD;

interface QuotaExceededArgs {
  userId: string;
  plan: UsagePlan;
  used: number;
  norm: number;
  windowEndsAt: number | null;
}

/**
 * Собрать и отправить алерт. Отдельная функция, чтобы `recordUsage` не знал
 * про email, Resend и цену токена.
 */
async function notifyQuotaExceeded(
  db: D1Database,
  env: Env,
  args: QuotaExceededArgs,
): Promise<void> {
  const user = await getUserById(db, args.userId);
  if (!user?.email) return;
  const window = await usageWindowFor(db, args.userId, args.plan);
  await sendQuotaAlert(db, env, {
    userId: args.userId,
    email: user.email,
    plan: args.plan,
    used: args.used,
    norm: args.norm,
    costOverNormRub: (args.used - args.norm) * RUB_PER_WEIGHTED_TOKEN,
    periodStart: window.windowStart,
    periodEndsAt: args.windowEndsAt,
  });
}

export { MONTH_SECONDS };

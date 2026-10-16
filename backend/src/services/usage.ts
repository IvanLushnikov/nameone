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
import {
  monthKeyOf,
  nextMonthStartSec,
  readMonthGenerations,
  readMonthHistory,
  readMonthNoticeSent,
  bumpMonthGenerations,
  markMonthNoticeSent,
  ensureFreeUsageTable,
  type FreeUsageMonthRow,
} from "../db/free-usage";
import { sendFreeQuotaNoticeEmail } from "./email";
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
/**
 * Норма тарифа на месяц в взвешенных токенах.
 *
 * `standard` — тариф «Оптимальный», добавлен по ТЗ-21 п.4 (990 ₽/мес,
 * норма втрое выше «Базового» за вдвое большую цену). Зеркалит
 * `NORM_STANDARD` в `src/lib/content/plans.ts`.
 *
 * Ключи здесь — ровно те планы, у которых есть помесячная норма. «Школы» в
 * таблице нет намеренно: её норма на класс живёт отдельной константой
 * (`SCHOOL_NORM_PER_CLASS`), потому что на класс считают, а не на тариф.
 */
export const PLAN_NORM_PER_MONTH: Record<"base" | "standard" | "plus", number> = {
  // Нормы пересчитаны под цены 249 / 499 / 999 ₽ (снижение 12.10.2026).
  // Правило: max(текущая норма, сценарий В × 1,5), но не выше потолка,
  // при котором маржа держится 70%. Отсюда 2 400 000 и 9 700 000.
  // Расчёт — docs/36-price-cut-implementation-plan-2026-10-12.md, §1.
  base: 2_400_000,
  standard: 4_800_000,
  plus: 9_700_000,
};

/** Школа: норма на класс = 3 × базовая (ориентир до пилота с реальными школами). */
export const SCHOOL_NORM_PER_CLASS = PLAN_NORM_PER_MONTH.base * 3;

/**
 * Бесплатная квота: генераций В МЕСЯЦ, а не всего (ТЗ-29).
 *
 * Было 3 навсегда: учитель проверил сервис в сентябре, а в октябре ему отказали,
 * и на «попробовать» это уже не похоже. Стало 5 в месяц со сбросом 1-го числа.
 * Само слово «навсегда» в интерфейс не возвращаем — оно и было главным
 * раздражителем (аудит Д-2) — теперь квота честно описана как помесячная.
 *
 * Счёт живёт в `free_usage` по ключу (owner_key, month): сброс — это новый
 * месяц, а не затирание строки, поэтому история остаётся (db/free-usage.ts).
 */
export const FREE_TOTAL_GENERATIONS = 5;

/**
 * Номер генерации, на которой уходит письмо «сколько осталось и когда
 * обновится».
 *
 * Не «на первой» (тогда письмо приходит о том, чего человек ещё не понял) и не
 * «на последней» (тогда времени что-то сделать уже нельзя). Третья — это
 * момент, когда учитель впервые видит, что листы заканчиваются, и ещё может
 * доплатить до конца месяца.
 */
export const FREE_QUOTA_NOTICE_AT = 3;

/** Среднее число out-токенов в листе-домашки — для перевода токенов в листы. */
export const TOKENS_PER_WORKSHEET = 1_600;

const MONTH_SECONDS = 30 * 86400;

/** Тарифы, которые сервер знает по имени. `standard` — «Оптимальный» (ТЗ-21 п.4). */
export type UsagePlan = "free" | "base" | "standard" | "plus";

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
  // Бесплатный тариф с аккаунтом — единственный случай, где окно У КАЛЕНДАРЯ
  // (ТЗ-29): квота 5 листов В МЕСЯЦ, 1-го числа начинается новая.
  //
  // У платных окон календарных нет намеренно: оплатив 15 октября «учебный год»,
  // учитель получает одно окно на 9 месяцев, и норма в 9 раз больше помесячной —
  // обнулять её 1-го числа посреди года было бы подменой проданного.
  //
  // `norm: null` обязателен: бесплатный тариф ограничен штуками листов, а не
  // токенами, и getUsageStatus по null-норме отдаёт нули — как раньше.
  if (plan === "free") {
    if (!userId) return never;
    return {
      windowStart: 0,
      windowEndsAt: nextMonthStartSec(Date.now()),
      norm: null,
      months: 1,
    };
  }
  if (!userId) return never;

  const sub = await getActiveSubscription(db, userId);
  if (!sub) return never;

  // Помесячная оплата = окно в месяц; «учебный год» = окно на 9 месяцев.
  const months = sub.period === "academicYear" ? ACADEMIC_YEAR_MONTHS : 1;
  // Ключ приводим к типу таблицы: `plan === "free"` уже отсечён выше, поэтому
  // здесь остаются только платные тарифы, и все они есть в PLAN_NORM_PER_MONTH.
  const perMonth = PLAN_NORM_PER_MONTH[plan as "base" | "standard" | "plus"] ?? PLAN_NORM_PER_MONTH.base;
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
  if (weightedTokens <= 0) return null;

  // BL-07: анонимный вызов не попадает ни в чью норму — нормы у анонима нет,
  // и превысить её без аккаунта нельзя. Но деньги у провайдера он стоит ровно
  // те же, и раньше был виден только в llm_logs: «сколько бесплатного трафика
  // мы сознательно дарим» не отвечалось ничем. Теперь каждый анонимный вызов
  // пишет событие ANON_USAGE_EVENT — агрегат по суткам без userId (его нет),
  // с ключом счёта владельца вместо id.
  if (!userId) {
    await recordAnonymousUsage(db, { weightedTokens, plan });
    return null;
  }
  // Бесплатный тариф с аккаунтом: квота в штуках генераций (checkFreeQuota),
  // а токены в норму не идут — помесячной нормы у этого тарифа нет.
  if (plan === "free") return null;

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
 * Бесплатная квота: N генераций В МЕСЯЦ, сброс 1-го числа (ТЗ-29).
 *
 * Читает `free_usage` за ТЕКУЩИЙ месяц по всем ключам человека (см.
 * quotaOwnerKeys), поэтому «зашёл с телефона, вышел с ноутбука» не выдаёт новые
 * листы. `nowMs` в сигнатуре — для тестов: месяц должен быть можно перевести
 * вперёд, не дожидаясь календаря.
 *
 * Держать чтение на сессии `first-primary` — по той же причине, по которой это
 * делал прежний счётчик (06.10.2026): обычный SELECT может уйти в реплику,
 * и карточка расхода показывала бы «осталось 5» сразу после третьего листа.
 */
export async function checkFreeQuota(
  db: D1Database,
  ownerKey: string | string[],
  nowMs = Date.now(),
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  const state = await freeQuotaState(db, ownerKey, Math.floor(nowMs / 1000));
  return {
    allowed: state.remaining > 0,
    used: state.used,
    limit: state.limit,
    remaining: state.remaining,
  };
}

/**
 * Состояние квоты для карточки расхода: сколько сделано в этом месяце и когда
 * обновится.
 *
 * Ключи собираются по всем отпечаткам человека — иначе карточка показывала бы
 * «сделал 2» из того браузера, из которого её открыли, а квота при этом
 * считалась бы по всем (см. quotaOwnerKeys).
 */
export async function freeQuotaForUser(
  db: D1Database,
  userId: string,
  nowMs = Date.now(),
): Promise<{
  used: number;
  limit: number;
  remaining: number;
  month: string;
  /** Начало следующего месяца по Москве, unix seconds — «обновится 1-го числа». */
  resetsAt: number;
  history: FreeUsageMonthRow[];
}> {
  const keys = await quotaOwnerKeys(db, userId, null);
  const nowSec = Math.floor(nowMs / 1000);
  const month = monthKeyOf(nowMs);
  const [used, history] = await Promise.all([
    readMonthGenerations(db, keys, month),
    readMonthHistory(db, keys, 12),
  ]);
  return {
    used,
    limit: FREE_TOTAL_GENERATIONS,
    remaining: Math.max(0, FREE_TOTAL_GENERATIONS - used),
    month,
    resetsAt: nextMonthStartSec(nowMs),
    history,
  };
}

/**
 * Ключ счёта бесплатной квоты.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * СЧЁТ ВСЕГДА ПО ОТПЕЧАТКУ (исправление 08.10.2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше здесь было `userId ?? fp:<отпечаток>`, и это была дыра, которую сразу
 * нашла учительница: «3 генерации — выйти/зайти — снова 3 генерации».
 *
 * Почему так выходило. Ключ менялся при смене авторизации:
 *
 *     аноним      →  freetotal:fp:<отпечаток>     ← свой счётчик
 *     вошёл в акк →  freetotal:usr_123            ← ДРУГОЙ счётчик, с нуля
 *
 * Три генерации анонимом, выход, вход — и учитель снова на нуле. Выйти и
 * зайти можно в два клика, поэтому лимит «3 генерации на весь период» не
 * означил ничего: обход был не хаком, а обычным использованием продукта.
 *
 * Теперь ключ ВСЕГДА `fp:<отпечаток>`, независимо от того, есть аккаунт или
 * нет. Вход и выход перестают влиять на счёт — ровно то, что обещает текст
 * «3 генерации на весь период».
 *
 * Отпечаток, а не IP: IP один на всю школу и на всех, кто сидит за одним NAT,
 * и счёт по IP отдавал бы три попытки на класс.
 *
 * userId в сигнатуре остаётся намеренно: он попадает в ключ только как
 * дополнительный слой для случая, когда отпечаток недоступен (нет IP/UA,
 * нечего хэшировать). Тогда ключ уникален на аккаунт, и без аккаунта такой
 * запрос всё равно упирается в общий `fp:` счётчик, а не проходит без счёта.
 */
export function freeQuotaOwnerKey(userId: string | null, fingerprint?: string | null): string {
  if (fingerprint) return `fp:${fingerprint}`;
  // Отпечатка нет — считаем по аккаунту. Без аккаунта и без отпечатка ключ
  // один общий для всех: ограничение лучше, чем его отсутствие.
  return userId ? `usr:${userId}` : "fp:unknown";
}

/**
 * Привязать отпечаток к пользователю (09.10.2026).
 *
 * Вызывается при каждой генерации с аккаунтом. Один и тот же человек, зашедший
 * с двух браузеров, получает две строки — и квота считается по обеим.
 *
 * Именно здесь «запоминаются пользователи в базе»: без этой связи база не
 * знает, что отпечаток телефона и отпечаток ноутбука — это один человек, и
 * лимит обходился сменой браузера.
 *
 * Пишем всегда: `last_seen_at` обновляется, `created_at` остаётся первым
 * известным. Ошибку глотаем на стороне вызова — невозможность запомнить
 * отпечаток не должна ломать генерацию, лимит при этом остаётся в силе.
 */
export async function linkUserFingerprint(
  db: D1Database,
  userId: string,
  fingerprint: string | null | undefined,
): Promise<void> {
  if (!userId || !fingerprint) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO user_fingerprints (user_id, fingerprint, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(user_id, fingerprint) DO UPDATE SET last_seen_at = ?3`,
    )
    .bind(userId, fingerprint, now)
    .run();
}

/**
 * Все ключи счёта, которые принадлежат ОДНОМУ человеку.
 *
 * Считается СУММА по этим ключам (см. `freeQuotaState`), и это главное:
 *   · аноним — единственный ключ по своему отпечатку;
 *   · вошедший — личный счётчик плюс отпечатки всех его устройств из базы,
 *     включая текущий.
 *
 * Сумма, а не максимум: максимум оставлял бы дыру «3 с одного браузера и 3 с
 * другого». И не «последний отпечаток» — тогда переключение браузера
 * обнуляло бы счёт, то есть лимит ничего бы не ограничивал.
 *
 * Ключи нормализуются и дедуплицируются: один и тот же отпечаток может
 * прийти и из привязки, и из текущего запроса.
 */
export async function quotaOwnerKeys(
  db: D1Database,
  userId: string | null,
  fingerprint?: string | null,
): Promise<string[]> {
  const keys = new Set<string>();

  if (fingerprint) keys.add(`fp:${fingerprint}`);

  if (userId) {
    keys.add(`usr:${userId}`);
    const rows = await db
      .prepare(`SELECT fingerprint FROM user_fingerprints WHERE user_id = ?1 LIMIT 200`)
      .bind(userId)
      .all<{ fingerprint: string }>();
    for (const row of rows?.results ?? []) {
      if (row?.fingerprint) keys.add(`fp:${row.fingerprint}`);
    }
  }

  // Совсем ничего не известно — общий ключ. Ограничение лучше, чем его
  // отсутствие, и такой запрос всё равно упрётся в лимит.
  if (keys.size === 0) keys.add("fp:unknown");

  return [...keys];
}

/**
 * Префикс ключей «занятых, но ещё не подтверждённых» попыток.
 *
 * Зачтённые генерации здесь больше НЕ живут: они в `free_usage` по месяцам.
 * В `rate_limits` остались только занятия — они минутные и по TTL исчезают.
 */
const freeHoldPrefix = (ownerKey: string) => `freehold:${ownerKey}:`;
/**
 * Верхняя граница диапазона по префиксу. Нужна, чтобы «занятые» попытки
 * считались выборкой по УНИКАЛЬНОМУ индексу по key, а не полным сканом
 * таблицы счётчиков (в ней же лежат суточные окна остальных ручек).
 */
const holdRangeEnd = (prefix: string) => `${prefix}\uffff`;

/**
 * Сколько секунд «занятая» попытка считается ещё занятой.
 *
 * Попытка занимается ДО вызова провайдера (см. holdFreeQuotaSlot) и снимается
 * после успеха. Если генерация упала или воркер умер, попытка не снимается
 * никем — и снимает её время: через TTL такая строка перестаёт учитываться.
 * Пять минут — с запасом на самый долгий вызов с фолбэком и повтором.
 */
export const FREE_QUOTA_HOLD_TTL_SEC = 300;

export interface FreeQuotaState {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Прочитать состояние квоты: зачтённые генерации в этом месяце + ещё не
 * истёкшие «занятые».
 *
 * Зачтённые лежат в `free_usage` за ТЕКУЩИЙ месяц (ТЗ-29), а не в вечном
 * счётчике `rate_limits`: месяц выбирается ключом строки, поэтому «сброс 1-го
 * числа» не стирает историю. «Занятые» остались в `rate_limits` — они живут
 * минуты и по TTL исчезают сами, хранить их по месяцам незачем.
 */
async function freeQuotaState(
  db: D1Database,
  ownerKeys: string | string[],
  now = Math.floor(Date.now() / 1000),
): Promise<Omit<FreeQuotaState, "allowed">> {
  // Принимаем и один ключ, и список: старые вызовы передают строку, новые —
  // набор всех отпечатков человека (см. quotaOwnerKeys).
  const keys = [...new Set(Array.isArray(ownerKeys) ? ownerKeys : [ownerKeys])];
  const month = monthKeyOf(now * 1000);

  // Первичная реплика — та же причина, что была: счётчик, который только что
  // попросили занять, должен быть виден сразу (BL-06), иначе карточка расхода
  // отстаёт от того, что учитель уже сделал.
  //
  // Считаем СУММОЙ по всем ключам: смена браузера не должна выдавать новые
  // листы (09.10.2026). Параметры собираются динамически — их число равно
  // числу отпечатков человека, а оно заранее неизвестно.
  await ensureFreeUsageTable(db);
  const holdClause = keys
    .map(
      (_, i) =>
        `(key >= ?${i * 2 + 1} AND key < ?${i * 2 + 2})`,
    )
    .join(" OR ");
  const bound = [
    ...keys.flatMap((k) => [freeHoldPrefix(k), holdRangeEnd(freeHoldPrefix(k))]),
    now - FREE_QUOTA_HOLD_TTL_SEC,
  ];

  const [committed, heldCount] = await Promise.all([
    readMonthGenerations(db, keys, month),
    db
      .withSession("first-primary")
      .prepare(
        `SELECT COUNT(*) AS held FROM rate_limits
          WHERE (${holdClause}) AND window_start > ?${bound.length}`,
      )
      .bind(...bound)
      .first<{ held: number }>(),
  ]);

  const held = Number(heldCount?.held ?? 0);
  const used = committed + held;
  return {
    used,
    limit: FREE_TOTAL_GENERATIONS,
    remaining: Math.max(0, FREE_TOTAL_GENERATIONS - used),
  };
}

/**
 * Занять одну попытку бесплатной квоты АТОМАРНО.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ПРОВЕРКА И СПИСАНИЕ БОЛЬШЕ НЕ РАЗНЫЕ ОБРАЩЕНИЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше было так: `checkFreeQuota` читает `count`, потом (после успешной
 * генерации) `consumeFreeQuota` делает `count = count + 1`. Между этими двумя
 * обращениями живёт вся генерация — секунды, а не микросекунды. Два запроса с
 * одного отпечатка, пришедшие одновременно (две вкладки, кнопка «ещё раз»),
 * оба читали `count = 2`, оба проходили проверку, и счётчик уезжал на 4+.
 * Инкремент в SQL атомарен, но ограничен СНИЗУ, а нужен потолок СВЕРХУ.
 *
 * Теперь попытка ЗАНИМАЕТСЯ до вызова провайдера, одним оператором, условие
 * которого — «использовано + занято < 5». Параллельные запросы сериализуются
 * внутри одного оператора: пятеро получают занятие, шестой — отказ. Превысить
 * квоту нельзя в принципе, а не «обычно не получается».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ МЕСЯЦ НЕ В КЛЮЧЕ ЗАНЯТИЯ, А В УСЛОВИИ
 * ─────────────────────────────────────────────────────────────────────────────
 * Занятие живёт минуты (FREE_QUOTA_HOLD_TTL_SEC) и хранится в `rate_limits`,
 * где ключ и есть имя счётчика. Добавлять месяц в ключ занятия не нужно: его
 * мог бы «зависнуть» на стыке месяцев, и тогда учитель, который начал
 * генерацию 31-го в 23:50, лишился бы занятого слота без причины. Месяц стоит
 * только в условии — там, где спрашивается зачтённое.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО НЕ «СПИСАНИЕ ПЕРЕД ГЕНЕРАЦИЕЙ»
 * ─────────────────────────────────────────────────────────────────────────────
 * Учитель не должен терять попытку из-за чужой ошибки (5xx провайдера), поэтому
 * зачёркивает занятие только успех (consumeFreeQuota). Пока генерация идёт,
 * занятие видно в квоте — и это правильно: попытка уже тратит деньги, иначе
 * параллельные запросы разошлись бы снова. Попытка, которую не подтвердили и
 * не вернули (падение, перезапуск воркера), освобождается сама по TTL.
 *
 * Второй плюс этого решения: `checkLlmRateLimit` (обёртка для llm/index.ts)
 * продолжает читать ТОЛЬКО зачтённые попытки и потому не считает занятую
 * попытку дважды — иначе учитель на бесплатном тарифе получил бы 4 генерации
 * вместо пяти.
 *
 * `nowMs` — только для тестов: месяц должен быть можно перевести вперёд, не
 * дожидаясь 1-го числа. Боевой код его не передаёт.
 */
export async function holdFreeQuotaSlot(
  db: D1Database,
  ownerKey: string,
  allOwnerKeys?: string[],
  nowMs = Date.now(),
): Promise<FreeQuotaState> {
  const now = Math.floor(nowMs / 1000);
  const month = monthKeyOf(nowMs);
  await ensureFreeUsageTable(db);
  const prefix = freeHoldPrefix(ownerKey);
  // id держим КОРОТКИМ и случайным: ключ счёта в нём не нужен (он лежит в
  // `key`), а обрезка длинного `freehold:fp:<64 hex>:` обрезала бы всё
  // содержимое после 40-го символа — и все занятия одного посетителя в одну
  // секунду получили бы один и тот же id, то есть падение по UNIQUE.
  const nonce = crypto.randomUUID().slice(0, 8);
  const id = `rl_hold_${now.toString(36)}_${nonce}_${ownerKey.replace(/[^a-z0-9]/gi, "").slice(-10)}`;
  // Условие «занято» считаем по ВСЕМ отпечаткам человека, а писать занятие
  // в текущий. Так параллельные генерации с двух устройств одного учителя
  // видят одно и то же «сколько уже занято» и не проскакивают вдвоём.
  // Набор ключей одинаков у обоих устройств, потому что связь с пользователем
  // заведена ДО этого вызова (см. `guardGeneration`).
  const checkKeys = [...new Set(allOwnerKeys ?? [ownerKey])];
  // Порядок параметров важен для читаемости и для проверки глазом:
  //   ?1 id, ?2 key, ?3 now,
  //   далее пары границ занятий по каждому ключу,
  //   затем limit, TTL, месяц и, наконец, сами ключи для free_usage.
  const holdCount = checkKeys.length * 2;
  const limitIdx = 4 + holdCount;
  const ttlIdx = limitIdx + 1;
  const monthIdx = ttlIdx + 1;
  const keyIdx = monthIdx + 1;
  const holdClause = checkKeys
    .map((_, i) => `(key >= ?${4 + i * 2} AND key < ?${5 + i * 2})`)
    .join(" OR ");
  const keyMarks = checkKeys.map((_, i) => `?${keyIdx + i}`).join(", ");
  const bound = [
    id,
    `${prefix}${nonce}`,
    now,
    ...checkKeys.flatMap((k) => [freeHoldPrefix(k), holdRangeEnd(freeHoldPrefix(k))]),
    FREE_TOTAL_GENERATIONS,
    now - FREE_QUOTA_HOLD_TTL_SEC,
    month,
    ...checkKeys,
  ];

  const held =
    Number(
      (
        await db
          .prepare(
            `INSERT INTO rate_limits (id, key, count, window_start)
             SELECT ?1, ?2, 1, ?3
             WHERE (SELECT COALESCE(SUM(generations), 0) FROM free_usage
                    WHERE month = ?${monthIdx} AND owner_key IN (${keyMarks}))
                 + (SELECT COUNT(*) FROM rate_limits
                    WHERE (${holdClause}) AND window_start > ?${ttlIdx}) < ?${limitIdx}`,
          )
          .bind(...bound)
          .run()
      ).meta?.changes ?? 0,
    ) > 0;
  const state = await freeQuotaState(db, checkKeys, now);
  return { ...state, allowed: held };
}

/** Вернуть занятую попытку: генерация не начнётся (капча, отказ на входе). */
export async function releaseFreeQuotaHold(db: D1Database, ownerKey: string): Promise<void> {
  const prefix = freeHoldPrefix(ownerKey);
  await db
    .prepare(
      `DELETE FROM rate_limits WHERE rowid = (
         SELECT rowid FROM rate_limits WHERE key >= ?1 AND key < ?2
         ORDER BY window_start ASC LIMIT 1)`,
    )
    .bind(prefix, holdRangeEnd(prefix))
    .run();
}

/**
 * Что списание генерации умеет помимо самого списания.
 *
 * Всё необязательное: существующие вызовы передают только `(db, ownerKey)` и
 * ничего не теряют. Третий аргумент нужен там, где вызывающий знает почту
 * учителя, — то есть в генерации залогиненного пользователя.
 */
export interface FreeQuotaConsumeOptions {
  /** Аккаунт, для истории (у анонима null). */
  userId?: string | null;
  /** Почта для письма о квоте. Без неё письмо не отправляется. */
  email?: string | null;
  /** Окружение для отправки письма. Без него письмо не отправляется. */
  env?: Env;
  /** «Сейчас» в мс — только для тестов (перевод календаря вперёд). */
  nowMs?: number;
}

/**
 * Зачесть занятую попытку: снять «занятое» и записать «использовано».
 *
 * Снятие и запись идут одним `batch` (D1 выполняет пачку в одной транзакции),
 * поэтому «занято + использовано» не может разъезаться. Запись идёт в строку
 * ТЕКУЩЕГО МЕСЯЦА в `free_usage` и ограничена сверху тем же `generations < 5`:
 * даже если вызвать списание лишний раз, шестая генерация в счёт не попадёт.
 *
 * Прошлые месяцы не трогаются — это и есть «сброс 1-го числа без потери
 * истории»: новый месяц = новая строка.
 */
export async function consumeFreeQuota(
  db: D1Database,
  ownerKey: string,
  options: FreeQuotaConsumeOptions = {},
): Promise<void> {
  const nowMs = options.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const month = monthKeyOf(nowMs);
  const prefix = freeHoldPrefix(ownerKey);
  await ensureFreeUsageTable(db);
  await db.batch([
    db
      .prepare(
        `DELETE FROM rate_limits WHERE rowid = (
           SELECT rowid FROM rate_limits WHERE key >= ?1 AND key < ?2
           ORDER BY window_start ASC LIMIT 1)`,
      )
      .bind(prefix, holdRangeEnd(prefix)),
  ]);
  const used = await bumpMonthGenerations(db, {
    ownerKey,
    userId: options.userId ?? null,
    month,
    limit: FREE_TOTAL_GENERATIONS,
    nowSec,
  });

  // Письмо о квоте — только когда знаем, кому писать. Вызывающий без env/email
  // (аноним) просто ничего не отправляет: анониму писать некуда.
  if (options.env && options.email) {
    // Дедуп по ВСЕМ устройствам человека, а не по текущему отпечатку: квота
    // считается по всем ключам (quotaOwnerKeys), и письмо про неё должно быть
    // одно. Иначе учитель, сделавший два листа с телефона и один с ноутбука,
    // получил бы два письма об одном и том же остатке.
    const ownerKeys = options.userId
      ? await quotaOwnerKeys(db, options.userId, ownerKey.replace(/^fp:/, ""))
      : [ownerKey];
    await maybeSendFreeQuotaNotice(db, {
      env: options.env,
      email: options.email,
      userId: options.userId ?? null,
      ownerKeys,
      used,
      nowMs,
    });
  }
}

/**
 * Письмо «сколько осталось и когда обновится» — один раз в месяц.
 *
 * Отдельная функция, а не строчка внутри `consumeFreeQuota`, потому что решает,
 * отправлять ли письмо. Метка ставится ДО отправки: два параллельных запроса на
 * третьем листе не отправят два письма. Цена решения — при сбое почты письма
 * в этом месяце не будет: повторное письмо о том же самом учителю хуже, чем
 * отсутствие письма.
 */
async function maybeSendFreeQuotaNotice(
  db: D1Database,
  params: {
    env: Env;
    email: string;
    userId: string | null;
    ownerKeys: string[];
    used: number;
    nowMs: number;
  },
): Promise<boolean> {
  const month = monthKeyOf(params.nowMs);
  // Ждём ровно третью генерацию, а не «третью и дальше»: на четвёртой и пятой
  // письмо уже было (метка стоит), а на шестой квоты нет.
  if (params.used < FREE_QUOTA_NOTICE_AT) return false;
  if (await readMonthNoticeSent(db, params.ownerKeys, month)) return false;

  await markMonthNoticeSent(db, params.ownerKeys, month, Math.floor(params.nowMs / 1000));
  const result = await sendFreeQuotaNoticeEmail(params.env, params.email, {
    used: params.used,
    limit: FREE_TOTAL_GENERATIONS,
    resetsAtSec: nextMonthStartSec(params.nowMs),
  });
  return result.sent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Учёт БЕСПЛАТНОГО (анонимного) трафика — BL-07
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Анонимный расход: сколько бесплатного трафика мы сознательно отдаём.
 *
 * Где он живёт и почему не в норме: у анонима нет ни userId, ни нормы —
 * `usage_counters.user_id` это NOT NULL + REFERENCES users(id), аноним туда
 * не встанет, и логично: превысить норму без аккаунта нельзя. Деньги же
 * провайдеру уходят. Поэтому считаем отдельно, в существующей таблице
 * `events` (user_id там допускает NULL), по ключу счёта владельца —
 * отпечатку, а не по id.
 *
 * Два события, и они не дублируют друг друга, потому что пишутся с разных
 * слоёв и знают разное:
 *   · ANON_USAGE_EVENT — слой вызова LLM (recordUsage): сколько ВЗВЕШЕННЫХ
 *     токенов ушло, то есть сколько это денег;
 *   · ANON_ACCESS_EVENT — слой запроса (guardGeneration / routes/llm.ts):
 *     кому именно отдали доступ (отпечаток), сколько попыток.
 */
export const ANON_USAGE_EVENT = "anon_free_usage";
export const ANON_ACCESS_EVENT = "anon_free_access";

/**
 * Записать анонимный вызов LLM в учёт. Не бросает никогда: аналитика не имеет
 * права уронить генерацию (та же оговорка, что в interactives-public.ts).
 */
export async function recordAnonymousUsage(
  db: D1Database,
  params: { weightedTokens: number; plan: UsagePlan; ownerKey?: string | null; task?: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `INSERT INTO events (id, user_id, name, data_json, created_at)
         VALUES (?1, NULL, ?2, ?3, ?4)`,
      )
      .bind(
        `ev_anon_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        ANON_USAGE_EVENT,
        JSON.stringify({
          weightedTokens: Math.round(params.weightedTokens),
          plan: params.plan,
          owner: params.ownerKey ?? null,
          task: params.task ?? null,
        }),
        now,
      )
      .run();
  } catch {
    /* учёт не записался — генерация от этого не должна пострадать */
  }
}

/** Записать, что бесплатный доступ отдан анониму (кто и каким отпечатком). */
export async function recordAnonymousAccess(
  db: D1Database,
  params: { ownerKey: string; plan: UsagePlan; task: string },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `INSERT INTO events (id, user_id, name, data_json, created_at)
         VALUES (?1, NULL, ?2, ?3, ?4)`,
      )
      .bind(
        `ev_anonx_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        ANON_ACCESS_EVENT,
        JSON.stringify({
          owner: params.ownerKey,
          task: params.task,
          // Префикс хэша, а не сам отпечаток: в отчёте хватает «сколько разных
          // отпечатков», а полный хэш в аналитике незачем.
          fp: params.ownerKey.replace(/^fp:/, "").slice(0, 16),
        }),
        now,
      )
      .run();
  } catch {
    /* см. выше: аналитика не роняет генерацию */
  }
}

export interface AnonymousUsageSummary {
  /** Границы интервала (unix seconds), для которых посчитан срез. */
  fromSec: number;
  toSec: number;
  /** Сколько раз отдали бесплатный доступ. */
  accesses: number;
  /** Сколько разных ключей счёта (отпечатков) получили доступ. */
  owners: number;
  /** Объём бесплатного трафика во взвешенных токенах. */
  weightedTokens: number;
  /** Тот же трафик в рублях по действующему курсу и цене эталонной модели. */
  costRub: number;
}

/**
 * Срез бесплатного трафика за интервал — ответ на вопрос владельца «сколько
 * бесплатного анонимного трафика мы отдаём в сутки».
 *
 * Читается с primary: это отчёт, а не путь генерации, зато читать его будут
 * сразу после инцидента, и увидеть отстающую реплику обидно.
 */
export async function summarizeAnonymousUsage(
  db: D1Database,
  window: { fromSec: number; toSec: number },
): Promise<AnonymousUsageSummary> {
  const empty: AnonymousUsageSummary = {
    fromSec: window.fromSec,
    toSec: window.toSec,
    accesses: 0,
    owners: 0,
    weightedTokens: 0,
    costRub: 0,
  };
  try {
    const access = await db
      .withSession("first-primary")
      .prepare(
        `SELECT COUNT(*) AS accesses,
                COUNT(DISTINCT json_extract(data_json, '$.owner')) AS owners
         FROM events
         WHERE name = ?1 AND created_at >= ?2 AND created_at < ?3`,
      )
      .bind(ANON_ACCESS_EVENT, window.fromSec, window.toSec)
      .first<{ accesses: number; owners: number }>();
    const usage = await db
      .withSession("first-primary")
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(json_extract(data_json, '$.weightedTokens'), 0)), 0) AS weighted
         FROM events
         WHERE name = ?1 AND created_at >= ?2 AND created_at < ?3`,
      )
      .bind(ANON_USAGE_EVENT, window.fromSec, window.toSec)
      .first<{ weighted: number }>();
    const weightedTokens = Number(usage?.weighted ?? 0);
    return {
      ...empty,
      accesses: Number(access?.accesses ?? 0),
      owners: Number(access?.owners ?? 0),
      weightedTokens,
      costRub: Math.round(weightedTokens * RUB_PER_WEIGHTED_TOKEN * 100) / 100,
    };
  } catch {
    return empty;
  }
}

/**
 * Сколько листов это в токенах — для понятной подписи в UI.
 */
export function tokensToWorksheets(tokens: number): number {
  return Math.round(tokens / TOKENS_PER_WORKSHEET);
}

/** Цена одного взвешенного токена в рублях (эталон — выход Luna). */
const RUB_PER_WEIGHTED_TOKEN = (REFERENCE_OUTPUT_PER_1M_USD / 1_000_000) * RUB_PER_USD;

/**
 * Себестоимость бесплатной квоты за месяц, в рублях.
 *
 * Считается из ТОЙ ЖЕ цены взвешенного токена, что и весь расход, поэтому
 * поднятие цен у провайдера не останется незамеченным. Проверка в тестах: не
 * больше 15% от 249 ₽ (расчёт выложен в docs/42-free-tier-cost-2026-10-15.md).
 */
export function freeTierMonthlyCostRub(generations = FREE_TOTAL_GENERATIONS): number {
  return generations * TOKENS_PER_WORKSHEET * RUB_PER_WEIGHTED_TOKEN;
}

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

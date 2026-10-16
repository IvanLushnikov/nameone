/**
 * Агрегаты для `/superpower` (ТЗ-24, раздел 7).
 *
 * ЧЕТЫРЕ ЭКРАНА, ЗДЕСЬ ВСЕ ЦИФРЫ
 * ------------------------------
 *   getOverview     — светофор: открыл и сразу видишь, что происходит
 *   getScreens      — экраны и воронка
 *   getGenerations  — генерации по типам и по дням
 *   getMoney        — выручка, расходы, подписки, пополнения
 *
 * ГЛАВНОЕ ПРАВИЛО ФАЙЛА — НЕ ВЫДУМЫВАТЬ ЦИФРЫ
 * --------------------------------------------
 * Каждое число здесь — результат SUM/COUNT по таблице. Там, где данных ещё
 * нет, возвращается null или ноль, а не «примерно». Конкретные случаи:
 *
 *   * Фактических денег (`llm_costs_actual`) может не быть вовсе — тогда, пока
 *     провайдер не отдавал `usage.cost_rub`. Показываем null и подпись «счёт
 *     ещё не забирался», а не ноль: ноль означал бы «мы ничего не потратили».
 *   * Баланс провайдера есть только после первого снимка. До него — null.
 *   * «Заходов на сайт» здесь нет вообще: посещаемость считает Метрика, дублировать
 *     её вторым счётчиком незачем (решение владельца, раздел 4 ТЗ-24). Здесь мы
 *     считаем АКТИВНОСТЬ по событиям и называем её своими словами, а не «заходами».
 *
 * ДЕНЬГИ В ДВУХ ЦИФРАХ
 * --------------------
 * `costRubActual` — факт со счёта провайдера, `costRubEstimate` — наш расчёт по
 * прайсу-снимку. Обе показываются рядом, потому что расхождение между ними и
 * есть сигнал, что прайс устарел. Подробнее — `docs/tz/24-superpower-dashboard.md`
 * раздел 6.
 */

import type { D1Database } from "@cloudflare/workers-types";

/** Граница тревоги: расходы съели больше четверти выручки. */
export const COST_ALERT_RATIO = 0.25;

/**
 * Порог расхождения между счётом провайдера и нашим расчётом.
 *
 * 3% — с запасом: округление polza.ai до восьми знаков и наценка дают
 * единицы процентов, а вот смена цен на десятки процентов должна быть видна
 * сразу.
 */
export const COST_DIVERGENCE_RATIO = 0.03;

/**
 * Выручка за период — по тарифу НЕ берётся.
 *
 * Раньше (в `/api/admin/usage`) выручка считалась по таблице месячных цен
 * в коде. Здесь так сделано быть не должно: цена живёт во фронте
 * (`src/lib/content/plans.ts`), дублировать её в бэкенде — значит через месяц
 * получить два разных числа в двух отчётах. Поэтому выручка — это ФАКТ:
 * сумма успешных платежей за тот же период.
 *
 * Следствие, о котором надо помнить: у учителя с годовой оплатой в этом
 * месяце платежа не будет, и выручка покажет 0. Это правда, а не ошибка;
 * годовая выручка видна, если смотреть период шире.
 *
 * ЕДИНИЦЫ: `payments.amount_rub` — копейки (см. блок «КОПЕЙКИ ИЛИ РУБЛИ» в
 * этом файле), поэтому возвращаемая карта уже в РУБЛЯХ. Раньше деления на 100
 * здесь не было, и платёж 249 ₽ показывался как 24 900 ₽.
 */
async function revenueByUser(
  db: D1Database,
  from: number,
  to: number,
): Promise<Map<string, number>> {
  const rows = await db
    .prepare(
      `SELECT user_id, SUM(amount_rub) AS rub FROM payments
       WHERE status = 'succeeded' AND user_id IS NOT NULL
         AND created_at >= ?1 AND created_at < ?2
       GROUP BY user_id`,
    )
    .bind(from, to)
    .all<{ user_id: string; rub: number }>();
  // Делим здесь, а не на экране: единственное место, где копейки становятся
  // рублями, — это kopecksToRub выше.
  return new Map(rows.results.map((r) => [r.user_id, kopecksToRub(r.rub)]));
}

/** Округление до копеек — на экране должно быть видно, что это деньги. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// КОПЕЙКИ ИЛИ РУБЛИ — ЕДИН РАЗ, ЧТОБЫ БОЛЬШЕ НЕ СПОРИТЬ
// ─────────────────────────────────────────────────────────────────────────────
//
// В проекте две колонки с похожим именем и РАЗНЫМИ единицами. Это не опечатка
// и не «надо бы причесать» — за этим стоит решение, и путать их дорого:
//
//   payments.amount_rub          → КОПЕЙКИ (целые)
//   llm_costs_actual.cost_rub    → РУБЛИ (вещественное)
//
// ПОЧЕМУ В payments лежат копейки. Имя колонки про рубли, значение — про
// копейки, и на этом уже ошибались: `billing.ts` пишет в неё `amountKopecks`
// (см. createPayment и сверку в handleWebhook, где сумма из БД сравнивается с
// `expectedKopecks`). Причина историческая — деньги в ЮKassa приходят
// десятичной строкой («249.00»), и целые копейки надёжнее: сложение копеек не
// даёт ошибок плавающей точки. Менять единицу в существующей таблице значило
// бы переписать всю историю платежей — поэтому единицу фиксирует комментарий и
// функция ниже, а не имя колонки.
//
// ПОЧЕМУ В llm_costs_actual лежат рубли. Это НЕ наши деньги, а счёт
// провайдера: polza.ai в каждом ответе кладёт `usage.cost_rub` уже готовой
// суммой в рублях, и мы сохраняем её как есть, ничего не умножая (см. llm/
// index.ts → llm_costs_actual). Там `/100` был бы ошибкой, завышающей расходы
// в сто раз.
//
// Отсюда правило файла: копейки приводятся к рублям В ОДНОМ МЕСТЕ — здесь, и
// больше нигде. Всё, что ниже, уже в рублях.

/** Копейки → рубли. Единственное место в проекте, где это преобразование. */
export function kopecksToRub(kopecks: number): number {
  return kopecks / 100;
}

/** Границы месяца `YYYY-MM` в unix-секундах. null, если месяц не разобрать. */
export function monthRange(month: string): { from: number; to: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return {
    from: Math.floor(new Date(Date.UTC(year, mon - 1, 1)).getTime() / 1000),
    to: Math.floor(new Date(Date.UTC(year, mon, 1)).getTime() / 1000),
  };
}

/** Текущий месяц в формате YYYY-MM. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Ближайший снимок баланса провайдера.
 * null — снимков ещё не было, и это нормально: они появляются по мере работы.
 */
export async function getLatestBalance(db: D1Database): Promise<{
  amountRub: number;
  availableRub: number | null;
  reservedRub: number | null;
  spentRub: number | null;
  at: number;
} | null> {
  const row = await db
    .prepare(
      `SELECT amount_rub, available_rub, reserved_rub, spent_rub, created_at
       FROM polza_balance_snapshots ORDER BY created_at DESC LIMIT 1`,
    )
    .first<{
      amount_rub: number;
      available_rub: number | null;
      reserved_rub: number | null;
      spent_rub: number | null;
      created_at: number;
    }>();
  if (!row) return null;
  return {
    amountRub: row.amount_rub,
    availableRub: row.available_rub,
    reservedRub: row.reserved_rub,
    spentRub: row.spent_rub,
    at: row.created_at,
  };
}

/** Прирост кошелька за период — по ТЗ-24 это и есть «пополнения». */
export async function getTopups(db: D1Database, from: number, to: number): Promise<{
  count: number;
  totalRub: number;
  byDay: Array<{ date: string; amountRub: number }>;
}> {
  const rows = await db
    .prepare(
      `SELECT amount_rub, created_at
       FROM polza_balance_snapshots
       WHERE created_at >= ?1 AND created_at < ?2
       ORDER BY created_at ASC`,
    )
    .bind(from, to)
    .all<{ amount_rub: number; created_at: number }>();

  // Пополнение — это РОСТ кошелька между соседними снимками. Если баланс упал,
  // в пополнения оно не попадает: это трата сверх внесённого, а не минус в
  // квитанции.
  let total = 0;
  const byDayMap = new Map<string, number>();
  for (let i = 1; i < rows.results.length; i++) {
    const prev = rows.results[i - 1]!;
    const cur = rows.results[i]!;
    const delta = cur.amount_rub - prev.amount_rub;
    if (delta <= 0) continue;
    total += delta;
    const date = new Date(cur.created_at * 1000).toISOString().slice(0, 10);
    byDayMap.set(date, (byDayMap.get(date) ?? 0) + delta);
  }

  return {
    count: [...byDayMap.values()].length,
    totalRub: round2(total),
    byDay: [...byDayMap.entries()]
      .map(([date, amountRub]) => ({ date, amountRub: round2(amountRub) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

export interface Overview {
  month: string;
  today: {
    events: number;
    generations: number;
    signups: number;
  };
  last30: {
    events: number;
    activeUsers: number;
    generations: number;
  };
  money: {
    revenueRub: number;
    costRubActual: number | null;
    costRubEstimate: number | null;
    costShare: number | null;
    /** Расхождение счёта провайдера и нашего расчёта, доля. null — если нет факта. */
    divergence: number | null;
    /** Факт вышел за рамки допуска — пора проверять прайс. */
    divergenceAlert: boolean;
  };
  /** Человек на платном тарифе сейчас. */
  activeSubscriptions: number;
  /** Наш кошелёк у провайдера. null, пока не было ни одного снимка. */
  providerBalance: { amountRub: number; availableRub: number | null } | null;
}

/**
 * Экран 1 — светофор.
 *
 * Ключевое число здесь — costShare: расходы против выручки. При мягкой норме у
 * учителя расходы съедают выручку незаметно, и узнаёшь об этом по счёту
 * провайдера. Поэтому оно стоит третьим, а не в списке.
 */
export async function getOverview(db: D1Database, month: string): Promise<Overview> {
  const range = monthRange(month);
  if (!range) throw new Error(`Некорректный месяц: ${month}`);

  const nowSec = Math.floor(Date.now() / 1000);
  const dayStart = nowSec - 24 * 3600;
  const thirtyStart = nowSec - 30 * 24 * 3600;

  const [todayEvents, monthEvents, activeUsers, monthGens, revenue, actual, estimate, subs, balance] =
    await Promise.all([
      db
        .prepare(`SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1`)
        .bind(dayStart)
        .first<{ n: number }>(),
      db
        .prepare(`SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1 AND created_at < ?2`)
        .bind(range.from, range.to)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(DISTINCT COALESCE(user_id, 'anon:' || id)) AS n
           FROM events WHERE created_at >= ?1`,
        )
        .bind(thirtyStart)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM llm_logs
           WHERE created_at >= ?1 AND created_at < ?2 AND error IS NULL`,
        )
        .bind(range.from, range.to)
        .first<{ n: number }>(),
      // Выручка месяца. SUM отдаёт КОПЕЙКИ (payments.amount_rub), деление на
      // 100 — в строке ниже, при приведении к рублям.
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_rub), 0) AS rub FROM payments
           WHERE status = 'succeeded' AND created_at >= ?1 AND created_at < ?2`,
        )
        .bind(range.from, range.to)
        .first<{ rub: number }>(),
      db
        .prepare(
          `SELECT COALESCE(SUM(cost_rub), 0) AS rub FROM llm_costs_actual
           WHERE created_at >= ?1 AND created_at < ?2`,
        )
        .bind(range.from, range.to)
        .first<{ rub: number }>(),
      db
        .prepare(
          `SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_logs
           WHERE created_at >= ?1 AND created_at < ?2 AND error IS NULL`,
        )
        .bind(range.from, range.to)
        .first<{ usd: number }>(),
      db
        .prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active'`)
        .first<{ n: number }>(),
      getLatestBalance(db),
    ]);

  const revenueRub = round2(kopecksToRub(revenue?.rub ?? 0));
  const costRubActual = (actual?.rub ?? 0) > 0 ? round2(actual?.rub ?? 0) : null;
  // Курс тот же, что зашит в MODEL_COSTS (86,2 ₽/$). Отдельная константа,
  // потому что это НЕ пересчёт фактических денег, а приведение оценки к рублям
  // для сравнения с фактом.
  const costRubEstimate = (estimate?.usd ?? 0) > 0 ? round2((estimate?.usd ?? 0) * 86.2) : null;

  const costShare =
    costRubActual !== null && revenueRub > 0 ? Math.round((costRubActual / revenueRub) * 100) : null;

  const divergence =
    costRubActual !== null && costRubEstimate !== null && costRubEstimate > 0
      ? Math.abs(costRubActual - costRubEstimate) / costRubEstimate
      : null;

  return {
    month,
    today: {
      events: todayEvents?.n ?? 0,
      generations: (await db
        .prepare(`SELECT COUNT(*) AS n FROM llm_logs WHERE created_at >= ?1 AND error IS NULL`)
        .bind(dayStart)
        .first<{ n: number }>())?.n ?? 0,
      signups: (await db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ?1`)
        .bind(dayStart)
        .first<{ n: number }>())?.n ?? 0,
    },
    last30: {
      events: monthEvents?.n ?? 0,
      activeUsers: activeUsers?.n ?? 0,
      generations: monthGens?.n ?? 0,
    },
    money: {
      revenueRub,
      costRubActual,
      costRubEstimate,
      costShare,
      divergence,
      divergenceAlert: divergence !== null && divergence > COST_DIVERGENCE_RATIO,
    },
    activeSubscriptions: subs?.n ?? 0,
    providerBalance: balance
      ? { amountRub: round2(balance.amountRub), availableRub: balance.availableRub }
      : null,
  };
}

export interface ScreenStat {
  event: string;
  total: number;
  byDay: Array<{ date: string; count: number }>;
}

export interface FunnelStep {
  step: string;
  label: string;
  users: number;
  /** Доля от предыдущего шага, процент. */
  fromPrev: number | null;
}

/**
 * Экран 2 — экраны и воронка.
 *
 * События группируются по имени; пользователь считается один раз на событие
 * (не по числу кликов) — иначе один учитель, перелистывающий шаги, выглядит
 * как десяток разных людей.
 */
export async function getScreens(db: D1Database, days: number): Promise<{
  days: number;
  events: ScreenStat[];
  funnel: FunnelStep[];
  totals: { events: number; byDay: Array<{ date: string; count: number }> };
}> {
  const from = Math.floor(Date.now() / 1000) - days * 24 * 3600;

  const rows = await db
    .prepare(
      `SELECT name, created_at FROM events
       WHERE created_at >= ?1 AND name NOT LIKE 'dev_%'
       ORDER BY created_at ASC`,
    )
    .bind(from)
    .all<{ name: string; created_at: number }>();

  const byEvent = new Map<string, number>();
  const dayTotals = new Map<string, number>();
  for (const r of rows.results) {
    byEvent.set(r.name, (byEvent.get(r.name) ?? 0) + 1);
    const date = new Date(r.created_at * 1000).toISOString().slice(0, 10);
    dayTotals.set(date, (dayTotals.get(date) ?? 0) + 1);
  }

  const events: ScreenStat[] = [...byEvent.entries()]
    .map(([event, total]) => ({ event, total, byDay: [] }))
    .sort((a, b) => b.total - a.total);

  // Дни по каждому событику — считаем вторым проходом, чтобы не усложнять SQL.
  const perEventDays = new Map<string, Map<string, number>>();
  for (const r of rows.results) {
    const date = new Date(r.created_at * 1000).toISOString().slice(0, 10);
    let m = perEventDays.get(r.name);
    if (!m) {
      m = new Map();
      perEventDays.set(r.name, m);
    }
    m.set(date, (m.get(date) ?? 0) + 1);
  }
  for (const stat of events) {
    const m = perEventDays.get(stat.event)!;
    stat.byDay = [...m.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /**
   * Воронка. Шаги взяты из реальных событий кода, а не придуманы: без события
   * шага в воронке просто не будет строки, и это лучше, чем рисовать шаг,
   * которого никто не измеряет.
   */
  const funnelSpec: Array<{ step: string; label: string }> = [
    { step: "login_view", label: "Открыл вход" },
    { step: "magic_link_sent", label: "Получил ссылку для входа" },
    { step: "dashboard_view", label: "Зашёл в кабинет" },
    { step: "constructor_view", label: "Открыл конструктор" },
    { step: "constructor_generate_click", label: "Нажал «сгенерировать»" },
    { step: "paywall_open", label: "Дошёл до тарифов" },
    { step: "paywall_plan_click", label: "Выбрал тариф" },
  ];

  const funnel: FunnelStep[] = [];
  let prev: number | null = null;
  for (const spec of funnelSpec) {
    const users = byEvent.get(spec.step) ?? 0;
    funnel.push({
      step: spec.step,
      label: spec.label,
      users,
      fromPrev: prev === null || prev === 0 ? null : Math.round((users / prev) * 100),
    });
    prev = users;
  }

  return {
    days,
    events,
    funnel,
    totals: {
      events: rows.results.length,
      byDay: [...dayTotals.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    },
  };
}

/** Экран 3 — генерации: по типам, по дням, успешные и с ошибкой. */
export async function getGenerations(db: D1Database, days: number): Promise<{
  days: number;
  totals: { calls: number; failed: number; fallback: number; cached: number; cacheRate: number };
  byTask: Array<{ task: string; calls: number; costRubActual: number | null }>;
  byDay: Array<{ date: string; calls: number; failed: number }>;
}> {
  const from = Math.floor(Date.now() / 1000) - days * 24 * 3600;

  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS calls,
              SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN fallback = 1 THEN 1 ELSE 0 END) AS fallback,
              SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) AS cached
       FROM llm_logs WHERE created_at >= ?1`,
    )
    .bind(from)
    .first<{ calls: number; failed: number; fallback: number; cached: number }>();

  const byTask = await db
    .prepare(
      `SELECT task, COUNT(*) AS calls FROM llm_logs
       WHERE created_at >= ?1 AND error IS NULL
       GROUP BY task ORDER BY calls DESC`,
    )
    .bind(from)
    .all<{ task: string; calls: number }>();

  // Фактические деньги по задачам — там, где провайдер их отдавал.
  const costByTask = await db
    .prepare(
      `SELECT task, SUM(cost_rub) AS rub FROM llm_costs_actual
       WHERE created_at >= ?1 GROUP BY task`,
    )
    .bind(from)
    .all<{ task: string; rub: number }>();
  const costMap = new Map(costByTask.results.map((r) => [r.task, r.rub]));

  const daily = await db
    .prepare(
      `SELECT created_at, error FROM llm_logs
       WHERE created_at >= ?1 ORDER BY created_at ASC`,
    )
    .bind(from)
    .all<{ created_at: number; error: string | null }>();

  const dayMap = new Map<string, { calls: number; failed: number }>();
  for (const r of daily.results) {
    const date = new Date(r.created_at * 1000).toISOString().slice(0, 10);
    const cur = dayMap.get(date) ?? { calls: 0, failed: 0 };
    cur.calls += 1;
    if (r.error) cur.failed += 1;
    dayMap.set(date, cur);
  }

  const calls = totals?.calls ?? 0;
  const cached = totals?.cached ?? 0;

  return {
    days,
    totals: {
      calls,
      failed: totals?.failed ?? 0,
      fallback: totals?.fallback ?? 0,
      cached,
      cacheRate: calls > 0 ? Math.round((cached / calls) * 100) : 0,
    },
    byTask: byTask.results.map((t) => ({
      task: t.task,
      calls: t.calls,
      costRubActual: costMap.has(t.task) ? round2(costMap.get(t.task)!) : null,
    })),
    byDay: [...dayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

/** Кто сколько потратил фактически — предохранитель COGS в новых цифрах. */
export interface CostByUser {
  userId: string | null;
  email: string | null;
  plan: string;
  costRub: number;
  revenueRub: number;
  costShare: number | null;
  overAlert: boolean;
}

/**
 * Экран 4 — деньги подробно.
 *
 * Расход здесь берётся из `llm_costs_actual`, то есть по счёту провайдера.
 * У кого факт неизвестен — того в список не попадает вовсе, а не попадает с
 * нулём: нулевой расход успокаивает, пока на самом деле просто нет данных.
 *
 * ── ПОЧЕМУ ЗДЕСЬ НЕТ ДЕЛЕНИЯ НА 100 ──────────────────────────────────────
 * ВНИМАНИЕ, этот блок легко «починить» не туда. Колонка называется
 * `c.cost_rub`, как и `payments.amount_rub`, но единицы у них РАЗНЫЕ:
 *
 *   c.cost_rub (llm_costs_actual) → РУБЛИ, дробное — это счёт провайдера;
 *   amount_rub  (payments)        → КОПЕЙКИ, целое — это наши платежи.
 *
 * Выручка справа приходит уже в рублях из revenueByUser, где деление есть.
 * Расход делить нельзя: получился бы расход, завышенный в сто раз, и
 * предсказатель «съел больше четверти выручки» срабатывал бы на пустом месте.
 */
export async function getCostByUser(db: D1Database, from: number, to: number): Promise<CostByUser[]> {
  const rows = await db
    .prepare(
      `SELECT c.user_id AS userId,
              u.email AS email,
              u.plan AS plan,
              SUM(c.cost_rub) AS costRub
       FROM llm_costs_actual c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.created_at >= ?1 AND c.created_at < ?2
       GROUP BY c.user_id
       ORDER BY costRub DESC
       LIMIT 100`,
    )
    .bind(from, to)
    .all<{ userId: string | null; email: string | null; plan: string | null; costRub: number }>();

  const revenue = await revenueByUser(db, from, to);

  return rows.results.map((r) => {
    const plan = r.plan ?? "free";
    const costRub = round2(r.costRub);
    const revenueRub = r.userId ? round2(revenue.get(r.userId) ?? 0) : 0;
    return {
      userId: r.userId,
      email: r.email,
      plan,
      costRub,
      revenueRub,
      costShare: revenueRub > 0 ? Math.round((costRub / revenueRub) * 100) : null,
      overAlert: revenueRub > 0 && costRub / revenueRub > COST_ALERT_RATIO,
    };
  });
}

/**
 * Записать в аудит-лог, что админ смотрел раздел с деньгами.
 *
 * Таблица `admin_audit_log` существует и до сих пор использовалась ноль раз.
 * Открытие экрана с выручкой — как раз то действие, при котором потом может
 * быть спор «я такого не видел».
 */
export async function writeAdminAudit(
  db: D1Database,
  params: { actorId: string | null; action: string; targetType?: string; payload?: unknown },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO admin_audit_log
         (id, actor_id, action, target_type, target_id, payload_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      `aud_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      params.actorId,
      params.action,
      params.targetType ?? null,
      null,
      params.payload === undefined ? null : JSON.stringify(params.payload),
      now,
    )
    .run();
}
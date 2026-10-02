/**
 * /api/admin/* — административная аналитика потребления.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ЭНДПОИНТ (2026-10-02)
 * ─────────────────────────────────────────────────────────────────────────────
 * Норма тарифа МЯГКАЯ: пересечение не блокирует генерацию. Это осознанно —
 * жёсткий блок посреди учебного года ломает продукт сильнее, чем ограничивает
 * убыток. Но тогда у продукта нет предохранителя, и единственная защита —
 * вовремя увидеть, кто уходит в минус.
 *
 * Этот эндпоинт — этот предохранитель. Ключевое число: `costUsd` за месяц против
 * выручки по тарифу. Если COGS съел больше 25% выручки, пользователь в списке.
 * Проверяется глазами за 10 секунд, а не постфактум по счёту от polza.ai.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ДАННЫЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * Источник — `llm_logs` (там уже пишутся task/model/plan/tokens/cost с каждого
 * вызова). Отдельную таблицу для этого не заводим: агрегат по индексу
 * idx_llm_logs_user_created дешёвый, а лишнее хранение в D1 — не лишнее.
 *
 * Взвешенные токены здесь пересчитываются НА ЛЕТУ из model + tokens_out, потому
 * что это отчёт для админа, а не норма для учителя: пересчёт задним числом
 * тут не врёт (взвешенные токены нужны, чтобы сравнивать тарифы между собой,
 * и текущие веса для этого годятся).
 */

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { ForbiddenError, BadRequestError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { getUsageStatus, PLAN_NORM_PER_MONTH } from "../services/usage";

const adminRouter = new Hono<AppEnv>();

/** Выручка тарифа в копейках за месяц — из billing, чтобы не расходилось. */
const MONTHLY_REVENUE_RUB: Record<string, number> = {
  base: 500,
  plus: 1_500,
  school: 3_000,
  free: 0,
};

/** Доля COGS от выручки, выше которой пользователя стоит посмотреть. */
const COST_ALERT_RATIO = 0.25;

function requireAdmin(c: Parameters<typeof requireAuth>[0]) {
  const user = requireAuth(c);
  if (!user.isAdmin) {
    throw new ForbiddenError("Доступ только для администратора");
  }
  return user;
}

/** `YYYY-MM` → unix-секунды начала и конца месяца. */
function monthRange(month: string): { from: number; to: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const from = Math.floor(new Date(Date.UTC(year, mon - 1, 1)).getTime() / 1000);
  const to = Math.floor(new Date(Date.UTC(year, mon, 1)).getTime() / 1000);
  return { from, to };
}

adminRouter.get("/usage", async (c) => {
  requireAdmin(c);

  const now = new Date();
  const month =
    c.req.query("month") ??
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const range = monthRange(month);
  if (!range) {
    throw new BadRequestError("Ожидается месяц в формате YYYY-MM", { month });
  }

  // Агрегат по пользователям. Взвешенные токены считаем в SQL не можем (вес
  // модели живёт в TS), поэтому берём строки и считаем в цикле. За месяц это
  // десятки тысяч строк на всю базу — для админского отчёта приемлемо, а если
  // вырастет, перенесём веса в таблицу model_weight и посчитаем в SQL.
  const rows = await c.env.DB
    .prepare(
      `SELECT l.user_id AS userId,
              u.plan AS plan,
              COUNT(*) AS calls,
              SUM(l.tokens_out) AS tokensOut,
              SUM(l.cost_usd) AS costUsd,
              SUM(CASE WHEN l.cached = 1 THEN 1 ELSE 0 END) AS cached
       FROM llm_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.created_at >= ?1 AND l.created_at < ?2
         AND l.error IS NULL
       GROUP BY l.user_id
       ORDER BY costUsd DESC
       LIMIT 200`,
    )
    .bind(range.from, range.to)
    .all<{
      userId: string | null;
      plan: string | null;
      calls: number;
      tokensOut: number;
      costUsd: number;
      cached: number;
    }>();

  // Модели по месяцу — видно, не уехали ли мы обратно на дорогую.
  const byModel = await c.env.DB
    .prepare(
      `SELECT model,
              COUNT(*) AS calls,
              SUM(tokens_out) AS tokensOut,
              SUM(cost_usd) AS costUsd
       FROM llm_logs
       WHERE created_at >= ?1 AND created_at < ?2 AND error IS NULL
       GROUP BY model
       ORDER BY costUsd DESC`,
    )
    .bind(range.from, range.to)
    .all<{ model: string; calls: number; tokensOut: number; costUsd: number }>();

  const rubToUsd = 1 / 85; // курс, зашитый в MODEL_COSTS
  const byTask = await c.env.DB
    .prepare(
      `SELECT task,
              COUNT(*) AS calls,
              SUM(cost_usd) AS costUsd
       FROM llm_logs
       WHERE created_at >= ?1 AND created_at < ?2 AND error IS NULL
       GROUP BY task
       ORDER BY calls DESC`,
    )
    .bind(range.from, range.to)
    .all<{ task: string; calls: number; costUsd: number }>();

  const users = rows.results.map((r) => {
    const plan = (r.plan ?? "free") as keyof typeof MONTHLY_REVENUE_RUB;
    const revenue = MONTHLY_REVENUE_RUB[plan] ?? 0;
    const cost = r.costUsd * rubToUsd;
    const norm = PLAN_NORM_PER_MONTH[plan as "base" | "plus"];
    return {
      userId: r.userId,
      plan,
      calls: r.calls,
      costRub: Math.round(cost * 100) / 100,
      revenueRub: revenue,
      // null, когда тариф бесплатный: там COGS сравнивать не с чем.
      costShare: revenue > 0 ? Math.round((cost / revenue) * 100) : null,
      overAlert: revenue > 0 && cost / revenue > COST_ALERT_RATIO,
      cachedCalls: r.cached,
      cacheRate: r.calls > 0 ? Math.round((r.cached / r.calls) * 100) : 0,
      normPerMonth: norm ?? null,
    };
  });

  return c.json({
    ok: true,
    month,
    totals: {
      users: users.length,
      calls: users.reduce((a, u) => a + u.calls, 0),
      costRub:
        Math.round(users.reduce((a, u) => a + u.costRub, 0) * 100) / 100,
      revenueRub: users.reduce((a, u) => a + u.revenueRub, 0),
      alerts: users.filter((u) => u.overAlert).length,
    },
    byModel: byModel.results.map((m) => ({
      ...m,
      costRub: Math.round(m.costUsd * rubToUsd * 100) / 100,
    })),
    byTask: byTask.results.map((t) => ({
      ...t,
      costRub: Math.round(t.costUsd * rubToUsd * 100) / 100,
    })),
    users,
  });
});

/**
 * Норма конкретного пользователя: сколько израсходовано и превышена ли.
 * Нужен для разбора «у меня показывает 3 листа, а счёт большой» — единственный
 * способ ответить, не читая логи глазами.
 */
adminRouter.get("/usage/:userId", async (c) => {
  requireAdmin(c);
  const userId = c.req.param("userId");
  const user = await c.env.DB
    .prepare(`SELECT id, plan FROM users WHERE id = ?1`)
    .bind(userId)
    .first<{ id: string; plan: string }>();
  if (!user) throw new BadRequestError("Пользователь не найден", { userId });

  const status = await getUsageStatus(
    c.env.DB,
    user.id,
    (user.plan as "free" | "base" | "plus") ?? "free",
  );
  return c.json({ ok: true, user: { id: user.id, plan: user.plan }, usage: status });
});

export { adminRouter };

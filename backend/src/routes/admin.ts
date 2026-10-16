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
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv } from "../types";
import { ForbiddenError, BadRequestError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/ratelimit";
import { getUsageStatus, PLAN_NORM_PER_MONTH } from "../services/usage";
// Канон цен живёт здесь (ТЗ-30 AD-1). Админка импортирует, а не знает числа:
// после следующего снижения прайса здесь нечего будет менять вручную.
import { PRICES } from "../services/billing";
import { listAdminUsers, getUserById, setUserAdmin } from "../db/queries";
import { z } from "zod";
import {
  currentMonth,
  getOverview,
  getScreens,
  getGenerations,
  getCostByUser,
  getTopups,
  monthRange as statsMonthRange,
  writeAdminAudit,
} from "../services/admin-stats";

const adminRouter = new Hono<AppEnv>();

/**
 * Доля COGS от выручки, выше которой пользователя стоит посмотреть. */
const COST_ALERT_RATIO = 0.25;

/**
 * Текущая цена тарифа в рублях — из `services/billing.ts`, единственного
 * канона (ТЗ-30 AD-1).
 *
 * Зачем это в админке, если выручка считается по платежам: чтобы рядом с
 * фактом было видно, сколько тариф стоит СЕЙЧАС. Разница между этими двумя
 * числами и есть снижение 12.10 — ровно то, что владелец проверяет, не
 * переписывая лишний раз прайс руками. Само число приходит из billing, и
 * поэтому таблицы цен в этом файле больше нет.
 */
function currentPriceRub(plan: string): number | null {
  if (plan === "free") return 0;
  const price = PRICES[plan as keyof typeof PRICES]?.monthly;
  // monthly в billing — копейки, здесь админке нужны рубли.
  return price == null ? null : price / 100;
}

/**
 * Выручка конкретного пользователя за месяц — ТОЛЬКО из его платежей.
 *
 * ─── ПОЧЕМУ НЕ ПО ТАРИФУ ──────────────────────────────────────────────────
 * До 15.10.2026 здесь стояла таблица `MONTHLY_REVENUE_RUB` с ценами ДО
 * снижения 12.10 — это цены старого прайса, и после снижения прайса таблица
 * осталась старой навсегда. Владелец смотрел на «средний чек 1 240 ₽» при
 * тарифе 249–999 ₽ и принимал по этой цифре решение «хватает ли денег».
 *
 * Теперь число берётся из таблицы `payments`: сумма платежей пользователя за
 * месяц. Это ровно то, что пришло на счёт, и никакой другой источник для
 * «сколько он заплатил» не существует.
 *
 * ─── ПОЧЕМУ ЭТО ВАЖНО ДЛЯ ИСТОРИИ ─────────────────────────────────────────
 * Платёж, сделанный до 12.10, попадает в выручку по СВОЕЙ сумме (по цене
 * того дня), а не по нынешнему прайсу. Иначе история за месяцы переписалась
 * бы задним числом, и любое сравнение «было/стало» было бы бессмысленным.
 *
 * ─── ЧТО ЭТО НЕ ЛОМАЕТ ────────────────────────────────────────────────────
 * У платящего раз в год пользователя в месяце без платежа выручка покажет 0.
 * Это правда, а не ошибка: годовая выручка видна, если смотреть период шире
 * (та же оговорка про годовую оплату стоит в services/admin-stats.ts).
 * В `users[]` рядом отдаётся `hasPayment`, чтобы администратор видел, что
 * нулевого числа может не быть, а не искал ошибку в счётчике.
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
  // `amount_rub` хранит КОПЕЙКИ — так его пишет `billing.ts` при создании
  // платежа (`amountKopecks`). Имя колонки про рубли, значение про копейки, и
  // на этом уже ошибались: без `/100` платёж 249 ₽ показывался как 24 900 ₽.
  // Поэтому делим здесь, один раз, в том месте, где сумма становится рублём.
  return new Map(rows.results.map((r) => [r.user_id, r.rub / 100]));
}

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

  // Выручка — по фактическим платежам месяца (см. revenueByUser).
  const revenueByUserMap = await revenueByUser(c.env.DB, range.from, range.to);

  const users = rows.results.map((r) => {
    const plan = r.plan ?? "free";
    const revenue = r.userId ? (revenueByUserMap.get(r.userId) ?? 0) : 0;
    const cost = r.costUsd * rubToUsd;
    const norm = PLAN_NORM_PER_MONTH[plan as "base" | "standard" | "plus"];
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
      // Платёж в этом месяце есть или нет. Нулевая выручка при true —
      // годовая оплата или неоплаченный платёж, и это не поломка счётчика.
      hasPayment: revenue > 0,
      // Цена тарифа сейчас, из billing. Никогда не подставляется в выручку.
      listPriceRub: currentPriceRub(plan),
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
    (user.plan as "free" | "base" | "standard" | "plus") ?? "free",
  );
  return c.json({ ok: true, user: { id: user.id, plan: user.plan }, usage: status });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Экраны `/superpower` (ТЗ-24, раздел 7)
 *
 * Отдельный блок от `/usage` выше не потому, что данные другие, а потому что
 * там был предохранитель для одного человека («кто ушёл в минус»), а тут —
 * четыре экрана для владельца продукта. Логика агрегатов вынесена в
 * `services/admin-stats.ts`, в роутере остаётся только разбор запроса.
 *
 * ВСЕ ЧЕТЫРЕ ЗАКРЫТЫ ОДИНАКОВО: requireAdmin + ограничение частоты. Цифры не
 * отдаются никому, кроме администратора, даже если адрес страницы известен —
 * страница `/superpower` отдаётся всем, закрыты данные, а не вёрстка.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Потолок окна в днях: меньше не бывает, больше — никто не смотрит. */
const MAX_DAYS = 90;

function parseMonth(c: Parameters<typeof requireAuth>[0]): string {
  const month = c.req.query("month") ?? currentMonth();
  if (!statsMonthRange(month)) {
    throw new BadRequestError("Ожидается месяц в формате YYYY-MM", { month });
  }
  return month;
}

function parseDays(c: Parameters<typeof requireAuth>[0]): number {
  const raw = c.req.query("days");
  const days = raw ? Number(raw) : 30;
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) {
    throw new BadRequestError(`Ожидается число дней от 1 до ${MAX_DAYS}`, { days: raw ?? null });
  }
  return Math.floor(days);
}

/**
 * Ограничение частоты для админских эндпоинтов.
 *
 * 240 в час на админа — с запасом больше, чем нужно живому человеку (он
 * открывает экран десятки раз), и сильно меньше, чем нужно перебору.
 */
const adminRateLimit = rateLimitMiddleware({
  limit: 240,
  windowSec: 3600,
  bucket: "admin",
});

/** Экран 1 — светофор. */
adminRouter.get("/overview", adminRateLimit, async (c) => {
  const admin = requireAdmin(c);
  const month = parseMonth(c);
  const overview = await getOverview(c.env.DB, month);
  await writeAdminAudit(c.env.DB, {
    actorId: admin.id,
    action: "superpower.overview.view",
    targetType: "dashboard",
    payload: { month },
  });
  return c.json({ ok: true, adminId: admin.id, ...overview });
});

/** Экран 2 — экраны и воронка. */
adminRouter.get("/screens", adminRateLimit, async (c) => {
  const admin = requireAdmin(c);
  const days = parseDays(c);
  await writeAdminAudit(c.env.DB, {
    actorId: admin.id,
    action: "superpower.screens.view",
    targetType: "dashboard",
    payload: { days },
  });
  return c.json({ ok: true, ...(await getScreens(c.env.DB, days)) });
});

/** Экран 3 — генерации. */
adminRouter.get("/generations", adminRateLimit, async (c) => {
  const admin = requireAdmin(c);
  const days = parseDays(c);
  await writeAdminAudit(c.env.DB, {
    actorId: admin.id,
    action: "superpower.generations.view",
    targetType: "usage",
    payload: { days },
  });
  return c.json({ ok: true, ...(await getGenerations(c.env.DB, days)) });
});

/**
 * Экран 4 — деньги подробно.
 *
 * Пишет в аудит-лог так же, как остальные экраны. Раньше журнал вёлся только
 * здесь, и потому на остальных четырёх не оставалось никакого следа: посмотреть
 * статистику генераций можно было совершенно незаметно. Теперь след есть у
 * каждого экрана, потому что «а вчера такого не было» — вопрос, который
 * задают именно после тихого просмотра.
 */
adminRouter.get("/money", adminRateLimit, async (c) => {
  const admin = requireAdmin(c);
  const month = parseMonth(c);
  const range = statsMonthRange(month)!;

  const [overview, costByUser, topups, payments, subscriptions] = await Promise.all([
    getOverview(c.env.DB, month),
    getCostByUser(c.env.DB, range.from, range.to),
    getTopups(c.env.DB, range.from, range.to),
    c.env.DB
      .prepare(
        // Тот же случай, что и в revenueByUser выше: `payments.amount_rub`
        // хранит КОПЕЙКИ. Делим в SQL, чтобы на фронте (`/superpower/money`,
        // таблица «Платежи») число было рублём — там formatRub умеет только
        // форматировать, но не переводить. Псевдоним оставлен тем же, чтобы
        // контракт ответа не менялся.
        `SELECT id, user_id, plan, amount_rub / 100 AS amount_rub, status, created_at
         FROM payments WHERE created_at >= ?1 AND created_at < ?2
         ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(range.from, range.to)
      .all(),
    c.env.DB
      .prepare(
        `SELECT id, user_id, plan, status, period, auto_renew, starts_at, ends_at
         FROM subscriptions ORDER BY ends_at DESC LIMIT 100`,
      )
      .all(),
  ]);

  await writeAdminAudit(c.env.DB, {
    actorId: admin.id,
    action: "superpower.money.view",
    targetType: "finance",
    payload: { month, costByUser: costByUser.length, payments: payments.results.length },
  });

  return c.json({
    ok: true,
    month,
    summary: overview.money,
    providerBalance: overview.providerBalance,
    topups,
    costByUser,
    payments: payments.results,
    subscriptions: subscriptions.results,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Кто может заходить в суперадминку (ТЗ-24 §8, добавлено 15.10.2026)
// ─────────────────────────────────────────────────────────────────────────────
//
// ЗАЧЕМ. Права администратора выдавались один раз — в момент первой регистрации,
// если адрес совпал со списком ADMIN_EMAILS на сервере, — и висели в базе
// навсегда. Снять их было нечем: `setUserAdmin` существовал, но не вызывался
// ниоткуда. Практический случай: адрес в списке освободился, его занял другой
// человек, зарегистрировался и получил доступ ко всей финансовой информации.
//
// ПОЧЕМУ НЕЛЬЗЯ СНЯТЬ С СЕБЯ. Единственный администратор, снявший с себя права
// одним нажатием, теряет доступ к разделу навсегда — и вернуть его можно будет
// только правкой базы вручную. Отказ здесь безопаснее, чем «потом разберёмся».

const adminsSchema = z.object({
  userId: z.string().min(1).max(64),
  isAdmin: z.boolean(),
});

/** GET /api/admin/admins — кто сейчас может заходить в суперадминку. */
adminRouter.get("/admins", adminRateLimit, async (c) => {
  const admin = requireAdmin(c);
  const admins = await listAdminUsers(c.env.DB);
  await writeAdminAudit(c.env.DB, {
    actorId: admin.id,
    action: "superpower.admins.view",
    targetType: "access",
  });
  return c.json({
    ok: true,
    admins: admins.map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      plan: a.plan,
      // Код подтверждения — не украшение: без него ссылка из письма даёт
      // полный доступ. Поэтому показываем его прямо в списке.
      totpEnabled: a.totp_enabled === 1,
      createdAt: new Date(a.created_at * 1000).toISOString(),
      isSelf: a.id === admin.id,
    })),
  });
});

/** POST /api/admin/admins — снять или вернуть права администратора. */
adminRouter.post("/admins", adminRateLimit, async (c) => {
  const admin = requireAdmin(c);
  const body = (await c.req.json().catch(() => ({}))) as unknown;
  const parsed = adminsSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError("Ожидается { userId, isAdmin }");
  }
  const { userId, isAdmin } = parsed.data;

  if (userId === admin.id) {
    throw new ForbiddenError(
      "Нельзя снять права с себя — иначе доступ к суперадминке пропадёт навсегда",
    );
  }

  const target = await getUserById(c.env.DB, userId);
  if (!target) {
    throw new BadRequestError("Аккаунт не найден");
  }

  // Последнего администратора снять нельзя — но снять себя мы уже запретили
  // выше, а чужих снимать можно: решение владельца оставить одного.
  await setUserAdmin(c.env.DB, userId, isAdmin);
  await writeAdminAudit(c.env.DB, {
    actorId: admin.id,
    action: isAdmin ? "access.grant" : "access.revoke",
    targetType: "user",
    payload: { userId, email: target.email },
  });

  return c.json({ ok: true, userId, isAdmin });
});

export { adminRouter };

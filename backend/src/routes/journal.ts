/**
 * GET /api/journal — журнал проверок учителя (ТЗ-19 §5.1).
 *
 * Закрывает дыру, из-за которой фича выглядела как игрушка: результат проверки
 * по фото жил только в открытой вкладке. Закрыл вкладку — отметок нет нигде,
 * даже автоматических. Теперь у учителя есть список: дата, предмет, класс,
 * отметка и — главное — кто эту отметку поставил: машина или он сам.
 *
 * Монтируется в `index.ts` как `app.route("/api/journal", journalRouter)`.
 * Само монтирование — за оркестратором, этот файл только экспортирует роутер.
 *
 * ЧУЖИХ ЗАПИСЕЙ НЕ БЫВАЕТ: `user_id` берётся из сессии, из query его не
 * подставляет никто. Пустой список — валидный ответ, а не 404: «проверок ещё не
 * было» и «проверка не найдена» — разные вещи, и учителю нужна первая.
 */

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { BadRequestError } from "../lib/errors";
import { listJournalEntries } from "../db/journal";
import type { AppEnv } from "../types";

const journalRouter = new Hono<AppEnv>();

/** Потолок страницы. Учитель за вечер делает десятки, не тысячи работ. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

journalRouter.get("/", async (c) => {
  const user = requireAuth(c);

  const limit = clampInt(c.req.query("limit"), 1, MAX_LIMIT, DEFAULT_LIMIT);

  // Курсор — unix seconds. Нечисловой курсор отбрасываем явно, иначе список
  // молча превратился бы в «ничего не найдено», и учитель подумал бы, что
  // история пропала.
  const cursorRaw = c.req.query("cursor");
  let before: number | null = null;
  if (cursorRaw) {
    const parsed = Number(cursorRaw);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestError("cursor должен быть unix-таймстампом");
    }
    before = parsed;
  }

  const rows = await listJournalEntries(c.env.DB, { userId: user.id, limit, before });

  return c.json({
    ok: true,
    entries: rows.map((r) => ({
      id: r.id,
      checkId: r.check_id,
      subject: r.subject,
      grade: r.grade,
      // null — не ошибка, а «разбор неполный». Фронт обязан показать это словами,
      // а не пустым местом.
      mark: r.mark,
      percentage: r.percentage,
      earnedPoints: r.earned_points,
      totalPoints: r.total_points,
      source: r.source,
      pendingTasks: r.pending_tasks,
      occurredAt: r.occurred_at,
    })),
    // Курсор есть только когда страница может быть ещё полной — иначе фронт
    // будет предлагать «показать ещё» в пустоту.
    nextCursor: rows.length === limit ? rows[rows.length - 1]?.occurred_at ?? null : null,
  });
});

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export { journalRouter };

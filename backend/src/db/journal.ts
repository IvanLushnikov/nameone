/**
 * Журнал проверок (ТЗ-19 §5.1) — таблица `journal_entries`.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ `db/photoChecks.ts`: это не про фото и не про
 * items. Журнал — про «что учителю видно в его истории», и его владелец должен
 * быть один: и `completePhotoCheck`, и `POST /manual-marks` пишут в одну и ту же
 * строку. Правило общее для репозитория — один доменный слой на файл.
 *
 * УСТРОЙСТВО. Строка на одну проверку (UNIQUE(user_id, check_id)), а не событие
 * на каждое действие. Учителю нужен ответ на вопрос «что я поставил этой работе
 * и поставил ли вообще», а не лента из пяти записей про одну тетрадь.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { shortId } from "../lib/shortid";

export interface JournalEntryRow {
  id: string;
  user_id: string;
  check_id: string;
  subject: string | null;
  grade: number | null;
  /** '5'|'4'|'3'|'2'|null. null = разбор неполный, отметки ещё нет. */
  mark: string | null;
  percentage: number | null;
  earned_points: number;
  total_points: number;
  source: "machine" | "teacher" | "mixed";
  pending_tasks: number;
  occurred_at: number;
  created_at: number;
  updated_at: number;
}

const JOURNAL_COLUMNS = `id, user_id, check_id, subject, grade, mark, percentage,
  earned_points, total_points, source, pending_tasks, occurred_at, created_at, updated_at`;

/** ID строки журнала: `jrn_<12>`. */
function journalEntryId(): string {
  return `jrn_${shortId()}`;
}

export interface UpsertJournalEntryInput {
  userId: string;
  checkId: string;
  subject: string | null;
  grade: number | null;
  /** null, пока учитель не закрыл все сомнительные задания. */
  mark: string | null;
  percentage: number | null;
  earnedPoints: number;
  totalPoints: number;
  source: "machine" | "teacher" | "mixed";
  pendingTasks: number;
  /** Когда проверка закончилась (unix seconds). Не «сейчас»: при пересохранении
   *  ручных отметок это время не должно съезжать вперёд, иначе в истории
   *  учителя работа перепрыгнёт на другое время. */
  occurredAt: number;
  now: number;
}

/**
 * Создать или обновить строку журнала по проверке.
 *
 * Вызывается в двух местах: после машинной проверки (source = machine) и после
 * сохранения ручных отметок. UPSERT по UNIQUE(user_id, check_id) — второй вызов
 * обновляет ту же строку, а не добавляет вторую запись про ту же работу.
 */
export async function upsertJournalEntry(
  db: D1Database,
  args: UpsertJournalEntryInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO journal_entries
         (id, user_id, check_id, subject, grade, mark, percentage, earned_points,
          total_points, source, pending_tasks, occurred_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(user_id, check_id) DO UPDATE SET
         subject = excluded.subject,
         grade = excluded.grade,
         mark = excluded.mark,
         percentage = excluded.percentage,
         earned_points = excluded.earned_points,
         total_points = excluded.total_points,
         source = excluded.source,
         pending_tasks = excluded.pending_tasks,
         updated_at = excluded.updated_at`,
    )
    .bind(
      journalEntryId(),
      args.userId,
      args.checkId,
      args.subject,
      args.grade,
      args.mark,
      args.percentage,
      args.earnedPoints,
      args.totalPoints,
      args.source,
      args.pendingTasks,
      args.occurredAt,
      args.now,
    )
    .run();
}

/**
 * Лента журнала учителя. `user_id` берётся ТОЛЬКО из сессии — из query его не
 * подставляет никто (то же правило, что в listUserPhotoChecks).
 *
 * Курсор — unix seconds по `occurred_at`, строгое `<`. Записи с одинаковым
 * временем (маловероятно, но возможно при пересохранении) курсором не
 * разъезжаются: следующая страница берётся строго раньше.
 */
export async function listJournalEntries(
  db: D1Database,
  args: { userId: string; limit: number; before?: number | null },
): Promise<JournalEntryRow[]> {
  const res = await db
    .prepare(
      `SELECT ${JOURNAL_COLUMNS} FROM journal_entries
       WHERE user_id = ?1 AND occurred_at < ?2
       ORDER BY occurred_at DESC
       LIMIT ?3`,
    )
    .bind(args.userId, args.before ?? 0x7fffffff, args.limit)
    .all<JournalEntryRow>();
  return res.results ?? [];
}

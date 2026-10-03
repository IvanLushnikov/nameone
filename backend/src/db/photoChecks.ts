/**
 * D1-запросы проверки работ по фото (TZ-11 §4.2).
 *
 * Живут отдельным файлом, а не в `db/queries.ts`: тот файл — базовый слой
 * user/session, и его владелец прямо запретил туда добавлять доменные выборки
 * (см. шапку queries.ts). Здесь — только photo_checks / photo_check_items /
 * usage_counters.
 *
 * Конвенции те же: явные колонки, unix seconds, никаких SELECT *.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { photoCheckId, photoCheckItemId, shortId, usageCounterId } from "../lib/shortid";
import type { GradedPhotoItem, PhotoCheckSummary } from "../services/photoCheckGrading";
// ─────────────────────────────────────────────────────────────────────────────
// Row types
// ─────────────────────────────────────────────────────────────────────────────

export interface PhotoCheckRow {
  id: string;
  user_id: string | null;
  worksheet_id: string | null;
  subject: string | null;
  grade: number | null;
  r2_key: string | null;
  mime_type: string | null;
  byte_size: number | null;
  status: "pending" | "ok" | "partial" | "failed";
  total_points: number;
  earned_points: number;
  percentage: number | null;
  grade_mark: string | null;
  needs_review: number;
  model: string | null;
  provider: string | null;
  cost_usd: number;
  latency_ms: number | null;
  error_code: string | null;
  deleted_at: number | null;
  delete_at: number | null;
  created_at: number;
  completed_at: number | null;
}

export interface PhotoCheckItemRow {
  id: string;
  check_id: string;
  task_number: number;
  task_text: string | null;
  expected: string | null;
  student_answer: string | null;
  verdict: "correct" | "incorrect" | "unclear";
  points_awarded: number;
  max_points: number;
  confidence: number | null;
  needs_review: number;
  comment: string | null;
  created_at: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo checks
// ─────────────────────────────────────────────────────────────────────────────

const CHECK_COLUMNS = `id, user_id, worksheet_id, subject, grade, r2_key, mime_type, byte_size,
  status, total_points, earned_points, percentage, grade_mark, needs_review,
  model, provider, cost_usd, latency_ms, error_code, deleted_at, delete_at,
  created_at, completed_at`;

const ITEM_COLUMNS = `id, check_id, task_number, task_text, expected, student_answer,
  verdict, points_awarded, max_points, confidence, needs_review, comment, created_at`;

export interface InsertPhotoCheckInput {
  userId: string | null;
  worksheetId?: string | null;
  subject?: string | null;
  grade?: number | null;
  r2Key: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  /** Расчётный срок автоудаления фото (unix seconds). */
  deleteAt: number | null;
  createdAt: number;
  status?: "pending" | "ok" | "partial" | "failed";
}

/**
 * Создать запись о проверке ДО вызова LLM, со статусом pending.
 *
 * Зачем так: если воркер убьёт посреди вызова модели, в D1 останется
 * pending-запись с r2_key — retention-скрипт её подчистит по delete_at.
 * Если бы мы писали только после успеха, фото повисло бы в R2 навсегда.
 */
export async function insertPhotoCheck(
  db: D1Database,
  input: InsertPhotoCheckInput,
): Promise<string> {
  const id = photoCheckId();
  await db
    .prepare(
      `INSERT INTO photo_checks
         (id, user_id, worksheet_id, subject, grade, r2_key, mime_type, byte_size,
          status, delete_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      id,
      input.userId,
      input.worksheetId ?? null,
      input.subject ?? null,
      input.grade ?? null,
      input.r2Key,
      input.mimeType ?? null,
      input.byteSize ?? null,
      input.status ?? "pending",
      input.deleteAt,
      input.createdAt,
    )
    .run();
  return id;
}

/** Дописать результат проверки после вызова LLM. */
export async function completePhotoCheck(
  db: D1Database,
  args: {
    id: string;
    summary: PhotoCheckSummary;
    model: string;
    provider: string;
    costUsd: number;
    latencyMs: number;
    errorCode?: string | null;
    completedAt: number;
  },
): Promise<void> {
  const { summary } = args;
  // partial = отработали, но есть задания, которые учитель должен посмотреть.
  const status: "ok" | "partial" = summary.needsReview ? "partial" : "ok";
  await db
    .prepare(
      `UPDATE photo_checks
         SET status = ?2, total_points = ?3, earned_points = ?4, percentage = ?5,
             grade_mark = ?6, needs_review = ?7, model = ?8, provider = ?9,
             cost_usd = ?10, latency_ms = ?11, error_code = ?12, completed_at = ?13
         WHERE id = ?1`,
    )
    .bind(
      args.id,
      status,
      summary.totalPoints,
      summary.earnedPoints,
      summary.percentage,
      summary.gradeMark,
      summary.needsReview ? 1 : 0,
      args.model,
      args.provider,
      args.costUsd,
      args.latencyMs,
      args.errorCode ?? null,
      args.completedAt,
    )
    .run();

  for (const item of summary.items) {
    await insertPhotoCheckItem(db, args.id, item, args.completedAt);
  }
}

/** Пометить проверку как failed (LLM недоступен, битая картинка). */
export async function failPhotoCheck(
  db: D1Database,
  args: { id: string; errorCode: string; completedAt: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE photo_checks
         SET status = 'failed', error_code = ?2, completed_at = ?3
       WHERE id = ?1`,
    )
    .bind(args.id, args.errorCode, args.completedAt)
    .run();
}

async function insertPhotoCheckItem(
  db: D1Database,
  checkId: string,
  item: GradedPhotoItem,
  createdAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO photo_check_items
         (id, check_id, task_number, task_text, expected, student_answer, verdict,
          points_awarded, max_points, confidence, needs_review, comment, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      photoCheckItemId(),
      checkId,
      item.number,
      item.taskText,
      item.expected,
      item.studentAnswer,
      item.verdict,
      item.pointsAwarded,
      item.maxPoints,
      item.confidence,
      item.needsReview ? 1 : 0,
      item.comment,
      createdAt,
    )
    .run();
}

export async function getPhotoCheckById(
  db: D1Database,
  id: string,
): Promise<PhotoCheckRow | null> {
  const row = await db
    .prepare(`SELECT ${CHECK_COLUMNS} FROM photo_checks WHERE id = ?1`)
    .bind(id)
    .first<PhotoCheckRow>();
  return row ?? null;
}

export async function getPhotoCheckItems(
  db: D1Database,
  checkId: string,
): Promise<PhotoCheckItemRow[]> {
  const res = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM photo_check_items
       WHERE check_id = ?1 ORDER BY task_number ASC`,
    )
    .bind(checkId)
    .all<PhotoCheckItemRow>();
  return res.results ?? [];
}

/**
 * История проверок пользователя. user_id берётся ТОЛЬКО из сессии —
 * из query его не подставляет никто (ТЗ §4.3).
 */
export async function listUserPhotoChecks(
  db: D1Database,
  args: { userId: string; limit: number; before?: number | null },
): Promise<PhotoCheckRow[]> {
  const res = await db
    .prepare(
      `SELECT ${CHECK_COLUMNS} FROM photo_checks
       WHERE user_id = ?1 AND created_at < ?2
       ORDER BY created_at DESC
       LIMIT ?3`,
    )
    .bind(args.userId, args.before ?? 0x7fffffff, args.limit)
    .all<PhotoCheckRow>();
  return res.results ?? [];
}

/**
 * Soft-delete: фото уже стёрто из R2, метаданные проверки остаются учителю.
 * `r2_key` обнуляем — иначе по базе останется ключ на несуществующий объект.
 */
export async function markPhotoDeleted(
  db: D1Database,
  args: { id: string; userId: string; deletedAt: number },
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE photo_checks
         SET deleted_at = ?3, r2_key = NULL, delete_at = ?3
       WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL`,
    )
    .bind(args.id, args.userId, args.deletedAt)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Проверки, у которых истёк срок хранения, но фото ещё в R2.
 * Для retention-скрипта (TZ §5.2 В-2.3).
 */
export async function listExpiredPhotoChecks(
  db: D1Database,
  args: { now: number; limit: number },
): Promise<PhotoCheckRow[]> {
  const res = await db
    .prepare(
      `SELECT ${CHECK_COLUMNS} FROM photo_checks
       WHERE deleted_at IS NULL AND r2_key IS NOT NULL AND delete_at IS NOT NULL AND delete_at <= ?1
       ORDER BY delete_at ASC
       LIMIT ?2`,
    )
    .bind(args.now, args.limit)
    .all<PhotoCheckRow>();
  return res.results ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Ручные отметки учителя (ТЗ-19)
// ─────────────────────────────────────────────────────────────────────────────
//
// Отдельная таблица `photo_check_manual_marks`, а НЕ колонка в photo_check_items:
// строка в items = решение МАШИНЫ, строка здесь = решение УЧИТЕЛЯ. Они не
// смешиваются, и через месяц видно, где кончилась машина и начался человек.

export interface PhotoCheckManualMarkRow {
  id: string;
  check_id: string;
  task_number: number;
  accepted: number;
  points: number;
  /** Снимок вердикта модели на момент ПЕРВОЙ правки. Дальше не перетирается. */
  model_verdict: string | null;
  model_points: number | null;
  author: string;
  created_at: number;
  updated_at: number;
}

const MANUAL_MARK_COLUMNS = `id, check_id, task_number, accepted, points,
  model_verdict, model_points, author, created_at, updated_at`;

/** ID строки ручной отметки: `pcmm_<12>`. */
function photoCheckManualMarkId(): string {
  return `pcmm_${shortId()}`;
}

export interface UpsertManualMarkInput {
  checkId: string;
  taskNumber: number;
  accepted: boolean;
  points: number;
  /** Что сказала машина по этому заданию — пишется один раз, при вставке. */
  modelVerdict: string | null;
  modelPoints: number | null;
  author: string;
  updatedAt: number;
}

/**
 * Записать/перезаписать ручную отметку по одному заданию.
 *
 * UPSERT по UNIQUE(check_id, task_number) — повторное сохранение той же работы
 * не плодит дубли.
 *
 * ПОЧЕМУ снимок машины пишется только при вставке: если учитель открывает
 * проверку второй раз и правит то же задание ещё раз, перезапись снимка стёрла бы
 * ровно ту информацию, ради которой он существует — «что машина предложила
 * В ПЕРВЫЙ РАЗ». Обновление трогает только решение учителя.
 */
export async function upsertManualMark(
  db: D1Database,
  args: UpsertManualMarkInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO photo_check_manual_marks
         (id, check_id, task_number, accepted, points, model_verdict, model_points,
          author, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(check_id, task_number) DO UPDATE SET
         accepted = excluded.accepted,
         points = excluded.points,
         author = excluded.author,
         updated_at = excluded.updated_at`,
    )
    .bind(
      photoCheckManualMarkId(),
      args.checkId,
      args.taskNumber,
      args.accepted ? 1 : 0,
      args.points,
      args.modelVerdict,
      args.modelPoints,
      args.author,
      args.updatedAt,
    )
    .run();
}

export async function getManualMarks(
  db: D1Database,
  checkId: string,
): Promise<PhotoCheckManualMarkRow[]> {
  const res = await db
    .prepare(
      `SELECT ${MANUAL_MARK_COLUMNS} FROM photo_check_manual_marks
       WHERE check_id = ?1 ORDER BY task_number ASC`,
    )
    .bind(checkId)
    .all<PhotoCheckManualMarkRow>();
  return res.results ?? [];
}

/**
 * Пересчитать итог проверки после ручных правок — одним UPDATE.
 *
 * `percentage`/`grade_mark` приходят сюда уже посчитанными чистым модулем слияния,
 * и могут быть NULL: пока сомнительные задания не закрыты, итоговой отметки
 * просто нет. Это осознанный «пробел», а не ошибка.
 */
export async function updatePhotoCheckScore(
  db: D1Database,
  args: {
    id: string;
    totalPoints: number;
    earnedPoints: number;
    percentage: number | null;
    gradeMark: string | null;
    needsReview: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE photo_checks
         SET total_points = ?2, earned_points = ?3, percentage = ?4,
             grade_mark = ?5, needs_review = ?6,
             status = CASE WHEN ?6 = 1 THEN 'partial' ELSE 'ok' END
       WHERE id = ?1`,
    )
    .bind(
      args.id,
      args.totalPoints,
      args.earnedPoints,
      args.percentage,
      args.gradeMark,
      args.needsReview ? 1 : 0,
    )
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Вопросы для беседы (F-06.1 / TZ-17 §5.5)
// ─────────────────────────────────────────────────────────────────────────────

export interface InterviewQuestionRow {
  id: string;
  check_id: string;
  user_id: string;
  task_number: number;
  task_text: string | null;
  question: string;
  verdict_snapshot: string;
  generation: number;
  superseded: number;
  model: string | null;
  created_at: number;
}

const IQ_COLUMNS = `id, check_id, user_id, task_number, task_text, question,
  verdict_snapshot, generation, superseded, model, created_at`;

export interface InsertInterviewQuestion {
  taskNumber: number;
  taskText: string | null;
  question: string;
  /** Вердикт проверки на момент генерации — якорь для учителя в интерфейсе. */
  verdict: string;
}

/** ID строки вопроса: `pciq_<12>`. */
function interviewQuestionId(): string {
  return `pciq_${shortId()}`;
}

/** Номер последней генерации вопросов по проверке. 0 — вопросов ещё не было. */
export async function getLatestInterviewGeneration(db: D1Database, checkId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT MAX(generation) AS generation FROM photo_check_interview_questions
       WHERE check_id = ?1`,
    )
    .bind(checkId)
    .first<{ generation: number | null }>();
  return row?.generation ?? 0;
}

/**
 * Сохранить набор вопросов как новую генерацию.
 *
 * Старые строки этой проверки в той же операции помечаются superseded = 1 —
 * `db.batch` в D1 выполняется транзакцией, поэтому учитель не увидит момент,
 * когда старый набор ещё актуален, а новый уже наполовину записан. История при
 * этом остаётся в базе: к ней возвращаются, когда вопросы не сработали.
 */
export async function insertInterviewQuestions(
  db: D1Database,
  args: {
    checkId: string;
    userId: string;
    questions: InsertInterviewQuestion[];
    model: string;
    createdAt: number;
    /** Номер генерации. 0 = вычислить как «последняя + 1». */
    generation?: number;
  },
): Promise<number> {
  const generation =
    args.generation && args.generation > 0
      ? Math.trunc(args.generation)
      : (await getLatestInterviewGeneration(db, args.checkId)) + 1;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE photo_check_interview_questions
           SET superseded = 1
         WHERE check_id = ?1 AND superseded = 0`,
      )
      .bind(args.checkId),
  ];

  for (const q of args.questions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO photo_check_interview_questions
             (id, check_id, user_id, task_number, task_text, question,
              verdict_snapshot, generation, superseded, model, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10)`,
        )
        .bind(
          interviewQuestionId(),
          args.checkId,
          args.userId,
          q.taskNumber,
          q.taskText,
          q.question,
          q.verdict,
          generation,
          args.model,
          args.createdAt,
        ),
    );
  }

  await db.batch(statements);
  return generation;
}

/**
 * Последняя не-superseded генерация — её и отдаём учителю.
 *
 * Отдельный подзапрос на MAX(generation) закрывает страховку от ситуации, когда
 * старые строки почему-то остались не-superseded: показываем один набор, а не
 * два набора вопросов на одну и ту же работу.
 */
export async function getLatestInterviewQuestions(
  db: D1Database,
  checkId: string,
): Promise<InterviewQuestionRow[]> {
  const res = await db
    .prepare(
      `SELECT ${IQ_COLUMNS} FROM photo_check_interview_questions
       WHERE check_id = ?1
         AND superseded = 0
         AND generation = (
           SELECT MAX(generation) FROM photo_check_interview_questions
           WHERE check_id = ?1 AND superseded = 0
         )
       ORDER BY task_number ASC`,
    )
    .bind(checkId)
    .all<InterviewQuestionRow>();
  return res.results ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// usage_counters — месячная квота
// ─────────────────────────────────────────────────────────────────────────────

/** Начало календарного месяца в unix seconds (UTC). */
export function monthWindowStart(nowUnixSec: number): number {
  const d = new Date(nowUnixSec * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0) / 1000,
  );
}

/**
 * Прочитать счётчик. Возвращает 0, если строки ещё нет — UPSERT ниже её создаст.
 */
export async function getUsageCounter(
  db: D1Database,
  args: { userId: string; metric: string; windowStart: number },
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count FROM usage_counters
       WHERE user_id = ?1 AND metric = ?2 AND window_start = ?3`,
    )
    .bind(args.userId, args.metric, args.windowStart)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Инкремент в UPSERT. Один SQL — без гонки между чтением и записью.
 * Возвращает НОВОЕ значение счётчика.
 */
export async function incrementUsageCounter(
  db: D1Database,
  args: { userId: string; metric: string; windowStart: number; updatedAt: number },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (id, user_id, metric, window_start, count, updated_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5)
       ON CONFLICT(user_id, metric, window_start)
       DO UPDATE SET count = count + 1, updated_at = ?5
       RETURNING count`,
    )
    .bind(usageCounterId(), args.userId, args.metric, args.windowStart, args.updatedAt)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

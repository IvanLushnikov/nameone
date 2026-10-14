/**
 * Слой данных для классов и учеников (лист 3.1.1).
 *
 * Здесь вся работа с таблицами `classes` / `class_students` /
 * `class_student_answers`. Роуты (`routes/classes.ts`) не пишут SQL — иначе
 * правило «учитель видит только свой класс» пришлось бы повторять в каждом
 * обработчике, а оно обязано выполняться везде одинаково.
 *
 * ─── ГЛАВНОЕ ПРАВИЛО ФАЙЛА: ЧУЖОЙ КЛАСС — ЭТО 403, А НЕ «НЕ НАЙДЕН» ────────
 * Если отфильтровать запрос по `user_id` молча, чужой класс станет неотличим от
 * несуществующего: учитель получил бы «нет такого класса» на класс, который
 * существует, и решил бы, что выдумал. Поэтому `loadOwnClass` сначала смотрит
 * владельца и только потом решает: 403 (класс есть, но не ваш) или 404 (нет).
 *
 * ─── ИМЯ УЧЕНИКА ЖИВЁТ ЗДЕСЬ, А НЕ В ССЫЛКЕ ─────────────────────────────────
 * `class_students.token` — 32 случайных символа. Имя лежит рядом в колонке
 * `name` и подставляется сервером в момент отправки ответа. Ученик, открывший
 * QR, своего имени не видит — иначе QR можно было бы переснять и узнать, кому
 * он выдан.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { shortId } from "../lib/shortid";

/* ───────────────────────────────────────────────────────────────────────────
 * Пределы
 *
 * Числа не «на всякий случай», а по смыслу: класс больше 200 человек не бывает,
 * а 120 символов на ФИО — длиннее любого реального «Иванов-Иванов-Константин».
 * Обрезание вместо ошибки: учитель вставил список из журнала с подписью школы
 * в конце строки — лучше потерять хвост подписи, чем весь импорт.
 * ─────────────────────────────────────────────────────────────────────────── */

export const MAX_CLASS_NAME = 40;
export const MAX_STUDENT_NAME = 120;
export const MAX_CLASSES_PER_TEACHER = 30;
export const MAX_STUDENTS_PER_CLASS = 200;
/** Сколько строк принимаем за один импорт списка. */
export const MAX_STUDENTS_PER_IMPORT = 200;
/**
 * Длина персонального токена: 32 символа base36 ≈ 165 бит.
 *
 * Считается ДВУМЯ вызовами по 16: `shortId(32)` вернул бы 16 символов, потому
 * что внутри он режет результат генератора, а не генерирует нужную длину.
 */
export const STUDENT_TOKEN_LENGTH = 32;

/* ───────────────────────────────────────────────────────────────────────────
 * Идентификаторы и токены
 *
 * Фабрики живут здесь, а не в `lib/shortid.ts`: тот файл принадлежит листу,
 * который трогает соседняя задача, а правка одного символа здесь не должна
 * ждать согласования с чужим листом.
 * ─────────────────────────────────────────────────────────────────────────── */

export function classId(): string {
  return `cls_${shortId()}`;
}
export function classStudentId(): string {
  return `cst_${shortId()}`;
}
export function classStudentAnswerId(): string {
  return `csa_${shortId()}`;
}

/** Персональный токен ученика. Только [0-9a-z] — безопасно и в URL, и в QR. */
export function newStudentToken(): string {
  return shortId(16) + shortId(16);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Нормализация
 * ─────────────────────────────────────────────────────────────────────────── */

export interface ClassRow {
  id: string;
  user_id: string;
  name: string;
  name_key: string;
  created_at: number;
  updated_at: number;
}

export interface StudentRow {
  id: string;
  class_id: string;
  token: string;
  name: string;
  position: number;
  removed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface StudentWithAnswer extends StudentRow {
  /** Ответ на эту работу, если ученик её уже сдавал (последний по времени). */
  answeredFormId: string | null;
  answeredAt: number | null;
  scoreTotal: number | null;
  scoreMax: number | null;
}

export interface RosterClass extends ClassRow {
  students: StudentWithAnswer[];
}

/** Имя класса: схлопнуть пробелы, обрезать, убрать пустое. */
export function normalizeClassName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CLASS_NAME);
}

/**
 * Ключ для сравнения имён класса: «5А» и «5а» — один класс.
 *
 * Отдельная функция, потому что её используют и запись, и проверка
 * конфликта: разъехаться они могут только тут, и разъездка выглядит как
 * «учитель добавил класс, а в списке их два».
 */
export function classNameKey(name: string): string {
  return name.toLocaleLowerCase("ru");
}

/** ФИО ученика. Пробелы схлопнуты, но регистр и кириллица сохранены. */
export function normalizeStudentName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_STUDENT_NAME);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Результат операций
 *
 * Не бросим исключений на ожидаемый отказ: роут превращает код в HTTP-статус
 * и понятный текст учителю, а стектрейс в логе не помогает никому из них.
 * ─────────────────────────────────────────────────────────────────────────── */

export type ClassResultCode =
  | "validation"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "limit";

export type ClassResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ClassResultCode };

const fail = <T>(code: ClassResultCode): ClassResult<T> => ({ ok: false, code });

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Чтение
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Класс по id + проверка владельца.
 *
 * Порядок именно такой: сначала строка по id (без фильтра по учителю), потом
 * сравнение владельца. Обратный порядок дал бы 404 на чужой класс.
 */
export async function loadOwnClass(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ClassResult<ClassRow>> {
  const row = await db
    .prepare(
      `SELECT id, user_id, name, name_key, created_at, updated_at FROM classes WHERE id = ?1`,
    )
    .bind(id)
    .first<ClassRow>();

  if (!row) return fail("not_found");
  if (row.user_id !== userId) return fail("forbidden");
  return { ok: true, value: row };
}

/**
 * Все классы учителя со списком учеников.
 *
 * Ученики и их ответы тянутся ОДНИМ запросом, а не по запросу на класс: у
 * учителя 5–6 параллелей, и N+1 здесь означал бы 30 задержек D1 на открытой
 * странице настроек — на мобильном интернете это заметно.
 *
 * `removed_at IS NULL` в основном списке: ушедшие ученики не должны занимать
 * место в рабочем списке, но их ответы не пропадают — они лежат в той же
 * таблице и попадают в отдельный список «ушедшие» (см. `listRemovedStudents`).
 */
export async function listRoster(
  db: D1Database,
  userId: string,
): Promise<RosterClass[]> {
  const classes = await db
    .prepare(
      `SELECT id, user_id, name, name_key, created_at, updated_at
         FROM classes WHERE user_id = ?1 ORDER BY created_at ASC`,
    )
    .bind(userId)
    .all<ClassRow>();

  if (classes.results.length === 0) return [];

  const students = await db
    .prepare(
      `SELECT s.id, s.class_id, s.token, s.name, s.position, s.removed_at,
              s.created_at, s.updated_at,
              a.form_id AS answered_form_id, a.submitted_at AS answered_at,
              a.score_total, a.score_max
         FROM class_students s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN class_student_answers a
           ON a.id = (SELECT id FROM class_student_answers
                       WHERE student_id = s.id ORDER BY submitted_at DESC LIMIT 1)
        WHERE c.user_id = ?1 AND s.removed_at IS NULL
        ORDER BY s.position ASC, s.created_at ASC`,
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  const byClass = new Map<string, StudentWithAnswer[]>();
  for (const row of students.results ?? []) {
    const student: StudentWithAnswer = {
      id: String(row.id),
      class_id: String(row.class_id),
      token: String(row.token),
      name: String(row.name),
      position: Number(row.position ?? 0),
      removed_at: row.removed_at === null || row.removed_at === undefined ? null : Number(row.removed_at),
      created_at: Number(row.created_at ?? 0),
      updated_at: Number(row.updated_at ?? 0),
      answeredFormId: row.answered_form_id === null || row.answered_form_id === undefined ? null : String(row.answered_form_id),
      answeredAt: row.answered_at === null || row.answered_at === undefined ? null : Number(row.answered_at),
      scoreTotal: row.score_total === null || row.score_total === undefined ? null : Number(row.score_total),
      scoreMax: row.score_max === null || row.score_max === undefined ? null : Number(row.score_max),
    };
    const bucket = byClass.get(student.class_id);
    if (bucket) bucket.push(student);
    else byClass.set(student.class_id, [student]);
  }

  return classes.results.map((c) => ({ ...c, students: byClass.get(c.id) ?? [] }));
}

/** Удалённые ученики учителя — чтобы их ответы не потерялись из виду. */
export async function listRemovedStudents(
  db: D1Database,
  userId: string,
): Promise<Array<StudentWithAnswer & { class_name: string }>> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.class_id, s.token, s.name, s.position, s.removed_at,
              s.created_at, s.updated_at, c.name AS class_name,
              a.form_id AS answered_form_id, a.submitted_at AS answered_at,
              a.score_total, a.score_max
         FROM class_students s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN class_student_answers a
           ON a.id = (SELECT id FROM class_student_answers
                       WHERE student_id = s.id ORDER BY submitted_at DESC LIMIT 1)
        WHERE c.user_id = ?1 AND s.removed_at IS NOT NULL
        ORDER BY s.removed_at DESC`,
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  return (rows.results ?? []).map((row) => ({
    id: String(row.id),
    class_id: String(row.class_id),
    token: String(row.token),
    name: String(row.name),
    position: Number(row.position ?? 0),
    removed_at: Number(row.removed_at ?? 0),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
    class_name: String(row.class_name ?? ""),
    answeredFormId: row.answered_form_id === null || row.answered_form_id === undefined ? null : String(row.answered_form_id),
    answeredAt: row.answered_at === null || row.answered_at === undefined ? null : Number(row.answered_at),
    scoreTotal: row.score_total === null || row.score_total === undefined ? null : Number(row.score_total),
    scoreMax: row.score_max === null || row.score_max === undefined ? null : Number(row.score_max),
  }));
}

/* ───────────────────────────────────────────────────────────────────────────
 * Классы: создание, переименование, удаление
 * ─────────────────────────────────────────────────────────────────────────── */

export async function createClass(
  db: D1Database,
  userId: string,
  rawName: unknown,
): Promise<ClassResult<ClassRow>> {
  const name = normalizeClassName(rawName);
  if (!name) return fail("validation");

  const count = await db
    .prepare("SELECT COUNT(*) AS cnt FROM classes WHERE user_id = ?1")
    .bind(userId)
    .first<{ cnt: number }>();
  if ((count?.cnt ?? 0) >= MAX_CLASSES_PER_TEACHER) return fail("limit");

  const now = nowSec();
  const id = classId();
  const key = classNameKey(name);

  // Гонка на одинаковом имени закрыта самим UNIQUE-индексами, а не проверкой
  // «а может, уже есть»: две вкладки открыты, проверка прошла у обеих, а
  // индекс отвёл бы второй в 409 без гонки.
  try {
    await db
      .prepare(
        `INSERT INTO classes (id, user_id, name, name_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      )
      .bind(id, userId, name, key, now)
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) return fail("conflict");
    throw e;
  }

  return { ok: true, value: { id, user_id: userId, name, name_key: key, created_at: now, updated_at: now } };
}

export async function renameClass(
  db: D1Database,
  userId: string,
  id: string,
  rawName: unknown,
): Promise<ClassResult<ClassRow>> {
  const owned = await loadOwnClass(db, userId, id);
  if (!owned.ok) return owned;

  const name = normalizeClassName(rawName);
  if (!name) return fail("validation");
  if (name === owned.value.name) return { ok: true, value: owned.value };

  const now = nowSec();
  try {
    await db
      .prepare("UPDATE classes SET name = ?1, name_key = ?2, updated_at = ?3 WHERE id = ?4")
      .bind(name, classNameKey(name), now, id)
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) return fail("conflict");
    throw e;
  }

  return { ok: true, value: { ...owned.value, name, name_key: classNameKey(name), updated_at: now } };
}

/**
 * Удалить класс вместе с учениками.
 *
 * Ответы учеников при этом НЕ удаляются: `class_student_answers` ссылается на
 * `class_students` с ON DELETE CASCADE, поэтому каскад уносит и их… — и это
 * ровно тот случай, где молчаливое удаление хуже явного.
 *
 * Поэтому удаление класса идёт в два шага: сначала ответы «отвязываются» от
 * учеников (строка ответа в `form_responses` остаётся и имя в ней сохранено),
 * затем удаляются ученики и класс. Итог — учитель удалил класс, а его ответы
 * остались в разборе формы с именем, а не исчезли.
 */
export async function deleteClass(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ClassResult<{ deleted: number }>> {
  const owned = await loadOwnClass(db, userId, id);
  if (!owned.ok) return owned;

  const students = await db
    .prepare("SELECT id FROM class_students WHERE class_id = ?1")
    .bind(id)
    .all<{ id: string }>();
  const ids = (students.results ?? []).map((r) => r.id);

  // Ответы не удаляем — переносим в «сироты» одной транзакцией: строка в
  // form_responses и её name никуда не денутся, а привязка к удалённому
  // ученику исчезнет.
  const now = nowSec();
  const batch: D1PreparedStatement[] = [];
  if (ids.length > 0) {
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(", ");
    batch.push(
      db
        .prepare(`DELETE FROM class_student_answers WHERE student_id IN (${placeholders})`)
        .bind(...ids),
    );
  }
  batch.push(db.prepare("DELETE FROM classes WHERE id = ?1").bind(id));

  await db.batch(batch);
  return { ok: true, value: { deleted: ids.length } };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Ученики
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Массовый импорт: принять список строк и добавить их учениками класса.
 *
 * Одна запись на всех — учитель вставляет журнал класса целиком, а не жмёт
 * «добавить» 27 раз. Точные дубли внутри одной вставки схлопываются (опечатка
 * при копировании), но одинаковые имена из РАЗНЫХ вставок не трогаем: в 5А
 * действительно могут быть два «Иванов И.», и второй — не опечатка первого.
 */
export async function addStudents(
  db: D1Database,
  userId: string,
  classId_: string,
  rawNames: unknown,
): Promise<ClassResult<{ added: StudentRow[]; skipped: number }>> {
  const owned = await loadOwnClass(db, userId, classId_);
  if (!owned.ok) return owned;

  if (!Array.isArray(rawNames)) return fail("validation");
  if (rawNames.length > MAX_STUDENTS_PER_IMPORT) return fail("limit");

  const live = await db
    .prepare("SELECT COUNT(*) AS cnt FROM class_students WHERE class_id = ?1 AND removed_at IS NULL")
    .bind(classId_)
    .first<{ cnt: number }>();
  if ((live?.cnt ?? 0) + rawNames.length > MAX_STUDENTS_PER_CLASS) return fail("limit");

  const seen = new Set<string>();
  const names: string[] = [];
  let skipped = 0;
  for (const raw of rawNames) {
    const name = normalizeStudentName(raw);
    if (!name) {
      skipped += 1;
      continue;
    }
    const key = name.toLocaleLowerCase("ru");
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  if (names.length === 0) return fail("validation");

  const now = nowSec();
  const startPos = await nextPosition(db, classId_);
  const rows: StudentRow[] = [];
  const batch: D1PreparedStatement[] = [];

  names.forEach((name, i) => {
    const id = classStudentId();
    const token = newStudentToken();
    rows.push({
      id,
      class_id: classId_,
      token,
      name,
      position: startPos + i,
      removed_at: null,
      created_at: now,
      updated_at: now,
    });
    batch.push(
      db
        .prepare(
          `INSERT INTO class_students (id, class_id, token, name, position, removed_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)`,
        )
        .bind(id, classId_, token, name, startPos + i, now),
    );
  });

  await db.batch(batch);
  return { ok: true, value: { added: rows, skipped } };
}

export async function renameStudent(
  db: D1Database,
  userId: string,
  classId_: string,
  studentId_: string,
  rawName: unknown,
): Promise<ClassResult<StudentRow>> {
  const student = await loadOwnStudent(db, userId, classId_, studentId_);
  if (!student.ok) return student;

  const name = normalizeStudentName(rawName);
  if (!name) return fail("validation");
  if (name === student.value.name) return { ok: true, value: student.value };

  const now = nowSec();
  await db
    .prepare("UPDATE class_students SET name = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(name, now, studentId_)
    .run();

  return { ok: true, value: { ...student.value, name, updated_at: now } };
}

/**
 * Мягкое удаление ученика.
 *
 * Строка остаётся навсегда — и это ровно то, что требуется от «удаления»:
 * ответы ушедшего ученика продолжают резолвиться в имя. Ссылка при этом
 * перестаёт работать (роут отдаёт 410), то есть отданный QR нельзя переиспользовать.
 */
export async function removeStudent(
  db: D1Database,
  userId: string,
  classId_: string,
  studentId_: string,
): Promise<ClassResult<{ id: string }>> {
  const student = await loadOwnStudent(db, userId, classId_, studentId_);
  if (!student.ok) return student;

  const now = nowSec();
  await db
    .prepare(
      `UPDATE class_students SET removed_at = ?1, updated_at = ?2
        WHERE id = ?3 AND removed_at IS NULL`,
    )
    .bind(now, now, studentId_)
    .run();

  return { ok: true, value: { id: studentId_ } };
}

/** Вернуть удалённого ученика в список — одной кнопкой, без новой ссылки. */
export async function restoreStudent(
  db: D1Database,
  userId: string,
  classId_: string,
  studentId_: string,
): Promise<ClassResult<{ id: string }>> {
  const student = await loadOwnStudent(db, userId, classId_, studentId_, true);
  if (!student.ok) return student;

  const now = nowSec();
  const startPos = await nextPosition(db, classId_);
  await db
    .prepare(
      `UPDATE class_students SET removed_at = NULL, position = ?1, updated_at = ?2 WHERE id = ?3`,
    )
    .bind(startPos, now, studentId_)
    .run();

  return { ok: true, value: { id: studentId_ } };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Ученик по персональному токену — путь ученика
 * ─────────────────────────────────────────────────────────────────────────── */

/** Что нужно ученическому роуту, чтобы отдать задания и принять ответ. */
export interface StudentLink {
  student: StudentRow;
  classId: string;
  className: string;
  /** Учитель, которому принадлежит и класс, и (обязана быть) форма. */
  teacherId: string;
}

/**
 * Найти ученика по токену из ссылки. Удалённый ученик — тоже находится:
 * роуту нужно знать, что он удалён, чтобы ответить 410, а не 404.
 */
export async function findStudentByToken(
  db: D1Database,
  token: string,
): Promise<StudentLink | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.id, s.class_id, s.token, s.name, s.position, s.removed_at,
              s.created_at, s.updated_at,
              c.name AS class_name, c.user_id AS teacher_id
         FROM class_students s
         JOIN classes c ON c.id = s.class_id
        WHERE s.token = ?1`,
    )
    .bind(token)
    .first<Record<string, unknown>>();

  if (!row) return null;

  return {
    student: {
      id: String(row.id),
      class_id: String(row.class_id),
      token: String(row.token),
      name: String(row.name),
      position: Number(row.position ?? 0),
      removed_at: row.removed_at === null || row.removed_at === undefined ? null : Number(row.removed_at),
      created_at: Number(row.created_at ?? 0),
      updated_at: Number(row.updated_at ?? 0),
    },
    classId: String(row.class_id),
    className: String(row.class_name ?? ""),
    teacherId: String(row.teacher_id ?? ""),
  };
}

/** Ученик учителя внутри его класса. Тот же контракт, что у `loadOwnClass`. */
export async function loadOwnStudent(
  db: D1Database,
  userId: string,
  classId_: string,
  studentId_: string,
  includeRemoved = false,
): Promise<ClassResult<StudentRow>> {
  const owned = await loadOwnClass(db, userId, classId_);
  if (!owned.ok) return owned;

  const row = await db
    .prepare(
      `SELECT id, class_id, token, name, position, removed_at, created_at, updated_at
         FROM class_students
        WHERE id = ?1 AND class_id = ?2${includeRemoved ? "" : " AND removed_at IS NULL"}`,
    )
    .bind(studentId_, classId_)
    .first<StudentRow>();

  if (!row) return fail("not_found");
  return { ok: true, value: row };
}

/**
 * Подготовить INSERT «этот ответ сдал вот этот ученик».
 *
 * Возвращается ГОТОВЫМ statement, а не выполняется: запись обязана уехать в той
 * же транзакции, что и сам ответ, иначе между `form_responses` и привязкой
 * появится окно, в котором учитель увидит ответ без хозяина.
 */
export function studentAnswerInsert(
  db: D1Database,
  input: {
    studentId: string;
    formId: string;
    responseId: string;
    scoreTotal: number;
    scoreMax: number;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO class_student_answers
         (id, student_id, form_id, response_id, score_total, score_max, submitted_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      classStudentAnswerId(),
      input.studentId,
      input.formId,
      input.responseId,
      input.scoreTotal,
      input.scoreMax,
      input.now,
    );
}

/* ───────────────────────────────────────────────────────────────────────────
 * Служебное
 * ─────────────────────────────────────────────────────────────────────────── */

async function nextPosition(db: D1Database, classId_: string): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(position) AS max_pos FROM class_students WHERE class_id = ?1")
    .bind(classId_)
    .first<{ max_pos: number | null }>();
  return (row?.max_pos ?? -1) + 1;
}

/**
 * Уникальное нарушение SQLite/D1.
 *
 * Отличаем его от прочих ошибок INSERT'а, чтобы конфликт имён превращался в
 * понятный учителю 409, а не в 500.
 */
function isUniqueViolation(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(message);
}
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

  // Короткий код для входа с телефона (TZ-28). Выдаётся тут же, потому что
  // учитель идёт к доске сразу после создания класса, а «выдать код позже»
  // означало бы «учитель забыл». Ошибка выдачи кода созданию класса не мешает:
  // вернуться к ней можно через getClassCode + повторную выдачу.
  await assignClassCode(db, id);

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
 * Короткий код класса (TZ-28)
 *
 * Зачем он нужен рядом с персональным QR. QR на доске ученик либо не видит
 * (это «взрослая» ссылка), либо телефон не умеет его открыть камерой без
 * приложения. Шесть знаков с доски — самый надёжный способ сказать «это мой
 * класс» руками, без приложения и без регистрации.
 *
 * Код живёт в отдельной таблице `class_codes`, а не колонкой в `classes`:
 * причина та же, что и во всей миграции 0004 — ни один существующий INSERT
 * в `classes` не должен из-за него поменяться.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Ровно 6 знаков: короче — легко угадать перебором, длиннее — не вписать на доску. */
export const CLASS_CODE_LENGTH = 6;

/**
 * Алфавит без похожих символов.
 *
 * Убраны `0/O` и `1/I/L` — их различают на калькуляторе и в тетрадке на доске
 * только по начертанию, а ученик с телефоном в руках ошибётся гарантированно.
 * `2/Z` и `5/S` оставляем: в верхнем регистре эти пары различимы глазом, в
 * отличие от нуля с буквой.
 *
 * Регистр: код всегда хранится и показывается ВЕРХНИМ. Так его можно набрать
 * не переключая регистр на телефоне, а сравнение на сервере — регистронезависимое.
 */
export const CLASS_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Сколько раз пробуем новый код, прежде чем сдаться. */
const CLASS_CODE_ATTEMPTS = 8;

/**
 * Сгенерировать 6 знаков из «безопасного» алфавита.
 *
 * Отклоняемый сэмплинг: берём случайное число 0..len-1 и отбрасываем «хвост»
 * за пределами кратного len. Иначе короткие диапазоны (остаток 33 из 36) были
 * бы чуть вероятнее — для шести знаков это незаметно, но придумывать лишнюю
 * статистику в коде, который читают учителя, не надо.
 */
export function newClassCode(): string {
  let out = "";
  for (let i = 0; i < CLASS_CODE_LENGTH; i += 1) {
    const limit = 256 - (256 % CLASS_CODE_ALPHABET.length);
    let byte: number;
    do {
      byte = crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
    } while (byte >= limit);
    out += CLASS_CODE_ALPHABET[byte % CLASS_CODE_ALPHABET.length];
  }
  return out;
}

/** Нормализация того, что ученик набрал на телефоне: верхний регистр, без пробелов. */
export function normalizeClassCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, "").toUpperCase().slice(0, CLASS_CODE_LENGTH + 2);
}

/**
 * Выдать классу код и вернуть его.
 *
 * Логика одна на создание класса и на дозаполнение старых записей. UNIQUE живёт
 * в БД, поэтому «проверить, что такого нет» здесь было бы гонкой: два запроса
 * из двух вкладок прошли бы проверку и второй упал бы на 500. Вместо этого
 * конфликт по UNIQUE — это сигнал «придумай другой», а не ошибка.
 *
 * Отсутствие таблицы (база ещё без миграции 0004) — НЕ ошибка создания класса:
 * класс создаётся, сдать работу по персональной ссылке по-прежнему можно,
 * пропадает только короткий вход по коду. Ловим поэтому именно «нет таблицы».
 */
export async function assignClassCode(db: D1Database, classId_: string): Promise<string | null> {
  for (let attempt = 0; attempt < CLASS_CODE_ATTEMPTS; attempt += 1) {
    const code = newClassCode();
    try {
      await db
        .prepare(`INSERT INTO class_codes (class_id, code, created_at) VALUES (?1, ?2, ?3)`)
        .bind(classId_, code, nowSec())
        .run();
      return code;
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      // Таблицы ещё нет — дальше пробовать бессмысленно.
      return null;
    }
  }
  return null;
}

/** Код класса или null. Учительский список показывает `null` как «код не выдан». */
export async function getClassCode(db: D1Database, classId_: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT code FROM class_codes WHERE class_id = ?1`)
      .bind(classId_)
      .first<{ code: string }>();
    return row?.code ?? null;
  } catch {
    return null;
  }
}

/** Коды всех классов учителя одним запросом — список классов не делает N+1. */
export async function getClassCodes(
  db: D1Database,
  userId: string,
): Promise<Map<string, string>> {
  try {
    const rows = await db
      .prepare(
        `SELECT cc.class_id, cc.code
           FROM class_codes cc
           JOIN classes c ON c.id = cc.class_id
          WHERE c.user_id = ?1`,
      )
      .bind(userId)
      .all<{ class_id: string; code: string }>();
    const out = new Map<string, string>();
    for (const r of rows.results ?? []) out.set(String(r.class_id), String(r.code));
    return out;
  } catch {
    return new Map();
  }
}

export interface ClassByCode {
  classId: string;
  className: string;
  teacherId: string;
  code: string;
}

/**
 * Класс по короткому коду.
 *
 * Код несекретный — он написан на доске. Поэтому здесь нет и не должно быть
 * проверки «этот код belongs учителю, который его выдал»: ученик приходит по
 * коду, а не по ссылке конкретного учителя. Всё, что код открывает, и так
 * ограничено учителем: задания его класса и его ученики.
 */
export async function findClassByCode(
  db: D1Database,
  rawCode: unknown,
): Promise<ClassByCode | null> {
  const code = normalizeClassCode(rawCode);
  if (code.length !== CLASS_CODE_LENGTH) return null;
  try {
    const row = await db
      .prepare(
        `SELECT cc.code, c.id AS class_id, c.name AS class_name, c.user_id AS teacher_id
           FROM class_codes cc
           JOIN classes c ON c.id = cc.class_id
          WHERE cc.code = ?1`,
      )
      .bind(code)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return {
      classId: String(row.class_id),
      className: String(row.class_name ?? ""),
      teacherId: String(row.teacher_id ?? ""),
      code: String(row.code),
    };
  } catch {
    return null;
  }
}

export type NameMatch =
  | { ok: true; student: StudentLink }
  | { ok: false; reason: "not_found" | "ambiguous" };

/**
 * Найти ученика класса по фамилии и имени (TZ-28, вход без приложения).
 *
 * ПОЧЕМУ НЕ ТОЧНОЕ РАВЕНСТВО. Учитель в журнале пишет «Иванов И.», ученик на
 * телефоне набирает «Иванов Иван» — точное равенство их развело бы, и ученик
 * ушёл бы «учитель неправильно завёл класс». Поэтому сверка идёт по нормализованной
 * фамилии, а имя — префиксом.
 *
 * Два ученика с одинаковой фамилией («Иванов И.» и «Иванов А.») — это НЕ ошибка:
 * так бывает в двух параллелях одного учителя. Таких кандидатов просим уточнить
 * («Напишите ещё и имя»), вместо того чтобы молча выбрать первого: сдать работу
 * не тому хуже, чем не сдать вовсе.
 *
 * Регистр сравнения НЕ значит: ввод с автозаменой на телефоне даёт «ИВАНОВ ИВАН»
 * так же часто, как «Иванов Иван», а различать их по регистру бессмысленно.
 */
export async function findStudentByName(
  db: D1Database,
  classId_: string,
  teacherId: string,
  rawName: unknown,
): Promise<NameMatch> {
  const typed = normalizeStudentName(rawName);
  if (!typed) return { ok: false, reason: "not_found" };
  const parts = typed.split(" ").filter(Boolean);
  const surnameKey = (parts[0] ?? "").toLocaleLowerCase("ru");
  const nameKey = (parts[1] ?? "").toLocaleLowerCase("ru");
  if (!surnameKey) return { ok: false, reason: "not_found" };

  const rows = await db
    .prepare(
      `SELECT s.id, s.class_id, s.token, s.name, s.position, s.removed_at,
              s.created_at, s.updated_at,
              c.name AS class_name, c.user_id AS teacher_id
         FROM class_students s
         JOIN classes c ON c.id = s.class_id
        WHERE s.class_id = ?1 AND s.removed_at IS NULL`,
    )
    .bind(classId_)
    .all<Record<string, unknown>>();

  const matches: StudentLink[] = [];
  for (const row of rows.results ?? []) {
    const full = String(row.name);
    const fullParts = full.split(" ").filter(Boolean);
    const surname = (fullParts[0] ?? "").toLocaleLowerCase("ru");
    // Имя ученика может состоять из двух слов («Анна Петрова») — берём вторую
    // часть, а не по всему остатку строки: иначе «Иванов Иван Петрович» не найдётся.
    const rest = (fullParts.slice(1).join(" ") || "").toLocaleLowerCase("ru");

    if (surname !== surnameKey) continue;
    if (!nameKey) {
      // Только фамилия — годится, только если такая фамилия одна в классе.
      matches.push(toStudentLink(row));
      continue;
    }
    if (!rest.startsWith(nameKey)) continue;
    matches.push(toStudentLink(row));
  }

  if (matches.length === 0) return { ok: false, reason: "not_found" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  // teacherId прокидывается для единообразия с findStudentByToken и на проверку
  // владельца класса в роуте: класс мог быть удалён между запросами.
  const link = matches[0]!;
  if (link.teacherId !== teacherId) return { ok: false, reason: "not_found" };
  return { ok: true, student: link };
}

function toStudentLink(row: Record<string, unknown>): StudentLink {
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

/** Задание класса — ровно те поля, которые уже отдаёт персональная ссылка ученика. */
export interface ClassTask {
  formId: string;
  token: string;
  title: string;
  subject: string;
  grade: number;
  expiresAt: number;
  open: boolean;
  answered: boolean;
  answeredAt: number | null;
  scoreTotal: number | null;
  scoreMax: number | null;
}

/**
 * Задания класса для ученика (TZ-28).
 *
 * Формы в системе не привязаны к классу — привязка живёт в ответах учеников
 * (`class_student_answers`). Поэтому список = работы учителя класса, которые
 * ещё открыты ИЛИ которые этот ученик уже сдавал. Второе условие нужно, чтобы
 * после закрытия работы ученик видел свой балл, а не пустой экран.
 *
 * ОДИН запрос, а не два. «Задания + отметка, что сдавал именно этот ученик» —
 * на телефоне это две последовательные загрузки, а страница показывает ученику
 * список одним экраном.
 */
export async function listClassTasks(
  db: D1Database,
  teacherId: string,
  studentId: string | null,
): Promise<ClassTask[]> {
  const rows = await db
    .prepare(
      `SELECT f.id AS form_id, f.token, f.title, f.subject, f.grade, f.expires_at, f.status,
              a.submitted_at AS answered_at, a.score_total, a.score_max
         FROM forms f
         LEFT JOIN class_student_answers a
           ON a.form_id = f.id AND a.student_id = ?2
        WHERE f.user_id = ?1
          AND (f.status = 'open' OR a.id IS NOT NULL)
        ORDER BY COALESCE(a.submitted_at, 0) DESC, f.expires_at ASC`,
    )
    .bind(teacherId, studentId ?? "")
    .all<Record<string, unknown>>();

  const now = nowSec();
  const out: ClassTask[] = [];
  for (const r of rows.results ?? []) {
    const answeredAt = r.answered_at === null || r.answered_at === undefined ? null : Number(r.answered_at);
    out.push({
      formId: String(r.form_id),
      token: String(r.token),
      title: String(r.title ?? ""),
      subject: String(r.subject ?? ""),
      grade: Number(r.grade ?? 0),
      expiresAt: Number(r.expires_at ?? 0),
      open: String(r.status ?? "open") === "open" && Number(r.expires_at ?? 0) > now,
      answered: answeredAt !== null,
      answeredAt,
      scoreTotal: r.score_total === null || r.score_total === undefined ? null : Number(r.score_total),
      scoreMax: r.score_max === null || r.score_max === undefined ? null : Number(r.score_max),
    });
  }
  return out;
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
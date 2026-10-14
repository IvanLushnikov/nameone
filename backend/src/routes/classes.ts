/**
 * Классы, ученики и персональные ссылки (лист 3.1.1).
 *
 *   Учитель (с входом):
 *     GET    /api/classes                          — свои классы и ученики
 *     POST   /api/classes                          — завести класс
 *     PATCH  /api/classes/:id                      — переименовать
 *     DELETE /api/classes/:id                      — удалить класс (ответы остаются)
 *     POST   /api/classes/:id/students             — добавить ученика или список
 *     PATCH  /api/classes/:id/students/:sid        — переименовать ученика
 *     DELETE /api/classes/:id/students/:sid        — убрать ученика (мягко)
 *     POST   /api/classes/:id/students/:sid/restore — вернуть ученика
 *
 *   Сводка и ведомость по классу (лист 3.1.3):
 *     GET    /api/classes/:id/report     — сколько сдали, кто ждёт, какие отметки
 *     GET    /api/classes/:id/report.csv — та же ведомость файлом для Excel
 *
 *   Ученик (без входа, по своей ссылке):
 *     GET  /api/public/class-links/:st/forms/:t          — задания
 *     POST /api/public/class-links/:st/forms/:t/submit   — ответить
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ВТОРОЙ ПУБЛИЧНЫЙ ЭНДПОИНТ, А НЕ ПАРАМЕТР В СУЩЕСТВУЮЩЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * Обычная ссылка `/form/?t=<токен формы>` общая у всего класса: ученик вводит
 * имя руками, и отнести ответ к ребёнку можно только по тому, как он это имя
 * написал. Персональная ссылка добавляет `st=<токен ученика>`, и тогда имя
 * подставляет СЕРВЕР — ученик его не знает и не может ошибиться.
 *
 * Подставить имя на сервере можно было только новым путём отправки: старый
 * `publicForms.ts` принимает `studentName` из тела и не знает про учеников.
 * Поэтому здесь свой эндпоинт с ТЕМ ЖЕ контрактом ответа, чтобы страница
 * ученика не отличалась для учителя с учениками и без.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЛИМИТЫ ОТПРАВКИ — НЕ МЕНЯЕМ, А ИСПОЛЬЗУЕМ ТЕ ЖЕ БАКИ ──────────────────────
 * Здесь стоят ровно те же 60/час на пару «форма + IP» и 200/час на IP, что и
 * в `publicForms.ts`, и — важнее — с ТЕМИ ЖЕ `bucket` и ТЕМ ЖЕ ключом. Класс
 * из 30 человек сидит на одном школьном Wi-Fi, поэтому бюджет должен быть
 * общим: персональная ссылка и обычная тратят один и тот же лимит. Новый
 * endpoint не должен стать вторым карманом, из которого можно слать
 * бесконечно.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv, WorksheetTask } from "../types";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware, djb2 } from "../middleware/ratelimit";
import { throwApiError } from "../lib/errors";
import { answerId as makeAnswerId, responseId as makeResponseId } from "../lib/shortid";
import { gradeSubmission, parseCheckMeta, type StudentValue } from "../services/formGrading";
import {
  MAX_STUDENTS_PER_IMPORT,
  addStudents,
  createClass,
  deleteClass,
  findStudentByToken,
  listRemovedStudents,
  listRoster,
  loadOwnClass,
  studentAnswerInsert,
  removeStudent,
  renameClass,
  renameStudent,
  restoreStudent,
  type ClassResultCode,
  type StudentLink,
} from "../db/classes";

const classesRouter = new Hono<AppEnv>();
const publicClassLinksRouter = new Hono<AppEnv>();

/* ═══════════════════════════════════════════════════════════════════════════
 * УЧИТЕЛЬСКИЕ МАРШРУТЫ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Код отказа → HTTP-статус и текст.
 *
 * Всегда бросает, поэтому объявлен как `never`: вызывающий код после
 * `if (!result.ok) fail(result)` сужает тип до успешного и не проверяет зря.
 */
function fail(result: { code: ClassResultCode }): never {
  switch (result.code) {
    case "validation":
      throwApiError(400, "VALIDATION_ERROR", "Проверьте название — пустым или слишком длинным быть нельзя");
    case "forbidden":
      // Ключевой случай листа: чужой класс — ОТКАЗ, а не «не найдено».
      throwApiError(403, "CLASS_FORBIDDEN", "Это класс другого учителя");
    case "conflict":
      throwApiError(409, "CLASS_EXISTS", "Класс с таким названием у вас уже есть");
    case "limit":
      throwApiError(409, "CLASS_LIMIT", "Слишком много классов или учеников — уменьшите список");
    default:
      throwApiError(404, "CLASS_NOT_FOUND", "Класса нет");
  }
}

/** Прочитать JSON-тело и отдать 400 вместо исключения zod наружу. */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throwApiError(400, "BAD_REQUEST", "Не удалось прочитать запрос");
  }
}

/** Имя класса или ученика. Потолок в zod — 200, реальные линейки режет слой данных. */
const NameBody = z.object({ name: z.string().min(1).max(200) });

const StudentsBody = z.union([
  z.object({ name: z.string().min(1).max(200) }),
  // Массовый импорт: учитель вставляет список из журнала целиком.
  z.object({ names: z.array(z.string().min(1).max(200)).min(1).max(MAX_STUDENTS_PER_IMPORT) }),
]);

classesRouter.get("/", async (c) => {
  const user = requireAuth(c);
  const [classes, removed] = await Promise.all([
    listRoster(c.env.DB, user.id),
    listRemovedStudents(c.env.DB, user.id),
  ]);

  return c.json({
    ok: true,
    // Плоский список классов со вложенными учениками: фронту нужен ровно он,
    // а ещё один уровень обёртки («roster: {classes}») здесь был бы лишним.
    classes: classes.map((cl) => ({
      id: cl.id,
      name: cl.name,
      createdAt: cl.created_at,
      students: cl.students.map(toStudentView),
    })),
    // classId обязателен: восстановить ученика можно только по id класса,
    // а само название класса («5А») для этого не годится.
    removedStudents: removed.map((s) => ({
      ...toStudentView(s),
      classId: s.class_id,
      className: s.class_name,
    })),
  });
});

classesRouter.post("/", async (c) => {
  const user = requireAuth(c);
  const body = NameBody.parse(await readJson(c));
  const result = await createClass(c.env.DB, user.id, body.name);
  if (!result.ok) fail(result);

  return c.json(
    { ok: true, class: { id: result.value.id, name: result.value.name, createdAt: result.value.created_at, students: [] } },
    201,
  );
});

classesRouter.patch("/:id", async (c) => {
  const user = requireAuth(c);
  const body = NameBody.parse(await readJson(c));
  const result = await renameClass(c.env.DB, user.id, c.req.param("id"), body.name);
  if (!result.ok) fail(result);

  return c.json({ ok: true, class: { id: result.value.id, name: result.value.name } });
});

classesRouter.delete("/:id", async (c) => {
  const user = requireAuth(c);
  const result = await deleteClass(c.env.DB, user.id, c.req.param("id"));
  if (!result.ok) fail(result);

  return c.json({ ok: true, removedStudents: result.value.deleted });
});

classesRouter.post("/:id/students", async (c) => {
  const user = requireAuth(c);
  const raw = await readJson(c);
  const body = StudentsBody.parse(raw);
  const names = "names" in body ? body.names : [body.name];

  const result = await addStudents(c.env.DB, user.id, c.req.param("id"), names);
  if (!result.ok) fail(result);

  return c.json(
    {
      ok: true,
      students: result.value.added.map(toStudentView),
      // Сколько строк пропущено (пустые или повторяющиеся) — учитель должен
      // знать, что список сохранился не полностью, а не обнаружить это на уроке.
      skipped: result.value.skipped,
    },
    201,
  );
});

classesRouter.patch("/:id/students/:sid", async (c) => {
  const user = requireAuth(c);
  const body = NameBody.parse(await readJson(c));
  const result = await renameStudent(c.env.DB, user.id, c.req.param("id"), c.req.param("sid"), body.name);
  if (!result.ok) fail(result);

  return c.json({ ok: true, student: toStudentView(result.value) });
});

classesRouter.delete("/:id/students/:sid", async (c) => {
  const user = requireAuth(c);
  const result = await removeStudent(c.env.DB, user.id, c.req.param("id"), c.req.param("sid"));
  if (!result.ok) fail(result);

  return c.json({ ok: true });
});

classesRouter.post("/:id/students/:sid/restore", async (c) => {
  const user = requireAuth(c);
  const result = await restoreStudent(c.env.DB, user.id, c.req.param("id"), c.req.param("sid"));
  if (!result.ok) fail(result);

  return c.json({ ok: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ВЕДОМОСТЬ ПО КЛАССУ (лист 3.1.3)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ─── Почему SQL здесь, а не в db/classes.ts ─────────────────────────────────
 * Лист 3.1.3 не владеет `src/db/**` — этот слой занят другой работой. Поэтому
 * три запроса сводки живут здесь, рядом с единственным местом, где уже доказано
 * правило «чужой класс — 403». Когда `db/classes.ts` освободится, их правильно
 * перенести туда; сейчас дублировать наружу правило владения нельзя.
 */

/** Сколько работ попадает в ведомость по одному классу. */
const MAX_REPORT_WORKS = 12;

/**
 * Порция связанных параметров в один запрос.
 *
 * D1 ограничивает число `?` примерно сотней на запрос. Класс из 30 человек и
 * 12 работ дают 30–42 ответа — впритык; режем на 50, чтобы заведомо не упасть
 * на 500 у большого класса.
 */
const MAX_BOUND_PARAMS = 50;

/** Работа (столбец ведомости) в том виде, в каком её читает этот файл. */
interface ReportWorkRow {
  id: string;
  title: string;
  subject: string;
  grade: number;
  status: string;
  created_at: number;
  expires_at: number;
}

/**
 * Источник отметки по одной сданной работе.
 *
 * `model` и `teacher` — РАЗНЫЕ значения, и это смысл всего типа: «верно» от
 * машины и «верно» от учителя не должны сливаться в одно число. `teacher_with_model`
 * означает «учитель посмотрел и поправил часть ответов» — там слово «поправил»
 * честнее, чем «поставил».
 */
type ReportSource = "teacher" | "teacher_with_model" | "model" | "auto" | "none";

interface ReportWork {
  id: string;
  title: string;
  subject: string;
  grade: number;
  /**
   * Работу ещё можно сдать: статус открыт И срок не вышел.
   *
   * Одного `status = 'open'` мало: срок ссылки истекает сам, а статус остаётся
   * «открыта» навсегда. Написать «ещё открыта» по истёкшей ссылке — значит
   * показать учителю «не сдал» как окончательный приговор по работе, куда
   * уже нельзя сдать.
   */
  isOpen: boolean;
  createdAt: number;
}

/** Одна сданная работа в ведомости. */
interface ReportCell {
  formId: string;
  responseId: string;
  score: number;
  max: number;
  submittedAt: number;
  source: ReportSource;
  /** Сколько заданий по этой работе ждут учителя. */
  pendingTasks: number;
  /** Сколько заданий оценила машина. */
  modelTasks: number;
  /** Сколько заданий оценил учитель. */
  teacherTasks: number;
  /** Сколько заданий посчитано без модели (число, вариант). */
  autoTasks: number;
  /** Машина оценила, учитель не подтвердил: его оценкой это НЕ считается. */
  unconfirmedByTeacher: boolean;
}

interface ReportStudent {
  id: string;
  name: string;
  /** Сданные работы этого ученика. У кого их нет — тот «не сдал». */
  works: ReportCell[];
}

/** Почему ведомость пустая. null — ведомость не пустая. */
type ReportEmptyReason = "no_students" | "no_works" | "no_answers";

interface ClassReportData {
  class: { id: string; name: string };
  works: ReportWork[];
  students: ReportStudent[];
  summary: {
    studentsTotal: number;
    studentsSubmitted: number;
    studentsNotSubmitted: number;
    /** Сколько работ сдано (непустых ячеек) — «сколько сдали», в работах. */
    submittedWorks: number;
    /** Работы, где что-то ждёт учителя. */
    pendingWorks: number;
    /** Работы, где вердикт машины учитель не подтвердил. */
    unconfirmedWorks: number;
    /** Средний процент по сданным работам. null — сдавать было нечего. */
    averagePercent: number | null;
    bySource: Record<ReportSource, number>;
    /**
     * Работы по ОБЩЕЙ ссылке этого класса: ученик представился сам, привязки к
     * ученику нет. Считаем отдельно и говорим о них словами — иначе учитель
     * увидел бы «не сдал» человеку, который работу на самом деле сдал.
     */
    unlinkedAnswers: number;
  };
  /** Сколько работ учителя вообще подошло под этот класс. */
  worksTotal: number;
  /** Показаны не все: колонки обрезаны до MAX_REPORT_WORKS. */
  worksTruncated: boolean;
  emptyReason: ReportEmptyReason | null;
}

/**
 * `?start, ?start+1, …` под количество параметров.
 *
 * `start` обязателен по делу, а не для удобства: нумерованные параметры D1
 * (`?1`, `?2`, …) не переиспользуются, и список из `?1…?N` рядом с уже занятым
 * `?1` даёт не «пустую таблицу», а 500 — «Wrong number of parameter bindings».
 */
function placeholders(count: number, start: number): string {
  return Array.from({ length: count }, (_, i) => `?${start + i}`).join(", ");
}

/**
 * Последний ответ ученика по каждой работе.
 *
 * Ученик может пересдать работу (и сдаёт две разные работы), поэтому в ведомость
 * попадает ПОСЛЕДНИЙ ответ на каждую пару «ученик + работа» — иначе одна и та же
 * работа учитывалась бы дважды и «сдали» считалось бы неверно.
 */
interface ReportAnswerRow {
  student_id: string;
  form_id: string;
  response_id: string;
  score_total: number;
  score_max: number;
  submitted_at: number;
  /**
   * Порядок вставки строки. Нужен, потому что `submitted_at` — с точностью до
   * секунды: две отправки в одну секунду (двойное нажатие «Отправить», два
   * телефона в кармане) дали бы равные таймстемпы, и «какая попытка последняя»
   * решалась бы случайно. Порядок вставки — единственный честный ответ.
   */
  answer_rowid: number;
}

/** Срез по заданиям: чей вердикт и что ещё ждёт учителя. */
interface ReportTaskRow {
  response_id: string;
  needs_review: number;
  check_method: string;
  check_meta_json: string | null;
}

/** Что посчитали по заданиям одной работы. */
interface TaskTally {
  teacherTasks: number;
  modelTasks: number;
  autoTasks: number;
  pendingTasks: number;
}

/**
 * Собрать сводку по классу. Один раз — и для экрана, и для CSV.
 *
 * ПОРЯДОК, КОТОРЫЙ НЕЛЬЗЯ ЛОМАТЬ:
 *   1. ПРОВЕРКА ВЛАДЕНИЯ — самым первым запросом. Чужой класс обязан отказать
 *      ДО того, как хоть одна строка чужих учеников прочитана из базы.
 *   2. Ученики — живой состав класса (удалённые сюда не попадают: их ответы
 *      живут в «ушедших», а ведомость — про текущий класс).
 *   3. Работы — только учителя, и только те, что ещё открыты или куда этот
 *      класс что-то сдавал.
 *   4. Ответы — по работам из п.3, ученикам из п.2.
 */
async function loadClassReport(
  db: D1Database,
  userId: string,
  classId: string,
): Promise<ClassReportData> {
  // Чужой класс — 403 «это класс другого учителя», и никаких данных.
  const owned = await loadOwnClass(db, userId, classId);
  if (!owned.ok) fail(owned);

  // Один «сейчас» на всю сборку: иначе работы, попавшие на границу минуты,
  // могли бы получить разные пометки «ещё открыта» в сводке и в выгрузке.
  const reportNow = Math.floor(Date.now() / 1000);

  const emptyBase = (
    emptyReason: ReportEmptyReason,
    roster: Array<{ id: string; name: string }>,
  ): ClassReportData => ({
    class: { id: owned.value.id, name: owned.value.name },
    works: [],
    students: roster.map((s) => ({ ...s, works: [] })),
    summary: {
      studentsTotal: roster.length,
      studentsSubmitted: 0,
      studentsNotSubmitted: roster.length,
      submittedWorks: 0,
      pendingWorks: 0,
      unconfirmedWorks: 0,
      averagePercent: null,
      bySource: { teacher: 0, teacher_with_model: 0, model: 0, auto: 0, none: 0 },
      unlinkedAnswers: 0,
    },
    worksTotal: 0,
    worksTruncated: false,
    emptyReason,
  });

  const studentRows = await db
    .prepare(
      `SELECT id, name, position FROM class_students
        WHERE class_id = ?1 AND removed_at IS NULL
        ORDER BY position ASC, created_at ASC`,
    )
    .bind(classId)
    .all<{ id: string; name: string; position: number }>();

  // Порядок строк = порядок в списке учителя. Отдельного поля `position` в
  // ответе нет: массив и есть порядок, а второе поле значило бы, что их можно
  // разойтись (клиент взял позицию, забыв про порядок).
  const students = (studentRows.results ?? []).map((s) => ({
    id: String(s.id),
    name: String(s.name),
    works: [] as ReportCell[],
  }));

  // Класс без учеников — не ошибка и не «пустой ноль»: это состояние, в котором
  // учитель ещё не рассылал QR. Отдельная причина пустоты, отдельные слова.
  if (students.length === 0) return emptyBase("no_students", students);

  // Работы: открытые (по ним ещё можно сдать) + те, куда класс уже сдавал.
  // Чужие работы учителя сюда попасть не могут: фильтр по user_id.
  const workRows = await db
    .prepare(
      `SELECT f.id, f.title, f.subject, f.grade, f.status, f.created_at, f.expires_at
         FROM forms f
        WHERE f.user_id = ?1
          AND (f.status = 'open' OR EXISTS (
                 SELECT 1 FROM class_student_answers a
                 JOIN class_students s ON s.id = a.student_id
                WHERE a.form_id = f.id AND s.class_id = ?2))
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT ?3`,
    )
    .bind(userId, classId, MAX_REPORT_WORKS + 1)
    .all<ReportWorkRow>();

  const allWorks = workRows.results ?? [];
  const worksTotalRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM forms f
        WHERE f.user_id = ?1
          AND (f.status = 'open' OR EXISTS (
                 SELECT 1 FROM class_student_answers a
                 JOIN class_students s ON s.id = a.student_id
                WHERE a.form_id = f.id AND s.class_id = ?2))`,
    )
    .bind(userId, classId)
    .first<{ cnt: number }>();

  const worksTotal = Number(worksTotalRow?.cnt ?? 0);
  // Обрезание показываем, а не прячем: молчаливая «полная» ведомость на 12 из 40
  // работ была бы выдумкой, которой учитель поверил бы.
  const worksTruncated = allWorks.length > MAX_REPORT_WORKS;
  // Колонки идут СВЕРАХУ ВНИЗ ПО ВРЕМЕНИ — ведомость читается слева направо как
  // хронология, а не как случайный набор. Обрезается тоже по времени, но
  // остаются СВЕЖИЕ работы: старые уже не ждут учителя.
  const works: ReportWork[] = allWorks
    .slice(0, MAX_REPORT_WORKS)
    .map((w) => ({
      id: String(w.id),
      title: String(w.title),
      subject: String(w.subject),
      grade: Number(w.grade ?? 0),
      isOpen: String(w.status) === "open" && Number(w.expires_at ?? 0) > reportNow,
      createdAt: Number(w.created_at ?? 0),
    }))
    .reverse();

  if (works.length === 0) {
    const empty = emptyBase("no_works", students);
    empty.worksTotal = worksTotal;
    return empty;
  }

  const workIds = works.map((w) => w.id);
  // Список работ идёт ПОСЛЕ ?1 (id класса) — нумерация параметров не начинается заново.
  const workPlaceholders = placeholders(workIds.length, 2);

  const answerRows = await db
    .prepare(
      `SELECT a.student_id, a.form_id, a.response_id, a.score_total, a.score_max,
              a.submitted_at, a.rowid AS answer_rowid
         FROM class_student_answers a
         JOIN class_students s ON s.id = a.student_id
        WHERE s.class_id = ?1
          AND s.removed_at IS NULL
          AND a.form_id IN (${workPlaceholders})
          AND a.submitted_at = (SELECT MAX(b.submitted_at) FROM class_student_answers b
                                 WHERE b.student_id = a.student_id AND b.form_id = a.form_id)`,
    )
    .bind(classId, ...workIds)
    .all<ReportAnswerRow>();

  // Одна и та же секунда у двух пересдач дала бы две строки на одну ячейку.
  // Мержим в JS: побеждает более поздняя отправка, а при равных секундах —
  // более поздняя ВСТАВКА (answer_rowid), а не «какая строка дольше назвалась».
  const latest = new Map<string, ReportAnswerRow>();
  for (const row of answerRows.results ?? []) {
    const key = `${row.student_id}|${row.form_id}`;
    const prev = latest.get(key);
    if (
      !prev ||
      Number(row.submitted_at) > Number(prev.submitted_at) ||
      (Number(row.submitted_at) === Number(prev.submitted_at) &&
        Number(row.answer_rowid) > Number(prev.answer_rowid))
    ) {
      latest.set(key, row);
    }
  }

  // Срез по заданиям: одним запросом на порцию ответов.
  const tallies = new Map<string, TaskTally>();
  const responseIds = Array.from(new Set(Array.from(latest.values()).map((r) => String(r.response_id))));
  for (let i = 0; i < responseIds.length; i += MAX_BOUND_PARAMS) {
    const chunk = responseIds.slice(i, i + MAX_BOUND_PARAMS);
    const taskRows = await db
      .prepare(
        `SELECT response_id, needs_review, check_method, check_meta_json
           FROM form_answers
          WHERE response_id IN (${placeholders(chunk.length, 1)})`,
      )
      .bind(...chunk)
      .all<ReportTaskRow>();

    for (const t of taskRows.results ?? []) {
      const key = String(t.response_id);
      const tally = tallies.get(key) ?? {
        teacherTasks: 0,
        modelTasks: 0,
        autoTasks: 0,
        pendingTasks: 0,
      };
      if (Number(t.needs_review) === 1) tally.pendingTasks += 1;
      // Чей вердикт: единственный источник правды — снимок в check_meta_json
      // (его пишет и сверка моделью, и правка учителя через журнал).
      //
      // `check_method = 'manual'` НЕ означает «учитель поставил». Это значит
      // «это задание должен посмотреть человек» — ровно то состояние, когда
      // учитель ещё не смотрел. Считать его решением учителя было бы тем самым
      // молчаливым слиянием, ради которого этот блок написан: эссе ждёт
      // учителя, а не оценено им.
      const meta = parseCheckMeta(t.check_meta_json);
      const method = String(t.check_method);
      const needsReview = Number(t.needs_review) === 1;
      if (meta.decidedBy === "teacher") {
        tally.teacherTasks += 1;
      } else if (meta.decidedBy === "model") {
        tally.modelTasks += 1;
      } else if (method === "llm") {
        // Машина ответила, а метка `decidedBy` потерялась (старые строки).
        // Отметка машины без подтверждения — всё равно не отметка учителя.
        tally.modelTasks += 1;
      } else if (method === "auto") {
        tally.autoTasks += 1;
      } else if (!needsReview) {
        // Ручное задание, записанное без решения: ждёт учителя, а не оценено.
        tally.pendingTasks += 1;
      }
      tallies.set(key, tally);
    }
  }

  const EMPTY_TALLY: TaskTally = {
    teacherTasks: 0,
    modelTasks: 0,
    autoTasks: 0,
    pendingTasks: 0,
  };

  const cellsByStudent = new Map<string, ReportCell[]>(students.map((s) => [s.id, s.works]));
  const cells: ReportCell[] = [];
  for (const row of latest.values()) {
    const tally = tallies.get(String(row.response_id)) ?? EMPTY_TALLY;
    const source: ReportSource =
      tally.teacherTasks > 0
        ? tally.modelTasks > 0
          ? "teacher_with_model"
          : "teacher"
        : tally.modelTasks > 0
          ? "model"
          : tally.autoTasks > 0
            ? "auto"
            : "none";
    const cell: ReportCell = {
      formId: String(row.form_id),
      responseId: String(row.response_id),
      score: Number(row.score_total ?? 0),
      max: Number(row.score_max ?? 0),
      submittedAt: Number(row.submitted_at ?? 0),
      source,
      pendingTasks: tally.pendingTasks,
      modelTasks: tally.modelTasks,
      teacherTasks: tally.teacherTasks,
      autoTasks: tally.autoTasks,
      // Машинный вердикт без единого шага учителя — это НЕ его отметка.
      unconfirmedByTeacher: tally.modelTasks > 0 && tally.teacherTasks === 0,
    };
    cells.push(cell);
    cellsByStudent.get(String(row.student_id))?.push(cell);
  }

  // Работы по общей ссылке: их нельзя отнести к ученику — он сам представился
  // строкой, а не персональным QR. Считаем отдельно и говорим словами.
  const unlinkedRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM form_responses r
        WHERE r.form_id IN (${placeholders(workIds.length, 1)})
          AND NOT EXISTS (SELECT 1 FROM class_student_answers a WHERE a.response_id = r.id)`,
    )
    .bind(...workIds)
    .first<{ cnt: number }>();

  const bySource: Record<ReportSource, number> = {
    teacher: 0,
    teacher_with_model: 0,
    model: 0,
    auto: 0,
    none: 0,
  };
  let submittedWorks = 0;
  let pendingWorks = 0;
  let unconfirmedWorks = 0;
  let percentSum = 0;
  let percentCount = 0;
  for (const cell of cells) {
    bySource[cell.source] += 1;
    submittedWorks += 1;
    if (cell.pendingTasks > 0) pendingWorks += 1;
    if (cell.unconfirmedByTeacher) unconfirmedWorks += 1;
    if (cell.max > 0) {
      percentSum += (cell.score / cell.max) * 100;
      percentCount += 1;
    }
  }

  const studentsSubmitted = students.filter((s) => s.works.length > 0).length;

  return {
    class: { id: owned.value.id, name: owned.value.name },
    works,
    students,
    summary: {
      studentsTotal: students.length,
      studentsSubmitted,
      studentsNotSubmitted: students.length - studentsSubmitted,
      submittedWorks,
      pendingWorks,
      unconfirmedWorks,
      // null, а не 0: «среднего нет» и «средний ноль» — разные вещи.
      averagePercent: percentCount > 0 ? Math.round(percentSum / percentCount) : null,
      bySource,
      unlinkedAnswers: Number(unlinkedRow?.cnt ?? 0),
    },
    worksTotal,
    worksTruncated,
    emptyReason: submittedWorks === 0 ? "no_answers" : null,
  };
}

/** GET /api/classes/:id/report — сводка по классу для экрана. */
classesRouter.get("/:id/report", async (c) => {
  const user = requireAuth(c);
  const report = await loadClassReport(c.env.DB, user.id, c.req.param("id"));

  return c.json({ ok: true, report });
});

/**
 * Экранирование значения для CSV: разделитель `;`, кавычки, переводы строк.
 *
 * Запятая в фамилии («Иванов, Иван») портит файл только при разделителе-запятой;
 * у нас разделитель `;`, поэтому запятая безопасна. Но `;` и кавычки в имени
 * класса или в комментарии — уже портят, поэтому экранируем.
 */
function reportCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[";\r\n]/u.test(text)) return `"${text.replace(/"/gu, '""')}"`;
  return text;
}

/**
 * Пометка состояния работы в шапке ведомости.
 *
 * «не сдал» по открытой работе — ещё не приговор, а по истёкшей — приговор.
 * Учитель обязан различать эти два случая, иначе он упрекает ребёнка за то,
 * что сдать уже было нельзя.
 */
function workMark(work: ReportWork): string {
  if (work.isOpen) return ", ещё открыта";
  return "";
}

/** Слово про источник отметки — одинаковое на экране и в выгрузке. */
function reportSourceWord(cell: ReportCell): string {
  switch (cell.source) {
    case "teacher":
      return "отметка учителя";
    case "teacher_with_model":
      return "учитель поправил ИИ";
    case "model":
      return "вердикт ИИ, не подтверждён учителем";
    case "auto":
      return "посчитали сами";
    default:
      return "без отметки";
  }
}

/**
 * Ведомость одной строкой на ученика.
 *
 * Ученик без ответов ТОЖЕ строка — со словом «не сдал». Пустая ячейка выглядела
 * бы как «забыли внести», а не как «работы нет».
 */
function reportCsvCellValue(cell: ReportCell | undefined): string {
  if (!cell) return "не сдал";
  const parts = [cell.max > 0 ? `${cell.score} из ${cell.max}` : `${cell.score}`];
  parts.push(reportSourceWord(cell));
  if (cell.pendingTasks > 0) parts.push(`ждёт вас: ${cell.pendingTasks}`);
  return parts.join(" · ");
}

/**
 * Заголовки ответа с CSV.
 *
 * Имя файла едет ДВАЖДЫ: латиницей для старых браузеров и почты плюс
 * UTF-8-вариантом по RFC 5987 — иначе кириллическое название класса
 * превратилось бы в «report.csv» или в битые символы.
 */
function csvHeaders(className: string, date: string): Record<string, string> {
  const niceName = `Ведомость ${className} ${date}.csv`;
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="vedomost-${date}.csv"; filename*=UTF-8''${encodeURIComponent(niceName)}`,
    "Cache-Control": "no-store",
  };
}

/** Дата для имени файла и шапки: 2026-10-14. */
function isoDate(nowSec: number): string {
  return new Date(nowSec * 1000).toISOString().slice(0, 10);
}

/**
 * GET /api/classes/:id/report.csv — ведомость файлом.
 *
 * Тот же отчёт, что на экране: собираем его ОДНИМ кодом, иначе через месяц
 * ведомость и экран разойдутся, а ведомость уйдёт классному руководителю.
 *
 * Формат — тот же, что у выгрузки по одной форме (`f07.ts`): UTF-8 BOM,
 * разделитель `;`, перевод строки CRLF. Русский Excel открывает такой файл
 * таблицей без «появился мастер импорта» и без кракозябр в ФИО.
 */
classesRouter.get("/:id/report.csv", async (c) => {
  const user = requireAuth(c);
  const report = await loadClassReport(c.env.DB, user.id, c.req.param("id"));
  // Дата одна и та же в шапке и в имени файла: два разных формата дали бы
  // учителю «сформировано 14.10» в файле «2026-10-15».
  const date = isoDate(Math.floor(Date.now() / 1000));

  const head: string[] = [
    // Две шапки сверху — по ним видно, что это ведомость какого класса и когда
    // она выгружена, даже когда файл лежит в почте без письма.
    [`Ведомость класса ${report.class.name}`, `Сформировано ${date}`].map(reportCsvCell).join(";"),
    [
      `Учеников: ${report.summary.studentsTotal}`,
      `Сдали: ${report.summary.studentsSubmitted}`,
      `Не сдали: ${report.summary.studentsNotSubmitted}`,
      `Ждут проверки: ${report.summary.pendingWorks}`,
      `ИИ не подтверждён: ${report.summary.unconfirmedWorks}`,
    ].map(reportCsvCell).join(";"),
  ];

  // Пустой класс или класс без работ — таблицы ещё нет, и выгружать её было бы
  // враньём. Отдаём тот же файл, но с объяснением, что сделать дальше.
  const EMPTY_HINT: Record<"no_students" | "no_works", string> = {
    no_students:
      "В этом классе пока нет учеников. Добавьте список учеников и выдайте каждому свой QR — ведомость заполнится сама.",
    no_works:
      "По этому классу пока нет работ. Выдайте работу по персональной ссылке: как только её сдадут, здесь появятся отметки и список тех, кто ещё не сдал.",
  };

  // Расшифровка едет в том же файле: ведомость уходит классному руководителю,
  // и он не обязан знать наши внутренние слова. Обрезанный список работ тоже
  // расшифровывается прямо здесь — счётчики относятся к показанным работам.
  const legend: string[] = [
    "",
    [
      "Расшифровка:",
      "«не сдал» — по этой работе ответа нет;",
      "«вердикт ИИ, не подтверждён учителем» — машина оценила, учитель оценку не подтвердил;",
      "«учитель поправил ИИ» — учитель посмотрел работу и изменил часть оценок;",
      "«посчитали сами» — ответы проверены без модели;",
      "«ждёт вас: N» — N заданий ждут проверки учителем;",
      "«ИИ не подтвердил» — число работ, где вердикт машины учитель не подтвердил;",
      "«(ещё открыта)» — работу ещё можно сдать, «не сдал» по ней ещё не окончательный.",
      ...(report.worksTruncated
        ? [
            `Показаны последние ${report.works.length} работ из ${report.worksTotal}: счётчики в файле относятся только к показанным работам.`,
          ]
        : []),
    ]
      .map(reportCsvCell)
      .join(";"),
  ];

  // Пустая ветка: таблицы нет — значит, и расшифровывать нечего. Файл состоит
  // из шапки и одной строки «что сделать дальше».
  if (report.emptyReason === "no_students" || report.emptyReason === "no_works") {
    const body = [
      ...head,
      ["", EMPTY_HINT[report.emptyReason]].map(reportCsvCell).join(";"),
    ];
    return new Response(`\uFEFF${body.join("\r\n")}\r\n`, {
      headers: csvHeaders(report.class.name, date),
    });
  }

  // Открытая работа помечена в шапке: «не сдал» по ней ещё не приговор.
  const header = [
    "№",
    "ФИО",
    ...report.works.map((w) => `${w.title} (${w.subject}${workMark(w)})`),
    "Сдал",
    "Ждут проверки",
    "ИИ не подтвердил",
    "Средний %",
  ];
  const lines: string[] = [...head, header.map(reportCsvCell).join(";")];

  for (const [index, student] of report.students.entries()) {
    const byWork = new Map(student.works.map((w) => [w.formId, w]));
    const submittedWorks = student.works.length;
    const pending = student.works.filter((w) => w.pendingTasks > 0).length;
    const unconfirmed = student.works.filter((w) => w.unconfirmedByTeacher).length;
    const scored = student.works.filter((w) => w.max > 0);
    const average = scored.length
      ? Math.round(scored.reduce((sum, w) => sum + (w.score / w.max) * 100, 0) / scored.length)
      : null;

    lines.push(
      [
        index + 1,
        student.name,
        ...report.works.map((w) => reportCsvCellValue(byWork.get(w.id))),
        submittedWorks > 0 ? `да (${submittedWorks} из ${report.works.length})` : "нет",
        pending > 0 ? String(pending) : "0",
        unconfirmed > 0 ? String(unconfirmed) : "0",
        // Пустая ячейка, а не 0: «процента нет» и «ноль процентов» — разное.
        average === null ? "" : `${average}%`,
      ]
        .map(reportCsvCell)
        .join(";"),
    );
  }

  lines.push(...legend);

  // BOM обязателен: без него русский Excel открывает файл как кракозябры.
  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;

  return new Response(csv, { headers: csvHeaders(report.class.name, date) });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ПУТЬ УЧЕНИКА
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Строка формы в том виде, в каком её читает этот файл. */
interface LinkFormRow {
  id: string;
  token: string;
  user_id: string;
  title: string;
  subject: string;
  grade: number;
  payload_json: string;
  status: string;
  access_code: string | null;
  expires_at: number;
  show_answers: number;
}

/** Задание в том виде, в котором его увидит ученик. */
interface LinkPublicTask {
  number: number;
  text: string;
  type: string;
  options?: string[];
  points: number;
}

/**
 * Whitelist полей задания — копия правила из `publicForms.ts`.
 *
 * Здесь нет `...task`: `answer` и `explanation` в этот список не входят и
 * входить не должны. Эталон физически не покидает бэкенд, пока учитель сам
 * не разрешит его показать. Дублирование метода здесь вынужденное — тот файл
 * принадлежит соседнему листу, а правило безопасности дублировать безопаснее,
 * чем импортировать полуприватный хелпер (см. тест S3 в tests/unit/classes.test.ts).
 */
function toPublicTask(task: WorksheetTask): LinkPublicTask {
  return {
    number: task.number,
    text: task.text,
    type: task.type,
    ...(Array.isArray(task.options) && task.options.length > 0 ? { options: task.options } : {}),
    points: task.points,
  };
}

/** Разобрать снимок заданий. Битый payload → пустой список (не 500). */
function parseTasks(payloadJson: string): WorksheetTask[] {
  try {
    const parsed = JSON.parse(payloadJson) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return [];
    return parsed.tasks.filter((t): t is WorksheetTask => typeof t === "object" && t !== null);
  } catch {
    return [];
  }
}

/**
 * Токен формы для ключа лимита.
 *
 * Middleware, зарегистрированный обработчиком роута, может не видеть
 * `c.req.param()` — та же оговорка, что в `publicForms.ts`. Путь здесь
 * `/api/public/class-links/<st>/forms/<t>[/submit]`, поэтому токен формы — это
 * второй с конца сегмент.
 */
function formTokenFromRequest(c: { req: { param(key: string): string | undefined; path: string } }): string {
  const fromParam = c.req.param("t");
  if (fromParam) return fromParam;
  const segments = c.req.path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last === "submit" ? (segments[segments.length - 2] ?? "unknown") : last;
}

/** Те же лимиты, что у общей ссылки: 120/мин на IP. */
const linkGetLimit = rateLimitMiddleware({
  limit: 120,
  windowSec: 60,
  bucket: "form-get",
  keyFn: (c) => `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/**
 * 60/час на ПАРУ «форма + IP» — тот же bucket и тот же ключ, что у общей ссылки.
 * Персональная ссылка не должна быть вторым карманом: иначе класс из 30 человек
 * получил бы вдвое больший бюджет просто потому, что учитель раздал QR.
 */
const linkSubmitLimit = rateLimitMiddleware({
  limit: 60,
  windowSec: 3600,
  bucket: "form-submit",
  keyFn: (c) => `form:${formTokenFromRequest(c)}:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/** Глобальный потолок по IP — 200/час, тот же бакет, что у общей ссылки. */
const linkSubmitIpLimit = rateLimitMiddleware({
  limit: 200,
  windowSec: 3600,
  bucket: "form-submit-ip",
  keyFn: (c) => `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/**
 * Проверить связку «ученик ↔ форма» и отдать форму.
 *
 * Порядок проверок выбран так, чтобы ученик не мог узнать лишнего и не мог
 * получить «пустой ответ» вместо отказа:
 *   1. токен ученика не найден  → 404 (ссылка битая);
 *   2. ученик удалён           → 410 (ссылка отозвана учителем);
 *   3. формы нет               → 404;
 *   4. форма не его учителя    → 403 ОТКАЗ, а не пустой список заданий;
 *   5. форма закрыта/истекла   → 410.
 */
async function loadLinkForm(
  db: D1Database,
  studentToken: string,
  formToken: string,
): Promise<{ link: StudentLink; form: LinkFormRow }> {
  const link = await findStudentByToken(db, studentToken);
  if (!link) {
    throwApiError(404, "STUDENT_LINK_NOT_FOUND", "Ссылка неправильная. Попросите учителя прислать её ещё раз");
  }
  if (link.student.removed_at !== null) {
    throwApiError(410, "STUDENT_REMOVED", "Учитель убрал это задание из класса");
  }

  const form = await db
    .prepare(
      `SELECT id, token, user_id, title, subject, grade, payload_json, status,
              access_code, expires_at, show_answers
         FROM forms WHERE token = ?1`,
    )
    .bind(formToken)
    .first<LinkFormRow>();

  if (!form) {
    throwApiError(404, "FORM_NOT_FOUND", "Задания не найдены. Попросите учителя прислать ссылку ещё раз");
  }

  // Чужая форма по чужой ссылке — отказ. Отдавать «пустые задания» здесь
  // нельзя: ученик решил бы, что QR битый, и пошёл искать учителя, а на самом
  // деле это была чужая параллель.
  if (form.user_id !== link.teacherId) {
    throwApiError(403, "CLASS_LINK_FORBIDDEN", "Это ссылка на чужой класс");
  }

  if (form.status === "closed") throwApiError(410, "FORM_CLOSED", "Форма закрыта учителем");
  if (form.expires_at <= Math.floor(Date.now() / 1000)) {
    throwApiError(410, "FORM_EXPIRED", "Срок ссылки истёк");
  }

  return { link, form };
}

publicClassLinksRouter.get("/:st/forms/:t", linkGetLimit, async (c) => {
  const { form } = await loadLinkForm(c.env.DB, c.req.param("st"), c.req.param("t"));

  const tasks = parseTasks(form.payload_json);

  return c.json({
    ok: true,
    form: {
      title: form.title,
      subject: form.subject,
      grade: form.grade,
      teacherLabel: "",
      // ← Whitelist. Ни answer, ни explanation здесь быть не может.
      tasks: tasks.map(toPublicTask),
      expiresAt: form.expires_at,
      // Персональная ссычка сама по себе пропуск: код класса, заданный учителем
      // для общей ссылки, здесь не спрашивается. Иначе каждый QR потребовал бы
      // ещё и общий код — то есть два «пароля» на один и тот же урок.
      needsCode: false,
    },
  });
});

const LinkSubmitBody = z.object({
  startedAt: z.number().int().positive().optional(),
  answers: z
    .array(
      z.object({
        taskNumber: z.number().int().positive(),
        value: z.union([z.string().max(4000), z.number(), z.array(z.string().max(200)).max(20)]),
      }),
    )
    .max(100),
});

publicClassLinksRouter.post("/:st/forms/:t/submit", linkSubmitLimit, linkSubmitIpLimit, async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const { link, form } = await loadLinkForm(c.env.DB, c.req.param("st"), c.req.param("t"));

  const rawBody = await readJson(c);
  const body = LinkSubmitBody.parse(rawBody);

  const tasks = parseTasks(form.payload_json);
  const taskByNumber = new Map(tasks.map((t) => [t.number, t]));

  // Ответы на несуществующие задания молча выкидываем — иначе ученик «нафантазировал»
  // бы себе баллы за задание, которого в листе нет.
  const answersByNumber = new Map<number, StudentValue>();
  for (const a of body.answers) {
    if (!taskByNumber.has(a.taskNumber)) continue;
    answersByNumber.set(a.taskNumber, a.value);
  }

  const graded = gradeSubmission(tasks, answersByNumber);

  const responseId = makeResponseId();
  const ipHash = djb2(c.get("ip") ?? "0.0.0.0");
  const startedAt = body.startedAt ?? null;
  const durationSec =
    startedAt && startedAt < now ? Math.min(86400, Math.max(0, now - startedAt)) : null;

  const answerInserts = graded.perTask.map((p) =>
    c.env.DB
      .prepare(
        `INSERT INTO form_answers
           (id, response_id, task_number, task_type, student_answer, is_correct,
            points_awarded, points_max, needs_review, check_method, check_meta_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        makeAnswerId(),
        responseId,
        p.taskNumber,
        p.taskType,
        p.studentValue === null
          ? null
          : Array.isArray(p.studentValue)
            ? p.studentValue.join(";")
            : String(p.studentValue),
        p.isCorrect === null ? null : p.isCorrect ? 1 : 0,
        p.pointsAwarded,
        p.pointsMax,
        p.needsReview ? 1 : 0,
        p.checkMethod,
        p.reason ? JSON.stringify({ reason: p.reason }) : null,
        now,
      ),
  );

  // Одна транзакция: ответ целиком или ничего. Иначе в сводке учителя появился бы
  // «пустой» ответ без единого задания. Ответ на ПЕРСОНАЛЬНУЮ ссылку отличается
  // от обычного ровно одним: `student_name` берётся из класса, а не из тела.
  const batch = [
    c.env.DB
      .prepare(
        `INSERT INTO form_responses
           (id, form_id, student_name, student_label, score_total, score_max, status,
            duration_sec, ip_hash, user_agent, started_at, submitted_at, created_at)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'submitted', ?6, ?7, ?8, ?9, ?10, ?10)`,
      )
      .bind(
        responseId,
        form.id,
        // Снимок имени из класса. Ученик его не знает и не присылал.
        link.student.name,
        graded.scoreTotal,
        graded.scoreMax,
        durationSec,
        ipHash,
        c.get("userAgent") ?? null,
        startedAt,
        now,
      ),
    ...answerInserts,
    // Привязка «этот ответ сдал этот ученик» — ради неё и затевался лист.
    studentAnswerInsert(c.env.DB, {
      studentId: link.student.id,
      formId: form.id,
      responseId,
      scoreTotal: graded.scoreTotal,
      scoreMax: graded.scoreMax,
      now,
    }),
  ];
  await c.env.DB.batch(batch);

  const perTask = graded.perTask.map((p) => ({
    taskNumber: p.taskNumber,
    status: p.needsReview ? "unreviewed" : p.isCorrect ? "correct" : "wrong",
    ...(form.show_answers === 1 ? { answer: taskByNumber.get(p.taskNumber)?.answer ?? null } : {}),
  }));

  return c.json({ ok: true, responseId, scoreTotal: graded.scoreTotal, scoreMax: graded.scoreMax, perTask }, 201);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Общие мелочи
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ученик в том виде, в каком его видит фронт.
 *
 * Принимает минимальный набор полей, а не `StudentRow`: у удалённого ученика
 * сверху добавлено `class_name`, и требовать от него полный тип строки — значит
 * запретить самый безобидный вызов.
 */
function toStudentView(row: {
  id: string;
  name: string;
  token: string;
  removed_at: number | null;
  created_at: number;
}) {
  return {
    id: row.id,
    name: row.name,
    // Токен едет в ссылку — это и есть «свой QR». Имени в ссылке нет.
    token: row.token,
    removed: row.removed_at !== null,
    createdAt: row.created_at,
  };
}

export { classesRouter, publicClassLinksRouter };
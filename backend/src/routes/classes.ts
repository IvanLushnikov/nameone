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
import { gradeSubmission, type StudentValue } from "../services/formGrading";
import {
  MAX_STUDENTS_PER_IMPORT,
  addStudents,
  createClass,
  deleteClass,
  findStudentByToken,
  listRemovedStudents,
  listRoster,
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
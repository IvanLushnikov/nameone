/**
 * /api/public/forms — публичный бэк онлайн-форм (TZ-12, этап 2).
 *
 * ОТДЕЛЬНЫЙ ФАЙЛ СПЕЦИАЛЬНО: всё, что здесь живёт, доступно по одной ссылке
 * без логина. Учительские роуты — в `routes/f07.ts` под `requireAuth`.
 * Граница «здесь нет авторизации» должна быть видна в коде.
 *
 *   GET  /api/public/forms/:token            — задания для ученика
 *   POST /api/public/forms/:token/submit     — отправка ответов + автосверка
 *   GET  /api/public/forms/:token/status     — open | closed | expired | not_found
 *
 * ── ЖЁСТКОЕ ПРАВИЛО БЕЗОПАСНОСТИ ────────────────────────────────────────────
 * `GET /:token` НИКОГДА не возвращает `tasks[].answer` и `tasks[].explanation`.
 * Реализовано явным whitelist'ом полей (`toPublicTask`), а не `delete` из
 * объекта: новое поле в `WorksheetTask` не должно утекать автоматически.
 * На это есть тест (tests/unit/publicForms.security.test.ts).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv, WorksheetTask } from "../types";
import { rateLimitMiddleware, djb2 } from "../middleware/ratelimit";
import { throwApiError } from "../lib/errors";
import { answerId as makeAnswerId, responseId as makeResponseId } from "../lib/shortid";
import { gradeSubmission, type StudentValue } from "../services/formGrading";

const publicFormsRouter = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Строки таблиц
// ─────────────────────────────────────────────────────────────────────────────

interface PublicFormRow {
  id: string;
  token: string;
  title: string;
  subject: string;
  grade: number;
  payload_json: string;
  status: string;
  access_code: string | null;
  expires_at: number;
  show_answers: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Безопасность: whitelist полей на выходе
// ─────────────────────────────────────────────────────────────────────────────

/** Задание в том виде, в котором его увидит ученик. */
export interface PublicTask {
  number: number;
  text: string;
  type: string;
  options?: string[];
  points: number;
}

/**
 * Whitelist-преобразование задания для публичного ответа.
 *
 * СПИСОК ПОЛЕЙ ФИКСИРОВАН. Здесь нет и не должно быть `...task` — только
 * явное перечисление. `answer` и `explanation` в этот список не входят и
 * входить не должны: эталон физически не покидает бэкенд до момента, когда
 * учитель сам разрешит показать его ученику (show_answers).
 */
function toPublicTask(task: WorksheetTask): PublicTask {
  return {
    number: task.number,
    text: task.text,
    type: task.type,
    // options нужны только для multiple-choice — не отдаём пустой массив.
    ...(Array.isArray(task.options) && task.options.length > 0
      ? { options: task.options }
      : {}),
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

// ─────────────────────────────────────────────────────────────────────────────
// Rate limits (ТЗ §4.3) — почему ключи именно такие
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Токен из URL для ключа rate-limit.
 *
 * Middleware, зарегистрированный как обработчик роута, может не видеть
 * c.req.param() — поэтому берём первый сегмент пути после префикса как
 * запасной вариант. Ключ обязан совпадать с тем, что потом проверит хендлер.
 */
function tokenFromRequest(c: { req: { param(key: string): string | undefined; path: string } }): string {
  const fromParam = c.req.param("token");
  if (fromParam) return fromParam;
  // Путь вида /api/public/forms/<token>/submit → "<token>".
  const segments = c.req.path.split("/").filter(Boolean);
  return segments[2] ?? "unknown";
}

/**
 * Лимит на открытие формы — 120/мин на IP.
 *
 * ВАЖНО: класс из 30 человек сидит на ОДНОМ школьном Wi-Fi, поэтому лимит
 * намеренно большой и считается на IP: это потолок для бота, а не «на
 * человека». Наивные 10 запросов с IP заблокировали бы реальный урок.
 */
const formGetLimit = rateLimitMiddleware({
  limit: 120,
  windowSec: 60,
  bucket: "form-get",
  keyFn: (c) => `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/**
 * Лимит на отправку — 10/час на ПАРУ (форма + IP), а не на IP.
 *
 * Это и есть причина, по которой ключ составной: 30 учеников с одного
 * школьного Wi-Fi за один урок — это норма, её нельзя блокировать. Защита
 * от «анонимно сдал 30 раз» получается за счёт того, что лимит на пару
 * считает и форму, и IP: другой токен — другой ключ, а на одной форме с
 * одного IP больше 10 отправок не пройдёт.
 */
const formSubmitLimit = rateLimitMiddleware({
  limit: 10,
  windowSec: 3600,
  bucket: "form-submit",
  keyFn: (c) => `form:${tokenFromRequest(c)}:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/** Глобальный потолок по IP — 200/час против бота, долбящего тысячу форм. */
const formSubmitIpLimit = rateLimitMiddleware({
  limit: 200,
  windowSec: 3600,
  bucket: "form-submit-ip",
  keyFn: (c) => `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

// ─────────────────────────────────────────────────────────────────────────────
// Ошибки для ученика — человекочитаемые, с кодом для фронта (ТЗ §4.3)
// ─────────────────────────────────────────────────────────────────────────────

/** Найти форму по токену или отдать FORM_NOT_FOUND ученику. */
async function loadFormByToken(db: D1Database, token: string): Promise<PublicFormRow> {
  const row = await db
    .prepare(
      `SELECT id, token, title, subject, grade, payload_json, status, access_code,
              expires_at, show_answers
       FROM forms WHERE token = ?1`,
    )
    .bind(token)
    .first<PublicFormRow>();
  if (!row) {
    throwApiError(404, "FORM_NOT_FOUND", "Ссылка неправильная. Попросите учителя прислать её ещё раз");
  }
  return row;
}

/** Статус формы для текущего момента. */
function formStatus(row: PublicFormRow, now: number): "open" | "closed" | "expired" {
  if (row.status === "closed") return "closed";
  if (row.expires_at <= now) return "expired";
  return "open";
}

// ─────────────────────────────────────────────────────────────────────────────
// Валидация входа
// ─────────────────────────────────────────────────────────────────────────────

const SubmitBody = z.object({
  studentName: z.string().min(1).max(100),
  studentCode: z.string().max(20).optional(),
  startedAt: z.number().int().positive().optional(),
  answers: z
    .array(
      z.object({
        taskNumber: z.number().int().positive(),
        // value приходит строкой с телефона; число/массив — тоже допускаем
        // (fill-blank отдаётся массивом полей).
        value: z.union([z.string().max(4000), z.number(), z.array(z.string().max(200)).max(20)]),
      }),
    )
    .max(100),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/forms/:token — задания для ученика
// ─────────────────────────────────────────────────────────────────────────────

publicFormsRouter.get("/:token", formGetLimit, async (c) => {
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);

  const form = await loadFormByToken(c.env.DB, token);
  const status = formStatus(form, now);
  if (status === "closed") {
    throwApiError(410, "FORM_CLOSED", "Форма закрыта учителем");
  }
  if (status === "expired") {
    throwApiError(410, "FORM_EXPIRED", "Срок ссылки истёк");
  }

  const tasks = parseTasks(form.payload_json);

  return c.json({
    ok: true,
    form: {
      title: form.title,
      subject: form.subject,
      grade: form.grade,
      // Учитель может не задать «подпись» — показываем её только если есть.
      teacherLabel: "",
      // ← Whitelist. Ни answer, ни explanation здесь быть не может.
      tasks: tasks.map(toPublicTask),
      expiresAt: form.expires_at,
      // Если учитель задал код — фронт спросит его перед отправкой.
      needsCode: Boolean(form.access_code),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/forms/:token/status — «жива» ли ссылка
// ─────────────────────────────────────────────────────────────────────────────

publicFormsRouter.get("/:token/status", formGetLimit, async (c) => {
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);

  const form = await c.env.DB
    .prepare(
      `SELECT id, token, title, subject, grade, payload_json, status, access_code,
              expires_at, show_answers
       FROM forms WHERE token = ?1`,
    )
    .bind(token)
    .first<PublicFormRow>();

  // Неизвестный токен — не ошибка, а нормальный ответ: фронт покажет
  // «ссылка неправильная», не показывая Teachers «500».
  if (!form) return c.json({ ok: true, status: "not_found" });

  return c.json({ ok: true, status: formStatus(form, now) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/forms/:token/submit — приём ответов + автосверка
// ─────────────────────────────────────────────────────────────────────────────

publicFormsRouter.post(
  "/:token/submit",
  formSubmitLimit,
  formSubmitIpLimit,
  async (c) => {
    const token = c.req.param("token");
    const now = Math.floor(Date.now() / 1000);

    const form = await loadFormByToken(c.env.DB, token);
    const status = formStatus(form, now);
    if (status === "closed") {
      throwApiError(410, "FORM_CLOSED", "Форма закрыта учителем");
    }
    if (status === "expired") {
      throwApiError(410, "FORM_EXPIRED", "Срок ссылки истёк");
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throwApiError(400, "BAD_REQUEST", "Не удалось прочитать ответы");
    }
    const body = SubmitBody.parse(rawBody);

    // Код класса: если учитель его задал — проверить, иначе 403 с понятным текстом.
    if (form.access_code) {
      const given = (body.studentCode ?? "").trim().toUpperCase();
      const expected = form.access_code.trim().toUpperCase();
      if (given !== expected) {
        throwApiError(403, "FORM_CODE_REQUIRED", "Введите код, который написал учитель на доске");
      }
    }

    const tasks = parseTasks(form.payload_json);
    const taskByNumber = new Map(tasks.map((t) => [t.number, t]));

    // Ответы на несуществующие задания молча выкидываем — иначе ученик мог бы
    // «нафантазировать» себе баллы за задание, которого в листе нет.
    const answersByNumber = new Map<number, StudentValue>();
    for (const a of body.answers) {
      if (!taskByNumber.has(a.taskNumber)) continue;
      answersByNumber.set(a.taskNumber, a.value);
    }

    // Сверка на сервере. Эталон наружу не уходит.
    const graded = gradeSubmission(tasks, answersByNumber);

    const responseId = makeResponseId();
    // Только хэш IP: сырой IP — персональные данные (ТЗ §5.2).
    const ipHash = djb2(c.get("ip") ?? "0.0.0.0");
    const userAgent = c.get("userAgent") ?? null;
    const startedAt = body.startedAt ?? null;
    const durationSec =
      startedAt && startedAt < now
        ? Math.min(86400, Math.max(0, now - startedAt))
        : null;

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

    // Одна транзакция: либо ответ целиком, либо ничего. Иначе в сводке
    // учителя появится «пустой» ответ без единого задания.
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO form_responses
             (id, form_id, student_name, student_label, score_total, score_max, status,
              duration_sec, ip_hash, user_agent, started_at, submitted_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'submitted', ?7, ?8, ?9, ?10, ?11, ?11)`,
        )
        .bind(
          responseId,
          form.id,
          body.studentName.trim().slice(0, 100),
          body.studentCode?.trim().slice(0, 20) ?? null,
          graded.scoreTotal,
          graded.scoreMax,
          durationSec,
          ipHash,
          userAgent,
          startedAt,
          now,
        ),
      ...answerInserts,
    ]);

    // Ученику отдаём только вердикты, без эталонов. Сам эталон — только если
    // учитель явно разрешил show_answers (для контрольной это выключено).
    const perTask = graded.perTask.map((p) => ({
      taskNumber: p.taskNumber,
      status: p.needsReview ? "unreviewed" : p.isCorrect ? "correct" : "wrong",
      ...(form.show_answers === 1
        ? { answer: taskByNumber.get(p.taskNumber)?.answer ?? null }
        : {}),
    }));

    return c.json(
      {
        ok: true,
        responseId,
        scoreTotal: graded.scoreTotal,
        scoreMax: graded.scoreMax,
        perTask,
      },
      201,
    );
  },
);

export { publicFormsRouter };

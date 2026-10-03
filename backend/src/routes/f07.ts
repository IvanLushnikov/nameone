/**
 * /api/assignments/forms — учительский бэк онлайн-форм (TZ-12, этап 1).
 *
 * Форма = выданный ученикам лист по ссылке/QR. Здесь всё, что делает учитель:
 * создаёт форму, смотрит список, разбирает ответы по ученикам, продлевает и
 * закрывает ссылку, выгружает CSV в Excel.
 *
 * Все роуты требуют входа (`requireAuth`) и работают только со своими формами.
 * Публичная часть (то, что видит ученик) вынесена в отдельный файл
 * `routes/publicForms.ts` — чтобы граница «без авторизации» была видна глазом.
 *
 *   POST   /api/assignments/forms                  — создать форму
 *   GET    /api/assignments/forms                  — список форм + счётчики
 *   GET    /api/assignments/forms/:id              — форма + все ответы (drill-down)
 *   PATCH  /api/assignments/forms/:id              — close / reopen / extend / rotate-token
 *   DELETE /api/assignments/forms/:id              — удалить форму с ответами (каскад)
 *   GET    /api/assignments/forms/:id/export.csv   — CSV (; + UTF-8 BOM) для Excel/ЭЖД
 */

import { Hono } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv, WorksheetTask } from "../types";
import type { Env } from "../env";
import { getWorksheetById } from "../services/worksheet";
import { requireAuth } from "../middleware/auth";
import { BadRequestError, NotFoundError } from "../lib/errors";
import { formId as makeFormId, formToken } from "../lib/shortid";
import { detectCheckMode } from "../services/formGrading";

const f07Router = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Типы строк таблиц
// ─────────────────────────────────────────────────────────────────────────────

interface FormRow {
  id: string;
  token: string;
  user_id: string;
  worksheet_id: string | null;
  title: string;
  subject: string;
  grade: number;
  payload_json: string;
  status: string;
  access_code: string | null;
  expires_at: number;
  closed_at: number | null;
  show_answers: number;
  check_mode: string;
  created_at: number;
  updated_at: number;
}

interface FormSummaryRow extends FormRow {
  responses_count: number;
  score_avg: number | null;
  score_max_avg: number | null;
}

interface ResponseRow {
  id: string;
  student_name: string;
  student_label: string | null;
  score_total: number;
  score_max: number;
  duration_sec: number | null;
  submitted_at: number;
}

/** Строка form_answers в том виде, как её отдаёт D1 (snake_case). */
interface AnswerRow {
  task_number: number;
  student_answer: string | null;
  is_correct: number | null;
  points_awarded: number;
  points_max: number;
  needs_review: number;
  check_method: string;
}

/** Ответ на задание в ответе API (camelCase, как ждёт фронт). */
interface AnswerView {
  taskNumber: number;
  studentAnswer: string | null;
  isCorrect: number | null;
  pointsAwarded: number;
  pointsMax: number;
  needsReview: number;
  checkMethod: string;
}

/**
 * Ответ ученика + его ответы по заданиям (drill-down).
 *
 * ВАЖНО: это НЕ `extends ResponseRow`. `ResponseRow` — строка D1 в
 * snake_case, она наружу не отдаётся. Здесь ровно те поля, которые видит фронт
 * (`src/lib/forms/types.ts`), в camelCase. Наследование от строки БД в прошлом
 * означало, что API отдавал `student_name`, а фронт читал `studentName`.
 */
interface ResponseView {
  id: string;
  studentName: string;
  studentLabel: string | null;
  scoreTotal: number;
  scoreMax: number;
  durationSec: number | null;
  submittedAt: number;
  answers: AnswerView[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Разобрать payload_json формы в список заданий.
 *
 * Формы создаются из листа, где tasks — массив объектов с answer/explanation.
 * Если payload битый (историческая форма, ручной импорт) — пустой массив,
 * форма всё равно отдаётся учителю, просто без заданий.
 */
function parseTasks(payloadJson: string): WorksheetTask[] {
  try {
    const parsed = JSON.parse(payloadJson) as { tasks?: unknown };
    const tasks = parsed.tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks.filter((t): t is WorksheetTask => typeof t === "object" && t !== null);
  } catch {
    return [];
  }
}

/**
 * Публичная ссылка на форму: `<origin>/form/?t=<token>`.
 *
 * Берём `APP_PUBLIC_URL` — это ОДИН origin фронта, заведённый специально для
 * ссылок, которые видит человек. `FRONTEND_URL` в проде содержит список
 * через запятую (он нужен CORS, который список разбирает) и вставлять его в
 * ссылку нельзя.
 *
 * ─── Почему это было багом ───
 * Раньше здесь стояло `FRONTEND_URL.split(",")[0]`. На проде это
 * `https://listai-prototype.pages.dev` — preview-домен Cloudflare, а не
 * рабочий сайт. Учитель получал QR и ссылку, которые выглядели правильно,
 * но вели на preview-деплой: могли быть не подняты, устаревшие или показывать
 * старую версию. Всё это невозможно заметить на локали, где FRONTEND_URL —
 * единственный `http://localhost:3000`.
 *
 * Fallback на первый элемент FRONTEND_URL оставлен для старых конфигураций,
 * где APP_PUBLIC_URL ещё не задали — ровно как в buildMagicLinkUrl.
 *
 * Страница ученика статическая, токен едет в query-строкой — это единственный
 * вариант, который работает при `output: "export"` (ТЗ §4.1).
 */
export function buildFormUrl(env: Env, token: string): string {
  const raw = env.APP_PUBLIC_URL ?? env.FRONTEND_URL?.split(",")[0] ?? "";
  const base = raw.trim().replace(/\/+$/u, "");
  return `${base}/form/?t=${token}`;
}

/** Прочитать форму, убедившись что она принадлежит текущему учителю. */
async function loadOwnForm(db: D1Database, id: string, userId: string): Promise<FormRow> {
  const row = await db
    .prepare(
      `SELECT id, token, user_id, worksheet_id, title, subject, grade, payload_json,
              status, access_code, expires_at, closed_at, show_answers, check_mode,
              created_at, updated_at
       FROM forms WHERE id = ?1`,
    )
    .bind(id)
    .first<FormRow>();
  if (!row) throw new NotFoundError("Форма не найдена");
  // Чужую форму не отдаём даже по id — 404, чтобы не подсказывать, что она есть.
  if (row.user_id !== userId) throw new NotFoundError("Форма не найдена");
  return row;
}

/** Экранирование значения для CSV: кавычки, разделитель, переводы строк. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[";\r\n]/u.test(text)) {
    return `"${text.replace(/"/gu, '""')}"`;
  }
  return text;
}

/**
 * Ответы по нескольким отправкам сразу (`form_answers` по `response_id`).
 *
 * D1 ограничивает количество связанных параметров (~100 на запрос), поэтому
 * id режем на порции: класс из 30 учеников проходит одним запросом, а форма
 * на 300 человек — несколькими. Без этого сводка учителя падала бы с 500.
 */
async function fetchAnswersForResponses(
  db: D1Database,
  responseIds: string[],
): Promise<Array<AnswerRow & { response_id: string }>> {
  const CHUNK = 90; // с запасом от лимита D1
  const out: Array<AnswerRow & { response_id: string }> = [];

  for (let i = 0; i < responseIds.length; i += CHUNK) {
    const chunk = responseIds.slice(i, i + CHUNK);
    const rows = await db
      .prepare(
        `SELECT response_id, task_number, student_answer, is_correct, points_awarded,
                points_max, needs_review, check_method
         FROM form_answers
         WHERE response_id IN (${chunk.map(() => "?").join(",")})
         ORDER BY task_number ASC`,
      )
      .bind(...chunk)
      .all<AnswerRow & { response_id: string }>();
    out.push(...rows.results);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Валидация входа
// ─────────────────────────────────────────────────────────────────────────────

const TaskSnapshot = z.object({
  number: z.number().int().positive(),
  text: z.string().min(1).max(4000),
  type: z.enum(["computation", "multiple-choice", "short-answer", "essay", "fill-blank"]),
  options: z.array(z.string().max(500)).max(20).optional(),
  // Эталон и объяснение нужны на сервере для сверки — но в публичный API
  // они не попадают никогда (см. routes/publicForms.ts).
  answer: z.string().max(4000).optional(),
  explanation: z.string().max(4000).optional(),
  points: z.number().int().nonnegative().max(100),
});

const CreateFormBody = z.object({
  worksheetId: z.string().min(1).max(64).optional(),
  /** Лист, созданный в браузере до логина: принимаем payload напрямую. */
  payload: z
    .object({
      tasks: z.array(TaskSnapshot).min(1).max(100),
      title: z.string().min(1).max(200).optional(),
      subject: z.string().min(1).max(64).optional(),
      grade: z.number().int().min(1).max(11).optional(),
    })
    .optional(),
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(64),
  grade: z.number().int().min(1).max(11),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  accessCode: z.string().min(1).max(20).optional(),
  showAnswers: z.boolean().optional(),
});

const PatchFormBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(365).optional() }),
  z.object({ action: z.literal("rotate-token") }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/assignments/forms — создать форму
// ─────────────────────────────────────────────────────────────────────────────

f07Router.post("/forms", async (c) => {
  const user = requireAuth(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const body = CreateFormBody.parse(rawBody);

  // Снимок заданий: из сохранённого листа или из тела запроса.
  let tasks: WorksheetTask[];
  let worksheetId: string | null = null;

  if (body.worksheetId) {
    const ws = await getWorksheetById(c.env.DB, body.worksheetId);
    if (!ws) throw new NotFoundError("Рабочий лист не найден");
    worksheetId = ws.id ?? body.worksheetId;
    tasks = (ws.tasks ?? []) as WorksheetTask[];
    if (tasks.length === 0) {
      throw new BadRequestError("В листе нет заданий — форму выдавать не на что");
    }
  } else if (body.payload?.tasks) {
    tasks = body.payload.tasks as WorksheetTask[];
  } else {
    throw new BadRequestError("Нужен worksheetId или payload с заданиями");
  }

  const now = Math.floor(Date.now() / 1000);
  // Срок жизни ссылки по умолчанию 14 дней (ТЗ, сценарий А, шаг 3).
  const expiresAt = now + (body.expiresInDays ?? 14) * 86400;
  const id = makeFormId();
  const token = formToken();
  const checkMode = detectCheckMode(tasks);

  // В payload_json кладём снимок заданий целиком (включая answer) — это
  // единственное место, где живёт эталон.
  const payloadJson = JSON.stringify({ tasks });

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO forms
           (id, token, user_id, worksheet_id, title, subject, grade, payload_json,
            status, access_code, expires_at, show_answers, check_mode, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'open', ?9, ?10, ?11, ?12, ?13, ?13)`,
      )
      .bind(
        id,
        token,
        user.id,
        worksheetId,
        body.title,
        body.subject,
        body.grade,
        payloadJson,
        body.accessCode ?? null,
        expiresAt,
        body.showAnswers ? 1 : 0,
        checkMode,
        now,
      )
      .run();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[f07/forms] INSERT failed:", err, { userId: user.id, formId: id });
    throw new BadRequestError("Не удалось создать форму");
  }

  return c.json(
    {
      ok: true,
      formId: id,
      token,
      url: buildFormUrl(c.env, token),
      responsesCount: 0,
    },
    201,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assignments/forms — список форм учителя
// ─────────────────────────────────────────────────────────────────────────────

f07Router.get("/forms", async (c) => {
  const user = requireAuth(c);

  const rows = await c.env.DB
    .prepare(
      `SELECT f.id, f.token, f.user_id, f.worksheet_id, f.title, f.subject, f.grade,
              f.payload_json, f.status, f.access_code, f.expires_at, f.closed_at,
              f.show_answers, f.check_mode, f.created_at, f.updated_at,
              COUNT(r.id) AS responses_count,
              AVG(CAST(r.score_total AS REAL)) AS score_avg,
              AVG(CAST(r.score_max AS REAL)) AS score_max_avg
       FROM forms f
       LEFT JOIN form_responses r ON r.form_id = f.id
       WHERE f.user_id = ?1
       GROUP BY f.id
       ORDER BY f.created_at DESC
       LIMIT 200`,
    )
    .bind(user.id)
    .all<FormSummaryRow>();

  const forms = rows.results.map((r) => ({
    id: r.id,
    token: r.token,
    title: r.title,
    subject: r.subject,
    grade: r.grade,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    responsesCount: r.responses_count ?? 0,
    scoreAvg: r.score_avg === null ? 0 : Math.round(r.score_avg * 10) / 10,
    scoreMaxAvg: r.score_max_avg === null ? 0 : Math.round(r.score_max_avg * 10) / 10,
  }));

  return c.json({ ok: true, forms });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assignments/forms/:id/export.csv — выгрузка для Excel
//
// Идёт ПЕРЕД /forms/:id: статический сегмент export.csv не должен попадать
// в параметр :id.
// ─────────────────────────────────────────────────────────────────────────────

f07Router.get("/forms/:id/export.csv", async (c) => {
  const user = requireAuth(c);
  const form = await loadOwnForm(c.env.DB, c.req.param("id"), user.id);

  const tasks = parseTasks(form.payload_json);

  const responses = await c.env.DB
    .prepare(
      `SELECT id, student_name, student_label, score_total, score_max, duration_sec, submitted_at
       FROM form_responses WHERE form_id = ?1 ORDER BY submitted_at ASC`,
    )
    .bind(form.id)
    .all<ResponseRow>();

  // Колонки — как в ТЗ §4.3. Одна строка = один ответ на одно задание.
  const header = ["ФИО", "Класс", "Задание", "Ответ ученика", "Верно", "Балл", "Макс.балл"];
  const lines: string[] = [header.map(csvCell).join(";")];

  if (responses.results.length > 0) {
    const answers = await fetchAnswersForResponses(
      c.env.DB,
      responses.results.map((r) => r.id),
    );

    for (const resp of responses.results) {
      const own = answers.filter((a) => a.response_id === resp.id);
      const seen = new Set<number>();
      for (const a of own) {
        seen.add(a.task_number);
        const verdict =
          a.is_correct === null
            ? a.needs_review === 1
              ? "не проверено"
              : "—"
            : a.is_correct === 1
              ? "да"
              : "нет";
        lines.push(
          [
            resp.student_name,
            resp.student_label ?? "",
            `Задание ${a.task_number}`,
            a.student_answer ?? "",
            verdict,
            a.points_awarded,
            a.points_max,
          ]
            .map(csvCell)
            .join(";"),
        );
      }
      // Пропущенные задания — тоже в отчёт, учитель должен видеть «не решено».
      for (const task of tasks) {
        if (seen.has(task.number)) continue;
        lines.push(
          [resp.student_name, resp.student_label ?? "", `Задание ${task.number}`, "", "не отвечено", 0, task.points]
            .map(csvCell)
            .join(";"),
        );
      }
    }
  }

  // UTF-8 BOM обязателен: без него русский Excel открывает файл как кракозябры.
  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
  const date = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="otchet-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assignments/forms/:id — форма + все ответы (drill-down)
// ─────────────────────────────────────────────────────────────────────────────

f07Router.get("/forms/:id", async (c) => {
  const user = requireAuth(c);
  const form = await loadOwnForm(c.env.DB, c.req.param("id"), user.id);

  const responses = await c.env.DB
    .prepare(
      `SELECT id, student_name, student_label, score_total, score_max, duration_sec, submitted_at
       FROM form_responses WHERE form_id = ?1 ORDER BY submitted_at ASC`,
    )
    .bind(form.id)
    .all<ResponseRow>();

  const out: ResponseView[] = [];

  if (responses.results.length > 0) {
    const answers = await fetchAnswersForResponses(
      c.env.DB,
      responses.results.map((r) => r.id),
    );

    for (const resp of responses.results) {
      // НЕ разбрасываем `...resp`: это строка D1 в snake_case, и она утекала
      // в JSON как `student_name` / `score_total` / `duration_sec`. Фронт
      // (`src/lib/forms/types.ts`) ждёт camelCase, поэтому поля перечислены
      // явно. Раньше здесь был спред — фронт получал `undefined` вместо имени
      // ученика в списке ответов, и тест это ловил.
      out.push({
        id: resp.id,
        studentName: resp.student_name,
        studentLabel: resp.student_label,
        scoreTotal: resp.score_total,
        scoreMax: resp.score_max,
        durationSec: resp.duration_sec,
        submittedAt: resp.submitted_at,
        answers: answers
          .filter((a) => a.response_id === resp.id)
          .map((a) => ({
            taskNumber: a.task_number,
            studentAnswer: a.student_answer,
            isCorrect: a.is_correct,
            pointsAwarded: a.points_awarded,
            pointsMax: a.points_max,
            needsReview: a.needs_review,
            checkMethod: a.check_method,
          })),
      });
    }
  }

  return c.json({
    ok: true,
    form: {
      id: form.id,
      token: form.token,
      title: form.title,
      subject: form.subject,
      grade: form.grade,
      status: form.status,
      showAnswers: form.show_answers === 1,
      checkMode: form.check_mode,
      accessCode: form.access_code,
      createdAt: form.created_at,
      expiresAt: form.expires_at,
      closedAt: form.closed_at,
      // Учитель видит полный снимок, включая эталоны — ему они нужны для проверки.
      tasks: parseTasks(form.payload_json),
      url: buildFormUrl(c.env, form.token),
    },
    responses: out,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/assignments/forms/:id — close / reopen / extend / rotate-token
// ─────────────────────────────────────────────────────────────────────────────

f07Router.patch("/forms/:id", async (c) => {
  const user = requireAuth(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const body = PatchFormBody.parse(rawBody);

  const form = await loadOwnForm(c.env.DB, c.req.param("id"), user.id);
  const now = Math.floor(Date.now() / 1000);

  let token = form.token;
  let expiresAt = form.expires_at;

  switch (body.action) {
    case "close":
      await c.env.DB
        .prepare(
          `UPDATE forms SET status = 'closed', closed_at = ?1, updated_at = ?1 WHERE id = ?2`,
        )
        .bind(now, form.id)
        .run();
      break;

    case "reopen":
      // Переоткрытая форма должна снова быть доступна — продлеваем срок,
      // иначе ссылка оживёт мёртвой (истёкшую не откроет даже open).
      await c.env.DB
        .prepare(
          `UPDATE forms
           SET status = 'open', closed_at = NULL, expires_at = ?1, updated_at = ?2
           WHERE id = ?3`,
        )
        .bind(Math.max(form.expires_at, now + 86400), now, form.id)
        .run();
      expiresAt = Math.max(form.expires_at, now + 86400);
      break;

    case "extend": {
      // Продление «от сегодня», но не короче текущего срока — иначе extend
      // на закрытой форме с истёкшим сроком снова уводит ссылку в прошлое.
      const days = body.days ?? 14;
      const base = Math.max(form.expires_at, now);
      expiresAt = base + days * 86400;
      await c.env.DB
        .prepare(`UPDATE forms SET expires_at = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(expiresAt, now, form.id)
        .run();
      break;
    }

    case "rotate-token": {
      // Старая ссылка умирает, ответы остаются (ТЗ §5.4).
      token = formToken();
      await c.env.DB
        .prepare(`UPDATE forms SET token = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(token, now, form.id)
        .run();
      break;
    }
  }

  return c.json({
    ok: true,
    token,
    url: buildFormUrl(c.env, token),
    status: body.action === "close" ? "closed" : "open",
    expiresAt,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/assignments/forms/:id — каскад (ответы удаляются через ON DELETE)
// ─────────────────────────────────────────────────────────────────────────────

f07Router.delete("/forms/:id", async (c) => {
  const user = requireAuth(c);
  const form = await loadOwnForm(c.env.DB, c.req.param("id"), user.id);

  // Явная очистка ответов, а не надежда на каскад: у SQLite foreign_keys
  // в D1 включён, но учителю важно, чтобы ПДн учеников ушли гарантированно
  // и в одной транзакции с формой.
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM form_answers WHERE response_id IN (SELECT id FROM form_responses WHERE form_id = ?1)`).bind(form.id),
    c.env.DB.prepare(`DELETE FROM form_responses WHERE form_id = ?1`).bind(form.id),
    c.env.DB.prepare(`DELETE FROM forms WHERE id = ?1`).bind(form.id),
  ]);

  return c.json({ ok: true });
});

export { f07Router };

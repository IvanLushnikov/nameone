/**
 * GET /api/journal — журнал проверок учителя (ТЗ-19 §5.1).
 *
 * Закрывает дыру, из-за которой фича выглядела как игрушка: результат проверки
 * по фото жил только в открытой вкладке. Закрыл вкладку — отметок нет нигде,
 * даже автоматических. Теперь у учителя есть список: дата, предмет, класс,
 * отметка и — главное — кто эту отметку поставил: машина или он сам.
 *
 *   Разбор по темам (ТЗ-27):
 *     GET  /api/journal/classes/:id/skills        — «Темы, где просели»
 *     GET  /api/journal/classes/:id/skills/:skill — карточка темы
 *     POST /api/journal/forms/:id/recheck        — пересчёт после правки отметок
 *
 * Монтируется в `index.ts` как `app.route("/api/journal", journalRouter)`.
 * Само монтирование — за оркестратором, этот файл только экспортирует роутер.
 *
 * ЧУЖИХ ЗАПИСЕЙ НЕ БЫВАЕТ: `user_id` берётся из сессии, из query его не
 * подставляет никто. Пустой список — валидный ответ, а не 404: «проверок ещё не
 * было» и «проверка не найдена» — разные вещи, и учителю нужна первая.
 *
 * ── Вторая половина журнала: работы, сданные через форму (лист 3.1.6) ─────────
 * Роут живёт здесь, а не в `f07.ts`, по простой причине: эти четыре ручки —
 * часть ЖУРНАЛА УЧИТЕЛЯ, а не создания формы. Учитель приходит сюда, чтобы
 * посмотреть, кто поставил отметку, и поправить машину. Всё, что он здесь
 * делает, требует входа, и каждая ручка проверяет, что форма или ответ — его.
 *
 * ── Число страниц в строке (лист 7.1.4) ───────────────────────────────────────
 * Строка ленты отдаёт ещё `pages` — сколько страниц в работе. Учитель видит
 * это, не открывая саму работу: две страницы вместо четырёх — это не «две
 * страницы», а половина работы, и узнать об этом после разбора поздно.
 * Число страниц хранится в `photo_checks.pages` и считается один раз при
 * загрузке работы — см. `countPagesForJournal`.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import { requireAuth } from "../middleware/auth";
import { BadRequestError, NotFoundError } from "../lib/errors";
import { listJournalEntries } from "../db/journal";
import {
  buildRecentChecks,
  buildSkillBreakdown,
  buildTaskBreakdown,
  findStrugglingStudents,
  listSkillAttempts,
  listTaskStats,
  recomputeFormSkillAttempts,
  trendPercent,
} from "../db/skill-attempts";
import {
  applyTeacherOverride,
  buildCheckMeta,
  describeAnswerState,
  hasShortAnswerTasks,
  parseCheckMeta,
  parseTasks,
  readShortAnswerLlmSettings,
  writeShortAnswerLlmSettings,
  type ShortAnswerGrade,
} from "../services/formGrading";
import type { AppEnv } from "../types";

const journalRouter = new Hono<AppEnv>();

/** Потолок страницы. Учитель за вечер делает десятки, не тысячи работ. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * Сколько страниц в работе — по каждой строке ленты.
 *
 * ЗАЧЕМ ЭТО В ЖУРНАЛЕ: «сколько страниц в работе» — вопрос, который учитель
 * задаёт ДО открытия работы (а две страницы вместо одной — это половина
 * работы вместо всей). Внутри DTO проверки поле `pages` есть, а в строке
 * ленты его не было: число просто не доезжало до типа строки.
 *
 * null = число страниц НЕИЗВЕСТНО потому, что фото удалены по семидневному
 * retention или у строки нет проверки. Не ноль и не единица: правдоподобное
 * число без источника — выдумка, на которую потом ссылается вся остальная
 * статистика.
 *
 * ЧИТАЕМ ИЗ `photo_checks.pages`, А НЕ СЧИТАЕМ ЗАНОВО. Так сделано с
 * 16.10.2026 (ТЗ-30): число страниц пишется один раз при загрузке фото, и
 * строка журнала берёт его оттуда. Раньше здесь для каждой строки уходили
 * HEAD-запросы в бакет — двадцать строк по два HEAD ещё терпимо, пятьдесят
 * разом упирались в лимит подзапросов воркера. Значение 0 в базе означает
 * «посчитать не удалось», и на экране оно читается как «число страниц
 * определить не удалось», а не как ноль.
 */
interface PhotoPagesRow {
  id: string;
  r2_key: string | null;
  deleted_at: number | null;
  /**
   * Посчитанное при загрузке число страниц. null — при загрузке бакет не
   * ответил, и это правда, а не ноль страниц.
   */
  pages: number | null;
}

/**
 * checkId → число страниц. `null` — фото удалены, ОТСУТСТВУЕТ — не смогли
 * посчитать. Ключа в `JSON.stringify` не будет — поле у строки не появится.
 */
async function countPagesForJournal(
  db: D1Database,
  checkIds: string[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (checkIds.length === 0) return result;

  const placeholders = checkIds.map((_, i) => `?${i + 1}`).join(", ");
  const photos = await db
    .prepare(
      `SELECT id, r2_key, deleted_at, pages FROM photo_checks WHERE id IN (${placeholders})`,
    )
    .bind(...checkIds)
    .all<PhotoPagesRow>();

  const byId = new Map(photos.results.map((p) => [p.id, p]));
  for (const id of checkIds) {
    const row = byId.get(id);
    if (!row || row.deleted_at !== null || row.r2_key === null) {
      result.set(id, null);
      continue;
    }
    result.set(id, row.pages);
  }
  return result;
}

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
  const pages = await countPagesForJournal(
    c.env.DB,
    rows.map((r) => r.check_id),
  );

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
      // Сколько страниц в этой работе. null = фото удалены, число
      // восстановить нельзя; поле отсутствует = не смогли посчитать (см.
      // countPagesForJournal). Ни то, ни другое не заменяем правдоподобной
      // единицей.
      pages: pages.get(r.check_id),
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

// ─────────────────────────────────────────────────────────────────────────────
// Работы, сданные через форму (лист 3.1.6)
// ─────────────────────────────────────────────────────────────────────────────

interface FormJournalRow {
  id: string;
  user_id: string;
  token: string;
  title: string;
  subject: string;
  grade: number;
  payload_json: string;
  status: string;
  expires_at: number;
  created_at: number;
}

interface AnswerRow {
  id: string;
  response_id: string;
  task_number: number;
  task_type: string;
  student_answer: string | null;
  is_correct: number | null;
  points_awarded: number;
  points_max: number;
  needs_review: number;
  check_method: string;
  check_meta_json: string | null;
}

/** Сколько ответов в последних работах ещё ждут учителя. */
const SHORT_ANSWER_RECENT_LIMIT = 20;

const ToggleBody = z.object({ enabled: z.boolean() });
const OverrideBody = z.object({
  accepted: z.boolean(),
  points: z.number().int().min(0).max(1000).nullable().optional(),
});

/**
 * Загрузить форму учителя.
 *
 * Чужая форма — 404, а не 403: по коду нельзя отличить «нет такой» от «есть,
 * но не твоя», а перебором лезть не должен никто.
 */
async function loadOwnForm(db: D1Database, id: string, userId: string): Promise<FormJournalRow> {
  const row = await db
    .prepare(
      `SELECT id, user_id, token, title, subject, grade, payload_json, status,
              expires_at, created_at
       FROM forms WHERE id = ?1`,
    )
    .bind(id)
    .first<FormJournalRow>();
  if (!row || row.user_id !== userId) throw new NotFoundError("Форма не найдена");
  return row;
}

/** GET /api/journal/forms — формы учителя и состояние сверки по каждой. */
journalRouter.get("/forms", async (c) => {
  const user = requireAuth(c);

  const rows = await c.env.DB
    .prepare(
      `SELECT f.id, f.user_id, f.token, f.title, f.subject, f.grade, f.payload_json, f.status,
              f.expires_at, f.created_at,
              (SELECT COUNT(*) FROM form_responses r WHERE r.form_id = f.id) AS responses_count
       FROM forms f
       WHERE f.user_id = ?1
       ORDER BY f.created_at DESC
       LIMIT 50`,
    )
    .bind(user.id)
    .all<FormJournalRow & { responses_count: number }>();

  return c.json({
    ok: true,
    forms: rows.results.map((r) => toFormJournalEntry(r)),
  });
});

/** Что журнал отдаёт фронту по одной форме. */
function toFormJournalEntry(r: FormJournalRow & { responses_count?: number }) {
  const settings = readShortAnswerLlmSettings(r.payload_json);
  const shortAnswers = hasShortAnswerTasks(parseTasks(r.payload_json));
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    grade: r.grade,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    responsesCount: r.responses_count ?? 0,
    // Галочка. По умолчанию false — сверку включают руками.
    shortAnswerLlmEnabled: settings.enabled,
    shortAnswerLlmEnabledAt: settings.enabledAt,
    // Нет коротких ответов — галочка бесполезна и показываться не должна.
    hasShortAnswers: shortAnswers,
  };
}

/**
 * POST /api/journal/forms/:id/short-answer-llm — включить/выключить сверку.
 *
 * Тело: `{enabled: true|false}`. Галочка снимается тем же запросом, и это важно:
 * решение «не тратить» должно быть таким же простым, как решение «тратить».
 */
journalRouter.post("/forms/:id/short-answer-llm", async (c) => {
  const user = requireAuth(c);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequestError("Не удалось прочитать настройку");
  }
  const body = ToggleBody.parse(raw);

  const form = await loadOwnForm(c.env.DB, c.req.param("id"), user.id);
  const now = Math.floor(Date.now() / 1000);

  const payloadJson = writeShortAnswerLlmSettings(form.payload_json, {
    enabled: body.enabled,
    enabledAt: body.enabled ? now : null,
  });
  await c.env.DB
    .prepare(`UPDATE forms SET payload_json = ?1, updated_at = ?2 WHERE id = ?3 AND user_id = ?4`)
    .bind(payloadJson, now, form.id, user.id)
    .run();

  return c.json({
    ok: true,
    formId: form.id,
    shortAnswerLlmEnabled: body.enabled,
    shortAnswerLlmEnabledAt: body.enabled ? now : null,
    // Снимок заданий не тронут — лишний ключ лежит рядом с tasks.
    hasShortAnswers: hasShortAnswerTasks(parseTasks(payloadJson)),
  });
});

/** GET /api/journal/forms/:id/responses — последние работы и их вердикты. */
journalRouter.get("/forms/:id/responses", async (c) => {
  const user = requireAuth(c);
  const form = await loadOwnForm(c.env.DB, c.req.param("id"), user.id);

  const responses = await c.env.DB
    .prepare(
      `SELECT id, student_name, student_label, score_total, score_max, submitted_at
       FROM form_responses
       WHERE form_id = ?1
       ORDER BY submitted_at DESC, id DESC
       LIMIT ?2`,
    )
    .bind(form.id, SHORT_ANSWER_RECENT_LIMIT)
    .all<{
      id: string;
      student_name: string;
      student_label: string | null;
      score_total: number;
      score_max: number;
      submitted_at: number;
    }>();

  const ids = responses.results.map((r) => r.id);
  const answersByResponse = new Map<string, AnswerRow[]>();
  if (ids.length > 0) {
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(", ");
    const answerRows = await c.env.DB
      .prepare(
        `SELECT id, response_id, task_number, task_type, student_answer, is_correct,
                points_awarded, points_max, needs_review, check_method, check_meta_json
         FROM form_answers
         WHERE response_id IN (${placeholders})
         ORDER BY task_number`,
      )
      .bind(...ids)
      .all<AnswerRow>();

    for (const a of answerRows.results) {
      const list = answersByResponse.get(a.response_id);
      if (list) list.push(a);
      else answersByResponse.set(a.response_id, [a]);
    }
  }

  return c.json({
    ok: true,
    form: {
      id: form.id,
      title: form.title,
      subject: form.subject,
      grade: form.grade,
      status: form.status,
      shortAnswerLlmEnabled: readShortAnswerLlmSettings(form.payload_json).enabled,
    },
    responses: responses.results.map((r) => ({
      id: r.id,
      studentName: r.student_name,
      studentLabel: r.student_label,
      scoreTotal: r.score_total,
      scoreMax: r.score_max,
      submittedAt: r.submitted_at,
      answers: (answersByResponse.get(r.id) ?? []).map(toJournalAnswer),
    })),
  });
});

/**
 * Один ответ в терминах журнала.
 *
 * `state` — главное поле: по нему фронт рисует разные бейджи, и именно он
 * не даёт «верно от машины» и «верно от учителя» слипнуться в одно слово.
 */
function toJournalAnswer(a: AnswerRow) {
  const meta = parseCheckMeta(a.check_meta_json);
  const isCorrect = a.is_correct === null ? null : a.is_correct === 1;
  const needsReview = a.needs_review === 1;

  return {
    id: a.id,
    taskNumber: a.task_number,
    taskType: a.task_type,
    studentAnswer: a.student_answer,
    isCorrect,
    pointsAwarded: a.points_awarded,
    pointsMax: a.points_max,
    needsReview,
    checkMethod: a.check_method,
    state: describeAnswerState({
      isCorrect,
      needsReview,
      checkMethod: a.check_method as "auto" | "llm" | "manual",
      meta,
    }),
    decidedBy: meta.decidedBy ?? null,
    modelVerdict: meta.modelVerdict ?? null,
    confidence: meta.confidence ?? null,
    comment: meta.comment ?? null,
    reason: meta.reason ?? null,
    llmChecked: meta.llmChecked === true,
    decidedAt: meta.decidedAt ?? null,
  };
}

/**
 * POST /api/journal/answers/:id/override — учитель исправляет машину.
 *
 * Тело: `{accepted: boolean, points?: number|null}`. Ответ учителя побеждает
 * навсегда: `decidedBy` становится «teacher», а `modelVerdict`/`confidence`
 * остаются снимком того, что сказала машина. Через месяц по журналу видно,
 * что именно поправил человек, — иначе выправленная ошибка модели выглядела
 * бы как ошибка учителя.
 */
journalRouter.post("/answers/:id/override", async (c) => {
  const user = requireAuth(c);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequestError("Не удалось прочитать оценку");
  }
  const body = OverrideBody.parse(raw);

  const answer = await c.env.DB
    .prepare(
      `SELECT a.id, a.response_id, a.task_number, a.task_type, a.student_answer, a.is_correct,
              a.points_awarded, a.points_max, a.needs_review, a.check_method, a.check_meta_json,
              f.id AS form_id, f.user_id AS form_user_id
       FROM form_answers a
       JOIN form_responses r ON r.id = a.response_id
       JOIN forms f ON f.id = r.form_id
       WHERE a.id = ?1`,
    )
    .bind(c.req.param("id"))
    .first<AnswerRow & { form_id: string; form_user_id: string }>();
  if (!answer) throw new NotFoundError("Ответ не найден");
  if (answer.form_user_id !== user.id) throw new NotFoundError("Ответ не найден");

  const now = Math.floor(Date.now() / 1000);
  const meta = parseCheckMeta(answer.check_meta_json);

  // База для переопределения: то, что уже записано, плюс снимок модели.
  const base: ShortAnswerGrade = {
    isCorrect: answer.is_correct === null ? null : answer.is_correct === 1,
    pointsAwarded: answer.points_awarded,
    needsReview: answer.needs_review === 1,
    checkMethod: answer.check_method as "auto" | "llm" | "manual",
    reason: meta.reason,
    modelVerdict: meta.modelVerdict ?? null,
    confidence: meta.confidence ?? null,
    comment: meta.comment ?? null,
    decidedBy: meta.decidedBy ?? "model",
  };

  const grade = applyTeacherOverride(base, { accepted: body.accepted, points: body.points ?? null }, answer.points_max);

  await c.env.DB
    .prepare(
      `UPDATE form_answers
       SET is_correct = ?1, points_awarded = ?2, needs_review = 0, check_method = 'manual',
           check_meta_json = ?3
       WHERE id = ?4`,
    )
    .bind(
      grade.isCorrect === null ? null : grade.isCorrect ? 1 : 0,
      grade.pointsAwarded,
      buildCheckMeta(grade, { llmChecked: meta.llmChecked === true, decidedAt: now }),
      answer.id,
    )
    .run();

  // Итог работы пересчитываем, иначе в сводке останется балл от машины.
  await c.env.DB
    .prepare(
      `UPDATE form_responses
       SET score_total = COALESCE(
         (SELECT SUM(points_awarded) FROM form_answers WHERE response_id = ?1), 0)
       WHERE id = ?1`,
    )
    .bind(answer.response_id)
    .run();

  // Пересчёт попыток по темам делаем ЗДЕСЬ, а не только по отдельной кнопке.
//
// Учитель закрыл эссе и поставил «2» — это и есть момент, когда работа
// «проверена». Если не пересчитать сейчас, разрез по темам продолжит показывать
// процент, который учитель уже видел исправленным в журнале, и ведомость
// разойдётся сама с собой.
  const recorded = await recomputeFormSkillAttempts(c.env.DB, user.id, answer.form_id);

  return c.json({
    ok: true,
    answer: {
      id: answer.id,
      isCorrect: grade.isCorrect,
      pointsAwarded: grade.pointsAwarded,
      needsReview: grade.needsReview,
      checkMethod: grade.checkMethod,
      state: describeAnswerState({
        isCorrect: grade.isCorrect,
        needsReview: grade.needsReview,
        checkMethod: grade.checkMethod,
        meta: {
          ...meta,
          decidedBy: grade.decidedBy,
          modelVerdict: grade.modelVerdict,
          confidence: grade.confidence,
          comment: grade.comment,
        },
      }),
      decidedBy: grade.decidedBy,
      // Снимок машины сохраняется — но учитель уже поправил.
      modelVerdict: grade.modelVerdict,
      confidence: grade.confidence,
      comment: grade.comment,
      reason: grade.reason ?? null,
      llmChecked: meta.llmChecked === true,
      decidedAt: now,
    },
    // Сколько строк попыток по темам пересчитано. Учителю это число ничего не
    // говорит — оно нужно для проверки, что пересчёт действительно отработал.
    skillAttemptsRecorded: recorded,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Разбор по темам (ТЗ-27)
//
// Эндпоинты живут здесь, а не в `routes/classes.ts`, потому что этот файл —
// единственный в листе, куда у разбора есть доступ к журналу проверок, а
// `classes.ts` на момент написания занят соседней работой. Смысл от этого не
// меняется: числа считает сервер (AD-3 ТЗ-27), владение проверяется до чтения,
// а чужой класс — 404, а не 403.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Проверить владение классом ДО чтения попыток.
 *
 * 404, а не 403 — ровно как в `loadOwnForm` выше: по коду ответа перебором
 * лезть не должен никто. Пустой массив попыток у своего класса — валидный ответ
 * («тем с метками ещё нет»), а не ошибка.
 */
async function loadOwnClassForSkills(
  db: D1Database,
  userId: string,
  classId: string,
): Promise<{ id: string; name: string }> {
  const row = await db
    .prepare(`SELECT id, name FROM classes WHERE id = ?1 AND user_id = ?2`)
    .bind(classId, userId)
    .first<{ id: string; name: string }>();
  if (!row) throw new NotFoundError("Класс не найден");
  return { id: String(row.id), name: String(row.name) };
}

/**
 * GET /api/journal/classes/:id/skills — блок «Темы, где просели».
 *
 * Сортировка по доле верных — на сервере (AD-3): худшая тема сверху, иначе
 * учителю пришлось бы переставлять список глазами перед каждым уроком.
 */
journalRouter.get("/classes/:id/skills", async (c) => {
  const user = requireAuth(c);
  const classId = c.req.param("id");
  await loadOwnClassForSkills(c.env.DB, user.id, classId);

  const attempts = await listSkillAttempts(c.env.DB, user.id, classId);

  return c.json({
    ok: true,
    skills: buildSkillBreakdown(attempts).map((row) => ({
      skill: row.skill,
      correct: row.correct,
      total: row.total,
      attempts: row.attempts,
      percent: row.total > 0 ? Math.round((row.correct / row.total) * 100) : null,
      lastCheckedAt: row.lastCheckedAt,
    })),
  });
});

/**
 * GET /api/journal/classes/:id/skills/:skill — карточка темы.
 *
 * Четыре блока из ТЗ-27 §3: три последние проверки, кто ошибается два раза
 * подряд, разбор по заданиям. Название темы идёт в путь целиком — русские
 * буквы и пробелы закодирует клиент, а не эндпоинт.
 */
journalRouter.get("/classes/:id/skills/:skill", async (c) => {
  const user = requireAuth(c);
  const classId = c.req.param("id");
  const skill = c.req.param("skill").trim();
  await loadOwnClassForSkills(c.env.DB, user.id, classId);

  // Пустая тема в адресе — это битая ссылка, а не «тема без названия»: по
  // пустой строке искать нечего, и молча вернуть пустой разбор значило бы
  // показать учителю «здесь ничего не провалилось».
  if (!skill) throw new BadRequestError("Не указано название темы");

  const attempts = await listSkillAttempts(c.env.DB, user.id, classId, skill);
  const stats = await listTaskStats(c.env.DB, user.id, classId, skill);
  const recent = buildRecentChecks(attempts);

  return c.json({
    ok: true,
    skill,
    recent,
    struggling: findStrugglingStudents(attempts),
    tasks: buildTaskBreakdown(stats, skill),
    trend: trendPercent(recent),
  });
});

/**
 * POST /api/journal/forms/:id/recheck — повторный пересчёт попыток по темам.
 *
 * Зачем учителю такая ручка: он поправил отметки в журнале, и разрез по темам
 * обязан показать новые числа. Пересчёт идёт по данным, а не по сохранённым
 * итогам, — иначе ведомость продолжала бы врать о том, что учитель уже изменил.
 *
 * Форма без меток даёт `recorded: 0` — это норма, а не ошибка: старые листы
 * должны вести себя как раньше.
 */
journalRouter.post("/forms/:id/recheck", async (c) => {
  const user = requireAuth(c);
  const form = await loadOwnForm(c.env.DB, c.req.param("id"), user.id);

  const recorded = await recomputeFormSkillAttempts(c.env.DB, user.id, form.id);
  return c.json({ ok: true, formId: form.id, recorded });
});

export { journalRouter };

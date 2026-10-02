/**
 * `/api/interactives` — учительские эндпоинты интерактивов (TZ-13 §4.5).
 *
 * ВСЕ эндпоинты требуют входа (`requireAuth`): это ЛК учителя, здесь видно
 * всё — конфиг с ответами, имена учеников, сводка. Ученик сюда не попадает,
 * для него есть отдельный файл `routes/interactives-public.ts` БЕЗ авторизации.
 * Граница «здесь нужна авторизация» должна быть видна в коде.
 *
 *   POST   /api/interactives                  — сделать интерактив из листа
 *   GET    /api/interactives/:id              — конфиг + сводка по попыткам
 *   GET    /api/interactives/:id/attempts     — все попытки + топ проваленных
 *   GET    /api/interactives/:id/attempts.csv — CSV для журнала
 *   PATCH  /api/interactives/:id              — переименовать / архивировать
 *
 * Владение проверяется на КАЖДОМ чтении и записи: строка с чужим `user_id`
 * отдаёт 404, а не 403 — иначе по id можно перебором проверить, что такой
 * интерактив существует (тот же приём, что в f07).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/ratelimit";
import { BadRequestError, NotFoundError } from "../lib/errors";
import { interactiveId as makeInteractiveId, interactiveToken } from "../lib/shortid";
import { getWorksheetById } from "../services/worksheet";
import { packInteractive } from "../llm/interactive-pack";
import type {
  InteractiveConfig,
  InteractiveFormat,
  InteractiveOptions,
} from "../lib/interactives/types";
import { INTERACTIVE_FORMATS } from "../lib/interactives/types";

const interactivesRouter = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Строки таблиц
// ─────────────────────────────────────────────────────────────────────────────

interface InteractiveRow {
  id: string;
  worksheet_id: string | null;
  user_id: string | null;
  format: string;
  title: string;
  share_token: string;
  config_json: string;
  config_schema: number;
  status: string;
  created_at: number;
  updated_at: number;
}

interface AttemptRow {
  id: string;
  attempt_token: string;
  student_name: string | null;
  student_class: string | null;
  score: number;
  max_score: number;
  percent: number;
  stars: number;
  duration_s: number | null;
  answers_json: string | null;
  completed_at: number | null;
  created_at: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Лимит на создание интерактива — 20/час на учителя.
 *
 * Каждая сборка = вызов LLM (~$0.001) + валидатор. Кнопка «переделать» без
 * ограничения — это просто способ потратить деньги аккаунта. Повтор с тем же
 * листом и форматом бесплатен (кэш `interactive-pack:...`).
 */
const createLimit = rateLimitMiddleware({
  limit: 20,
  windowSec: 3600,
  bucket: "interactive-create",
  keyFn: (c) => `user:${c.get("user")?.id ?? "anon"}`,
});

/** Публичная ссылка на игру: `<FRONTEND_URL>/play/?t=<token>` (ТЗ Б-4). */
function buildPlayUrl(frontendUrl: string | undefined, token: string): string {
  const base = (frontendUrl ?? "").split(",")[0]?.trim().replace(/\/+$/u, "") || "";
  return `${base}/play/?t=${token}`;
}

/**
 * Прочитать интерактив и убедиться, что он принадлежит учителю.
 *
 * Чужой id → 404, а не 403: по ответу нельзя отличить «нет такого» от
 * «есть, но не твой» и перебрать чужие интерактивы.
 */
async function loadOwnInteractive(
  db: D1Database,
  id: string,
  userId: string,
): Promise<InteractiveRow> {
  const row = await db
    .prepare(
      `SELECT id, worksheet_id, user_id, format, title, share_token, config_json,
              config_schema, status, created_at, updated_at
       FROM interactives WHERE id = ?1`,
    )
    .bind(id)
    .first<InteractiveRow>();
  if (!row || row.user_id !== userId) throw new NotFoundError("Интерактив не найден");
  return row;
}

/** Разобрать config_json. Битый конфиг — пустой объект, роут не падает. */
function parseConfig(json: string): InteractiveConfig | null {
  try {
    const parsed = JSON.parse(json) as InteractiveConfig;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Событие в `events` — та же таблица, что у листов и форм. */
async function logInteractiveEvent(
  db: D1Database,
  params: { userId: string; name: string; data: Record<string, unknown> },
): Promise<void> {
  const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db
      .prepare(`INSERT INTO events (id, user_id, name, data_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(id, params.userId, params.name, JSON.stringify(params.data), Math.floor(Date.now() / 1000))
      .run();
  } catch {
    // Аналитика не должна ронять создание интерактива.
  }
}

/** Сводка «как сыграл класс» — учителю на главный экран. */
function summarizeAttempts(rows: AttemptRow[]): {
  attempts: number;
  finished: number;
  averagePercent: number;
  bestPercent: number;
  withStars3: number;
} {
  const finished = rows.filter((r) => r.completed_at !== null);
  const totalPercent = rows.reduce((acc, r) => acc + r.percent, 0);
  return {
    attempts: rows.length,
    finished: finished.length,
    averagePercent: rows.length === 0 ? 0 : Math.round(totalPercent / rows.length),
    bestPercent: rows.reduce((max, r) => Math.max(max, r.percent), 0),
    withStars3: rows.filter((r) => r.stars === 3).length,
  };
}

/**
 * Агрегат по заданию для «какой вопрос все провалили».
 *
 * Считается из `itemResults`, который писал СЕРВЕР при submit (ТЗ §4.5).
 * Задания, на которые никто не ответил, в список не попадают: у них нет доли
 * правильных, и в топе они были бы шумом.
 */
function hardestItems(rows: AttemptRow[], config: InteractiveConfig | null): Array<{
  itemId: string;
  prompt: string;
  answered: number;
  correct: number;
  ratio: number;
}> {
  const promptById = new Map<string, string>();
  if (config) {
    for (const item of config.items) promptById.set(item.id, item.prompt);
  }

  const answeredBy = new Map<string, number>();
  const correctBy = new Map<string, number>();
  for (const attempt of rows) {
    if (!attempt.answers_json) continue;
    try {
      const parsed = JSON.parse(attempt.answers_json) as { itemResults?: unknown };
      if (!Array.isArray(parsed.itemResults)) continue;
      for (const raw of parsed.itemResults) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as { itemId?: unknown; correct?: unknown };
        if (typeof entry.itemId !== "string") continue;
        answeredBy.set(entry.itemId, (answeredBy.get(entry.itemId) ?? 0) + 1);
        if (entry.correct === true) {
          correctBy.set(entry.itemId, (correctBy.get(entry.itemId) ?? 0) + 1);
        }
      }
    } catch {
      // битый answers_json — просто не учитываем в агрегате
    }
  }

  const stats: Array<{ itemId: string; prompt: string; answered: number; correct: number; ratio: number }> = [];
  for (const [itemId, answered] of answeredBy) {
    const correct = correctBy.get(itemId) ?? 0;
    stats.push({
      itemId,
      prompt: promptById.get(itemId) ?? "",
      answered,
      correct,
      ratio: answered > 0 ? correct / answered : 0,
    });
  }

  // Сортировка: чем ниже доля правильных, тем «сложнее» задание. При равенстве
  // больше ответов = надёжнее оценка, поэтому такой выше.
  return stats.sort((a, b) => a.ratio - b.ratio || b.answered - a.answered).slice(0, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Схемы входа
// ─────────────────────────────────────────────────────────────────────────────

const CreateBody = z.object({
  worksheetId: z.string().min(1).max(64),
  format: z.enum(INTERACTIVE_FORMATS as unknown as [string, ...string[]]),
  options: z.record(z.unknown()).optional(),
});

const PatchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), title: z.string().min(1).max(120) }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("restore") }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/interactives — сделать интерактив из листа
// ─────────────────────────────────────────────────────────────────────────────

interactivesRouter.post("/", createLimit, async (c) => {
  const user = requireAuth(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const body = CreateBody.parse(rawBody);
  const format = body.format as InteractiveFormat;
  const options = (body.options ?? {}) as InteractiveOptions;

  // Лист читаем по id и ПРОВЕРЯЕМ, что он наш: иначе учитель собрал бы
  // интерактив из чужого платного листа.
  const worksheet = await getWorksheetById(c.env.DB, body.worksheetId);
  if (!worksheet) throw new NotFoundError("Рабочий лист не найден");

  const worksheetRow = await c.env.DB
    .prepare(`SELECT user_id FROM worksheets WHERE id = ?1`)
    .bind(body.worksheetId)
    .first<{ user_id: string | null }>();
  if (worksheetRow && worksheetRow.user_id && worksheetRow.user_id !== user.id) {
    throw new NotFoundError("Рабочий лист не найден");
  }
  if (!worksheet.tasks || worksheet.tasks.length === 0) {
    throw new BadRequestError("В листе нет заданий — интерактив из него не собрать");
  }

  // Ранклер: кэш → LLM → валидация. Секрет не нужен наружу, роут сам решает.
  const packed = await packInteractive(
    {
      worksheet,
      worksheetId: body.worksheetId,
      format,
      options,
      userId: user.id,
      plan: user.plan,
    },
    c.env,
    c.env.DB,
  );

  const now = Math.floor(Date.now() / 1000);
  const id = makeInteractiveId();
  const token = interactiveToken();

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO interactives
           (id, worksheet_id, user_id, format, title, share_token, config_json,
            config_schema, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?9)`,
      )
      .bind(
        id,
        body.worksheetId,
        user.id,
        format,
        packed.config.title,
        token,
        JSON.stringify(packed.config),
        packed.config.schemaVersion ?? 1,
        now,
      )
      .run();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[interactives] INSERT failed:", err, { userId: user.id, interactiveId: id });
    throw new BadRequestError("Не удалось сохранить интерактив");
  }

  await logInteractiveEvent(c.env.DB, {
    userId: user.id,
    name: "interactive.created",
    data: {
      interactiveId: id,
      worksheetId: body.worksheetId,
      format,
      items: packed.config.items.length,
      model: packed.model,
      cached: packed.cached,
      costUsd: packed.costUsd,
      latencyMs: packed.latencyMs,
      validationScore: packed.validationScore,
      issues: packed.issues.length,
    },
  });

  return c.json(
    {
      ok: true,
      id,
      shareToken: token,
      url: buildPlayUrl(c.env.FRONTEND_URL, token),
      // Тот же токен едет в QR: фронт рисует `qrPayload` как обычную строку.
      qrPayload: buildPlayUrl(c.env.FRONTEND_URL, token),
      format,
      title: packed.config.title,
      items: packed.config.items.length,
      validationScore: packed.validationScore,
      issues: packed.issues,
      model: packed.model,
      cached: packed.cached,
    },
    201,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/interactives — список для ЛК
//
// ⚠️ Эндпоинта НЕТ в таблице ТЗ §4.5 (там только POST /, :id, :id/attempts,
// :id/attempts.csv, PATCH /:id). Фронт (/src/lib/interactives/api.ts,
// `listInteractives`) без него не может собрать раздел «Интерактивы» в ЛК
// (ТЗ §4.9) и сам просил его добавить. Поэтому он здесь — как простая
// выборка с агрегатом, без новых таблиц и без новых прав.
// ─────────────────────────────────────────────────────────────────────────────

interactivesRouter.get("/", async (c) => {
  const user = requireAuth(c);

  const result = await c.env.DB
    .prepare(
      `SELECT i.id, i.format, i.title, i.status, i.created_at,
              w.subject AS subject, w.grade AS grade,
              (SELECT COUNT(*) FROM interactive_attempts a
                WHERE a.interactive_id = i.id AND a.completed_at IS NOT NULL) AS attempts_count,
              (SELECT AVG(a.percent) FROM interactive_attempts a
                WHERE a.interactive_id = i.id AND a.completed_at IS NOT NULL) AS percent_avg
       FROM interactives i
       LEFT JOIN worksheets w ON w.id = i.worksheet_id
       WHERE i.user_id = ?1
       ORDER BY i.created_at DESC
       LIMIT 100`,
    )
    .bind(user.id)
    .all<{
      id: string;
      format: string;
      title: string;
      status: string;
      created_at: number;
      subject: string | null;
      grade: number | null;
      attempts_count: number;
      percent_avg: number | null;
    }>();

  const rows = result.results ?? [];

  return c.json({
    ok: true,
    interactives: rows.map((r) => ({
      id: r.id,
      title: r.title,
      format: r.format,
      status: r.status,
      ...(r.subject ? { subject: r.subject } : {}),
      ...(typeof r.grade === "number" ? { grade: r.grade } : {}),
      createdAt: r.created_at,
      attemptsCount: r.attempts_count ?? 0,
      // null = попыток ещё нет (фронт различает «нет данных» и «ноль»).
      percentAvg: r.percent_avg === null ? null : Math.round(r.percent_avg),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/interactives/:id — конфиг + счётчики для сводки учителя
// ─────────────────────────────────────────────────────────────────────────────

interactivesRouter.get("/:id", async (c) => {
  const user = requireAuth(c);
  const id = c.req.param("id");
  // Бросает 404, если интерактив не найден или принадлежит другому учителю,
  // поэтому вызов — это и проверка прав, и источник данных ниже.
  const row = await loadOwnInteractive(c.env.DB, id, user.id);

  const attempts = await c.env.DB
    .prepare(
      `SELECT id, attempt_token, student_name, student_class, score, max_score, percent,
              stars, duration_s, answers_json, completed_at, created_at
       FROM interactive_attempts WHERE interactive_id = ?1 ORDER BY created_at DESC LIMIT 200`,
    )
    .bind(id)
    .all<AttemptRow>();

  const rows = attempts.results ?? [];
  const summary = summarizeAttempts(rows);

  return c.json({
    ok: true,
    // Конверт `{ ok, interactive }` — тот же, что ждёт клиент
    // (`getInteractive` в src/lib/interactives/api.ts читает body.interactive).
    interactive: {
      id: row.id,
      title: row.title,
      format: row.format,
      status: row.status,
      // Учитель видит конфиг ЦЕЛИКОМ, вместе с correctIndex/isTrue: ему нужен
      // разбор результатов. Балсы всё равно считает сервер.
      config: parseConfig(row.config_json),
      // Сколько всего учеников получили ссылку — продукт не знает
      // (учитель знает из класса), фронт показывает это поле как «спроси учителя».
      expectedStudents: null,
      attemptsCount: summary.attempts,
      createdAt: row.created_at,
      // Ссылка для QR: фронт кладёт её в обёртку.
      shareUrl: buildPlayUrl(c.env.FRONTEND_URL, row.share_token),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/interactives/:id/attempts — попытки + «сложные задания»
// ─────────────────────────────────────────────────────────────────────────────

interactivesRouter.get("/:id/attempts", async (c) => {
  const user = requireAuth(c);
  const id = c.req.param("id");
  const row = await loadOwnInteractive(c.env.DB, id, user.id);
  const config = parseConfig(row.config_json);

  const result = await c.env.DB
    .prepare(
      `SELECT id, attempt_token, student_name, student_class, score, max_score, percent,
              stars, duration_s, answers_json, completed_at, created_at
       FROM interactive_attempts WHERE interactive_id = ?1 ORDER BY created_at DESC LIMIT 1000`,
    )
    .bind(id)
    .all<AttemptRow>();

  const rows = result.results ?? [];

  return c.json({
    ok: true,
    // `hardestItems` — топ-3 заданий с наименьшей долей правильных; именно
    // это поле читает фронт (ТЗ §4.5 «топ проваленных вопросов»).
    attempts: rows.map((r) => ({
      id: r.id,
      // Ученик мог не ввести имя — отдаём пустую строку, а не null:
      // в таблице учителя это строка.
      studentName: r.student_name ?? "",
      studentClass: r.student_class,
      score: r.score,
      maxScore: r.max_score,
      percent: r.percent,
      stars: r.stars,
      durationS: r.duration_s,
      completed: r.completed_at !== null,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })),
    hardestItems: hardestItems(rows, config),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/interactives/:id/attempts.csv — журнал
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Экранирование ячейки CSV: разделитель, кавычка, перенос строки.
 *
 * Разделитель — ТОЧКА С ЗАПЯТОЙ, а не запятая: русский Excel по умолчанию
 * открывает CSV именно с `;` и с запятой разваливает файл на колонки.
 */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /["\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interactivesRouter.get("/:id/attempts.csv", async (c) => {
  const user = requireAuth(c);
  const id = c.req.param("id");
  // Нужен ради проверки прав: loadOwnInteractive бросает 404, если интерактив
  // не найден или принадлежит другому учителю. Сам объект в CSV не нужен —
  // все колонки берутся из запроса ниже, поэтому результат не присваиваем.
  await loadOwnInteractive(c.env.DB, id, user.id);

  const result = await c.env.DB
    .prepare(
      `SELECT student_name, student_class, score, max_score, percent, stars, duration_s,
              completed_at, created_at
       FROM interactive_attempts WHERE interactive_id = ?1 ORDER BY percent DESC, created_at ASC`,
    )
    .bind(id)
    .all<AttemptRow>();

  const rows = result.results ?? [];
  const header = ["Имя", "Класс", "Баллы", "Макс", "Процент", "Звёзды", "Время, с", "Завершён", "Начат"];

  const lines = [header.map(csvCell).join(";")];
  for (const r of rows) {
    // Даты отдаём в локальном виде ISO-подобной строки: журнал открывают в
    // Excel/Таблицах, unix-секунды там бесполезны.
    const iso = (sec: number | null): string => (sec ? new Date(sec * 1000).toISOString().slice(0, 19).replace("T", " ") : "");
    lines.push(
      [
        r.student_name ?? "",
        r.student_class ?? "",
        r.score,
        r.max_score,
        r.percent,
        r.stars,
        r.duration_s ?? "",
        iso(r.completed_at),
        iso(r.created_at),
      ]
        .map(csvCell)
        .join(";"),
    );
  }

  // BOM — иначе Excel откроет кириллицу в 1251 и покажет кракозябры.
  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="interactive-${id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/interactives/:id — переименовать / архивировать
// ─────────────────────────────────────────────────────────────────────────────

interactivesRouter.patch("/:id", async (c) => {
  const user = requireAuth(c);
  const id = c.req.param("id");

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const body = PatchBody.parse(rawBody);
  await loadOwnInteractive(c.env.DB, id, user.id);

  const now = Math.floor(Date.now() / 1000);
  if (body.action === "rename") {
    await c.env.DB
      .prepare(`UPDATE interactives SET title = ?1, updated_at = ?2 WHERE id = ?3`)
      .bind(body.title, now, id)
      .run();
  } else {
    const status = body.action === "archive" ? "archived" : "active";
    await c.env.DB
      .prepare(`UPDATE interactives SET status = ?1, updated_at = ?2 WHERE id = ?3`)
      .bind(status, now, id)
      .run();
  }

  await logInteractiveEvent(c.env.DB, {
    userId: user.id,
    name: "interactive.updated",
    data: { interactiveId: id, action: body.action },
  });

  return c.json({ ok: true, id, action: body.action });
});

export { interactivesRouter };

/**
 * `/api/public/interactives` — публичный бэк игровых интерактивов (TZ-13 §4.5).
 *
 * ОТДЕЛЬНЫЙ ФАЙЛ СПЕЦИАЛЬНО, как `routes/publicForms.ts` (TZ-12): всё, что
 * здесь живёт, доступно по одной ссылке без логина. Граница «здесь нет
 * авторизации» должна быть видна в коде. Учительские роуты — в
 * `routes/interactives.ts` под `requireAuth`.
 *
 *   GET  /api/public/interactives/p/:code                          — короткая ссылка `/p/<код>`
 *   GET  /api/public/interactives/:token                            — конфиг для ученика
 *   POST /api/public/interactives/:token/attempts                   — начать/восстановить попытку
 *   POST /api/public/interactives/:token/attempts/:attemptToken/submit — отправить результат
 *
 * Первый путь в списке отличается от остальных: это НЕ API для ученика, а
 * разворот ссылки для доски (`https://uchlist.ru/p/<код>` → 302 на
 * `/play/?t=<токен>`). Подробности — в секции «КОРОТКАЯ ССЫЛКА ДЛЯ ДОСКИ» внизу.
 *
 * ═══ ЖЁСТКОЕ ПРАВИЛО БЕЗОПАСНОСТИ ════════════════════════════════════════
 * 1. `GET /:token` отдаёт РОВНО `config_json` и ничего больше. Ни `user_id`,
 *    ни email учителя, ни subject/grade сверх того, что уже есть в конфиге.
 *    Реализовано ЯВНЫМ whitelist'ом объекта ответа, а не `delete` из строки:
 *    новая колонка в `interactives` не должна утечь автоматически.
 *
 * 2. `submit` НЕ ДОВЕРЯЕТ клиентским `score` / `maxScore` / `percent` / `stars`.
 *    Тело их принимает (фронт их шлёт), но они не попадают ни в INSERT, ни в
 *    UPDATE: значения пересчитывает `scoreAttempt(config, answers)` из
 *    `config_json`, который лежит в D1. Подменить баллы в DevTools бессмысленно.
 *
 * 3. Самопроверка (ТЗ §4.7): если присланный клиентом счёт НЕ совпал с
 *    эталонным, пишем событие `interactive.score_mismatch` в `events` — это
 *    метрика качества, которую смотрим в проде. Сама попытка при этом
 *    сохраняется с ПРАВИЛЬНЫМ счётом.
 *
 * 4. Из `answers_json` наружу (в попытку) пишем только серверный разбор:
 *    `wrongItemIds` (сверено с эталоном) и сводку. Сырые `answers[]` от
 *    клиента не сохраняются — иначе «правильные» флаги клиента оселись бы в базе.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv } from "../types";
import { rateLimitMiddleware, djb2 } from "../middleware/ratelimit";
import { throwApiError } from "../lib/errors";
import {
  attemptId as makeAttemptId,
  attemptToken as makeAttemptToken,
} from "../lib/shortid";
import { scoreAttempt } from "../services/interactives-scoring";
import type {
  AttemptAnswer,
  InteractiveConfig,
  InteractiveScore,
} from "../lib/interactives/types";

const publicInteractivesRouter = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Строки таблиц
// ─────────────────────────────────────────────────────────────────────────────

/** Колонки, которые реально нужны публичному роутеру. */
interface PublicInteractiveRow {
  id: string;
  worksheet_id: string | null;
  format: string;
  title: string;
  share_token: string;
  config_json: string;
  status: string;
  /** Срок жизни ссылки в unix-секундах. NULL = бессрочно. */
  expires_at: number | null;
  /** Из листа: предмет и класс. Фронт показывает их в шапке игры. */
  subject: string | null;
  grade: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Лимиты
// ─────────────────────────────────────────────────────────────────────────────

/** Токен из `:token` (для ключей rate-limit) либо из пути, если param пуст. */
function tokenFromRequest(c: { req: { param(key: string): string | undefined; path: string } }): string {
  const fromParam = c.req.param("token");
  if (fromParam) return fromParam;
  // /api/public/interactives/<token>/... → "<token>"
  const segments = c.req.path.split("/").filter(Boolean);
  return segments[3] ?? "unknown";
}

/**
 * Открытие игры — 240/мин на IP.
 *
 * Класс из 30 человек на школьном Wi-Fi — норма, поэтому потолок по IP
 * большой: это защита от бота, а не «на человека».
 */
const playGetLimit = rateLimitMiddleware({
  limit: 240,
  windowSec: 60,
  bucket: "interactive-play",
  keyFn: (c) => `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/**
 * Начало попытки — 30/час на пару (игра + IP).
 *
 * Ключ составной по той же причине, что у форм в TZ-12: 30 учеников с одного
 * Wi-Fi за урок должны пройти, а вот «анонимно создать 1000 попыток» — нет.
 */
const startAttemptLimit = rateLimitMiddleware({
  limit: 30,
  windowSec: 3600,
  bucket: "interactive-attempt-start",
  keyFn: (c) => `int:${tokenFromRequest(c)}:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/** Отправка — 10/час на пару (игра + IP): одна попытка = одна отправка. */
const submitLimit = rateLimitMiddleware({
  limit: 10,
  windowSec: 3600,
  bucket: "interactive-submit",
  keyFn: (c) => `int:${tokenFromRequest(c)}:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/** Глобальный потолок по IP против бота, долбящего тысячу игр. */
const submitIpLimit = rateLimitMiddleware({
  limit: 300,
  windowSec: 3600,
  bucket: "interactive-submit-ip",
  keyFn: (c) => `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

// ─────────────────────────────────────────────────────────────────────────────
// Загрузка и разбор
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Найти интерактив по публичному токену или отдать ученику 404.
 *
 * JOIN на worksheets — только за subject/grade для шапки игры. Никаких полей
 * учителя (user_id, email) в выборку не берём: их там нет и не должно быть.
 */
async function loadByToken(db: D1Database, token: string): Promise<PublicInteractiveRow> {
  const row = await db
    .prepare(
      `SELECT i.id, i.worksheet_id, i.format, i.title, i.share_token, i.config_json, i.status,
              i.expires_at, w.subject AS subject, w.grade AS grade
       FROM interactives i
       LEFT JOIN worksheets w ON w.id = i.worksheet_id
       WHERE i.share_token = ?1`,
    )
    .bind(token)
    .first<PublicInteractiveRow>();
  if (!row) {
    throwApiError(404, "INTERACTIVE_NOT_FOUND", "Ссылка неправильная. Попросите учителя прислать её ещё раз");
  }
  return row;
}

/**
 * Проверить срок жизни ссылки.
 *
 * `expires_at` NULL = бессрочно (учитель срок не задавал) — это не ошибка,
 * такая ссылка работает, пока учитель её не закроет. Истёкшая ссылка отдаёт
 * 410 `INTERACTIVE_EXPIRED`: ученик должен увидеть понятное «срок истёк»,
 * а не пустую игру, из которой вычесть баллы уже нельзя.
 *
 * Вынесено отдельно, потому что проверка нужна в нескольких хендлерах, а
 * молча забыть её в одном из них — значит отдать 404 на живой ссылке.
 */
function assertNotExpired(row: PublicInteractiveRow): void {
  if (typeof row.expires_at !== "number" || row.expires_at <= 0) return;
  if (Date.now() >= row.expires_at * 1000) {
    throwApiError(410, "INTERACTIVE_EXPIRED", "Срок игры истёк. Попросите учителя прислать новую ссылку");
  }
}

/**
 * Разобрать конфиг. Конфиг — единственный источник эталона для скоринга,
 * поэтому битый конфиг = 500 для ученика («попробуй позже»), а не тихий ноль:
 * тихий ноль ученик примет за свой результат.
 */
function parseConfig(row: PublicInteractiveRow): InteractiveConfig {
  try {
    const parsed = JSON.parse(row.config_json) as InteractiveConfig;
    if (!parsed || !Array.isArray(parsed.items)) throw new Error("no items");
    return parsed;
  } catch {
    throwApiError(500, "INTERACTIVE_BROKEN", "Игра не загрузилась. Попросите учителя пересоздать её");
  }
}

/** Сколько попыток дошло до финиша — для счётчика «уже сыграли». */
async function countFinishedAttempts(db: D1Database, interactiveId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM interactive_attempts
       WHERE interactive_id = ?1 AND completed_at IS NOT NULL`,
    )
    .bind(interactiveId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Событие в `events` — та же таблица, что у листов и форм. */async function logEvent(
  db: D1Database,
  params: { name: string; userId: string | null; data: Record<string, unknown> },
): Promise<void> {
  const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db
      .prepare(`INSERT INTO events (id, user_id, name, data_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(id, params.userId, params.name, JSON.stringify(params.data), Math.floor(Date.now() / 1000))
      .run();
  } catch {
    // Аналитика не должна ломать игру.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Валидация входа
// ─────────────────────────────────────────────────────────────────────────────

const StartAttemptBody = z.object({
  // Повторный вызов с attemptToken восстанавливает попытку (ученик закрыл вкладку).
  attemptToken: z.string().min(8).max(64).optional(),
  studentName: z.string().max(100).optional(),
  studentClass: z.string().max(40).optional(),
});

const AnswerSchema = z.object({
  itemId: z.string().min(1).max(64),
  chosenIndex: z.number().int().min(0).max(50).optional(),
  chosenTrue: z.boolean().optional(),
  chosenBucket: z.string().max(60).optional(),
  chosenOrder: z.array(z.string().max(64)).max(60).optional(),
  secondTry: z.boolean().optional(),
  player: z.string().max(60).optional(),
  ms: z.number().int().min(0).max(3_600_000).optional(),
});

const SubmitBody = z.object({
  // Клиент присылает свои score/maxScore/percent/stars — они ПРИНИМАЮТСЯ
  // (чтобы не ломать старый фронт), но дальше НЕ ИСПОЛЬЗУЮТСЯ: см. правило 2
  // в шапке файла. Отдельная схема их не описывает намеренно.
  score: z.number().optional(),
  maxScore: z.number().optional(),
  percent: z.number().optional(),
  stars: z.number().optional(),
  durationS: z.number().int().min(0).max(86_400).optional(),
  studentName: z.string().max(100).optional(),
  studentClass: z.string().max(40).optional(),
  answers: z.array(AnswerSchema).max(300).default([]),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/interactives/:token — конфиг для ученика
// ─────────────────────────────────────────────────────────────────────────────

publicInteractivesRouter.get("/:token", playGetLimit, async (c) => {
  const token = c.req.param("token");
  const row = await loadByToken(c.env.DB, token);

  if (row.status === "archived") {
    throwApiError(410, "INTERACTIVE_ARCHIVED", "Учитель закрыл эту игру");
  }

  // Срок жизни ссылки. `expires_at` NULL = бессрочно (учитель не задал срок) —
  // тогда проверка пропускается. Фронт ждёт именно код `INTERACTIVE_EXPIRED`
  // и поле `expiresAt` в теле (см. src/lib/interactives/api.ts:318, :350).
  assertNotExpired(row);

  const config = parseConfig(row);

  // ── WHITELIST ОТВЕТА ────────────────────────────────────────────────────
  // Конверт `{ ok, interactive }` — тот же, что ждёт клиент
  // (`loadPublicInteractive` в src/lib/interactives/api.ts читает body.interactive
  // и парсит ПЛОСКИЙ InteractiveConfig: format/title/items/options/schemaVersion).
  //
  // Внутри — только поля, которые нужны игре. Здесь НЕТ и не должно быть:
  // `id` интерактива, `share_token` (он и так в URL), `user_id`, email или
  // имени учителя, subject/grade листа, кроме как разрешённые шапкой.
  // Ответ собирается ЯВНЫМ перечислением, а не разворачиванием строки таблицы
  // и не `delete` по полям: новая колонка не должна утекать сама.
  return c.json({
    ok: true,
    interactive: {
      format: config.format,
      title: config.title,
      items: config.items,
      options: config.options,
      schemaVersion: config.schemaVersion ?? 1,
      // `expiresAt` — unix-секунды, как их ждёт фронт
      // (`PublicInteractive.expiresAt`). NULL → поле не отдаём, клиент
      // трактует отсутствие как «бессрочно».
      ...(typeof row.expires_at === "number" && row.expires_at > 0
        ? { expiresAt: row.expires_at }
        : {}),
      ...(row.subject ? { subject: row.subject } : {}),
      ...(typeof row.grade === "number" ? { grade: row.grade } : {}),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/interactives/:token/attempts — начать/восстановить
// ─────────────────────────────────────────────────────────────────────────────

publicInteractivesRouter.post("/:token/attempts", startAttemptLimit, async (c) => {
  const token = c.req.param("token");
  const row = await loadByToken(c.env.DB, token);
  if (row.status === "archived") {
    throwApiError(410, "INTERACTIVE_ARCHIVED", "Учитель закрыл эту игру");
  }
  // Истёкшая ссылка не должна принимать новые попытки: конфиг ещё в базе,
  // но выставлять баллы по нему уже нельзя — учитель снял игру с доски.
  assertNotExpired(row);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json().catch(() => ({}));
  } catch {
    rawBody = {};
  }
  const body = StartAttemptBody.parse(rawBody ?? {});

  const now = Math.floor(Date.now() / 1000);

  // Восстановление: попытка по токену. Проверяем, что она ИМЕННО этого
  // интерактива — иначе по чужому attemptToken можно было бы открыть чужую
  // попытку и дописать в неё ответы.
  if (body.attemptToken) {
    const existing = await c.env.DB
      .prepare(
        `SELECT id, interactive_id, student_name
         FROM interactive_attempts WHERE attempt_token = ?1`,
      )
      .bind(body.attemptToken)
      .first<{ id: string; interactive_id: string; student_name: string | null }>();

    if (existing && existing.interactive_id === row.id) {
      return c.json({
        ok: true,
        attemptToken: body.attemptToken,
        resumed: true,
        studentName: existing.student_name,
      });
    }
    // Попытка по чужому токену (или её нет) — молча начинаем новую: так
    // ученик с протухшим токеном не застревает на ошибке.
  }

  const attemptId = makeAttemptId();
  const newToken = makeAttemptToken();

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO interactive_attempts
           (id, interactive_id, attempt_token, student_name, student_class,
            score, max_score, percent, stars, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0, 0, ?6, ?6)`,
      )
      .bind(
        attemptId,
        row.id,
        newToken,
        body.studentName?.trim() || null,
        body.studentClass?.trim() || null,
        now,
      )
      .run();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[public/interactives] INSERT attempt failed:", err, { interactiveId: row.id });
    throwApiError(500, "ATTEMPT_FAILED", "Не удалось начать игру. Попробуй ещё раз");
  }

  return c.json(
    {
      ok: true,
      attemptToken: newToken,
      resumed: false,
      studentName: body.studentName?.trim() || null,
    },
    201,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// POST .../submit — отправить результат
// ─────────────────────────────────────────────────────────────────────────────

publicInteractivesRouter.post("/:token/attempts/:attemptToken/submit", submitLimit, submitIpLimit, async (c) => {
  const token = c.req.param("token");
  const attemptTokenValue = c.req.param("attemptToken");
  const row = await loadByToken(c.env.DB, token);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throwApiError(400, "BAD_REQUEST", "Не удалось прочитать ответы");
  }
  const body = SubmitBody.parse(rawBody);

  // Попытка должна существовать и принадлежать ИМЕННО этому интерактиву.
  const attempt = await c.env.DB
    .prepare(
      `SELECT id, interactive_id, student_name, student_class, completed_at
       FROM interactive_attempts WHERE attempt_token = ?1`,
    )
    .bind(attemptTokenValue)
    .first<{
      id: string;
      interactive_id: string;
      student_name: string | null;
      student_class: string | null;
      completed_at: number | null;
    }>();

  if (!attempt || attempt.interactive_id !== row.id) {
    throwApiError(404, "ATTEMPT_NOT_FOUND", "Попытка не найдена. Начни игру заново");
  }

  // Повторная отправка — возвращаем тот же результат, что и в первый раз.
  // Иначе «двойной клик» затирал бы баллы и ломал рейтинг класса.
  if (attempt.completed_at !== null) {
    const stored = await c.env.DB
      .prepare(`SELECT score, max_score, percent, stars FROM interactive_attempts WHERE id = ?1`)
      .bind(attempt.id)
      .first<{ score: number; max_score: number; percent: number; stars: number }>();
    return c.json({
      ok: true,
      alreadySubmitted: true,
      score: stored?.score ?? 0,
      maxScore: stored?.max_score ?? 0,
      percent: stored?.percent ?? 0,
      stars: stored?.stars ?? 0,
    });
  }

  // ── КЛЮЧЕВОЙ МОМЕНТ: счёт считает сервер, не клиент ─────────────────────
  const config = parseConfig(row);
  const answers = body.answers as AttemptAnswer[];
  const graded: InteractiveScore = scoreAttempt(config, answers);

  // Самопроверка ТЗ §4.7: расхождение с клиентским счётом — сигнал качества.
  const clientPercent =
    typeof body.percent === "number" && Number.isFinite(body.percent) ? Math.round(body.percent) : null;
  if (clientPercent !== null && clientPercent !== graded.percent) {
    await logEvent(c.env.DB, {
      name: "interactive.score_mismatch",
      userId: null,
      data: {
        interactiveId: row.id,
        attemptId: attempt.id,
        format: row.format,
        clientPercent,
        serverPercent: graded.percent,
        // Разница нужна, чтобы отличить «клиент посчитал иначе» от «клиент подделал».
        delta: clientPercent - graded.percent,
        items: config.items.length,
        answered: answers.length,
      },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  // `durationS` приходит от клиента и не проверяется: длительность не влияет на
  // баллы, а проверять её можно было бы только по серверным таймстемпам.
  // Мы их знаем — created_at, но разница между «начал» и «отправил» включает
  // время на чтение вопросов, поэтому берём клиентское значение как есть.
  const durationS = typeof body.durationS === "number" ? body.durationS : null;

  // В answers_json кладём ТОЛЬКО серверный разбор: `itemResults` уже сверено с
  // эталоном тем же кодом, что и баллы. Сырые клиентские `correct`-флаги и
  // сами ответы ученика в базу не попадают.
  const answersJson = JSON.stringify({
    itemResults: graded.itemResults,
    wrongItemIds: graded.wrongItemIds,
    correct: graded.detail.correct,
    wrong: graded.detail.wrong,
    total: graded.detail.total,
    sectorProgress: graded.detail.sectorProgress ?? null,
    playerScores: graded.detail.playerScores ?? null,
    winner: graded.detail.winner ?? null,
    positionsCorrect: graded.detail.positionsCorrect ?? null,
  });

  try {
    await c.env.DB
      .prepare(
        `UPDATE interactive_attempts
            SET score = ?1, max_score = ?2, percent = ?3, stars = ?4,
                duration_s = ?5, answers_json = ?6, completed_at = ?7, updated_at = ?7,
                student_name = COALESCE(?8, student_name),
                student_class = COALESCE(?9, student_class)
          WHERE id = ?10`,
      )
      .bind(
        graded.score,
        graded.maxScore,
        graded.percent,
        graded.stars,
        durationS,
        answersJson,
        now,
        body.studentName?.trim() || null,
        body.studentClass?.trim() || null,
        attempt.id,
      )
      .run();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[public/interactives] UPDATE attempt failed:", err, { attemptId: attempt.id });
    throwApiError(500, "SUBMIT_FAILED", "Не удалось сохранить результат. Попробуй ещё раз");
  }

  // Событие разбора — на него смотрит учитель в сводке (topMissed).
  await logEvent(c.env.DB, {
    name: "interactive.attempt_submitted",
    userId: null,
    data: {
      interactiveId: row.id,
      attemptId: attempt.id,
      format: row.format,
      percent: graded.percent,
      stars: graded.stars,
      wrong: graded.detail.wrong,
      total: graded.detail.total,
      durationS,
    },
  });

  return c.json({
    ok: true,
    alreadySubmitted: false,
    // Всё, что ниже, посчитано сервером. Клиентские значения не возвращаем и
    // не смешиваем — фронт обязан показать именно это.
    score: graded.score,
    maxScore: graded.maxScore,
    percent: graded.percent,
    stars: graded.stars,
    detail: graded.detail,
    // Сколько человек уже закончили игру — фронт показывает это в финале.
    attemptsCount: await countFinishedAttempts(c.env.DB, row.id),
  });
});

// ════════════════════════════════════════════════════════════════════════════
// КОРОТКАЯ ССЫЛКА ДЛЯ ДОСКИ — `/p/<код>` (лист 6.1.8)
// ════════════════════════════════════════════════════════════════════════════

/**
 * ─── Где живёт `/p/<код>` и почему его отдаёт сервер ─────────────────────────
 *
 * Сайт собирается статикой (`next.config.mjs` → `output: "export"`). Страницы
 * «про код» в сборке нет и быть не может: коды рождаются в рантайме. `/p/<код>`
 * — не страница, а разворот ссылки, поэтому раздаёт его бэкенд.
 *
 * Цепочка целиком:
 *   https://uchlist.ru/p/<код>            ← учитель пишет на доске
 *     → Pages, правило `/p/*` в `public/_redirects` (прокси, не 301)
 *       → https://api.uchlist.ru/api/public/interactives/p/<код>
 *         → воркер: 302 на https://uchlist.ru/play/?t=<полный токен>
 *
 * ПОЧЕМУ ПУТЬ НА ВОРКЕРЕ ИМЕЕТ ПРЕФИКС `/api/public/interactives`. Роутер
 * подключён в `src/index.ts` как `app.route("/api/public/interactives", …)`,
 * а Hono при `route()` НАВЕШИВАЕТ префикс на каждый путь подроутка (проверено
 * в `hono/dist/hono-base.js`, `route()` → `basePath()` → `#addRoute`). Снять
 * этот префикс изнутри файла нельзя. Путь на воркере длиннее ровно на
 * `/api/public/interactives`, но учитель его не видит: он написан один раз в
 * `_redirects` и работает на любом домене Pages-проекта.
 *
 * ─── Почему код — ПРЕФИКС share_token, а не новая колонка ───────────────────
 *
 * Новой колонки/таблицы сознательно нет: миграция 0002 уже применена, а
 * `src/db/**` — чужая зона. Код = первые 12 символов 32-символьного base62
 * токена, поэтому:
 *   • он НИЧЕГО не добавляет к секрету — перебор 12 символов не открывает
 *     оставшиеся 20 (~119 бит), а чтобы сыграть по длинной ссылке, токен
 *     по-прежнему нужен целиком;
 *   • учитель (и ЛК) получает короткую ссылку из токена, который у него и так
 *     есть: `https://uchlist.ru/p/` + token.slice(0, 12) — ноль запросов в бэк;
 *   • миграции нет, откат = удалить одну функцию.
 *
 * ─── Честная цена решения: индекса по префиксу нет ─────────────────────────
 *
 * `substr(share_token, 1, 12) = ?` идёт сканом индекса `UNIQUE(share_token)`
 * (covering — тело строки не читается). Для таблицы интерактивов это дёшево,
 * но не бесплатно, поэтому на `/p/` свой лимит: 120/мин на IP — это защита от
 * бота, а не от класса из 30 человек на школьном Wi-Fi (каждый делает ровно
 * один запрос на открытие ссылки).
 */

/** Длина кода в короткой ссылке. Проверяется скриптом `check-short-link.mjs`. */
const SHORT_CODE_LENGTH = 12;

/**
 * Срок жизни короткой ссылки, ЕСЛИ учитель срок не задавал: 365 дней.
 *
 * Требование листа — срок задан явно, а не «навсегда»: интерактив могут
 * удалить, а ссылка с удалённым материалом не должна открываться вечно. При
 * этом срок учителя (`expires_at`) всегда выигрывает, если он короче.
 * Старая длинная ссылка этого правила НЕ касается: у неё `expires_at` NULL
 * по-прежнему означает «пока учитель не закроет» — раздавать её нельзя.
 */
const SHORT_LINK_DEFAULT_TTL_DAYS = 365;
const SECONDS_PER_DAY = 86_400;

/** Код в ссылке — ровно 12 символов base62. Регистр ЗНАЧИМ. */
const SHORT_CODE_PATTERN = new RegExp(`^[0-9A-Za-z]{${SHORT_CODE_LENGTH}}$`);

/** Открытие короткой ссылки — 120/мин на IP (одна ссылка = один клик). */
const shortLinkLimit = rateLimitMiddleware({
  limit: 120,
  windowSec: 60,
  bucket: "interactive-short-link",
  keyFn: (c) => `ip:${djb2(c.get("ip") ?? "0.0.0.0")}`,
});

/**
 * Понятная страница вместо ошибки.
 *
 * Ученик или учитель открывает ссылку с телефона. JSON `{"error": …}` здесь
 * читается как «500, сайт сломан», поэтому отдаём внятную страницу с кодом
 * 404/410 и подсказкой «попросите учителя». Все подставляемые значения —
 * статические строки, ничего из базы в HTML не попадает.
 */
function shortLinkPage(
  status: 404 | 410,
  headline: string,
  lead: string,
): Response {
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${headline} — УчЛист</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f5f6f8; color: #1f2328; line-height: 1.5;
  }
  main { max-width: 460px; width: 100%; text-align: center; }
  .logo { font-weight: 700; letter-spacing: .02em; color: #2b6cb0; margin: 0 0 20px; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  p { margin: 0 0 12px; color: #57606a; }
  a.home {
    display: inline-block; margin-top: 12px; padding: 10px 18px;
    border-radius: 8px; background: #2b6cb0; color: #fff; text-decoration: none;
  }
</style>
</head>
<body>
<main>
  <p class="logo">УчЛист</p>
  <h1>${headline}</h1>
  <p>${lead}</p>
  <p>Спросите учителя ссылку ещё раз — скорее всего, он пришлёт новую.</p>
  <a class="home" href="/">На главную</a>
</main>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

const SHORT_LINK_404 = () =>
  shortLinkPage(
    404,
    "Ссылка не работает",
    "Такой ссылки нет. Возможно, в адресе опечатка или лишний символ.",
  );

/**
 * Базовый адрес сайта для ссылки на прохождение.
 *
 * В проде `FRONTEND_URL` — список origin'ов через запятую (ради CORS), поэтому
 * берётся ПЕРВЫЙ. Логика та же, что в `buildPlayUrl` из routes/interactives.ts
 * (функция там не экспортируется, дублируем её здесь сознательно: три строки).
 */
function frontendBase(env: AppEnv["Bindings"]): string {
  const raw = env.APP_PUBLIC_URL ?? (env.FRONTEND_URL ?? "").split(",")[0] ?? "";
  return raw.trim().replace(/\/+$/u, "");
}

/** Момент, когда короткая ссылка этого интерактива перестаёт работать. */
function shortLinkDeadline(row: ShortLinkRow): number {
  const teacherDeadline =
    typeof row.expires_at === "number" && row.expires_at > 0 ? row.expires_at : Number.POSITIVE_INFINITY;
  // created_at NOT NULL по схеме; если вдруг 0 — считаем срок от «сейчас»,
  // чтобы битая строка не убила живую игру.
  const createdAt =
    typeof row.created_at === "number" && row.created_at > 0
      ? row.created_at
      : Math.floor(Date.now() / 1000);
  return Math.min(teacherDeadline, createdAt + SHORT_LINK_DEFAULT_TTL_DAYS * SECONDS_PER_DAY);
}

interface ShortLinkRow {
  id: string;
  share_token: string;
  status: string;
  expires_at: number | null;
  created_at: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /p/:code — короткая ссылка → страница прохождения
// ─────────────────────────────────────────────────────────────────────────────

publicInteractivesRouter.get("/p/:code", shortLinkLimit, async (c) => {
  const code = c.req.param("code");

  // Регистр значим, длина фиксирована: код не той формы — это не «найди
  // похожий», это «ссылки нет». Ответ тот же 404, что и на несуществующий код,
  // чтобы по странице нельзя было отличить «нет такого» от «есть, но не то».
  if (!SHORT_CODE_PATTERN.test(code)) return SHORT_LINK_404();

  const base = frontendBase(c.env);
  if (!base) {
    // Конфигурация воркера, а не вина ссылки: честный 500, но не HTML.
    throwApiError(500, "FRONTEND_URL_MISSING", "Сайт временно недоступен. Попробуйте позже");
  }

  // Поиск по префиксу, а не по полному токену: так и работает короткий код.
  // LIMIT 2 — страховка от «нашлось случайно два»: при 62^12 это вероятность
  // порядка 10^-15, но выбирать наугад из двух чужих игр нельзя.
  const { results } = await c.env.DB.prepare(
    `SELECT id, share_token, status, expires_at, created_at
       FROM interactives
      WHERE substr(share_token, 1, ?2) = ?1
      LIMIT 2`,
  )
    .bind(code, SHORT_CODE_LENGTH)
    .all<ShortLinkRow>();

  const [row] = results;
  if (!row || results.length !== 1) return SHORT_LINK_404();

  if (row.status === "archived") {
    return shortLinkPage(410, "Игра закрыта", "Учитель закрыл эту игру и больше её не выдаёт.");
  }

  if (Date.now() >= shortLinkDeadline(row) * 1000) {
    return shortLinkPage(
      410,
      "Срок игры истёк",
      "Эта ссылка была выдана на один учебный год и больше не открывается.",
    );
  }

  // 302, а не 200-HTML: браузер сразу показывает страницу прохождения, адрес
  // в строке становится рабочим, JS не нужен — с телефона это надёжнее.
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${base}/play/?t=${encodeURIComponent(row.share_token)}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});

export { publicInteractivesRouter };

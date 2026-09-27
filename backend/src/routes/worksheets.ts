/**
 * /api/worksheets/* — генерация, валидация и чтение рабочих листов.
 *
 *   POST /api/worksheets/generate   — сгенерировать новый лист (LLM)
 *   POST /api/worksheets/validate   — прогнать валидатор на листе (DeepSeek)
 *   GET  /api/worksheets/:id        — прочитать сохранённый лист (для preview/share)
 *   POST /api/worksheets/save       — сохранить артефакт (worksheet/lesson-plan/
 *                                     presentation/ktp) + инкремент generations_today
 *
 * План (free/base/plus) передаётся:
 *  1) В теле запроса (body.plan) — приоритет
 *  2) Из сессии пользователя (users.plan) — если не указан в теле
 *  3) Free по умолчанию
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { generateWorksheet, validateWorksheet } from "../llm";
import { saveWorksheet, logWorksheetEvent, getWorksheetById } from "../services/worksheet";
import { NotFoundError, BadRequestError, UnauthorizedError, InternalError } from "../lib/errors";
import type { AppEnv, GenerateWorksheetRequest, Worksheet, SubjectSlug } from "../types";
import { moderateGenerationRequest } from "../llm/moderation";
import { shortId, worksheetId as makeWorksheetId } from "../lib/shortid";
import { requireAuth } from "../middleware/auth";
import { getUserById, incrementUserGenerations } from "../db/queries";

// Env imported for Hono<AppEnv> type inference compatibility.
void ({} as Env);

const worksheetsRouter = new Hono<AppEnv>();

async function resolvePlan(
  c: Context<AppEnv>,
  bodyPlan: unknown,
): Promise<"free" | "base" | "plus"> {
  if (bodyPlan === "plus" || bodyPlan === "base" || bodyPlan === "free") return bodyPlan;
  const user = c.get("user");
  if (user?.plan) return user.plan;
  return "free";
}

async function resolveUserId(
  c: Context<AppEnv>,
): Promise<string | null> {
  const user = c.get("user");
  if (user?.id) return user.id;
  return null;
}

worksheetsRouter.post("/generate", async (c) => {
  let body: GenerateWorksheetRequest & { plan?: "free" | "base" | "plus" };
  try {
    body = (await c.req.json()) as GenerateWorksheetRequest & { plan?: "free" | "base" | "plus" };
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }

  if (!body.request) throw new BadRequestError("Missing 'request' field");

  // Pre-moderation (defense in depth)
  const mod = moderateGenerationRequest({ subject: body.request.subject, topic: body.request.topic });
  if (!mod.ok) throw new BadRequestError(`Invalid input: ${mod.reason}`);

  const plan = await resolvePlan(c, body.plan);
  const userId = await resolveUserId(c);
  const ip = c.get("ip") ?? "0.0.0.0";

  // Гарантируем, что у worksheet есть id (для будущего save)
  if (!body.request || typeof body.request !== "object") {
    throw new BadRequestError("Invalid 'request' object");
  }

  const result = await generateWorksheet(
    {
      request: body.request,
      plan,
      bypassCache: body.bypassCache ?? false,
      userId,
      ip,
    },
    c.env,
    c.env.DB,
  );

  // Если у worksheet нет id — проставляем наш (для последующего сохранения)
  const worksheet: Worksheet = {
    ...result.worksheet,
    id: result.worksheet.id || `ws_${shortId()}`,
  };

  // Save (await — лучше знать сразу если что-то упало)
  await saveWorksheet(c.env.DB, { userId, worksheet });
  await logWorksheetEvent(c.env.DB, { userId, worksheet, meta: result.meta });

  return c.json({
    ok: true,
    worksheet,
    meta: result.meta,
  });
});

worksheetsRouter.post("/validate", async (c) => {
  let body: { worksheet: Worksheet; context: { subject: string; grade: number; topic: string } };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  if (!body.worksheet || !body.context) throw new BadRequestError("Missing worksheet or context");

  const result = await validateWorksheet({ worksheet: body.worksheet, context: body.context }, c.env, c.env.DB);
  return c.json({
    ok: true,
    score: result.score,
    issues: result.issues,
    meta: result.meta,
  });
});

worksheetsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ws = await getWorksheetById(c.env.DB, id);
  if (!ws) throw new NotFoundError("Worksheet not found");
  return c.json({ ok: true, worksheet: ws });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/worksheets/save — атомарное сохранение сгенерированного (mock или
// LLM) листа + инкремент users.generations_today.
//
// Контракт (M2 + W1):
//   1) requireAuth → 401 если аноним
//   2) zod-валидация body → 400 + details если невалидно
//   3) INSERT в worksheets  (атомарно)
//   4) UPDATE users.generations_today = generations_today + 1
//   5) Возвращает { ok:true, worksheetId, generationsToday, generationsLimit }
//
// Семантика:
//   - Если INSERT упал → counter НЕ инкрементится (защита от over-increment).
//   - Если INSERT прошёл, а UPDATE упал → лист остаётся, warning в лог,
//     возвращаем 500 (юзер увидит ошибку и повторит; счётчик останется 0/лист
//     на бэке уже есть).
//
// ВАЖНО: на свежей D1 все нужные колонки уже в schema.sql (writable колонки:
// id/user_id/subject/grade/topic/difficulty/type/count/title/payload_json/
// created_at). verified/verifiedExplanation/source/tasks[] лежат в payload_json.
// Отдельная миграция не нужна.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * zod-схема тела /save — discriminated union по `type`.
 *
 * Поддерживает 4 типа артефактов из ЛК учителя:
 *   - "worksheet"     — рабочий лист (tasks[])
 *   - "lesson-plan"   — план урока ФГОС (stages[])
 *   - "presentation"  — презентация (slides[], slideCount)
 *   - "ktp"           — КТП на учебный год (weeks[])
 *
 * Расширения сверх прошлой worksheet-схемы:
 *   - source — опциональная метка "mock" | "llm" (идёт в payload_json для аналитики).
 *   - verified/verifiedExplanation — опциональные поля per-task (F-05-B).
 *
 * payload_json хранит весь `data` (включая type + специфичные поля), чтобы при чтении
 * через GET /api/worksheets/:id данные совпадали с тем, что прислал фронт.
 *
 * ВАЖНО: difficulty обязателен только для worksheet; для lesson-plan опционален;
 * presentation/ktp не имеют difficulty (заменяем "medium" при INSERT).
 */
const WorksheetBody = z.object({
  type: z.literal("worksheet"),
  subject: z.string().min(1).max(64),
  grade: z.number().int().min(1).max(11),
  topic: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  difficulty: z.enum(["easy", "medium", "hard"]),
  tasks: z
    .array(
      z.object({
        number: z.number().int().positive(),
        text: z.string().min(1).max(2000),
        type: z.enum(["computation", "multiple-choice", "short-answer", "essay", "fill-blank"]),
        options: z.array(z.string().max(500)).max(20).optional(),
        answer: z.string().max(2000).optional(),
        explanation: z.string().max(2000).optional(),
        points: z.number().int().nonnegative().max(100),
        verified: z.union([z.boolean(), z.null()]).optional(),
        verifiedExplanation: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(100),
  source: z.enum(["mock", "llm"]).optional(),
});

const LessonPlanBody = z.object({
  type: z.literal("lesson-plan"),
  subject: z.string().min(1).max(64),
  grade: z.number().int().min(1).max(11),
  topic: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  goals: z
    .object({
      educational: z.array(z.string()),
      developmental: z.array(z.string()),
      nurturing: z.array(z.string()),
    })
    .optional(),
  equipment: z.array(z.string()).optional(),
  stages: z
    .array(
      z.object({
        kind: z.enum(["org-moment", "motivation", "new-topic", "practice", "reflex", "homework"]),
        title: z.string(),
        durationMin: z.number().int().min(1).max(45),
        teacherActions: z.string(),
        studentActions: z.string(),
        materials: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  homework: z.object({
    text: z.string(),
    alternatives: z.array(z.string()).optional(),
  }),
  fgosRef: z.string().optional(),
  source: z.enum(["mock", "llm"]).optional(),
});

const PresentationBody = z.object({
  type: z.literal("presentation"),
  subject: z.string().min(1).max(64),
  grade: z.number().int().min(1).max(11),
  topic: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  slideCount: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
  slides: z
    .array(
      z.object({
        kind: z.enum(["title", "bullets", "definition", "example", "summary"]),
        title: z.string(),
        bullets: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
  theme: z.enum(["default", "modern", "school", "minimal"]).optional(),
  source: z.enum(["mock", "llm"]).optional(),
});

const KtpBody = z.object({
  type: z.literal("ktp"),
  subject: z.string().min(1).max(64),
  grade: z.number().int().min(1).max(11),
  topic: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200),
  schoolYear: z.string().regex(/^\d{4}\/\d{4}$/),
  totalHours: z.number().int().min(1).max(200),
  weeks: z
    .array(
      z.object({
        weekNum: z.number().int().min(1),
        entries: z
          .array(
            z.object({
              num: z.number().int().min(1),
              dates: z.string(),
              topic: z.string(),
              kind: z.enum(["lesson", "control", "test", "review", "reserve", "project"]),
              hours: z.union([z.literal(1), z.literal(2)]),
              fgosRef: z.string().optional(),
              uud: z.array(z.string()).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  source: z.enum(["mock", "llm"]).optional(),
});

const SaveBody = z.discriminatedUnion("type", [
  WorksheetBody,
  LessonPlanBody,
  PresentationBody,
  KtpBody,
]);

worksheetsRouter.post("/save", async (c) => {
  // 1) Auth — анонимный запрос → 401.
  let user;
  try {
    user = requireAuth(c);
  } catch {
    throw new UnauthorizedError("unauthorized");
  }

  // 2) Парсим body.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }

  // 3) zod-валидация. При ошибке error-middleware вернёт 400 + details.
  const data = SaveBody.parse(rawBody);

  // 4) Считаем `count` per-type для worksheets.count (NOT NULL колонка).
  //    Семантика: количество «единиц контента» — задач / этапов / слайдов / недель.
  const count =
    data.type === "worksheet"
      ? data.tasks.length
      : data.type === "lesson-plan"
        ? data.stages.length
        : data.type === "presentation"
          ? data.slides.length
          : data.weeks.length;

  // Difficulty — обязательное поле worksheets.difficulty (NOT NULL). У worksheet
  // оно required, у lesson-plan optional, у presentation/ktp его нет → дефолт "medium".
  const difficulty: "easy" | "medium" | "hard" =
    data.type === "worksheet"
      ? data.difficulty
      : data.type === "lesson-plan"
        ? (data.difficulty ?? "medium")
        : "medium";

  // 5) payload_json — ВЕСЬ data (включая type + специфичные поля), чтобы при
  //    чтении через GET /api/worksheets/:id данные совпадали с тем, что прислал фронт.
  //    `source` остаётся аналитикой mock vs LLM для будущих фильтров.
  const newId = makeWorksheetId();
  const now = Math.floor(Date.now() / 1000);

  // 6) INSERT. Если упал — counter НЕ инкрементим, пробрасываем 500.
  //
  // ВАЖНО: worksheets.topic — NOT NULL. У worksheet/lesson-plan/presentation
  // поле обязательное, у ktp — optional (на бэке zod-схема). Когда фронт
  // шлёт ktp без topic (Ktp-тип на фронте не имеет этого поля вообще),
  // подставляем `title` как placeholder — он содержит учебный год и тему.
  // Полный data со всеми полями всё равно хранится в payload_json.
  const topicForInsert: string =
    data.type === "ktp"
      ? (data.topic ?? data.title)
      : data.topic;

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO worksheets
           (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        newId,
        user.id,
        data.subject as SubjectSlug,
        data.grade,
        topicForInsert,
        difficulty,
        data.type,
        count,
        data.title,
        JSON.stringify(data),
        now,
      )
      .run();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[worksheets/save] INSERT failed:", err, {
      userId: user.id,
      ip: c.get("ip") ?? null,
      ua: c.get("userAgent") ?? null,
    });
    throw new InternalError("Failed to save worksheet");
  }

  // 7) Инкремент counter-а.
  //
  // Гарантия "no over-increment": INSERT уже прошёл до UPDATE, поэтому даже
  // если UPDATE упадёт — лист остаётся. Caller увидит 500 и может retry
  // (INSERT OR REPLACE по тому же id — лист пересохранится, counter при
  // таком retry уже не задвоится, потому что retry пойдёт через /generate,
  // а не через /save повторно).
  try {
    await incrementUserGenerations(c.env.DB, user.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[worksheets/save] increment failed (worksheet inserted, counter NOT updated):", err, {
      worksheetId: newId,
      userId: user.id,
    });
    throw new InternalError("Failed to increment daily counter");
  }

  // 8) Читаем свежие значения для ответа.
  const fresh = await getUserById(c.env.DB, user.id);
  const generationsToday = fresh?.generations_today ?? 0;
  const generationsLimit = fresh
    ? fresh.plan === "plus" || fresh.plan === "base"
      ? -1
      : 3
    : 3;

  // 9) Audit-event (легковесный console-info). Полный event-pipeline через
  // POST /api/track на фронте, но бэк логирует минимальный контекст для дебага.
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      ev: "worksheet_saved",
      worksheetId: newId,
      userId: user.id,
      ip: c.get("ip") ?? null,
      ua: c.get("userAgent") ?? null,
      source: data.source ?? null,
      type: data.type,
      count,
      generationsToday,
    }),
  );

  return c.json({
    ok: true,
    worksheetId: newId,
    generationsToday,
    generationsLimit,
  });
});

export { worksheetsRouter };

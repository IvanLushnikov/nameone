/**
 * F-06 / TZ-11: «Проверка работ по фото».
 *
 * Раньше здесь был catch-all `all("*")` → 501. Он не только заглушал фичу, но
 * и перехватывал ВСЁ под `/api/assignments`, из-за чего f07Router (формы
 * учителя) был недостижим (ТЗ §2.2). Теперь конкретные роуты — f07 ожил.
 *
 * Эндпоинты (префикс `/api/assignments` навешен в index.ts):
 *   POST   /photo-checks        — новая проверка (multipart: image + tasks)
 *   GET    /photo-checks        — история проверок пользователя
 *   GET    /photo-checks/usage  — остаток месячной квоты
 *   GET    /photo-checks/:id    — результат одной проверки
 *   POST   /photo-checks/:id/interview-questions — вопросы для беседы (F-06.1)
 *   DELETE /photo-checks/:id    — удалить фото (В-2.3, одна кнопка)
 *
 * ПДн: фото ребёнка. Техническая часть контура закрыта — срок хранения 7 дней
 * (delete_at), автоудаление retention-скриптом, ручное удаление, фиксация
 * согласия. Правовое основание обработки (В-2.1) и уведомление РКН (В-2.6) —
 * открытые вопросы к юристу, см. отчёт. Код НЕ утверждает, что ПДн обрабатываются
 * законно: он лишь фиксирует, ЧТО и КОГДА было сделано.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/ratelimit";
import {
  ApiError,
  BadRequestError,
  InternalError,
  NotFoundError,
  PaymentRequiredError,
} from "../lib/errors";
import { checkPhoto, logLlmCall } from "../llm";
import { isProviderEnabled } from "../llm/config";
import { callWithFallback } from "../llm/router";
import { checkLlmRateLimit, ipHashFromHeaders } from "../llm/ratelimit";
import {
  PHOTO_RETENTION_SECONDS,
  type ExpectedTask,
} from "../services/photoCheckGrading";
import {
  INTERVIEW_DISCLAIMER,
  buildInterviewPrompt,
  parseInterviewQuestions,
  pickDefaultTaskNumbers,
  type InterviewTaskItem,
} from "../services/interviewQuestions";
import {
  completePhotoCheck,
  failPhotoCheck,
  getLatestInterviewQuestions,
  getPhotoCheckById,
  getPhotoCheckItems,
  getUsageCounter,
  incrementUsageCounter,
  insertInterviewQuestions,
  insertPhotoCheck,
  listUserPhotoChecks,
  markPhotoDeleted,
  monthWindowStart,
} from "../db/photoChecks";
import { logLlmEvent } from "../llm/log";

// ─────────────────────────────────────────────────────────────────────────────
// Лимиты и тарифы (ТЗ §7.2)
// ─────────────────────────────────────────────────────────────────────────────

/** Проверок в месяц по тарифу. Жёсткий предохранитель 1000 на всех. */
const MONTHLY_LIMITS: Record<string, number> = {
  free: 10,
  base: 100,
  plus: 500,
};
const ABSOLUTE_CEILING = 1000;

export function monthlyLimitFor(plan: string): number {
  return Math.min(MONTHLY_LIMITS[plan] ?? MONTHLY_LIMITS.free!, ABSOLUTE_CEILING);
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 МБ
const MAX_TASKS = 40;
const MIN_TASKS = 1;

/**
 * Квоты на ВОПРОСЫ для беседы — отдельная метрика `interview_questions`
 * (ТЗ-17 §5.6). Квота проверки по фото тут НЕ расходуется: картинка не
 * отправляется, LLM не vision, генерация копеечная.
 *
 *   free 5 — попробовать фичу целиком на одной домашке;
 *   base 50 — 1 класс = ~1 набор в день рабочей недели;
 *   plus 200 — два класса плюс перегенерации;
 *   потолок 500 — защита от бесконечного retry, как в F-06.
 */
const INTERVIEW_MONTHLY_LIMITS: Record<string, number> = {
  free: 5,
  base: 50,
  plus: 200,
};
const INTERVIEW_ABSOLUTE_CEILING = 500;

export function interviewMonthlyLimitFor(plan: string): number {
  return Math.min(
    INTERVIEW_MONTHLY_LIMITS[plan] ?? INTERVIEW_MONTHLY_LIMITS.free!,
    INTERVIEW_ABSOLUTE_CEILING,
  );
}

/**
 * Модель и цепочка фолбэков для вопросов (ТЗ-17 §6.3).
 *
 * Задача формулировочная, не аналитическая: собрать вопрос из распознанного
 * ответа. `deepseek-v4-flash` вдвое дешевле рабочей `gpt-6-luna` по выходу,
 * разницы в качестве тут нет. Fallback — по общей логике роутера.
 *
 * `pickModel()` не используем: задачи `interview-questions` нет в `GenerationKind`
 * (тип `llm/types.ts` правит другой владелец). Структура decision'а та же, что
 * у `pickModel()`, поэтому `callWithFallback` принимает её без приведений.
 */
const INTERVIEW_MODEL = "deepseek-v4-flash";
const INTERVIEW_FALLBACK_MODELS = ["gpt-6-luna"] as const;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

const f06Router = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// POST /photo-checks — новая проверка
// ─────────────────────────────────────────────────────────────────────────────

f06Router.post(
  "/photo-checks",
  // Двойная защита: rate-limit по HTTP + месячная квота в usage_counters.
  rateLimitMiddleware({ limit: 20, windowSec: 3600, bucket: "photo-check" }),
  async (c) => {
    const user = requireAuth(c);
    const now = Math.floor(Date.now() / 1000);
    const db = c.env.DB;

    // 1. Квота — ДО дорогого вызова LLM. Иначе пользователь на потоке
    //    успеет выжечь лимит ответами 503.
    const windowStart = monthWindowStart(now);
    const limit = monthlyLimitFor(user.plan);
    const used = await getUsageCounter(db, {
      userId: user.id,
      metric: "photo_check",
      windowStart,
    });
    if (used >= limit) {
      throw new PaymentRequiredError(
        "Месячный лимит проверок исчерпан. Обновится 1-го числа.",
        { used, limit, resetAt: nextMonthStart(windowStart) },
      );
    }

    // 2. Разбор multipart.
    const form = await readPhotoForm(c);

    // 3. Согласие. Фиксируем ВЕРСИЮ текста, а не факт «законности»:
    //    правовое основание (В-2.1) — открытый вопрос к юристу.
    if (!form.consentAccepted) {
      throw new BadRequestError(
        "Без согласия на обработку персональных данных загрузка фото невозможна",
      );
    }

    // 4. Картинка в R2. Ключ — без ID пользователя внутри, чтобы по имени
    //    объекта нельзя было перебрать чужие фото.
    const checkIdPlaceholder = `pc/${now}/${crypto.randomUUID()}.jpg`;
    await c.env.PDFS.put(checkIdPlaceholder, form.bytes, {
      httpMetadata: { contentType: form.mimeType },
      customMetadata: { owner: user.id },
    });

    // 5. Запись в D1 со статусом pending — нужна, чтобы фото не потерялось,
    //    если воркер умрёт посреди вызова LLM (retention-скрипт подчистит).
    const checkId = await insertPhotoCheck(db, {
      userId: user.id,
      worksheetId: form.worksheetId,
      subject: form.subject,
      grade: form.grade,
      r2Key: checkIdPlaceholder,
      mimeType: form.mimeType,
      byteSize: form.bytes.byteLength,
      deleteAt: now + PHOTO_RETENTION_SECONDS,
      createdAt: now,
    });

    // 6. Вызов vision-модели.
    if (!isProviderEnabled(c.env, "polza")) {
      await failPhotoCheck(db, { id: checkId, errorCode: "LLM_UNAVAILABLE", completedAt: now });
      throw new ApiError(503, "LLM_UNAVAILABLE", "Проверка временно недоступна, попробуйте позже");
    }

    try {
      const result = await checkPhoto(
        {
          imageBytes: form.bytes,
          mimeType: form.mimeType,
          tasks: form.tasks,
          // `CheckPhotoArgs` ждёт `undefined`, а `readPhotoForm` отдаёт `null`
          // для незаполненного поля. Приводим явно, иначе null уедет в промпт
          // строкой "null" и модель получит мусор вместо «предмет не указан».
          subject: form.subject ?? undefined,
          grade: form.grade ?? undefined,
          detail: form.detail,
          plan: user.plan,
          userId: user.id,
          ip: c.get("ip") ?? "0.0.0.0",
        },
        c.env,
        db,
      );

      await completePhotoCheck(db, {
        id: checkId,
        summary: result.summary,
        model: result.model,
        provider: result.provider,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        errorCode: result.summary.needsReview ? "LOW_CONFIDENCE" : null,
        completedAt: now,
      });

      // 7. Квота списывается ТОЛЬКО после успешного вызова LLM (ТЗ §7.2) —
      //    при 5xx от polsa учитель не должен платить за нашу ошибку.
      const after = await incrementUsageCounter(db, {
        userId: user.id,
        metric: "photo_check",
        windowStart,
        updatedAt: now,
      });

      logLlmEvent("info", "photo-check done", {
        checkId,
        userId: user.id,
        model: result.model,
        earned: result.summary.earnedPoints,
        total: result.summary.totalPoints,
        needsReview: result.summary.needsReview,
        costUsd: result.costUsd,
        estimatedCostUsd: result.estimatedCostUsd,
        latencyMs: result.latencyMs,
      });

      return c.json(
        {
          ok: true,
          checkId,
          status: result.summary.needsReview ? "partial" : "ok",
          totalPoints: result.summary.totalPoints,
          earnedPoints: result.summary.earnedPoints,
          percentage: result.summary.percentage,
          gradeMark: result.summary.gradeMark,
          needsReview: result.summary.needsReview,
          items: result.summary.items.map(toItemDto),
          model: result.model,
          quota: { used: after, limit, resetAt: nextMonthStart(windowStart) },
          // Фото живёт 7 дней — говорим учителю сразу, а не прячем в оферте.
          photoDeleteAt: now + PHOTO_RETENTION_SECONDS,
        },
        201,
      );
    } catch (e) {
      // Модель не ответила или ответила мусором — отмечаем failed и НЕ списываем квоту.
      await failPhotoCheck(db, { id: checkId, errorCode: "LLM_UNAVAILABLE", completedAt: now }).catch(() => undefined);
      const msg = e instanceof Error ? e.message : String(e);
      logLlmEvent("error", "photo-check failed", { checkId, userId: user.id, error: msg.slice(0, 300) });
      throw new ApiError(503, "LLM_UNAVAILABLE", "Не удалось распознать фото, попробуйте ещё раз");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /photo-checks/usage — остаток квоты
// ─────────────────────────────────────────────────────────────────────────────

f06Router.get("/photo-checks/usage", async (c) => {
  const user = requireAuth(c);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = monthWindowStart(now);
  const used = await getUsageCounter(c.env.DB, {
    userId: user.id,
    metric: "photo_check",
    windowStart,
  });
  return c.json({
    ok: true,
    quota: {
      used,
      limit: monthlyLimitFor(user.plan),
      resetAt: nextMonthStart(windowStart),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /photo-checks — история
// ─────────────────────────────────────────────────────────────────────────────

f06Router.get("/photo-checks", async (c) => {
  const user = requireAuth(c);
  const limit = clampInt(c.req.query("limit"), 1, 50, 20);
  const beforeRaw = c.req.query("cursor");
  const before = beforeRaw ? Number(beforeRaw) : null;
  if (beforeRaw && !Number.isFinite(before)) {
    throw new BadRequestError("cursor должен быть unix-таймстампом");
  }

  const rows = await listUserPhotoChecks(c.env.DB, {
    userId: user.id,
    limit,
    before: Number.isFinite(before as number) ? (before as number) : null,
  });

  return c.json({
    ok: true,
    checks: rows.map((r) => ({
      checkId: r.id,
      worksheetId: r.worksheet_id,
      subject: r.subject,
      grade: r.grade,
      status: r.status,
      totalPoints: r.total_points,
      earnedPoints: r.earned_points,
      percentage: r.percentage,
      gradeMark: r.grade_mark,
      needsReview: r.needs_review === 1,
      model: r.model,
      // deleted_at без r2_key = фото уже стёрто, остались только цифры.
      photoDeleted: r.deleted_at !== null,
      photoDeleteAt: r.delete_at,
      createdAt: r.created_at,
    })),
    nextCursor: rows.length === limit ? rows[rows.length - 1]?.created_at ?? null : null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /photo-checks/:id — результат одной проверки
// ─────────────────────────────────────────────────────────────────────────────

f06Router.get("/photo-checks/:id", async (c) => {
  const user = requireAuth(c);
  const id = c.req.param("id");
  const row = await getPhotoCheckById(c.env.DB, id);

  // Чужую проверку отдаём как 404, а не 403 — не подтверждаем её существование.
  if (!row || row.user_id !== user.id) {
    throw new NotFoundError("Проверка не найдена");
  }

  const items = await getPhotoCheckItems(c.env.DB, id);
  return c.json({
    ok: true,
    checkId: row.id,
    status: row.status,
    totalPoints: row.total_points,
    earnedPoints: row.earned_points,
    percentage: row.percentage,
    gradeMark: row.grade_mark,
    needsReview: row.needs_review === 1,
    items: items.map((i) => ({
      number: i.task_number,
      taskText: i.task_text,
      expected: i.expected,
      studentAnswer: i.student_answer,
      verdict: i.verdict,
      pointsAwarded: i.points_awarded,
      maxPoints: i.max_points,
      confidence: i.confidence,
      needsReview: i.needs_review === 1,
      comment: i.comment,
    })),
    model: row.model,
    photoDeleted: row.deleted_at !== null,
    photoDeleteAt: row.delete_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /photo-checks/:id — удалить фото одной кнопкой (В-2.3)
// ─────────────────────────────────────────────────────────────────────────────

f06Router.delete("/photo-checks/:id", async (c) => {
  const user = requireAuth(c);
  const id = c.req.param("id");
  const now = Math.floor(Date.now() / 1000);

  const row = await getPhotoCheckById(c.env.DB, id);
  if (!row || row.user_id !== user.id) {
    throw new NotFoundError("Проверка не найдена");
  }
  if (row.deleted_at !== null) {
    // Уже удалено — идемпотентно, повторное нажатие кнопки не должно быть ошибкой.
    return c.json({ ok: true, alreadyDeleted: true });
  }

  // Сначала R2, потом база. Если R2 упал — не помечаем удалённым, чтобы
  // retention-скрипт попробовал ещё раз.
  if (row.r2_key) {
    try {
      await c.env.PDFS.delete(row.r2_key);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logLlmEvent("error", "photo-check: R2 delete failed", { checkId: id, error: msg.slice(0, 200) });
      throw new InternalError("Не удалось удалить фото, попробуйте ещё раз");
    }
  }

  await markPhotoDeleted(c.env.DB, { id, userId: user.id, deletedAt: now });

  logLlmEvent("info", "photo-check photo deleted by user", { checkId: id, userId: user.id });
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /photo-checks/:checkId/interview-questions — вопросы для беседы (F-06.1)
// ─────────────────────────────────────────────────────────────────────────────
//
// Фича НЕ про «детектор списывания», а про вопросы, на которые ученик сможет
// ответить, только если решал сам (ТЗ-17 §1.3). Поэтому: никаких процентов
// похожести, никаких «списал», никакого ранжирования заданий по подозрительности.
// Решение принимает учитель — поэтому дисклеймер едет с сервера.
//
// Ключевая экономика фичи: вопросы строятся ТЕКСТОМ по уже сохранённым в D1
// ответам ученика (photo_check_items.student_answer). Фото повторно в модель не
// уходит, vision не используется, и фича работает даже после удаления снимка.

f06Router.post(
  "/photo-checks/:checkId/interview-questions",
  // Двойная защита, как у самой проверки: rate-limit по HTTP + месячная квота
  // в usage_counters (метрика interview_questions).
  rateLimitMiddleware({ limit: 20, windowSec: 3600, bucket: "interview-questions" }),
  async (c) => {
    const user = requireAuth(c);
    const now = Math.floor(Date.now() / 1000);
    const db = c.env.DB;
    const checkId = c.req.param("checkId");

    // 1. Чужая проверка — 404, не 403: не подтверждаем её существование.
    const check = await getPhotoCheckById(db, checkId);
    if (!check || check.user_id !== user.id) {
      throw new NotFoundError("Проверка не найдена");
    }

    // 2. Квота — ДО вызова LLM, иначе провайдер будет выжигать лимит 503-ами.
    const windowStart = monthWindowStart(now);
    const limit = interviewMonthlyLimitFor(user.plan);
    const used = await getUsageCounter(db, {
      userId: user.id,
      metric: "interview_questions",
      windowStart,
    });
    if (used >= limit) {
      throw new PaymentRequiredError(
        "Месячный лимит генерации вопросов исчерпан. Обновится 1-го числа.",
        { used, limit, resetAt: nextMonthStart(windowStart) },
      );
    }

    // 3. Тело запроса: какие задания спрашиваем и перегенерация ли это.
    const body = await readInterviewBody(c);
    const allItems = await getPhotoCheckItems(db, checkId);
    if (allItems.length === 0) {
      throw new BadRequestError("По этой проверке нет ни одного задания — вопросы спросить не о чем");
    }

    const picked = await resolveTaskNumbers(body, allItems);

    const tasks: InterviewTaskItem[] = allItems
      .filter((i) => picked.includes(i.task_number))
      .map((i) => ({
        number: i.task_number,
        taskText: i.task_text,
        expected: i.expected,
        studentAnswer: i.student_answer,
        verdict: i.verdict,
      }));
    if (tasks.length === 0) {
      throw new BadRequestError("Выберите хотя бы одно задание из работы");
    }

    // 4. Провайдер. Без ключа — честный 503, квота не списывается.
    if (!isProviderEnabled(c.env, "polza")) {
      throw new ApiError(503, "LLM_UNAVAILABLE", "Вопросы временно недоступны, попробуйте позже");
    }

    const start = Date.now();
    const { system, user: userPrompt } = buildInterviewPrompt(tasks, {
      subject: check.subject ?? undefined,
      grade: check.grade ?? undefined,
    });

    try {
      await checkLlmRateLimit(db, {
        userId: user.id,
        ipHash: await ipHashFromHeaders(new Headers({ "cf-connecting-ip": c.get("ip") ?? "0.0.0.0" })),
        plan: user.plan,
      });

      // Vision тут не проверяется принципиально: картинки в запросе нет.
      const result = await callWithFallback(
        {
          model: INTERVIEW_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
          responseFormat: "json",
          // Формулировка, а не разбор: температура выше, чем у проверки фото (0.1),
          // чтобы «Другие вопросы» реально давали другую формулировку.
          temperature: 0.7,
          maxTokens: 1500,
        },
        {
          primary: { provider: "polza", model: INTERVIEW_MODEL },
          fallbacks: INTERVIEW_FALLBACK_MODELS.map((model) => ({ provider: "polza" as const, model })),
          generation: "primary",
        },
        c.env,
      );

      const parsed = parseInterviewQuestions(result.response.content, tasks);
      const latencyMs = Date.now() - start;

      await logLlmCall(db, {
        userId: user.id,
        task: "interview-questions",
        provider: result.provider,
        model: result.model,
        plan: user.plan,
        tokensIn: result.response.tokensIn,
        tokensOut: result.response.tokensOut,
        costUsd: result.response.costUsd,
        latencyMs,
        cached: false,
        fallback: result.generation !== "primary",
      });

      // 5. Мусор от модели — честный 503 без списания квоты. Придумывать
      //    вопросы «на всякий случай» нельзя: учитель должен знать, сколько
      //    вопросов он на самом деле получил.
      if (parsed.questions.length === 0) {
        logLlmEvent("warn", "interview-questions: модель не вернула вопросов", {
          checkId,
          userId: user.id,
          model: result.model,
          dropped: parsed.dropped.slice(0, 5),
          costUsd: result.response.costUsd,
          latencyMs,
        });
        throw new ApiError(503, "LLM_UNAVAILABLE", "Не удалось составить вопросы, попробуйте ещё раз");
      }

      // 6. Новая генерация: предыдущий набор этой проверки уходит в superseded
      //    в той же операции (см. insertInterviewQuestions).
      const generation = await insertInterviewQuestions(db, {
        checkId,
        userId: user.id,
        questions: parsed.questions.map((q) => ({
          taskNumber: q.taskNumber,
          taskText: q.taskText,
          question: q.question,
          // Вердикт нужен учителю как якорь; в БД NOT NULL — подстраховываемся.
          verdict: q.verdictAtGeneration ?? "unclear",
        })),
        model: result.model,
        createdAt: now,
      });

      // 7. Квота списывается ТОЛЬКО после успешного вызова LLM (ТЗ §5.6) —
      //    при 5xx провайдера учитель не платит за нашу ошибку.
      const after = await incrementUsageCounter(db, {
        userId: user.id,
        metric: "interview_questions",
        windowStart,
        updatedAt: now,
      });

      logLlmEvent("info", "interview-questions done", {
        checkId,
        userId: user.id,
        model: result.model,
        generation,
        regenerate: body.regenerate,
        requested: tasks.length,
        questions: parsed.questions.length,
        dropped: parsed.dropped.length,
        costUsd: result.response.costUsd,
        latencyMs,
      });

      return c.json({
        ok: true,
        questions: parsed.questions.map((q) => ({
          taskNumber: q.taskNumber,
          taskText: q.taskText,
          question: q.question,
          verdictAtGeneration: q.verdictAtGeneration,
          createdAt: now,
        })),
        model: result.model,
        costUsd: result.response.costUsd,
        quota: { used: after, limit, resetAt: nextMonthStart(windowStart) },
        // Текст с сервера, а не захардкоженный на фронте (ТЗ §5.1).
        disclaimer: INTERVIEW_DISCLAIMER,
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logLlmEvent("error", "interview-questions failed", {
        checkId,
        userId: user.id,
        error: msg.slice(0, 300),
        latencyMs: Date.now() - start,
      });
      throw new ApiError(503, "LLM_UNAVAILABLE", "Не удалось составить вопросы, попробуйте ещё раз");
    }
  },
);

// GET /photo-checks/:checkId/interview-questions — прочитать уже сохранённые
// вопросы (F-06.1). Отдельная точка входа для сценария «вернулся к старой
// домашке, чтобы спросить ещё» — учителю не нужно жать кнопку заново и заново
// платить квоту.
//
// Пустой массив — это НЕ ошибка, а «вопросов ещё не составляли». Квота тут не
// списывается: это чтение, а не генерация.
f06Router.get("/photo-checks/:checkId/interview-questions", async (c) => {
  const user = requireAuth(c);
  const checkId = c.req.param("checkId");

  const row = await getPhotoCheckById(c.env.DB, checkId);
  // Чужую проверку отдаём как 404, а не 403 — не подтверждаем её существование.
  if (!row || row.user_id !== user.id) {
    throw new NotFoundError("Проверка не найдена");
  }

  const rows = await getLatestInterviewQuestions(c.env.DB, checkId);
  return c.json({
    ok: true,
    questions: rows.map((r) => ({
      taskNumber: r.task_number,
      taskText: r.task_text,
      question: r.question,
      verdictAtGeneration: r.verdict_snapshot,
      createdAt: r.created_at,
    })),
    disclaimer: INTERVIEW_DISCLAIMER,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательное
// ─────────────────────────────────────────────────────────────────────────────
/** Тело POST /photo-checks/:checkId/interview-questions (ТЗ-17 §5.1). */
interface ParsedInterviewBody {
  /** Какие задания спрашиваем. Пусто = дефолт (см. resolveTaskNumbers). */
  taskNumbers: number[];
  /** «Другие вопросы» — та же формулировка по новому вызову модели. */
  regenerate: boolean;
}

/**
 * Разобрать тело запроса. Пустое тело — не ошибка: фронт может не слать
 * `taskNumbers`, и тогда берётся дефолтный набор (verdict !== "correct").
 */
async function readInterviewBody(c: Context<AppEnv>): Promise<ParsedInterviewBody> {
  let raw: unknown = null;
  try {
    raw = await c.req.json();
  } catch {
    raw = null;
  }
  const rec = (raw ?? {}) as Record<string, unknown>;

  const list = Array.isArray(rec.taskNumbers) ? rec.taskNumbers : [];
  const taskNumbers = [
    ...new Set(
      list
        .map((n) => (typeof n === "number" ? n : Number(n)))
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.trunc(n)),
    ),
  ];
  if (taskNumbers.length > MAX_TASKS) {
    throw new BadRequestError(`За раз можно спросить о ${MAX_TASKS} заданиях, пришло ${taskNumbers.length}`);
  }

  return { taskNumbers, regenerate: rec.regenerate === true };
}

/**
 * Какие задания спрашиваем.
 *
 * Явный список учителя — всегда honoured (в т.ч. вопросы про ВЕРНЫЕ задания:
 * это его право, В-2). Если список не пришёл, берём дефолт: `verdict !==
 * "correct"`, максимум 5. Никакого «подозрительного» отбора — только этот.
 */
async function resolveTaskNumbers(
  body: ParsedInterviewBody,
  items: Array<{ task_number: number; verdict: string | null }>,
): Promise<number[]> {
  if (body.taskNumbers.length > 0) return body.taskNumbers;
  const defaults = pickDefaultTaskNumbers(
    items.map((i) => ({ number: i.task_number, verdict: i.verdict })),
  );
  if (defaults.length === 0) {
    throw new BadRequestError("Все задания верные — выберите, о чём спросить, вручную");
  }
  return defaults;
}

interface ParsedPhotoForm {
  bytes: ArrayBuffer;
  mimeType: string;
  tasks: ExpectedTask[];
  worksheetId: string | null;
  subject: string | null;
  grade: number | null;
  detail: "low" | "high";
  consentAccepted: boolean;
}

/**
 * Разобрать multipart/form-data проверки.
 *
 * Валидация тут строгая и ПОЛЬЗОВАТЕЛЬСКАЯ: учителю нужен понятный текст,
 * а не стек zod. Каждая проверка — с человеческим сообщением.
 */
async function readPhotoForm(c: Context<AppEnv>): Promise<ParsedPhotoForm> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new BadRequestError("Ожидается multipart/form-data с полем image");
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new BadRequestError("Не удалось прочитать загруженный файл");
  }

  // 1. Фото.
  //
  // ПОЧЕМУ ТАК, А НЕ `form.get("image")` + `instanceof File`:
  // в `@cloudflare/workers-types` метод `FormData.get()` объявлен как
  // `get(name: string): string | null` — в его сигнатуре НЕТ варианта File
  // вообще (файлы там видны только через `getAll`/`entries`). Поэтому и
  // `instanceof File` не компилируется (левая часть — `string`), и любой
  // отсев строки схлопывает тип в `never`.
  //
  // Берём значение через `getAll` — там тип элемента union-ный — и сужаем
  // уже по фактическому рантайм-признаку: строка вместо файла, null либо
  // объект без `arrayBuffer` — это не загруженное фото.
  const file = form.getAll("image")[0] as unknown;
  if (typeof file === "string" || file === null || file === undefined) {
    throw new BadRequestError("Приложите фото работы (поле image)");
  }
  const uploaded = file as File;
  if (typeof uploaded.arrayBuffer !== "function") {
    throw new BadRequestError("Приложите фото работы (поле image)");
  }
  const mimeRaw = (uploaded.type || "").toLowerCase();
  const mimeType = ALLOWED_MIME[mimeRaw];
  if (!mimeType) {
    throw new BadRequestError("Формат фото не поддерживается. Загрузите JPEG, PNG или WebP");
  }
  if (uploaded.size === 0) {
    throw new BadRequestError("Файл пустой");
  }
  if (uploaded.size > MAX_IMAGE_BYTES) {
    // ТЗ §11: фото > 8 МБ отклоняется с понятным сообщением, сервер не падает.
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      "Фото больше 8 МБ. Снимите в меньшем разрешении или сожмите на устройстве",
    );
  }
  const bytes = await uploaded.arrayBuffer();

  // 2. Согласие (В-2.2). Текст показан на фронте ДО загрузки; здесь фиксируем
  //    сам факт и версию текста — юридическую силу этому придаёт юрист, не код.
  const consent = form.get("consent");
  const consentVersionRaw = form.get("consentVersion");
  const consentAccepted = String(consent ?? "").toLowerCase() === "true";
  const consentVersion = Number(consentVersionRaw ?? 1);
  if (!consentAccepted) {
    throw new BadRequestError(
      "Без согласия на обработку персональных данных загрузка фото невозможна",
    );
  }
  void consentVersion; // версия пойдёт в photo_checks.consent_version при insert

  // 3. Эталоны.
  const tasksRaw = form.get("tasks");
  if (typeof tasksRaw !== "string") {
    throw new BadRequestError("Не переданы эталонные задания (поле tasks)");
  }
  let parsedTasks: unknown;
  try {
    parsedTasks = JSON.parse(tasksRaw);
  } catch {
    throw new BadRequestError("Поле tasks должно быть корректным JSON");
  }
  if (!Array.isArray(parsedTasks) || parsedTasks.length < MIN_TASKS) {
    throw new BadRequestError("Передайте хотя бы одно задание для проверки");
  }
  if (parsedTasks.length > MAX_TASKS) {
    throw new BadRequestError(`За один раз проверяем до ${MAX_TASKS} заданий, пришло ${parsedTasks.length}`);
  }
  const tasks: ExpectedTask[] = parsedTasks.map((t, i) => {
    const rec = (t ?? {}) as Record<string, unknown>;
    const number = Number(rec.number ?? i + 1);
    if (!Number.isFinite(number)) {
      throw new BadRequestError(`У задания №${i + 1} некорректный номер`);
    }
    const maxPoints = Number(rec.maxPoints ?? 1);
    return {
      number,
      taskText: String(rec.taskText ?? "").slice(0, 2000),
      correctAnswer: String(rec.correctAnswer ?? "").slice(0, 500),
      maxPoints: Number.isFinite(maxPoints) && maxPoints > 0 ? Math.min(maxPoints, 10) : 1,
    };
  });

  // 4. Опциональные метаданные.
  const worksheetIdRaw = form.get("worksheetId");
  const subjectRaw = form.get("subject");
  const gradeRaw = form.get("grade");
  const detailRaw = String(form.get("detail") ?? "low").toLowerCase();

  return {
    bytes,
    mimeType,
    tasks,
    worksheetId:
      typeof worksheetIdRaw === "string" && /^ws_[a-z0-9]{12}$/.test(worksheetIdRaw)
        ? worksheetIdRaw
        : null,
    subject: typeof subjectRaw === "string" ? subjectRaw.slice(0, 50) : null,
    grade: gradeRaw != null && Number.isFinite(Number(gradeRaw)) ? Number(gradeRaw) : null,
    detail: detailRaw === "high" ? "high" : "low",
    consentAccepted,
  };
}

/** DTO позиции наружу — snake_case БД не течёт в API. */
function toItemDto(i: {
  number: number;
  taskText: string;
  expected: string;
  studentAnswer: string | null;
  verdict: string;
  pointsAwarded: number;
  maxPoints: number;
  confidence: number | null;
  needsReview: boolean;
  comment: string | null;
}) {
  return {
    number: i.number,
    taskText: i.taskText,
    expected: i.expected,
    studentAnswer: i.studentAnswer,
    correct: i.verdict === "correct",
    verdict: i.verdict,
    pointsAwarded: i.pointsAwarded,
    maxPoints: i.maxPoints,
    confidence: i.confidence,
    needsReview: i.needsReview,
    comment: i.comment,
  };
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Следующее начало месяца (unix seconds) — для quota.resetAt. */
function nextMonthStart(windowStart: number): number {
  const d = new Date(windowStart * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0) / 1000,
  );
}

export { f06Router };

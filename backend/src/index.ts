/**
 * РабочиеЛисты AI — Cloudflare Workers entry point.
 *
 * Структура:
 *   1. CORS (для FRONTEND_URL) — на всех запросах
 *   2. Access-log — лёгкий, только в dev
 *   3. Auth middleware — резолвит session → c.get('user') (для всех запросов)
 *   4. Route mounts:
 *        /healthz, /readyz              — health
 *        /api/llm/*                      — публичный LLM-info (модели, embeddings)
 *        /api/worksheets/*               — генерация, валидация, чтение листов
 *        /api/exams/*                    — ОГЭ/ЕГЭ
 *        /api/auth/*                     — magic-link, session
 *        /api/users/*                    — профиль, история, избранное, шаблоны, подписка
 *        /api/billing/*                  — ЮKassa payments, webhooks
 *        /api/assignments/*              — F-06 photo-check, F-07 формы учителя
 *        /api/public/forms/*             — TZ-12: страница ученика (БЕЗ авторизации)
 *   5. Error middleware + 404 handler
 */

import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors";
import { originGuard } from "./middleware/origin";
import { errorMiddleware, notFoundHandler } from "./middleware/error";
import { authMiddleware } from "./middleware/auth";
import type { AppEnv } from "./types";

import { healthRouter } from "./routes/health";
import { llmRouter } from "./routes/llm";
import { worksheetsRouter } from "./routes/worksheets";
import { examsRouter } from "./routes/exams";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { billingRouter } from "./routes/billing";
import { adminRouter } from "./routes/admin";
import { trackRouter } from "./routes/track";
import { turnstileRouter } from "./routes/turnstile";
import { accountRouter } from "./routes/account";
import { f06Router } from "./routes/f06";
import { f07Router } from "./routes/f07";
import { f08Router } from "./routes/f08";
import { publicFormsRouter } from "./routes/publicForms";
import { purgeExpiredPhotos } from "./jobs/purgeExpiredPhotos";
import { interactivesRouter } from "./routes/interactives";
import { publicInteractivesRouter } from "./routes/interactives-public";

const app = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Global middleware
// ─────────────────────────────────────────────────────────────────────────────

app.use("*", corsMiddleware());

// CSRF-защита: изменяющие запросы (POST/PUT/PATCH/DELETE) с чужим Origin → 403.
// Идёт сразу после CORS, до auth: смысл в том, чтобы чужой сайт не дошёл
// до бизнес-логики вообще, даже если cookie у него есть.
app.use("*", originGuard());

// Auth middleware — на всех запросах. Не бросает, ставит c.get('user') = null если аноним.
app.use("*", authMiddleware());

// Лёгкий access-лог (только в dev — в проде экономим логи).
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  if (c.env.APP_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - start,
        user: c.get("user")?.id ?? null,
      }),
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Route mounts
// ─────────────────────────────────────────────────────────────────────────────

app.route("/", healthRouter); // /healthz, /readyz
app.route("/api/llm", llmRouter);
app.route("/api/worksheets", worksheetsRouter);
app.route("/api/worksheets", f08Router); // F-08: POST /:id/edit
app.route("/api/exams", examsRouter);
app.route("/api/auth", authRouter);
app.route("/api/users", usersRouter);
app.route("/api/billing", billingRouter);
app.route("/api/account", accountRouter); // ЛК + magic-link
app.route("/api/assignments", f06Router); // F-06: POST /:id/photo-check
app.route("/api/assignments", f07Router); // F-07: формы учителя (требуют входа)
app.route("/api/public/forms", publicFormsRouter); // TZ-12: страница ученика, БЕЗ авторизации
app.route("/api/interactives", interactivesRouter); // TZ-13: ЛК учителя (требует входа)
app.route("/api/public/interactives", publicInteractivesRouter); // TZ-13: игра ученика, БЕЗ авторизации
app.route("/api", trackRouter);  // POST /api/track — публичный
app.route("/api/turnstile", turnstileRouter); // проверка капчи антифрода (409 → капча → повтор)
app.route("/api/admin", adminRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Error handling & 404
// ─────────────────────────────────────────────────────────────────────────────

app.onError(errorMiddleware);
app.notFound(notFoundHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Export для wrangler / tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cron-обработчик: удаление фото тетрадей по истечении retention-срока.
 *
 * TZ-11 §5.2 (В-2.3): фото школьной тетради — персональные данные ребёнка,
 * держим максимум 7 дней. Само поле `delete_at` выставляется при загрузке,
 * но без этого обработчика оно ничего не удаляет: фото лежали бы в R2
 * бессрочно. Триггер объявлен в `wrangler.toml` → `[env.production.triggers]`.
 *
 * Срабатывает раз в сутки, независимо от того, заходил ли учитель в ЛК.
 *
 * ─── Почему `app.scheduled`, а не отдельный `export default { scheduled }` ───
 * В Hono 4.13 метода `app.scheduled` нет вообще (проверено:
 * `typeof new Hono().scheduled === "undefined"`), cron-триггер вешается через
 * `app.fire("scheduled", event, env, ctx)` из обработчика Fetch. `scheduled` —
 * зарезервированное имя события воркера, поэтому навешиваем его вручную.
 */
app.fire = ((event: ScheduledEvent, env: AppEnv["Bindings"], ctx: ExecutionContext) => {
  ctx.waitUntil(
    (async () => {
      try {
        const result = await purgeExpiredPhotos(env.DB, env.PDFS);
        console.info("[cron] purgeExpiredPhotos", JSON.stringify(result));
      } catch (e) {
        // Cron-ошибка не должна ронять воркер: логируем, следующий прогон
        // заберёт просроченное (batch ограничен, `delete_at` не сгорает).
        console.error("[cron] purgeExpiredPhotos failed", e);
      }
    })(),
  );
}) as typeof app.fire;

export default app;
export { app };

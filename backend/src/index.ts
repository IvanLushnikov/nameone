/**
 * УчЛист — Cloudflare Workers entry point.
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
import { purgeExpiredForms } from "./jobs/purgeExpiredForms";
import { sendRenewalReminders, chargeDueSubscriptions } from "./jobs/billingRecurring";
import { journalRouter } from "./routes/journal";
import { interactivesRouter } from "./routes/interactives";
import { publicInteractivesRouter } from "./routes/interactives-public";

const app = new Hono<AppEnv>();

/**
 * Самопроверка конфигурации при первом обращении.
 *
 * Зачем: 2 октября 2026 аудит обнаружил, что на проде не заданы
 * RESEND_API_KEY и ключи ЮKassa. Ни код, ни git об этом не говорят — узнать
 * можно было только через API Cloudflare. При этом отсутствие почты ломало
 * вход, а отсутствие ЮKassa молча уводило оплату в симуляцию.
 *
 * Теперь об этом узнаётся сразу при деплое, из логов, а не по жалобам
 * пользователей. Проверка выполняется один раз на инстанс: секреты при
 * деплое меняются вместе с новым инстансом, так что перепроверять нечего.
 *
 * ВАЖНО: здесь только ИМЕНА отсутствующих переменных. Значения не читаются
 * и никуда не пишутся — в лог попадает ровно столько, сколько нужно, чтобы
 * понять, что чинить.
 */
let configChecked = false;

function checkProductionConfig(env: AppEnv["Bindings"]): void {
  if (configChecked || env.APP_ENV !== "production") return;
  configChecked = true;

  const required: Array<[string, unknown]> = [
    ["JWT_SECRET", env.JWT_SECRET],
    ["POLZA_API_KEY", env.POLZA_API_KEY],
    ["RESEND_API_KEY", env.RESEND_API_KEY],
    ["YOOKASSA_SHOP_ID", env.YOOKASSA_SHOP_ID],
    ["YOOKASSA_SECRET_KEY", env.YOOKASSA_SECRET_KEY],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);

  if (missing.length === 0) {
    // eslint-disable-next-line no-console
    console.info("[config] все обязательные секреты на месте");
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    `[config] КРИТИЧНО: в production не заданы секреты: ${missing.join(", ")}. ` +
      `Последствия по каждому: RESEND_API_KEY — вход по ссылке не работает; ` +
      `YOOKASSA_* — приём платежей отключён; JWT_SECRET — сессии не проверяются; ` +
      `POLZA_API_KEY — генерация не работает. ` +
      `Задать: npx wrangler secret put <ИМЯ> --name rabochielisty-api`,
  );
}

/**
 * Проверка, что опубликованный воркер действительно настроен как прод.
 *
 * Отдельная функция не потому, что логика сложная, а потому что её предмет —
 * не секреты, а сама конфигурация. И она ловит баг, который 2 октября 2026
 * стоил дороже всех найденных дыр: боевой воркер был задеплоен из секции
 * `[vars]` вместо `[env.production.vars]`, то есть работал с
 * `APP_ENV=development` и `FRONTEND_URL=http://localhost:3000`.
 *
 * Из этого следовало: вход выдавал ссылку прямо в ответе (дыра К-2), оплата
 * уходила в симуляцию (бесплатные подписки), а письма уходили с адресом
 * localhost. Ни один тест этого не показывал — в коде всё выглядело верно.
 * Ловить такое можно только сверкой с фактическим состоянием воркера.
 */
let envChecked = false;

function checkPublishedEnvironment(env: AppEnv["Bindings"]): void {
  if (envChecked) return;
  envChecked = true;

  // Значение приходит в виде полного origin («http://localhost:3000»), поэтому
  // схему снимаем ДО проверки. Иначе «http://localhost:3000» не распознаётся
  // как локальный адрес — именно такая ошибка была в первой версии этой
  // проверки, и она бы пропустила неверный деплой.
  const looksLikeLocal = (value: string | undefined) => {
    if (!value) return true;
    const withoutScheme = value.trim().replace(/^https?:\/\//i, "");
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(withoutScheme);
  };

  const problems: string[] = [];
  if (env.APP_ENV !== "production") {
    problems.push(`APP_ENV="${env.APP_ENV ?? "—"}" (ожидается "production")`);
  }
  if (looksLikeLocal(env.FRONTEND_URL)) {
    problems.push(`FRONTEND_URL="${env.FRONTEND_URL ?? "—"}" указывает на локальную машину`);
  }
  if (env.ALLOW_DEV_MAGIC_URL === "true") {
    problems.push("ALLOW_DEV_MAGIC_URL=true — ссылка входа выдаётся в ответе, вход не защищён");
  }
  if (env.ALLOW_DEMO_PAYMENTS === "true") {
    problems.push("ALLOW_DEMO_PAYMENTS=true — оплата симулируется, подписку можно получить бесплатно");
  }

  if (problems.length === 0) return;

  // eslint-disable-next-line no-console
  console.error(
    "[config] КРИТИЧНО: опубликованный воркер настроен как окружение разработки. " +
      problems.join("; ") +
      ". Признак деплоя из [vars] вместо [env.production.vars]. " +
      "Пока так, вход и оплата работают небезопасно. " +
      "Задеплойте с окружением: npx wrangler deploy --env production",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Global middleware
// ─────────────────────────────────────────────────────────────────────────────

// Самопроверка до всего остального: если секретов нет или воркер настроен как
// окружение разработки, об этом надо узнать из лога, а не из ответа пользователю.
app.use("*", async (c, next) => {
  checkProductionConfig(c.env);
  checkPublishedEnvironment(c.env);
  await next();
});

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
app.route("/api/journal", journalRouter); // ТЗ-19: журнал проверок учителя
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
      // 1) Фото тетрадей — ПДн, 7 дней (TZ-11 §5.2).
      try {
        const result = await purgeExpiredPhotos(env.DB, env.PDFS);
        console.info("[cron] purgeExpiredPhotos", JSON.stringify(result));
      } catch (e) {
        // Cron-ошибка не должна ронять воркер: логируем, следующий прогон
        // заберёт просроченное (batch ограничен, `delete_at` не сгорает).
        console.error("[cron] purgeExpiredPhotos failed", e);
      }

      // 2) Ответы учеников в онлайн-формах — ПДн, 90 дней (TZ-12 §5.4).
      //    САМИ формы не удаляются: учитель должен видеть список выданного.
      try {
        const result = await purgeExpiredForms(env.DB);
        console.info("[cron] purgeExpiredForms", JSON.stringify(result));
      } catch (e) {
        console.error("[cron] purgeExpiredForms failed", e);
      }

      // 3) Биллинг (ТЗ-20) — отдельный триггер, раз в час. Подписку нельзя
      //    продлевать суточным кроном: списалось ночью, а доступ вернулся бы
      //    только через сутки, и учитель в это время видел бы «оплачено, но
      //    не работает».
      //
      //    Обе функции — no-op, если выключен RECURRING_BILLING_ENABLED или
      //    не заданы ключи ЮKassa (проверяется внутри). Внешний `if` — чтобы
      //    окружение, где переменной нет вообще, не дёргало джобы вхолостую.
      if (typeof env.RECURRING_BILLING_ENABLED === "string") {
        try {
          const reminders = await sendRenewalReminders(env.DB, env);
          console.info("[cron] sendRenewalReminders", JSON.stringify(reminders));
        } catch (e) {
          console.error("[cron] sendRenewalReminders failed", e);
        }
        try {
          const charges = await chargeDueSubscriptions(env.DB, env);
          console.info("[cron] chargeDueSubscriptions", JSON.stringify(charges));
        } catch (e) {
          console.error("[cron] chargeDueSubscriptions failed", e);
        }
      }
    })(),
  );
}) as typeof app.fire;

export default app;
export { app };

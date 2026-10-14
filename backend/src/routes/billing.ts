/**
 * /api/billing/* — ЮKassa payments, подписки, история.
 *
 *   POST /api/billing/create           — создать платёж, вернуть confirmationUrl
 *   POST /api/billing/yookassa-webhook — webhook от ЮKassa (БЕЗ auth, server-to-server)
 *   GET  /api/billing/subscription     — текущая активная подписка (или 404)
 *   POST /api/billing/cancel           — отменить подписку
 *   GET  /api/billing/history          — история платежей
 *
 * Авторизация:
 *   - Все кроме /yookassa-webhook требуют сессию (`X-Session-Token` header).
 *   - Webhook — server-to-server от ЮKassa, IP allowlist защищает на их стороне.
 *
 * Inline auth: пока T4 не зарегистрировал глобальный auth middleware, делаем
 * session-проверку локально. Если T4 добавит middleware в index.ts — requireUser()
 * подхватит `c.get('user')` из middleware (первый приоритет) и DB-lookup не сделает.
 */

import { Hono, type Context } from "hono";
import { createPaymentRequestSchema } from "../lib/zod";
import {
  createPayment,
  handleWebhook,
  getActiveSubscription,
  cancelSubscription,
  getPaymentHistory,
  type YooKassaWebhookPayload,
} from "../services/billing";
import { getSession, getUserById, getUserRole } from "../db/queries";
import { BadRequestError, UnauthorizedError } from "../lib/errors";
import type { AppEnv, CreatePaymentResponse } from "../types";

/**
 * Первый корректный адрес фронта из строки со списком через запятую.
 *
 * ЗАЧЕМ. В проде FRONTEND_URL — это список origin'ов через запятую
 * («https://uchlist.ru,https://www.uchlist.ru»): список нужен CORS, который его
 * разбирает. Вставлять же список целиком в ссылку, которую видит человек, нельзя:
 * получается несуществующий адрес вида
 * «https://uchlist.ru,https://www.uchlist.ru/account?paid=1».
 * Та же мысль уже высказана в services/auth.ts (buildMagicLinkUrl) и
 * services/email.ts (appUrl) — здесь она применяется к возврату с оплаты.
 *
 * Берём ПЕРВЫЙ элемент, который похож на адрес, а не просто первый после
 * разбиения: пустые места и обрывки вроде «uchlist.ru» без схемы не должны
 * становиться адресом возврата.
 *
 * ВНИМАНИЕ: имя, сигнатуру и тело этой функции проверяет
 * scripts/check-auto-renew-consent.mjs (гейт листа 1.1.2). Функция вынесена
 * отдельно и без импортов именно ради этого: скрипт выполняет её на настоящем
 * коде. Меняешь здесь — правь там же.
 */
export function firstValidFrontendOrigin(raw: string | undefined): string {
  for (const part of (raw ?? "").split(",")) {
    const candidate = part.trim().replace(/\/+$/, "");
    // Пробел внутри элемента — это уже не адрес («https://a.ru https://b.ru»),
    // такой пропускаем целиком, а не режем пополам.
    if (/\s/.test(candidate)) continue;
    // Только http(s) и только начало origin: без пустой схемы «https://».
    if (/^https?:\/\/[^\s/?#]+/i.test(candidate)) return candidate;
  }
  return "";
}

const billingRouter = new Hono<AppEnv>();

/**
 * Достать текущего пользователя. Использует `c.get('user')` из глобального
 * auth-middleware, либо делает inline session lookup через `X-Session-Token`.
 */
async function requireUser(c: Context<AppEnv>) {
  const existing = c.get("user");
  if (existing) return existing;

  const token = c.req.header("X-Session-Token");
  if (!token) throw new UnauthorizedError("Missing session token");

  const session = await getSession(c.env.DB, token);
  if (!session) throw new UnauthorizedError("Invalid or expired session");

  const user = await getUserById(c.env.DB, session.user_id);
  if (!user) throw new UnauthorizedError("User not found");

  c.set("user", {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    isAdmin: user.is_admin === 1,
    role: await getUserRole(c.env.DB, user.id),
  });
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /create — создать платёж
// ─────────────────────────────────────────────────────────────────────────────

billingRouter.post("/create", async (c) => {
  const user = await requireUser(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const parsed = createPaymentRequestSchema.parse(rawBody);

  // returnUrl. Фронт почти всегда присылает свой адрес — тогда берём его как есть.
  //
  // Если адрес не пришёл (или пришёл пустым), собираем его сами, и обязательно
  // из ОДНОГО адреса. Раньше здесь было `${c.env.FRONTEND_URL}/account?paid=1`, а в
  // проде FRONTEND_URL — список через запятую ради CORS, то есть на выходе был
  // несуществующий URL вида «https://uchlist.ru,https://www.uchlist.ru/account?paid=1».
  // Фронт это маскировал тем, что всегда присылал свой адрес, но дефолт-то был
  // неправильный, и любой клиент без returnUrl получал битую ссылку.
  const clientReturnUrl =
    typeof rawBody === "object" &&
    rawBody !== null &&
    "returnUrl" in rawBody &&
    typeof (rawBody as { returnUrl?: unknown }).returnUrl === "string"
      ? (rawBody as { returnUrl: string }).returnUrl.trim()
      : "";

  let returnUrl = clientReturnUrl;
  if (!returnUrl) {
    // APP_PUBLIC_URL — это как раз «один origin для ссылок, которые видит человек»
    // (см. env.ts). Список FRONTEND_URL — запасной путь для старых конфигураций.
    const origin =
      firstValidFrontendOrigin(c.env.APP_PUBLIC_URL) ||
      firstValidFrontendOrigin(c.env.FRONTEND_URL);
    if (!origin) {
      // Молча уходить на пустую ссылку нельзя: ЮKassa всё равно её не примет, а
      // учитель увидит «оплата не прошла» без причины. Говорим прямо, что чинить.
      throw new BadRequestError(
        "Не задан адрес фронта для возврата с оплаты: задайте APP_PUBLIC_URL " +
          "(или FRONTEND_URL) в конфигурации воркера",
      );
    }
    returnUrl = `${origin}/account?paid=1`;
  }

  const result = await createPayment(c.env.DB, c.env, {
    userId: user.id,
    plan: parsed.plan,
    period: parsed.period,
    returnUrl,
    // Согласие на автосписания (ТЗ-20). Значение приходит с экрана оплаты: там
    // есть явная галочка «продлевать автоматически», снятая по умолчанию, и она
    // показывается только для помесячной оплаты. Без неё `autoRenew` не
    // присылается, `parsed.autoRenew` — undefined, и согласия нет.
    // Дальше createPayment применяет согласие только при периоде «месяц» и
    // включённом RECURRING_BILLING_ENABLED; учебный год согласие игнорирует
    // в любом случае (ТЗ-20 §2.6).
    autoRenewConsent: parsed.autoRenew === true,
  });

  const response: CreatePaymentResponse = {
    ok: true,
    paymentId: result.paymentId,
    confirmationUrl: result.confirmationUrl,
  };
  return c.json(response);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /yookassa-webhook — webhook от ЮKassa (БЕЗ auth)
// ─────────────────────────────────────────────────────────────────────────────

billingRouter.post("/yookassa-webhook", async (c) => {
  let body: YooKassaWebhookPayload;
  try {
    body = (await c.req.json()) as YooKassaWebhookPayload;
  } catch {
    // Битый body — логируем и возвращаем 200 (ЮKassa будет ретраить на не-2xx,
    // мы же не хотим, чтобы битый POST засорял error log бесконечно).
    // eslint-disable-next-line no-console
    console.warn("[billing] webhook: invalid JSON body");
    return c.json({ handled: false });
  }

  const result = await handleWebhook(c.env.DB, c.env, body);
  return c.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /subscription — текущая активная подписка
// ─────────────────────────────────────────────────────────────────────────────

billingRouter.get("/subscription", async (c) => {
  const user = await requireUser(c);
  const sub = await getActiveSubscription(c.env.DB, user.id);
  if (!sub) {
    return c.json({ ok: false, error: "No active subscription", code: "NOT_FOUND" }, 404);
  }
  return c.json({ ok: true, subscription: sub });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /cancel — отменить подписку
// ─────────────────────────────────────────────────────────────────────────────
// Отмена означает «перестаём списывать»: автопродление гасится, а оплаченный
// период доигрывается до конца (services/billing.ts → cancelSubscription).
// Учитель не должен терять оплаченное из-за того, что нажал кнопку в конце
// месяца.

billingRouter.post("/cancel", async (c) => {
  const user = await requireUser(c);
  await cancelSubscription(c.env.DB, user.id);
  return c.json({ ok: true, canceled: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /history — история платежей
// ─────────────────────────────────────────────────────────────────────────────

billingRouter.get("/history", async (c) => {
  const user = await requireUser(c);
  const payments = await getPaymentHistory(c.env.DB, user.id);
  return c.json({ ok: true, payments });
});

export { billingRouter };

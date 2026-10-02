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

  // returnUrl опциональный (фронт может прислать свой, иначе — дефолт на /account).
  const returnUrl =
    typeof rawBody === "object" &&
    rawBody !== null &&
    "returnUrl" in rawBody &&
    typeof (rawBody as { returnUrl?: unknown }).returnUrl === "string"
      ? (rawBody as { returnUrl: string }).returnUrl
      : `${c.env.FRONTEND_URL}/account?paid=1`;

  const result = await createPayment(c.env.DB, c.env, {
    userId: user.id,
    plan: parsed.plan,
    period: parsed.period,
    returnUrl,
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

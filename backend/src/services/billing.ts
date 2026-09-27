/**
 * Billing service: прайсинг, создание платежей в ЮKassa, обработка webhook'ов.
 *
 * Без внешнего SDK — REST + fetch. Секреты в env (YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY).
 * Если секретов нет — включается dev-mode (без реального вызова API), чтобы фронт
 * мог гонять полный флоу локально без регистрации магазина в ЮKassa.
 *
 * Все суммы — в КОПЕЙКАХ (integers). Перевод в рубли только для UI/labels.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import { shortId } from "../lib/shortid";
import { updateUserPlan } from "../db/queries";
import { InternalError } from "../lib/errors";

// ─────────────────────────────────────────────────────────────────────────────
// Прайсинг (в копейках). 12 × monthly со скидкой за годовую оплату.
// ─────────────────────────────────────────────────────────────────────────────

export type PaidPlan = "base" | "plus";
export type Period = "monthly" | "yearly";

/**
 * Канон тарифов — единый источник правды для backend (создание платежа, валидация).
 * Синхронизирован с front PaywallModal.tsx: base 590/490, plus 1490/990.
 */
export const PRICES = {
  base: { monthly: 590_00, yearly: 490_00 * 12 },
  plus: { monthly: 1490_00, yearly: 990_00 * 12 },
} as const;

export function getPriceKopecks(plan: PaidPlan, period: Period): number {
  return PRICES[plan][period];
}

// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

export interface YooKassaWebhookPayload {
  type?: string;
  event?: "payment.succeeded" | "payment.canceled" | "payment.waiting_for_capture" | "refund.succeeded";
  object?: {
    id: string;
    status: string;
    amount?: { value: string; currency: string };
    metadata?: { user_id?: string; plan?: PaidPlan; period?: Period };
    captured_at?: string;
    created_at?: string;
  };
}

export interface CreatePaymentParams {
  userId: string;
  plan: PaidPlan;
  period: Period;
  returnUrl: string;
}

export interface CreatePaymentResult {
  /** Наш внутренний payment-id (pay_xxx) — отдаём фронту как paymentId. */
  paymentId: string;
  /** ID платежа в ЮKassa (или наш, в dev-mode). */
  yookassaPaymentId: string;
  confirmationUrl: string;
  /** Сумма в копейках. */
  amount: number;
  devMode: boolean;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: PaidPlan;
  status: string;
  period: Period;
  yookassa_payment_id: string | null;
  starts_at: number;
  ends_at: number;
  auto_renew: number;
  created_at: number;
  updated_at: number;
}

export interface PaymentHistoryRow {
  id: string;
  user_id: string | null;
  plan: PaidPlan;
  amount_rub: number;
  yookassa_payment_id: string | null;
  status: string;
  confirmation_url: string | null;
  created_at: number;
  completed_at: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const YOOKASSA_API = "https://api.yookassa.ru/v3/payments";

/** Локальный payment-id — короткий, читабельный, с префиксом. */
function generatePaymentId(): string {
  return `pay_${shortId()}`;
}

/** Basic auth для ЮKassa (btoa работает с latin1 — пароли ЮKassa в latin1, OK). */
function basicAuthHeader(shopId: string, secretKey: string): string {
  return "Basic " + btoa(`${shopId}:${secretKey}`);
}

/** Сколько секунд прибавить к starts_at для расчёта ends_at. */
function periodDurationSeconds(period: Period): number {
  return period === "yearly" ? 365 * 86400 : 30 * 86400;
}

// ─────────────────────────────────────────────────────────────────────────────
// createPayment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создать платёж в ЮKassa (или dev-mode запись в БД).
 * Сохраняет payment в таблицу payments со status='pending'.
 * Возвращает URL для redirect пользователя на страницу оплаты.
 */
export async function createPayment(
  db: D1Database,
  env: Env,
  params: CreatePaymentParams,
): Promise<CreatePaymentResult> {
  const { userId, plan, period, returnUrl } = params;
  const amountKopecks = getPriceKopecks(plan, period);
  const amountFormatted = (amountKopecks / 100).toFixed(2);
  const description = `РабочиеЛисты AI · ${plan} · ${period}`;
  const paymentId = generatePaymentId();
  const now = Math.floor(Date.now() / 1000);

  const shopId = env.YOOKASSA_SHOP_ID;
  const secretKey = env.YOOKASSA_SECRET_KEY;
  const isDevMode = !shopId || !secretKey;

  if (isDevMode) {
    const confirmationUrl = `${env.FRONTEND_URL}/pricing?demo_payment=${paymentId}`;
    await db
      .prepare(
        `INSERT INTO payments
           (id, user_id, plan, amount_rub, yookassa_payment_id, status, confirmation_url, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)`,
      )
      .bind(paymentId, userId, plan, amountKopecks, paymentId, confirmationUrl, now)
      .run();
    // eslint-disable-next-line no-console
    console.info(
      `[billing] dev-mode payment created: id=${paymentId} user=${userId} plan=${plan} period=${period} amount=${amountKopecks}`,
    );
    return {
      paymentId,
      yookassaPaymentId: paymentId,
      confirmationUrl,
      amount: amountKopecks,
      devMode: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Real YooKassa API call
  // ─────────────────────────────────────────────────────────────────────────

  const idempotenceKey = paymentId; // наш pay_xxx → идемпотентность запроса
  const body = {
    amount: { value: amountFormatted, currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: returnUrl },
    description,
    metadata: { user_id: userId, plan, period },
  };

  const response = await fetch(YOOKASSA_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotence-Key": idempotenceKey,
      Authorization: basicAuthHeader(shopId, secretKey),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.error(`[billing] YooKassa API error: ${response.status} body=${text.slice(0, 500)}`);
    throw new InternalError(`YooKassa API error: ${response.status}`);
  }

  const yk = (await response.json()) as {
    id: string;
    status: string;
    confirmation?: { type: string; confirmation_url: string };
  };

  if (!yk.confirmation?.confirmation_url) {
    throw new InternalError("YooKassa response missing confirmation_url");
  }

  await db
    .prepare(
      `INSERT INTO payments
         (id, user_id, plan, amount_rub, yookassa_payment_id, status, confirmation_url, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(paymentId, userId, plan, amountKopecks, yk.id, yk.status, yk.confirmation.confirmation_url, now)
    .run();

  return {
    paymentId,
    yookassaPaymentId: yk.id,
    confirmationUrl: yk.confirmation.confirmation_url,
    amount: amountKopecks,
    devMode: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// handleWebhook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Обработать webhook от ЮKassa.
 *
 * TODO(security): ЮKassa по умолчанию НЕ подписывает webhooks. В проде:
 *   1) Включить IP allowlist в ЛК ЮKassa (HTTP-уведомления → Список IP).
 *   2) Опционально добавить HMAC через заголовок (ЮKassa поддерживает кастомный
 *      shared secret — настроить в личном кабинете и верифицировать здесь).
 *
 * Сейчас доверяем payload'у (server-to-server + IP allowlist на стороне ЮKassa
 * достаточно для маленького продукта).
 */
export async function handleWebhook(
  db: D1Database,
  _env: Env,
  body: YooKassaWebhookPayload,
): Promise<{ handled: boolean }> {
  if (!body || body.type !== "notification" || !body.event || !body.object) {
    // eslint-disable-next-line no-console
    console.warn(`[billing] webhook: invalid payload shape event=${body?.event ?? "?"}`);
    return { handled: false };
  }

  const ykId = body.object.id;
  const event = body.event;
  const now = Math.floor(Date.now() / 1000);

  if (event === "payment.succeeded") {
    // 1. Обновить сам платёж
    await db
      .prepare(`UPDATE payments SET status = 'succeeded', completed_at = ?1 WHERE yookassa_payment_id = ?2`)
      .bind(now, ykId)
      .run();

    // 2. Найти пользователя (через нашу запись о платеже — yookassa_payment_id UNIQUE)
    const payment = await db
      .prepare(`SELECT user_id, plan FROM payments WHERE yookassa_payment_id = ?1`)
      .bind(ykId)
      .first<{ user_id: string | null; plan: PaidPlan }>();

    if (!payment || !payment.user_id) {
      // eslint-disable-next-line no-console
      console.warn(`[billing] webhook succeeded: payment yookassa_id=${ykId} not found in DB`);
      return { handled: true };
    }

    const userId = payment.user_id;
    // Prefer metadata из webhook (фронт мог поменять план к моменту оплаты),
    // fallback — plan из БД (который фронт прислал в /create).
    const plan = body.object.metadata?.plan ?? payment.plan;
    const period: Period = body.object.metadata?.period ?? "monthly";
    const endsAt = now + periodDurationSeconds(period);

    // 3. Отменить предыдущие активные подписки этого юзера (новая подписка перебивает)
    await db
      .prepare(
        `UPDATE subscriptions SET status = 'canceled', updated_at = ?1
         WHERE user_id = ?2 AND status = 'active'`,
      )
      .bind(now, userId)
      .run();

    // 4. Создать новую активную подписку
    const subId = `sub_${shortId()}`;
    await db
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, plan, status, period, yookassa_payment_id,
            starts_at, ends_at, auto_renew, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6, ?7, 1, ?6, ?6)`,
      )
      .bind(subId, userId, plan, period, ykId, now, endsAt)
      .run();

    // 5. Обновить users.plan (cache column — реальный источник правды это subscriptions)
    await updateUserPlan(db, userId, plan);

    // eslint-disable-next-line no-console
    console.info(
      `[billing] subscription activated: user=${userId} plan=${plan} period=${period} until=${endsAt}`,
    );
    return { handled: true };
  }

  if (event === "payment.canceled") {
    await db
      .prepare(`UPDATE payments SET status = 'canceled' WHERE yookassa_payment_id = ?1`)
      .bind(ykId)
      .run();
    // eslint-disable-next-line no-console
    console.info(`[billing] payment canceled: ${ykId}`);
    return { handled: true };
  }

  if (event === "refund.succeeded") {
    const payment = await db
      .prepare(`SELECT user_id FROM payments WHERE yookassa_payment_id = ?1`)
      .bind(ykId)
      .first<{ user_id: string | null }>();

    if (payment?.user_id) {
      // Отменить активную подписку, привязанную к этому платежу
      await db
        .prepare(
          `UPDATE subscriptions SET status = 'canceled', auto_renew = 0, updated_at = ?1
           WHERE user_id = ?2 AND yookassa_payment_id = ?3 AND status = 'active'`,
        )
        .bind(now, payment.user_id, ykId)
        .run();
    }
    await db
      .prepare(`UPDATE payments SET status = 'refunded' WHERE yookassa_payment_id = ?1`)
      .bind(ykId)
      .run();
    // eslint-disable-next-line no-console
    console.info(`[billing] refund processed: ${ykId}`);
    return { handled: true };
  }

  // Неизвестные события (payment.waiting_for_capture и пр.) — логируем, не падаем.
  // eslint-disable-next-line no-console
  console.info(`[billing] webhook: ignored event=${event} id=${ykId}`);
  return { handled: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Текущая активная подписка пользователя (status='active' AND ends_at > now).
 * Возвращает самую «свежую» по ends_at (если несколько активных из-за race).
 */
export async function getActiveSubscription(
  db: D1Database,
  userId: string,
): Promise<SubscriptionRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT id, user_id, plan, status, period, yookassa_payment_id,
              starts_at, ends_at, auto_renew, created_at, updated_at
       FROM subscriptions
       WHERE user_id = ?1 AND status = 'active' AND ends_at > ?2
       ORDER BY ends_at DESC LIMIT 1`,
    )
    .bind(userId, now)
    .first<SubscriptionRow>();
  return row ?? null;
}

/**
 * Отменить подписку: status='canceled', auto_renew=0, downgrade users.plan до free.
 * Подписка остаётся активной до конца оплаченного периода (ends_at не двигаем) —
 * фронт сам решит, оставить доступ до конца периода или отрезать сразу.
 */
export async function cancelSubscription(db: D1Database, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE subscriptions SET status = 'canceled', auto_renew = 0, updated_at = ?1
       WHERE user_id = ?2 AND status = 'active'`,
    )
    .bind(now, userId)
    .run();
  await updateUserPlan(db, userId, "free");
}

/**
 * История платежей пользователя (все статусы, новые сверху).
 */
export async function getPaymentHistory(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<PaymentHistoryRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, user_id, plan, amount_rub, yookassa_payment_id, status,
              confirmation_url, created_at, completed_at
       FROM payments
       WHERE user_id = ?1
       ORDER BY created_at DESC
       LIMIT ?2`,
    )
    .bind(userId, limit)
    .all<PaymentHistoryRow>();
  return rows.results ?? [];
}

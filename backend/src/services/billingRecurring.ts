/**
 * Сервис рекуррентного автопродления (ТЗ-20).
 *
 * Здесь вся «механика денег», а в `jobs/billingRecurring.ts` — только сборка
 * крона: что вызвать, в каком порядке и что записать в лог.
 *
 * ─── ГЛАВНОЕ ПРАВИЛО ФАЙЛА ─────────────────────────────────────────────────
 * Ни одна функция здесь не имеет права что-то списывать, если согласия нет.
 * Согласие материализовано ровно одной вещью — строкой в
 * `recurring_payment_methods` со `status = 'active'`. Строка появляется
 * исключительно в вебхуке, исключительно для платежа, который УЧИТЕЛЬ оплатил
 * сам с `save_payment_method: true`.
 *
 * Отсюда следует и решение по тем, кто уже заплатил разово (ТЗ-20 §5.3):
 * у них такой строки нет, крон их не видит и не списывает. Миграции данных
 * нет, переводить молча нельзя, и код это просто не умеет.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import {
  PRICES,
  RENEWAL_ID_PREFIX,
  getPriceKopecks,
  periodDurationSeconds,
  renewalPaymentId,
  type PaidPlan,
  type Period,
} from "./billing";
import { shortId } from "../lib/shortid";

/** Сколько подписок обрабатываем за один проход — как в остальных джобах. */
export const BATCH_LIMIT = 200;

/**
 * Окно напоминания: от 24 до 25 часов до конца периода.
 *
 * Нижняя граница (не раньше суток) — чтобы письмо не прилетело за трое суток.
 * Верхняя граница (не позже 25 часов) — из-за часового крона. Ровно в полночь
 * письмо пришло бы на границе «уже завтра», и учитель прочитал бы «завтра
 * спишем» в 00:00, когда до списания ещё 24 часа. Сдвиг в час делает
 * формулировку «завтра» правдивой в любой момент прохода.
 */
export const REMINDER_WINDOW_MIN_SEC = 24 * 3600;
export const REMINDER_WINDOW_MAX_SEC = 25 * 3600;

const YOOKASSA_API = "https://api.yookassa.ru/v3/payments";

// ─────────────────────────────────────────────────────────────────────────────
// Флаг фичи
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Включён ли рекуррент.
 *
 * Проверка строго на "true": любое другое значение (в том числе "1" или
 * "TRUE") считается выключенным. Пока автоплатежи в боевом магазине не
 * разрешены менеджером ЮKassa, «полувключённый» флаг означал бы попытку
 * списать деньги у учителя, который на это не подписывался.
 */
export function isRecurringEnabled(env: Env): boolean {
  return env.RECURRING_BILLING_ENABLED === "true";
}

/** Есть ли ключи для реального вызова API. Без них списание невозможно. */
export function hasYooKassaKeys(env: Env): boolean {
  return Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Подписки к обработке
// ─────────────────────────────────────────────────────────────────────────────

export interface EndingSubscription {
  id: string;
  user_id: string;
  email: string;
  plan: PaidPlan;
  period: Period;
  ends_at: number;
  /** 1 — есть живая строка согласия на списания, 0 — автопродления нет. */
  has_recurring_method: number;
}

export interface DueSubscription {
  id: string;
  user_id: string;
  email: string;
  plan: PaidPlan;
  period: Period;
  ends_at: number;
  yookassa_payment_method_id: string;
}

/**
 * Подписки, по которым СЕЙЧАС можно и нужно списать.
 *
 * Четыре условия в одном SELECT — и это ровно те четыре вещи, которых не
 * должно быть у платящего «по инерции»:
 *   status='active' + period='monthly' — живые помесячные подписки;
 *   ends_at <= now                     — период закончился;
 *   auto_renew=1                       — учитель сам не отменял;
 *   INNER JOIN по rpm status='active'  — было ЯВНОЕ согласие на списания.
 *
 * Учебный год сюда не попадает дважды: период отфильтрован, и согласие на него
 * createPayment не принимает вовсе (ТЗ-20 §2.6).
 */
export async function findDueSubscriptions(
  db: D1Database,
  now: number,
  limit = BATCH_LIMIT,
): Promise<DueSubscription[]> {
  const rows = await db
    .prepare(
      `SELECT s.id            AS id,
              s.user_id       AS user_id,
              u.email         AS email,
              s.plan          AS plan,
              s.period        AS period,
              s.ends_at       AS ends_at,
              r.yookassa_payment_method_id AS yookassa_payment_method_id
       FROM subscriptions s
       JOIN recurring_payment_methods r ON r.subscription_id = s.id
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'active'
         AND s.period = 'monthly'
         AND s.auto_renew = 1
         AND s.ends_at <= ?1
         AND r.status = 'active'
       ORDER BY s.ends_at ASC
       LIMIT ?2`,
    )
    .bind(now, limit)
    .all<DueSubscription>();
  return rows.results ?? [];
}

/**
 * Подписки, у которых заканчивается период — для напоминаний.
 *
 * Здесь, в отличие от findDueSubscriptions, автопродления может не быть: письмо
 * «ваш период заканчивается, списаний не будет, продлите» нужно и тем, кто
 * платит разово (см. sendPeriodEndingEmail).
 */
export async function findEndingSubscriptions(
  db: D1Database,
  now: number,
  limit = BATCH_LIMIT,
): Promise<EndingSubscription[]> {
  const rows = await db
    .prepare(
      `SELECT s.id          AS id,
              s.user_id     AS user_id,
              u.email       AS email,
              s.plan        AS plan,
              s.period      AS period,
              s.ends_at     AS ends_at,
              CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS has_recurring_method
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN recurring_payment_methods r
              ON r.subscription_id = s.id AND r.status = 'active'
       WHERE s.status = 'active'
         AND s.ends_at > ?1
         AND s.ends_at <= ?2
       ORDER BY s.ends_at ASC
       LIMIT ?3`,
    )
    .bind(now, now + REMINDER_WINDOW_MAX_SEC, limit)
    .all<EndingSubscription>();
  return rows.results ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Идемпотентность писем
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Занять место в billing_notifications под конкретное письмо.
 *
 * ── Почему сначала фиксируем, потом шлём ───────────────────────────────────
 * Обратный порядок (отправить, потом записать) при падении между шагами даёт
 * повторное письмо на следующем прогоне. Напоминаний в сутки — 24, cron ходит
 * каждый час, и учитель получил бы «завтра спишем 500 ₽» двадцать четыре раза.
 * Сначала-затем-шлём хуже только в одном случае: письмо не ушло ( Resend лежит),
 * а строка уже занята — тогда письмо не повторится в этом окне. Окно сутки, и
 * следующий период всё равно получит своё письмо. Между «24 лишних письма» и
 * «одно потерянное» выбираем однозначно второе.
 *
 * Возвращает true, если место было свободно (письмо надо слать).
 */
export async function claimNotification(
  db: D1Database,
  userId: string,
  kind: "renewal_reminder" | "renewal_done" | "renewal_failed",
  dedupeKey: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO billing_notifications (id, user_id, kind, dedupe_key, sent_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(`btn_${shortId()}`, userId, kind, dedupeKey, now)
    .run();

  // D1 отдаёт meta.changes — сколько строк реально изменилось. Ноль означает,
  // что UNIQUE(kind, dedupe_key) уже занята и письмо по этому списанию ушло.
  const changes = result?.meta?.changes ?? 0;
  return changes > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Списание
// ─────────────────────────────────────────────────────────────────────────────

export interface ChargeOutcome {
  ok: boolean;
  /** Наш payment-id (pay_r_xxx) — по нему вебхук найдёт платёж. */
  paymentId: string;
  /** Текст ошибки для лога. Секретов и полных тел ответов здесь нет. */
  error?: string;
}

/**
 * Создать платёж по сохранённому способу оплаты (безакцептное списание).
 *
 * Запрос отличается от обычной покупки ровно двумя вещами:
 *   • вместо `confirmation` передаётся `payment_method_id` — подтверждать
 *     платёж не нужно, учитель в этом цикле не участвует;
 *   • в `Idempotence-Key` идёт наш `pay_r_…`. Если сеть оборвалась после того,
 *     как ЮKassa платёж создал, повторный прогон крона с тем же ключом вернёт
 *     тот же платёж, а не спишет дважды.
 *
 * Дальше срабатывает обычная цепочка: вебхук `payment.succeeded` продлевает
 * период (services/billing.ts) и присылает письмо.
 */
export async function chargeDueSubscription(
  db: D1Database,
  env: Env,
  sub: DueSubscription,
  options: { now?: number; fetcher?: typeof globalThis.fetch } = {},
): Promise<ChargeOutcome> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const amountKopecks = getPriceKopecks(sub.plan, sub.period);
  const amountFormatted = (amountKopecks / 100).toFixed(2);
  const paymentId = renewalPaymentId();

  // Не списываем дважды за один и тот же закончившийся период.
  // Крон ходит каждый час, а вебхук может задержаться на минуты: без этой
  // проверки второй прогон создал бы второе списание за тот же месяц.
  // GLOB, а не LIKE: в LIKE подчёркивание — «любой символ», и префикс pay_r_
  // совпал бы с чужими платежами. В GLOB `_` — литеральный символ.
  const alreadyCharged = await db
    .prepare(
      `SELECT id FROM payments
       WHERE user_id = ?1
         AND id GLOB ?3
         AND status IN ('pending', 'succeeded')
         AND created_at >= ?2
       LIMIT 1`,
    )
    .bind(
      sub.user_id,
      sub.ends_at - periodDurationSeconds(sub.period),
      `${RENEWAL_ID_PREFIX}*`,
    )
    .first<{ id: string }>();

  if (alreadyCharged) {
    return { ok: true, paymentId: alreadyCharged.id, error: "already_charged" };
  }

  const body = {
    amount: { value: amountFormatted, currency: "RUB" },
    capture: true,
    payment_method_id: sub.yookassa_payment_method_id,
    description: `УчЛист · ${sub.plan} · продление месяца`,
    metadata: { user_id: sub.user_id, plan: sub.plan, period: sub.period },
  };

  const response = await fetcher(YOOKASSA_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotence-Key": paymentId,
      Authorization: basicAuthHeader(env.YOOKASSA_SHOP_ID!, env.YOOKASSA_SECRET_KEY!),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // Тело ответа в лог не пишем целиком: там могут быть фрагменты данных карты.
    // eslint-disable-next-line no-console
    console.error(
      `[billing] YooKassa отклонила автосписание sub=${sub.id} status=${response.status} body=${text.slice(0, 200)}`,
    );
    return { ok: false, paymentId, error: `yookassa_${response.status}` };
  }

  const yk = (await response.json()) as { id: string; status: string };

  await db
    .prepare(
      `INSERT INTO payments
         (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(paymentId, sub.user_id, sub.plan, sub.period, amountKopecks, yk.id, yk.status, now)
    .run();

  // Привязываем платёж к подписке. Именно эта связь потом превращает
  // `payment.succeeded` в ПРОДЛЕНИЕ, а не в новую подписку: вебхук ищет
  // активную подписку по этому yk-id. Поле, кстати, не новое — в нём и раньше
  // лежал платёж, за который подписку открыли; мы просто переставляем указатель
  // на последний (он же теперь единственный) платёж этой подписки.
  await db
    .prepare(`UPDATE subscriptions SET yookassa_payment_id = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(yk.id, now, sub.id)
    .run();

  return { ok: true, paymentId };
}

/** Сколько стоит месяц тарифа — для текста напоминания. Суммы в копейках. */
export function monthlyPriceKopecks(plan: PaidPlan): number {
  return PRICES[plan].monthly;
}

function basicAuthHeader(shopId: string, secretKey: string): string {
  return "Basic " + btoa(`${shopId}:${secretKey}`);
}

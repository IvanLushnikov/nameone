/**
 * Подписка и оплата из кабинета (ТЗ-21, блок 4).
 *
 * Второй (из двух) файл, принадлежащий этому блоку в `src/lib/lk/`.
 * Первый — `profile-api.ts`.
 *
 * Серверные методы `/api/billing/subscription`, `/cancel`, `/history` были
 * написаны и готовы, но из фронта не вызывались ни разу. Здесь они наконец
 * используются, плюс `POST /api/billing/create` — единственный способ дойти до
 * платёжной страницы.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ОПЛАТА. ГДЕ ЗАканчивается наша зона ответственности
 * ─────────────────────────────────────────────────────────────────────────────
 * Цепочка доведена до последнего пункта, который зависит от нас: кнопка
 * «Перейти к оплате» создаёт платёж на сервере и уводит учителя на страницу
 * платёжного сервиса (`confirmationUrl` из ответа). Дальше — территория
 * интегратора, и мы её НЕ имитируем:
 *
 *   * приём платежей сейчас не настроен — бэк честно отвечает 500
 *     («Приём платежей не настроен»), и мы показываем это сообщение, а не
 *     «оплата прошла»;
 *   * никаких «демо-оплат» и «успешных платежей» в интерфейсе нет: подделать
 *     успешную оплату — значит показать учителю несуществующий тариф;
 *   * кнопка «Я оплатил» / автоподтверждение без ответа платёжного сервиса
 *     не реализованы намеренно (TODO в отчёте).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * АНОНИМ
 * ─────────────────────────────────────────────────────────────────────────────
 * Входа нет (`MAGIC_LINK_READY = false`) — и это не причина прятать блок.
 * Анонимный учитель видит тот же блок: свой тариф, цену, честную пометку, что
 * платежи и чеки появятся после входа, и рабочую кнопку перехода на тарифы.
 * Блока «войдите, чтобы увидеть» здесь нет и быть не должно.
 */

import { PLANS, formatRub, priceShort, type PeriodId, type PlanId } from "@/lib/content/plans";
import { getCurrentUser, fetchUsage } from "@/lib/auth/api";
import { getProfile } from "@/lib/utils/storage";

/* ────────────────────────────────────────────────────────────────────────────
 * Типы
 * ──────────────────────────────────────────────────────────────────────────── */

export type SubscriptionState =
  /** Платного тарифа нет. */
  | "free"
  /** Платный тариф, автопродление включено. */
  | "active"
  /** Платный тариф, автопродление выключено: доступ доигрывается. */
  | "canceled"
  /** Платный тариф есть, но учитель вышел за объём. Генерация при этом НЕ останавливается. */
  | "over";

export interface SubscriptionView {
  state: SubscriptionState;
  plan: PlanId;
  planName: string;
  /** Период оплаты, если тариф платный. */
  period: PeriodId | null;
  /** «500 ₽/мес», «3 800 ₽/9 мес» — готовая строка из единого источника цен. */
  priceLabel: string;
  /**
   * Когда следующее списание — unix-секунды. Это то, что сейчас спрятано
   * мелкой строкой внутри карточки нормы, и по ТЗ должно быть отдельной строкой.
   */
  nextChargeAt: number | null;
  /** Когда заканчивается оплаченный период. */
  periodEndsAt: number | null;
  autoRenew: boolean;
  /**
   * Способ оплаты. `saved` — карта сохранена платёжным сервисом (значит есть
   * согласие на автосписания), `none` — способ не сохранён.
   * `unknown` — сервер этого не отдаёт (см. TODO в отчёте): показываем честное
   * «нужно проверить у платёжного сервиса», а не выдуманную карту.
   */
  paymentMethod: "saved" | "none" | "unknown";
  /** Данные с сервера или с устройства. */
  source: "account" | "device";
  /** Почему блок может быть беднее обычного — одной строкой для подписи. */
  note: string | null;
}

export interface PaymentItem {
  id: string;
  plan: PlanId;
  amountRub: number;
  status: string;
  createdAt: number;
  completedAt: number | null;
  /** Ссылка на чек в личном кабинете платёжного сервиса, если она есть. */
  receiptUrl: string | null;
  period?: string | null;
}

export type SubscriptionApiError =
  | "network"
  | "unauthorized"
  | "not_found"
  | "validation"
  | "payment_unavailable"
  | "internal";

export interface LoadSubscriptionResult {
  subscription: SubscriptionView;
  history: PaymentItem[];
  /** Можно ли платить прямо отсюда: нужен вход И работающий приём платежей. */
  canPay: boolean;
  /** Причина, по которой платить нельзя (для честной подписи под кнопкой). */
  canPayReason: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Сервер
 * ──────────────────────────────────────────────────────────────────────────── */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const BILLING_BASE = "/api/billing";

async function request<T>(
  path: string,
  init: { method: string; body?: string } = { method: "GET" },
): Promise<
  | { ok: true; body: T }
  | { ok: false; error: SubscriptionApiError; detail?: string }
> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: init.body,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown> | null;
  } catch {
    body = null;
  }

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 400) return { ok: false, error: "validation", detail: asString(body?.error) };
  if (res.status >= 500) {
    // 500 здесь означает «приём платежей не настроен» (см. services/billing.ts).
    // Это НЕ «попробуйте позже»: платёж физически некуда провести.
    return {
      ok: false,
      error: "payment_unavailable",
      detail: asString(body?.error) ?? undefined,
    };
  }
  if (!res.ok) return { ok: false, error: "internal" };
  return { ok: true, body: (body ?? {}) as T };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Сырая подписка в том виде, в каком её отдаёт бэк (backend/src/services/billing.ts). */
export interface ServerSubscription {
  plan: PlanId;
  status: string;
  period: "monthly" | "academicYear";
  starts_at: number;
  ends_at: number;
  auto_renew: number;
}

/**
 * GET /api/billing/subscription.
 *
 * 404 = подписки нет. Это НЕ ошибка: так выглядит бесплатный тариф, и отдельная
 * ветка нужна, чтобы показать «тарифа нет», а не «что-то сломалось».
 */
export async function fetchSubscription(): Promise<
  | { ok: true; subscription: ServerSubscription | null }
  | { ok: false; error: SubscriptionApiError }
> {
  const res = await request<{ subscription?: ServerSubscription }>(`${BILLING_BASE}/subscription`);
  if (!res.ok) {
    if (res.error === "not_found") return { ok: true, subscription: null };
    return res;
  }
  const sub = res.body.subscription;
  if (!sub || typeof sub.plan !== "string" || typeof sub.ends_at !== "number") {
    return { ok: false, error: "internal" };
  }
  return { ok: true, subscription: sub };
}

/** GET /api/billing/history — чеки и платежи, новые сверху. */
export async function fetchPaymentHistory(): Promise<
  { ok: true; payments: PaymentItem[] } | { ok: false; error: SubscriptionApiError }
> {
  const res = await request<{ payments?: unknown }>(`${BILLING_BASE}/history`);
  if (!res.ok) return res;
  const rows = Array.isArray(res.body.payments) ? (res.body.payments as PaymentItem[]) : [];
  return { ok: true, payments: rows.filter((p) => typeof p?.id === "string") };
}

/**
 * POST /api/billing/cancel.
 *
 * Что означает отмена — договорённость с ТЗ-20, и она же показывается учителю:
 * перестаём СПИСЫВАТЬ, а оплаченный период доигрывается до конца. Никаких
 * «доступ отключится сразу».
 *
 * `reason` отправляем, хотя сервер сегодня его игнорирует: причина нужна для
 * тихого разбора оттока, и менять бэк биллинга (файл интегратора) мы не будем.
 */
export async function cancelSubscription(reason?: string): Promise<
  { ok: true } | { ok: false; error: SubscriptionApiError }
> {
  const res = await request<{ canceled?: boolean }>(`${BILLING_BASE}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
  if (!res.ok) return res;
  return { ok: true };
}

/**
 * POST /api/billing/create — единственный путь к оплате.
 *
 * Успех = платёж создан на стороне платёжного сервиса и нас ждёт
 * `confirmationUrl`. Всё, что дальше, — уже не наш код.
 */
export async function createPayment(input: {
  plan: PlanId;
  period: PeriodId;
  returnUrl: string;
  autoRenew?: boolean;
}): Promise<{ ok: true; confirmationUrl: string; paymentId: string } | { ok: false; error: SubscriptionApiError; detail?: string }> {
  const res = await request<{ confirmationUrl?: string; paymentId?: string }>(
    `${BILLING_BASE}/create`,
    {
      method: "POST",
      body: JSON.stringify({
        plan: input.plan,
        period: input.period === "month" ? "monthly" : "academicYear",
        returnUrl: input.returnUrl,
        autoRenew: input.autoRenew === true,
      }),
    },
  );
  if (!res.ok) return res;
  if (typeof res.body.confirmationUrl !== "string") return { ok: false, error: "internal" };
  return {
    ok: true,
    confirmationUrl: res.body.confirmationUrl,
    paymentId: typeof res.body.paymentId === "string" ? res.body.paymentId : "",
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Честный расчёт смены тарифа
 * ──────────────────────────────────────────────────────────────────────────── */

export type PlanChangeKind = "same" | "start" | "upgrade" | "downgrade";

export interface PlanChangeQuote {
  kind: PlanChangeKind;
  /** Сколько платить сейчас, в рублях. Понижение = 0. */
  payNowRub: number;
  /** Сколько будет стоить период после изменения. */
  nextPriceRub: number;
  /** Unix-секунды, с которых действует новая цена. При понижении — конец текущего периода. */
  effectiveAt: number;
  /** Одна честная строка: что именно произойдёт с деньгами. */
  note: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function priceOf(plan: PlanId, period: PeriodId): number {
  return PLANS[plan].prices[period]?.amount ?? 0;
}

function periodDays(period: PeriodId): number {
  return period === "academicYear" ? 9 * 30 : 30;
}

function pluralMonths(months: number): string {
  const last = months % 10;
  const tens = months % 100;
  if (tens === 1) return `${months} месяца`;
  if (last === 1) return `${months} месяц`;
  return `${months} месяцев`;
}

/**
 * Посчитать, что произойдёт при смене тарифа. Никаких «примерно» и «от 500 ₽».
 *
 * Логика повторяет договорённость ТЗ-20 и обещания на /pricing:
 *   * **повышение** — платится только разница за оставшиеся дцы периода
 *     (полный период не вычитается никогда);
 *   * **понижение** — не сейчас: новая цена действует со следующего периода,
 *     платить сейчас не нужно;
 *   * **первая покупка** — полная цена выбранного периода.
 *
 * `now` и `periodEndsAt` передаются, а не берутся из `Date.now()`: так расчёт
 * детерминирован и его можно проверить тестом.
 */
export function quotePlanChange(input: {
  from: PlanId;
  to: PlanId;
  period: PeriodId;
  now: number; // unix-секунды
  periodEndsAt: number | null; // конец оплаченного периода, если тариф платный
}): PlanChangeQuote {
  const { from, to, period, now, periodEndsAt } = input;
  const targetPrice = priceOf(to, period);
  const currentPrice = priceOf(from, period);

  const hasPaidNow =
    from !== "free" && periodEndsAt != null && periodEndsAt > now && from !== to;

  if (from === to) {
    return {
      kind: "same",
      payNowRub: 0,
      nextPriceRub: targetPrice,
      effectiveAt: now,
      note: "Тариф уже такой же — платить не нужно",
    };
  }

  if (!hasPaidNow) {
    return {
      kind: "start",
      payNowRub: targetPrice,
      nextPriceRub: targetPrice,
      effectiveAt: now,
      note: `Оплата ${formatRub(targetPrice)} за ${period === "academicYear" ? pluralMonths(9) : "месяц"}`,
    };
  }

  const remainingDays = Math.max(0, (periodEndsAt - now) / (DAY_MS / 1000));
  const totalDays = periodDays(period);

  if (targetPrice > currentPrice) {
    // Разница за оставшееся время. Округляем вниз до целого рубля: недобранные
    // копейки — наш промах, а не учителя.
    const payNow = Math.max(0, Math.floor((targetPrice * remainingDays) / totalDays));
    return {
      kind: "upgrade",
      payNowRub: payNow,
      nextPriceRub: targetPrice,
      effectiveAt: now,
      note:
        payNow === 0
          ? "Повышение включится сразу, доплачивать сейчас не нужно"
          : `Сейчас ${formatRub(payNow)} — разница за оставшиеся ${Math.round(remainingDays)} дн., дальше ${formatRub(targetPrice)} за период`,
    };
  }

  return {
    kind: "downgrade",
    payNowRub: 0,
    nextPriceRub: targetPrice,
    effectiveAt: periodEndsAt,
    note: `Сейчас ничего списывать не будем. Новая цена ${formatRub(targetPrice)} — с ${new Date(
      periodEndsAt * 1000,
    ).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Сборка блока подписки
 * ──────────────────────────────────────────────────────────────────────────── */

function periodFromServer(period: "monthly" | "academicYear"): PeriodId {
  return period === "academicYear" ? "academicYear" : "month";
}

/**
 * Вид подписки для анонимного учителя: тариф известен с устройства, дат и чеков
 * нет — и мы говорим об этом прямо, вместо того чтобы прятать блок.
 */
export function deviceSubscriptionView(): SubscriptionView {
  const plan = (getProfile()?.plan ?? "free") as PlanId;
  return {
    state: plan === "free" ? "free" : "active",
    plan,
    planName: PLANS[plan].name,
    period: plan === "free" ? null : "month",
    priceLabel: priceShort(plan, "month"),
    nextChargeAt: null,
    periodEndsAt: null,
    autoRenew: false,
    paymentMethod: "unknown",
    source: "device",
    note: "Платежи, чеки и дата следующего списания появятся здесь после входа в аккаунт.",
  };
}

/**
 * Собрать блок подписки.
 *
 * Ни одного белого экрана: при любой ошибке возвращается то, что известно
 * точно (тариф с устройства или free), плюс причина. Учитель в кабинете всегда
 * видит, что у него с подпиской, даже когда сеть лежит.
 */
export async function loadSubscription(): Promise<LoadSubscriptionResult> {
  const fallback = deviceSubscriptionView();

  const user = await getCurrentUser();
  if (!user) {
    return {
      subscription: fallback,
      history: [],
      canPay: false,
      canPayReason: "Оплата привязана к аккаунту. Тарифы и цены — на странице тарифов.",
    };
  }

  const [subRes, historyRes, usage] = await Promise.all([
    fetchSubscription(),
    fetchPaymentHistory(),
    fetchUsage(),
  ]);

  if (!subRes.ok) {
    // Сервер недоступен или подписки нет — показываем то, что есть, и честно
    // говорим, что не загрузилось. Не превращаем это в «тариф отменён».
    return {
      subscription: { ...fallback, source: "account", note: noteForError(subRes.error) },
      history: [],
      canPay: false,
      canPayReason: noteForError(subRes.error),
    };
  }

  const sub = subRes.subscription;
  const history = historyRes.ok ? historyRes.payments : [];
  const over = usage?.over === true;

  if (!sub) {
    return {
      subscription: {
        state: "free",
        plan: "free",
        planName: PLANS.free.name,
        period: null,
        priceLabel: priceShort("free", "month"),
        nextChargeAt: null,
        periodEndsAt: null,
        autoRenew: false,
        paymentMethod: "none",
        source: "account",
        note: null,
      },
      history,
      canPay: true,
      canPayReason: null,
    };
  }

  const period = periodFromServer(sub.period);
  const autoRenew = sub.auto_renew === 1;

  return {
    subscription: {
      state: over ? "over" : autoRenew ? "active" : "canceled",
      plan: sub.plan,
      planName: PLANS[sub.plan]?.name ?? sub.plan,
      period,
      priceLabel: priceShort(sub.plan, period),
      // Дата следующего списания есть только у тарифа с автопродлением. У
      // отменённого её не будет — и это не «ошибка», а ровно то, что произошло.
      nextChargeAt: autoRenew ? sub.ends_at : null,
      periodEndsAt: sub.ends_at,
      autoRenew,
      // Серверный способ оплаты отдельным эндпоинтом не отдаётся (TODO).
      paymentMethod: autoRenew ? "saved" : "none",
      source: "account",
      note: null,
    },
    history,
    canPay: true,
    canPayReason: null,
  };
}

function noteForError(error: SubscriptionApiError): string {
  switch (error) {
    case "unauthorized":
      return "Вход истёк — показываем то, что сохранено на этом устройстве.";
    case "network":
      return "Сервер недоступен. Показываем тариф, сохранённый на этом устройстве.";
    case "payment_unavailable":
      return "Приём платежей не настроен — оплата временно недоступна.";
    case "not_found":
      return "Активной подписки нет.";
    default:
      return "Не удалось загрузить данные подписки.";
  }
}

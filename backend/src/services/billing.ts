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
import { InternalError, BadRequestError } from "../lib/errors";

// ─────────────────────────────────────────────────────────────────────────────
// Прайсинг (в копейках)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Тарифы, за которые можно заплатить.
 *
 * `school` добавлен вместе с ценой (3 000 ₽/мес за класс), хотя продажа
 * ещё не открыта — `comingSoon: "Q1 2027"` во фронте. Тип опережает кнопку,
 * чтобы при включении тарифа не пришлось трогать ни бэк, ни миграции.
 * `createPayment` отдаёт 400, пока school не разрешён (см. `SELLABLE_PLANS`).
 */
export type PaidPlan = "base" | "plus" | "school";

/** Тарифы, по которым платёж создаётся прямо сейчас. */
export const SELLABLE_PLANS: ReadonlySet<PaidPlan> = new Set<PaidPlan>(["base", "plus"]);
/**
 * Период оплаты.
 *
 * `academicYear` — НЕ календарный год. Это 9 месяцев подряд от даты оплаты:
 * оплатив 15 октября, учитель получает доступ до 15 июля. Так же считает
 * фронт (`ACADEMIC_YEAR_MONTHS = 9` в `src/lib/content/plans.ts`), и это же
 * решение владельца продукта: «учебный год как по РФ-календарю у учителей»,
 * летом платить не нужно.
 *
 * Раньше здесь был `yearly` = 365 дней и цены 5 880/11 880 ₽ — фронт при этом
 * показывал 3 800/11 000 ₽ за 9 месяцев. Расхождение в 55% и 8% уходило бы
 * в счёт плательщика при первом же реальном платеже.
 */
export type Period = "monthly" | "academicYear";

/** Длительность учебного года в месяцах. Держим в паре с фронтовой константой. */
export const ACADEMIC_YEAR_MONTHS = 9;

/**
 * Канон тарифов — единый источник правды для backend (создание платежа, валидация).
 *
 * ЧИСЛА ВЗЯТЫ ИЗ ФРОНТА И НЕ МЕНЯЮТСЯ: src/lib/content/plans.ts →
 * base 500 ₽/мес · 3 800 ₽ за учебный год, plus 1 500 ₽/мес · 11 000 ₽ за год,
 * school 3 000 ₽/мес за класс (тариф запускается в Q1 2027, цену уже зафиксировали).
 *
 * Бэк — отдельный npm-проект и не видит файлы фронта, поэтому импортировать
 * plans.ts здесь нельзя. Расхождение закрыто тестом
 * tests/integration/plans-price-sources.test.ts (в КОРНЕ репозитория): он
 * читает plans.ts и этот файл с диска и сравнивает суммы.
 * Важно: бэкенд этот тест не запускает — у него свой vitest
 * (`backend/vitest.config.ts`, include = `tests/**` относительно backend/).
 * Тест гоняет ФРОНТОВЫЙ прогон, см. ci.yml → job frontend.
 */
export const PRICES = {
  base: { monthly: 500_00, academicYear: 3_800_00 },
  plus: { monthly: 1_500_00, academicYear: 11_000_00 },
  school: { monthly: 3_000_00, academicYear: null },
} as const;

export function getPriceKopecks(plan: PaidPlan, period: Period): number {
  const price = PRICES[plan][period];
  if (price == null) {
    throw new InternalError(`Тариф ${plan} не продаётся на период ${period}`);
  }
  return price;
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

/**
 * Сколько секунд прибавить к starts_at для расчёта ends_at.
 *
 * Помесячно — календарный месяц (30 дней): точность до суток тут ни на что
 * не влияет. Учебный год — 9 средних месяцев (30,44 дня) = 274 дня, и это
 * обязано быть 9 МЕСЯЦЕВ, а не 365 дней. При 365 днях учитель, оплативший
 * 3 800 ₽ «за учебный год», получал доступ на 12 месяцев, включая все
 * каникулы, — то есть платил за треть лишнего года.
 */
function periodDurationSeconds(period: Period): number {
  return period === "academicYear"
    ? Math.round(ACADEMIC_YEAR_MONTHS * 30.44) * 86400
    : 30 * 86400;
}

/**
 * Первый origin из FRONTEND_URL.
 *
 * В проде FRONTEND_URL — список через запятую (чтобы CORS принимал и
 * listai-prototype.pages.dev, и uchlist.ru). Вставлять этот список
 * целиком в ссылку нельзя: получится нерабочий URL вида
 * «https://a.ru,https://b.ru/auth/callback?token=…». Поэтому для ссылок,
 * которые видит человек, используется отдельная переменная APP_PUBLIC_URL,
 * а этот helper — только как запасной вариант для старых конфигураций.
 */
function firstFrontendOrigin(env: Env): string {
  return (env.FRONTEND_URL ?? "").split(",")[0]?.trim().replace(/\/+$/, "") ?? "";
}

/**
 * Совпадает ли сумма из уведомления с канонической ценой тарифа.
 *
 * ЮKassa присылает сумму строкой («500.00») — переводим в копейки и сравниваем
 * с прайсом. Валюта обязана быть RUB: платёж в другой валюте — это не наш прайс.
 */
function amountMatches(
  amount: { value: string; currency: string } | undefined,
  expectedKopecks: number,
): boolean {
  if (!amount) return false;
  if (amount.currency !== "RUB") return false;
  const got = Math.round(Number(amount.value) * 100);
  return Number.isFinite(got) && got === expectedKopecks;
}

/**
 * Живая сверка статуса платежа в API ЮKassa.
 *
 * Три состояния, а не два, — это осознанно:
 *   * "succeeded" — подтверждено, можно активировать подписку;
 *   * "denied"    — API ответил, но оплату не подтверждает → отказ;
 *   * "unknown"   — сеть/5xx/невалидный ответ. Отказать нельзя: это отправит
 *                   ЮKassa в ретраи и может сорвать реальную оплату. Возвращаем
 *                   "unknown" и поднимаем alert — безопасность обеспечивают
 *                   проверки по нашей БД и по сумме, которые к этому моменту
 *                   уже пройдены.
 */
async function fetchPaymentStatus(
  ykId: string,
  env: Env,
): Promise<"succeeded" | "denied" | "unknown"> {
  try {
    const response = await fetch(`${YOOKASSA_API}/${encodeURIComponent(ykId)}`, {
      headers: {
        Authorization: basicAuthHeader(env.YOOKASSA_SHOP_ID!, env.YOOKASSA_SECRET_KEY!),
      },
    });
    if (!response.ok) return "unknown";
    const data = (await response.json()) as { status?: string; paid?: boolean };
    return data.status === "succeeded" && data.paid !== false ? "succeeded" : "denied";
  } catch {
    return "unknown";
  }
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
  // Тариф «Школа» имеет цену, но ещё не продаётся (Q1 2027). Ловим здесь,
  // чтобы фронтовая кнопка не смогла создать платёж по нераскрытой цене.
  if (!SELLABLE_PLANS.has(plan)) {
    throw new BadRequestError(`Тариф «${plan}» пока недоступен для оплаты`, {
      plan,
      sellable: [...SELLABLE_PLANS],
    });
  }
  const amountKopecks = getPriceKopecks(plan, period);
  const amountFormatted = (amountKopecks / 100).toFixed(2);
  const description = `УчЛист · ${plan} · ${period === "academicYear" ? "учебный год" : "месяц"}`;
  const paymentId = generatePaymentId();
  const now = Math.floor(Date.now() / 1000);

  const shopId = env.YOOKASSA_SHOP_ID;
  const secretKey = env.YOOKASSA_SECRET_KEY;
  const isDevMode = !shopId || !secretKey;

  // ── Почему «просто включить демо-оплату» в проде нельзя ───────────────────
  // В dev-режиме yookassa_payment_id равен нашему paymentId, а этот id
  // возвращается клиенту. Значит, клиент знает идентификатор платежа, который
  // мы ему сами выдали, и может дослать поддельное `payment.succeeded`.
  // Обработчик вебхука не может этому помешать: он проверяет каноническую
  // запись в нашей БД — и она настоящая, потому что её создал он сам.
  // Настоящей проверки не будет: сверять с API ЮKassa нечем, ключей нет.
  // Итог: без ключей в проде подписку можно получить бесплатно.
  //
  // Поэтому симулятор — привилегированный режим, и включается он ТОЛЬКО
  // положительным флагом ALLOW_DEMO_PAYMENTS=true. Раньше условием был
  // APP_ENV, и 2 октября выяснилось, что боевой воркер задеплоен с
  // APP_ENV=development: такая проверка выключилась бы молча, вместе с защитой.
  const demoPaymentsAllowed = env.ALLOW_DEMO_PAYMENTS === "true";

  if (isDevMode && !demoPaymentsAllowed) {
    // eslint-disable-next-line no-console
    console.error(
      "[billing] Отказ: приём платежей не настроен (нет YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY), " +
        "а ALLOW_DEMO_PAYMENTS не включён. Демо-оплата по умолчанию выключена везде, включая прод: " +
        "без сверки с API ЮKassa подтвердить платёж нечем, и подписку можно было бы активировать " +
        "подделкой вебхука. Задайте ключи: npx wrangler secret put YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY",
    );
    throw new InternalError("Приём платежей не настроен");
  }

  if (isDevMode) {
    const confirmationUrl = `${env.APP_PUBLIC_URL ?? firstFrontendOrigin(env)}/pricing?demo_payment=${paymentId}`;
    await db
      .prepare(
        `INSERT INTO payments
           (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, confirmation_url, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8)`,
      )
      .bind(paymentId, userId, plan, period, amountKopecks, paymentId, confirmationUrl, now)
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
         (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, confirmation_url, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(paymentId, userId, plan, period, amountKopecks, yk.id, yk.status, yk.confirmation.confirmation_url, now)
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
 * ── Безопасность ────────────────────────────────────────────────────────────
 * Раньше обработчик доверял телу запроса: `body.object.metadata.plan` имел
 * приоритет над нашей базой, а подлинность отправителя никак не проверялась.
 * Итог: любой, кто знает идентификатор платежа, мог отправить поддельное
 * `payment.succeeded` с `metadata.plan = "plus"` и получить подписку бесплатно.
 *
 * Теперь правила жёсткие:
 *   1. План и период берутся ТОЛЬКО из нашей строки `payments`. Поля из тела
 *      запроса игнорируются полностью.
 *   2. Сумма из уведомления сверяется с канонической ценой из PRICES.
 *      Не совпала — подписка не активируется.
 *   3. Повторное уведомление по уже обработанному платежу игнорируется.
 *      Это закрывает replay: «заплатил раз, отменил, отправил уведомление заново».
 *   4. Если заданы ключи ЮKassa — дополнительно сверяем статус платежа живым
 *      запросом в API. Это defense in depth: главную защиту дают пункты 1-3,
 *      поэтому при недоступности сети мы не теряем оплату, а логируем alert.
 *
 * ЮKassa не подписывает уведомления, поэтому «подлинность» здесь = совпадение
 * с нашей канонической записью + сверка в API. IP-allowlist в личном кабинете
 * ЮKassa остаётся полезным дополнительным слоем.
 */
export async function handleWebhook(
  db: D1Database,
  env: Env,
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
    // ── Шаг 1. Наша каноническая запись о платеже ────────────────────────────
    // Читаем ДО любых записей. Если платежа у нас нет — значит уведомление
    // либо поддельное, либо про оплату, созданную не в этом приложении.
    const payment = await db
      .prepare(`SELECT user_id, plan, period, amount_rub, status FROM payments WHERE yookassa_payment_id = ?1`)
      .bind(ykId)
      .first<{
        user_id: string | null;
        plan: PaidPlan;
        period: Period | null;
        amount_rub: number;
        status: string;
      }>();

    if (!payment || !payment.user_id) {
      // eslint-disable-next-line no-console
      console.error(
        `[billing] REJECTED: уведомление о платеже без записи в БД yk_id=${ykId}. ` +
          `Похоже на подделку либо на оплату вне нашего приложения. Подписка НЕ активирована.`,
      );
      return { handled: false };
    }

    // ── Шаг 2. Идемпотентность (защита от replay) ────────────────────────────
    if (payment.status === "succeeded" || payment.status === "refunded") {
      // eslint-disable-next-line no-console
      console.info(`[billing] webhook: платёж ${ykId} уже в статусе ${payment.status} — повтор пропущен`);
      return { handled: true };
    }

    // ── Шаг 3. Сверка суммы с каноническим прайсом ───────────────────────────
    const plan: PaidPlan = payment.plan;
    const period: Period = payment.period ?? "monthly";
    const expectedKopecks = getPriceKopecks(plan, period);

    if (payment.amount_rub !== expectedKopecks) {
      // eslint-disable-next-line no-console
      console.error(
        `[billing] REJECTED: у суммы платежа и прайса расхождение yk_id=${ykId} ` +
          `(в БД ${payment.amount_rub} коп, прайс ${expectedKopecks} коп)`,
      );
      return { handled: false };
    }

    if (!amountMatches(body.object.amount, expectedKopecks)) {
      // eslint-disable-next-line no-console
      console.error(
        `[billing] REJECTED: сумма в уведомлении не совпадает с ценой тарифа ` +
          `yk_id=${ykId} got=${JSON.stringify(body.object.amount ?? null)} expected=${expectedKopecks}`,
      );
      return { handled: false };
    }

    // ── Шаг 4. Живая сверка в API ЮKassa (defense in depth) ──────────────────
    if (env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY) {
      const live = await fetchPaymentStatus(ykId, env);
      if (live === "denied") {
        // API ответил и сказал, что платёж не succeeded.
        // eslint-disable-next-line no-console
        console.error(`[billing] REJECTED: API ЮKassa не подтвердило оплату yk_id=${ykId}`);
        return { handled: false };
      }
      if (live === "unknown") {
        // Сеть/5xx — не отказываем в оплате (пункты 1-3 уже отработали),
        // но поднимаем alert: возможно, ключи протухли.
        // eslint-disable-next-line no-console
        console.error(
          `[billing] ALERT: не удалось сверить платёж с API ЮKassa yk_id=${ykId}. ` +
            `Активация прошла по данным БД и сумме из уведомления. Проверьте ключи и доступность API.`,
        );
      }
    }

    // ── Шаг 5. Всё сошлось — фиксируем оплату и активируем подписку ──────────
    await db
      .prepare(`UPDATE payments SET status = 'succeeded', completed_at = ?1 WHERE yookassa_payment_id = ?2`)
      .bind(now, ykId)
      .run();

    const userId = payment.user_id;
    const endsAt = now + periodDurationSeconds(period);

    // Отменить предыдущие активные подписки этого юзера (новая подписка перебивает)
    await db
      .prepare(
        `UPDATE subscriptions SET status = 'canceled', updated_at = ?1
         WHERE user_id = ?2 AND status = 'active'`,
      )
      .bind(now, userId)
      .run();

    // Создать новую активную подписку
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
    //
    // users.plan пока хранит только free/base/plus. `school` сюда попасть не
    // может: createPayment отклоняет его через SELLABLE_PLANS. Проверка
    // продублирована здесь, потому что строка приходит из метаданных
    // webhook'а, а не из нашего кода — то есть извне.
    if (plan === "school") {
      throw new InternalError(
        "Webhook: тариф «school» не продаётся, но пришёл успешный платёж по нему — разберись вручную",
        { userId, plan, yookassaPaymentId: ykId },
      );
    }
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

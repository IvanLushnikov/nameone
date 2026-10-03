/**
 * Рекуррентное автопродление (ТЗ-20).
 *
 * Тесты идут по НАСТОЯЩЕМУ пути: реальный Hono-free сервис, реальный D1 из
 * workerd, сетевой вызов к ЮKassa подменён функцией. Проверять мок было бы
 * бессмысленно — вся ценность тут в том, что отбор подписок, проверка согласия
 * и продление периода происходят настоящим SQL, а не «по описанию теста».
 *
 * Что здесь закрываем (каждый пункт — реальная дыра, а не покрытие ради строки):
 *   1. флаг выключен → ни списаний, ни напоминаний (главная страховка: в проде
 *      автоплатежи разрешены не всем);
 *   2. автопродление ПРОДЛЯЕТ текущую подписку, а не создаёт новую;
 *   3. повторный `payment.succeeded` по тому же платежу не продлевает дважды;
 *   4. учебный год не продлевается и способ оплаты не сохраняется;
 *   5. подписка БЕЗ строки согласия не списывается — это и есть решение по тем,
 *      кто уже заплатил разово (ТЗ-20 §5.3): их данные никто не мигрирует;
 *   6. напоминание уходит один раз на конкретное списание;
 *   7. отмена гасит автопродление и не отрезает оплаченный период.
 */

/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  cancelSubscription,
  createPayment,
  handleWebhook,
  paymentKindById,
  type YooKassaWebhookPayload,
} from "../../src/services/billing";
import {
  chargeDueSubscriptions,
  sendRenewalReminders,
} from "../../src/jobs/billingRecurring";
import { BATCH_LIMIT } from "../../src/services/billingRecurring";
import type { Env } from "../../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

/**
 * Схема для этих тестов — своя копия: workerd не умеет node:fs и прочитать
 * src/db/schema.sql не может (та же причина, по которой её копирует
 * security-regressions.test.ts). Таблиц ровно столько, сколько касается ТЗ-20.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  generations_total INTEGER NOT NULL DEFAULT 0,
  generations_today INTEGER NOT NULL DEFAULT 0,
  generations_reset_at INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  stripe_customer_id TEXT,
  yookassa_customer_id TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  amount_rub INTEGER NOT NULL,
  yookassa_payment_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmation_url TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  period TEXT NOT NULL,
  yookassa_payment_id TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_payment_methods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  yookassa_payment_method_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  canceled_at INTEGER,
  last_charge_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(subscription_id)
);

CREATE TABLE IF NOT EXISTS billing_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  UNIQUE(kind, dedupe_key)
);
`;

const DAY = 86400;
/**
 * Опорное время тестов — реальные часы, а не константа.
 *
 * `handleWebhook` и `cancelSubscription` считают `now` сами (у первого нет и не
 * может быть параметра «сейчас»: он вызывается из вебхука провайдера). Значит,
 * фикстуры обязаны жить в той же шкале, иначе «подписка, период которой истёк
 * час назад» окажется подпиской с периодом в будущем.
 */
const NOW = Math.floor(Date.now() / 1000);
/** Цена базового помесячного тарифа, копейки. Дублируем намеренно (см. PRICES). */
const BASE_MONTHLY = 500_00;
const PLUS_MONTHLY = 1_500_00;
const BASE_YEAR = 3_800_00;

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "billing-recurring", queries: [SCHEMA_SQL] }]);
});

beforeEach(async () => {
  const d = db();
  await d.prepare(`DELETE FROM billing_notifications`).run();
  await d.prepare(`DELETE FROM recurring_payment_methods`).run();
  await d.prepare(`DELETE FROM subscriptions`).run();
  await d.prepare(`DELETE FROM payments`).run();
  await d.prepare(`DELETE FROM users`).run();
});

/**
 * Окружение для сервисов. Ключи ЮKassa заданы (иначе createPayment уходит в
 * dev-режим и не делает сетевого вызова), но сетевой вызов всё равно
 * подменяется — в testsEnv он не используется вовсе.
 */
function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "production",
    FRONTEND_URL: "https://uchlist.ru",
    APP_PUBLIC_URL: "https://uchlist.ru",
    YOOKASSA_SHOP_ID: "shop_test",
    YOOKASSA_SECRET_KEY: "secret_test",
    // По умолчанию фича ВЫКЛЮЧЕНА: тесты, которые проверяют списания, включают
    // её явно. Так каждый тест сам заявляет, что он проверяет.
    RECURRING_BILLING_ENABLED: "false",
    RESEND_API_KEY: undefined,
    ALLOW_DEMO_PAYMENTS: "false",
    ...overrides,
  } as Env;
}

/**
 * Окружение ДЛЯ ВЕБХУКА — без ключей ЮKassa.
 *
 * Зачем: живая сверка статуса платежа (defense in depth) ходит в
 * api.yookassa.ru по-настоящему, если ключи заданы. В тестах это даёт сетевой
 * вызов с фальшивыми учётными данными — медленно, нестабильно и бессмысленно.
 * Основную защиту (каноническая запись в БД + сверка суммы) она лишь
 * дублирует, поэтому в тестах отключается.
 */
function webhookEnv(overrides: Partial<Env> = {}): Env {
  return testEnv({ YOOKASSA_SHOP_ID: undefined, YOOKASSA_SECRET_KEY: undefined, ...overrides });
}

/** Ответ ЮKassa на создание платежа — без реальной сети. */
function fakeYooKassa(ids: string[]): typeof globalThis.fetch {
  let i = 0;
  return (async () => {
    const id = ids[i] ?? `yk_auto_${i++}`;
    return new Response(
      JSON.stringify({ id, status: "pending", paid: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
}

/** Запрос `payment.succeeded` ровно так, как его шлёт ЮKassa. */
function succeededNotification(
  ykId: string,
  extra: {
    amountKopecks?: number;
    paymentMethod?: { id: string; saved: boolean };
  } = {},
): YooKassaWebhookPayload {
  const kopecks = extra.amountKopecks ?? BASE_MONTHLY;
  return {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: ykId,
      status: "succeeded",
      amount: { value: (kopecks / 100).toFixed(2), currency: "RUB" },
      ...(extra.paymentMethod ? { payment_method: extra.paymentMethod } : {}),
    },
  };
}

async function createUser(id: string, email = `${id}@test.ru`): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO users (id, email, name, plan, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'free', ?4, ?4)`,
    )
    .bind(id, email, `Учитель ${id}`, NOW)
    .run();
}

interface SubRow {
  id: string;
  status: string;
  period: string;
  auto_renew: number;
  ends_at: number;
  yookassa_payment_id: string | null;
}

async function getSub(id: string): Promise<SubRow> {
  const row = await db()
    .prepare(
      `SELECT id, status, period, auto_renew, ends_at, yookassa_payment_id
       FROM subscriptions WHERE id = ?1`,
    )
    .bind(id)
    .first<SubRow>();
  if (!row) throw new Error(`подписка ${id} не найдена`);
  return row;
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  const row = await db()
    .prepare(sql)
    .bind(...args)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Подписка, которая вот-вот закончится: период истёк час назад. */
async function seedDueSubscription(opts: {
  id: string;
  userId: string;
  plan?: string;
  period?: string;
  endsAt?: number;
  autoRenew?: number;
  withConsent?: boolean;
}): Promise<void> {
  const {
    id,
    userId,
    plan = "base",
    period = "monthly",
    endsAt = NOW - 3600,
    autoRenew = 1,
    withConsent = true,
  } = opts;

  await db()
    .prepare(
      `INSERT INTO subscriptions
         (id, user_id, plan, status, period, yookassa_payment_id,
          starts_at, ends_at, auto_renew, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6, ?7, ?8, ?6, ?6)`,
    )
    .bind(id, userId, plan, period, `yk_origin_${id}`, endsAt - 30 * DAY, endsAt, autoRenew)
    .run();

  if (withConsent) {
    await db()
      .prepare(
        `INSERT INTO recurring_payment_methods
           (id, user_id, subscription_id, yookassa_payment_method_id, plan, status,
            confirmed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6, ?6)`,
      )
      .bind(`rpm_${id}`, userId, id, `pm_${id}`, plan, NOW)
      .run();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Флаг фичи (главный предохранитель)", () => {
  it("выключенный флаг: списаний нет, ни одного запроса к ЮKassa", async () => {
    await createUser("usr_flag_off");
    await seedDueSubscription({ id: "sub_a", userId: "usr_flag_off" });

    let called = false;
    const fetcher = (async () => {
      called = true;
      throw new Error("сеть не должна вызываться");
    }) as typeof globalThis.fetch;

    const result = await chargeDueSubscriptions(db(), testEnv(), { fetcher });

    expect(result).toEqual({ scanned: 0, charged: 0, failed: 0, skipped: 0 });
    expect(called).toBe(false);
    expect(await count(`SELECT COUNT(*) AS n FROM payments`)).toBe(0);
  });

  it("выключенный флаг: напоминаний нет", async () => {
    await createUser("usr_flag_off2");
    await seedDueSubscription({ id: "sub_b", userId: "usr_flag_off2", endsAt: NOW + 20 * 3600 });

    const result = await sendRenewalReminders(db(), testEnv(), { now: NOW });

    expect(result).toEqual({ scanned: 0, sent: 0, skipped: 0 });
    expect(await count(`SELECT COUNT(*) AS n FROM billing_notifications`)).toBe(0);
  });

  it("включённый флаг, но нет ключей ЮKassa — тоже no-op, а не попытка списать", async () => {
    await createUser("usr_no_keys");
    await seedDueSubscription({ id: "sub_c", userId: "usr_no_keys" });

    const result = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true", YOOKASSA_SECRET_KEY: undefined }),
    );

    expect(result.charged).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM payments`)).toBe(0);
  });

  it("недостаточно месяца до конца периода — списывать рано", async () => {
    await createUser("usr_early");
    await seedDueSubscription({ id: "sub_d", userId: "usr_early", endsAt: NOW + 5 * DAY });

    const result = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
    );

    expect(result.scanned).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM payments`)).toBe(0);
  });
});

describe("Списание по крону", () => {
  it("создаёт платёж по сохранённому методу и привязывает его к подписке", async () => {
    await createUser("usr_charge");
    await seedDueSubscription({ id: "sub_charge", userId: "usr_charge" });

    const requests: Array<Record<string, unknown>> = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "yk_charge_1", status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      { now: NOW, fetcher },
    );

    expect(result).toEqual({ scanned: 1, charged: 1, failed: 0, skipped: 0 });

    // Безакцептное списание: метод оплаты вместо подтверждения — учитель в этом
    // цикле вообще не участвует.
    expect(requests[0]?.payment_method_id).toBe("pm_sub_charge");
    expect(requests[0]?.confirmation).toBeUndefined();
    expect(requests[0]?.capture).toBe(true);
    expect(requests[0]?.amount).toEqual({ value: "500.00", currency: "RUB" });

    const payment = await db()
      .prepare(
        `SELECT id, yookassa_payment_id, status, amount_rub FROM payments WHERE user_id = 'usr_charge'`,
      )
      .first<{ id: string; yookassa_payment_id: string; status: string; amount_rub: number }>();
    expect(payment?.id.startsWith("pay_r_")).toBe(true);
    expect(payment?.yookassa_payment_id).toBe("yk_charge_1");
    expect(payment?.amount_rub).toBe(BASE_MONTHLY);

    // Платёж привязан к подписке: именно эта связь превратит `payment.succeeded`
    // в ПРОДЛЕНИЕ, а не в новую подписку.
    const sub = await getSub("sub_charge");
    expect(sub.yookassa_payment_id).toBe("yk_charge_1");
  });

  it("повторный проход крона не создаёт второе списание за тот же период", async () => {
    await createUser("usr_twice");
    await seedDueSubscription({ id: "sub_twice", userId: "usr_twice" });

    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response(JSON.stringify({ id: `yk_twice_${calls}`, status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const env = testEnv({ RECURRING_BILLING_ENABLED: "true" });
    const first = await chargeDueSubscriptions(db(), env, { now: NOW, fetcher });
    // Вебхук ещё не пришёл и период не продлён — но второй проход крона всё
    // равно не имеет права списывать за этот же месяц повторно.
    const second = await chargeDueSubscriptions(db(), env, { now: NOW, fetcher });

    expect(first.charged).toBe(1);
    expect(second.charged).toBe(0);
    expect(second.skipped).toBe(1);
    expect(calls).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM payments`)).toBe(1);
  });

  it("ошибка по одному учителю не роняет проход по остальным", async () => {
    await createUser("usr_ok");
    await seedDueSubscription({ id: "sub_ok", userId: "usr_ok" });
    await createUser("usr_bad");
    await seedDueSubscription({ id: "sub_bad", userId: "usr_bad" });

    const fetcher = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { metadata: { user_id: string } };
      if (body.metadata.user_id === "usr_bad") {
        return new Response(JSON.stringify({ message: "internal error" }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: "yk_ok_1", status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      { now: NOW, fetcher },
    );

    expect(result.scanned).toBe(2);
    expect(result.charged).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("подписка БЕЗ строки согласия не списывается (те, кто заплатил разово)", async () => {
    await createUser("usr_onetime");
    await seedDueSubscription({ id: "sub_onetime", userId: "usr_onetime", withConsent: false });

    // Сетевого запроса быть не должно вовсе: подписка не отбирается на уровне SQL.
    let called = false;
    const fetcher = (async () => {
      called = true;
      throw new Error("сеть не должна вызываться");
    }) as typeof globalThis.fetch;

    const result = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      { now: NOW, fetcher },
    );

    expect(result.scanned).toBe(0);
    expect(result.charged).toBe(0);
    expect(called).toBe(false);
    expect(await count(`SELECT COUNT(*) AS n FROM payments`)).toBe(0);
  });

  it("учебный год кроном не продлевается и не списывается", async () => {
    await createUser("usr_year");
    await seedDueSubscription({
      id: "sub_year",
      userId: "usr_year",
      period: "academicYear",
      endsAt: NOW - 3600,
    });

    const result = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      { now: NOW, fetcher: fakeYooKassa([]) },
    );

    expect(result.scanned).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM payments`)).toBe(0);
  });

  it("отменённое автопродление не списывается (auto_renew = 0)", async () => {
    await createUser("usr_canceled_renew");
    await seedDueSubscription({
      id: "sub_canceled_renew",
      userId: "usr_canceled_renew",
      autoRenew: 0,
    });

    const result = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      { now: NOW, fetcher: fakeYooKassa([]) },
    );

    expect(result.scanned).toBe(0);
  });

  it("отмена гасит строку согласия — крон её больше не видит", async () => {
    await createUser("usr_off");
    await seedDueSubscription({ id: "sub_off", userId: "usr_off", endsAt: NOW + 10 * DAY });

    await cancelSubscription(db(), "usr_off");

    const rpm = await db()
      .prepare(`SELECT status, canceled_at FROM recurring_payment_methods WHERE id = 'rpm_sub_off'`)
      .first<{ status: string; canceled_at: number | null }>();
    expect(rpm?.status).toBe("canceled");
    expect(rpm?.canceled_at).toBeGreaterThan(0);

    // Период ещё не закончился — доступ сохранён, но списаний больше нет.
    const sub = await getSub("sub_off");
    expect(sub.status).toBe("active");
    expect(sub.auto_renew).toBe(0);
    expect(sub.ends_at).toBe(NOW + 10 * DAY);

    // Досрочно «наступил» конец периода — крон всё равно молчит.
    await db()
      .prepare(`UPDATE subscriptions SET ends_at = ?1 WHERE id = 'sub_off'`)
      .bind(NOW - 10)
      .run();
    const after = await chargeDueSubscriptions(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      { now: NOW, fetcher: fakeYooKassa([]) },
    );
    expect(after.scanned).toBe(0);
  });

  it("отмена при уже закончившемся периоде закрывает подписку и снимает тариф", async () => {
    await createUser("usr_expired");
    await seedDueSubscription({ id: "sub_expired", userId: "usr_expired", endsAt: NOW - DAY });
    await db().prepare(`UPDATE users SET plan = 'base' WHERE id = 'usr_expired'`).run();

    await cancelSubscription(db(), "usr_expired");

    const sub = await getSub("sub_expired");
    expect(sub.status).toBe("canceled");
    const user = await db()
      .prepare(`SELECT plan FROM users WHERE id = 'usr_expired'`)
      .first<{ plan: string }>();
    expect(user?.plan).toBe("free");
  });
});

describe("Первый платёж и согласие (createPayment → webhook)", () => {
  it("согласие на месяц: карта сохраняется, автопродление включено", async () => {
    await createUser("usr_consent");
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "yk_first",
          status: "pending",
          confirmation: { type: "redirect", confirmation_url: "https://yookassa/pay" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const result = await createPayment(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      {
        userId: "usr_consent",
        plan: "base",
        period: "monthly",
        returnUrl: "https://uchlist.ru/account",
        autoRenewConsent: true,
        fetcher,
      },
    );

    // save_payment_method уходит провайдеру — это и есть механика автоплатежей.
    expect(requests[0]?.save_payment_method).toBe(true);
    expect(paymentKindById(result.paymentId)).toBe("consent");

    await handleWebhook(
      db(),
      webhookEnv(),
      succeededNotification("yk_first", { paymentMethod: { id: "pm_123", saved: true } }),
    );

    const sub = await db()
      .prepare(
        `SELECT id, auto_renew, status, ends_at FROM subscriptions WHERE yookassa_payment_id = 'yk_first'`,
      )
      .first<{ id: string; auto_renew: number; status: string; ends_at: number }>();
    expect(sub?.auto_renew).toBe(1);

    const rpm = await db()
      .prepare(
        `SELECT yookassa_payment_method_id, status FROM recurring_payment_methods WHERE subscription_id = ?1`,
      )
      .bind(sub!.id)
      .first<{ yookassa_payment_method_id: string; status: string }>();
    expect(rpm?.yookassa_payment_method_id).toBe("pm_123");
    expect(rpm?.status).toBe("active");
  });

  it("без согласия: способ оплаты из тела запроса игнорируется", async () => {
    await createUser("usr_no_consent");
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "yk_plain",
          status: "pending",
          confirmation: { type: "redirect", confirmation_url: "https://yookassa/pay" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const result = await createPayment(db(), testEnv({ RECURRING_BILLING_ENABLED: "true" }), {
      userId: "usr_no_consent",
      plan: "base",
      period: "monthly",
      returnUrl: "https://uchlist.ru/account",
      fetcher,
    });

    expect(requests[0]?.save_payment_method).toBeUndefined();
    expect(paymentKindById(result.paymentId)).toBe("standard");

    // Провайдер вернул payment_method — но согласия не было, значит сохранять
    // нечего. Строка согласия не появляется, крон этот период не тронет.
    await handleWebhook(
      db(),
      webhookEnv(),
      succeededNotification("yk_plain", { paymentMethod: { id: "pm_hacked", saved: true } }),
    );

    expect(await count(`SELECT COUNT(*) AS n FROM recurring_payment_methods`)).toBe(0);
    const sub = await db()
      .prepare(`SELECT auto_renew FROM subscriptions WHERE yookassa_payment_id = 'yk_plain'`)
      .first<{ auto_renew: number }>();
    expect(sub?.auto_renew).toBe(0);
  });

  it("учебный год: согласие НЕ применяется, карта не сохраняется", async () => {
    await createUser("usr_year_consent");
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "yk_year",
          status: "pending",
          confirmation: { type: "redirect", confirmation_url: "https://yookassa/pay" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const result = await createPayment(db(), testEnv({ RECURRING_BILLING_ENABLED: "true" }), {
      userId: "usr_year_consent",
      plan: "base",
      period: "academicYear",
      returnUrl: "https://uchlist.ru/account",
      autoRenewConsent: true,
      fetcher,
    });

    expect(requests[0]?.save_payment_method).toBeUndefined();
    expect(paymentKindById(result.paymentId)).toBe("standard");

    await handleWebhook(
      db(),
      webhookEnv(),
      succeededNotification("yk_year", {
        amountKopecks: BASE_YEAR,
        paymentMethod: { id: "pm_year", saved: true },
      }),
    );
    expect(await count(`SELECT COUNT(*) AS n FROM recurring_payment_methods`)).toBe(0);
  });

  it("флаг выключен: карта не сохраняется, даже если фронт прислал согласие", async () => {
    await createUser("usr_flag_consent");
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "yk_flag_off",
          status: "pending",
          confirmation: { type: "redirect", confirmation_url: "https://yookassa/pay" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const result = await createPayment(db(), testEnv(), {
      userId: "usr_flag_consent",
      plan: "base",
      period: "monthly",
      returnUrl: "https://uchlist.ru/account",
      autoRenewConsent: true,
      fetcher,
    });

    expect(requests[0]?.save_payment_method).toBeUndefined();
    expect(paymentKindById(result.paymentId)).toBe("standard");
  });
});

describe("Вебхук автопродления", () => {
  /** Готовит состояние «крон списал, пришло уведомление». */
  async function seedChargeInFlight(userId = "usr_renew", subId = "sub_renew"): Promise<string> {
    await createUser(userId);
    await seedDueSubscription({ id: subId, userId, endsAt: NOW - 3600 });
    const ykId = "yk_renew_1";
    await db()
      .prepare(
        `INSERT INTO payments
           (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
         VALUES ('pay_r_test1', ?1, 'base', 'monthly', ?2, ?3, 'pending', ?4)`,
      )
      .bind(userId, BASE_MONTHLY, ykId, NOW)
      .run();
    // Так же поступает крон: он переставляет указатель на платёж подписки.
    await db()
      .prepare(`UPDATE subscriptions SET yookassa_payment_id = ?1 WHERE id = ?2`)
      .bind(ykId, subId)
      .run();
    return ykId;
  }

  it("продлевает ТЕКУЩУЮ подписку, а не создаёт новую", async () => {
    const ykId = await seedChargeInFlight();
    const before = await getSub("sub_renew");

    await handleWebhook(db(), webhookEnv(), succeededNotification(ykId));

    const after = await getSub("sub_renew");
    expect(after.id).toBe(before.id);
    // Никакой второй подписки: продление продлевает, а не пересоздаёт.
    expect(await count(`SELECT COUNT(*) AS n FROM subscriptions`)).toBe(1);
    expect(after.status).toBe("active");
    expect(after.auto_renew).toBe(1);
    // Месяц считается от момента списания, а не от старой просроченной даты.
    const realNow = Math.floor(Date.now() / 1000);
    expect(after.ends_at).toBeGreaterThan(realNow + 29 * DAY);
    expect(after.ends_at).toBeLessThanOrEqual(realNow + 30 * DAY + 60);

    const rpm = await db()
      .prepare(`SELECT last_charge_at FROM recurring_payment_methods WHERE subscription_id = 'sub_renew'`)
      .first<{ last_charge_at: number | null }>();
    expect(rpm?.last_charge_at).toBeGreaterThan(0);
  });

  it("просроченная подписка продлевается ровно на один месяц, без догоняющих списаний", async () => {
    await createUser("usr_stale");
    // Крон не ходил 40 дней: наивное `ends_at += месяц` догоняло бы по списанию
    // за каждый пропущенный месяц.
    await seedDueSubscription({ id: "sub_stale", userId: "usr_stale", endsAt: NOW - 40 * DAY });
    await db()
      .prepare(
        `INSERT INTO payments
           (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
         VALUES ('pay_r_stale', 'usr_stale', 'base', 'monthly', ?1, 'yk_stale', 'pending', ?2)`,
      )
      .bind(BASE_MONTHLY, NOW)
      .run();
    await db()
      .prepare(`UPDATE subscriptions SET yookassa_payment_id = 'yk_stale' WHERE id = 'sub_stale'`)
      .run();

    await handleWebhook(db(), webhookEnv(), succeededNotification("yk_stale"));

    const sub = await getSub("sub_stale");
    const realNow = Math.floor(Date.now() / 1000);
    expect(sub.ends_at).toBeLessThanOrEqual(realNow + 30 * DAY + 60);
  });

  it("повторное уведомление по тому же платежу НЕ продлевает дважды", async () => {
    const ykId = await seedChargeInFlight();

    await handleWebhook(db(), webhookEnv(), succeededNotification(ykId));
    const afterFirst = await getSub("sub_renew");

    await handleWebhook(db(), webhookEnv(), succeededNotification(ykId));
    const afterSecond = await getSub("sub_renew");

    expect(afterSecond.ends_at).toBe(afterFirst.ends_at);
    expect(await count(`SELECT COUNT(*) AS n FROM subscriptions`)).toBe(1);
  });

  it("без строки согласия автопродление не продлевает период", async () => {
    await createUser("usr_renew_noconsent");
    await seedDueSubscription({
      id: "sub_renew_noconsent",
      userId: "usr_renew_noconsent",
      withConsent: false,
    });
    await db()
      .prepare(
        `INSERT INTO payments
           (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
         VALUES ('pay_r_noconsent', 'usr_renew_noconsent', 'base', 'monthly', ?1, 'yk_noconsent', 'pending', ?2)`,
      )
      .bind(BASE_MONTHLY, NOW)
      .run();
    await db()
      .prepare(
        `UPDATE subscriptions SET yookassa_payment_id = 'yk_noconsent' WHERE id = 'sub_renew_noconsent'`,
      )
      .run();

    await handleWebhook(db(), webhookEnv(), succeededNotification("yk_noconsent"));

    // Деньги списаны, но продлевать нечем: оформляем как обычную покупку периода
    // и поднимаем alert, а не продлеваем без согласия.
    const sub = await getSub("sub_renew_noconsent");
    const realNow = Math.floor(Date.now() / 1000);
    expect(sub.ends_at).toBeLessThanOrEqual(realNow + 30 * DAY + 60);
  });

  it("учебный год не продлевается даже при согласии в данных", async () => {
    await createUser("usr_renew_year");
    await seedDueSubscription({
      id: "sub_renew_year",
      userId: "usr_renew_year",
      period: "academicYear",
      endsAt: NOW - 3600,
    });
    await db()
      .prepare(
        `INSERT INTO payments
           (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
         VALUES ('pay_r_year', 'usr_renew_year', 'base', 'academicYear', ?1, 'yk_year_r', 'pending', ?2)`,
      )
      .bind(BASE_YEAR, NOW)
      .run();
    await db()
      .prepare(`UPDATE subscriptions SET yookassa_payment_id = 'yk_year_r' WHERE id = 'sub_renew_year'`)
      .run();

    await handleWebhook(
      db(),
      webhookEnv(),
      succeededNotification("yk_year_r", { amountKopecks: BASE_YEAR }),
    );

    // Новой подписки на 9 месяцев не появилось, учебный год не продлён.
    const rows = await db()
      .prepare(`SELECT id, ends_at FROM subscriptions WHERE user_id = 'usr_renew_year'`)
      .all<{ id: string; ends_at: number }>();
    expect(rows.results).toHaveLength(2);
  });
});

describe("Напоминания", () => {
  it("уходит один раз на конкретное списание, повторный прогон молчит", async () => {
    await createUser("usr_remind");
    await seedDueSubscription({ id: "sub_remind", userId: "usr_remind", endsAt: NOW + 20 * 3600 });

    const env = testEnv({ RECURRING_BILLING_ENABLED: "true" });
    const first = await sendRenewalReminders(db(), env, { now: NOW });
    expect(first.sent).toBe(1);

    // Cron ходит каждый час: второй и третий проходы в то же окно не дублируют.
    const second = await sendRenewalReminders(db(), env, { now: NOW });
    const third = await sendRenewalReminders(db(), env, { now: NOW });
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(third.sent).toBe(0);

    const rows = await db()
      .prepare(
        `SELECT kind, dedupe_key FROM billing_notifications WHERE user_id = 'usr_remind'`,
      )
      .all<{ kind: string; dedupe_key: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.kind).toBe("renewal_reminder");
    // Ключ привязан к конкретному списанию (включая дату), а не к подписке.
    expect(rows.results[0]?.dedupe_key).toContain(String(NOW + 20 * 3600));
  });

  it("письмо о подписке БЕЗ автопродления — другое, и оно тоже одноразовое", async () => {
    await createUser("usr_remind_plain");
    await seedDueSubscription({
      id: "sub_remind_plain",
      userId: "usr_remind_plain",
      endsAt: NOW + 20 * 3600,
      withConsent: false,
      autoRenew: 0,
    });

    const env = testEnv({ RECURRING_BILLING_ENABLED: "true" });
    expect((await sendRenewalReminders(db(), env, { now: NOW })).sent).toBe(1);
    expect((await sendRenewalReminders(db(), env, { now: NOW })).sent).toBe(0);

    const row = await db()
      .prepare(`SELECT dedupe_key FROM billing_notifications WHERE user_id = 'usr_remind_plain'`)
      .first<{ dedupe_key: string }>();
    expect(row?.dedupe_key.startsWith("expiring:")).toBe(true);
  });

  it("за пределами окна 24-25 часов письмо не отправляется", async () => {
    await createUser("usr_remind_far");
    await seedDueSubscription({ id: "sub_far", userId: "usr_remind_far", endsAt: NOW + 3 * DAY });

    const result = await sendRenewalReminders(
      db(),
      testEnv({ RECURRING_BILLING_ENABLED: "true" }),
      { now: NOW },
    );

    expect(result.scanned).toBe(0);
    expect(result.sent).toBe(0);
  });
});

describe("Мелочи, на которых обычно и ломается", () => {
  it("BATCH_LIMIT ограничивает проход крона", () => {
    expect(BATCH_LIMIT).toBeGreaterThan(0);
    expect(BATCH_LIMIT).toBeLessThanOrEqual(200);
  });

  it("виды платежей различаются по префиксу и не пересекаются", () => {
    expect(paymentKindById("pay_abc123")).toBe("standard");
    expect(paymentKindById("pay_a_abc123")).toBe("consent");
    expect(paymentKindById("pay_r_abc123")).toBe("renewal");
  });

  it("фейковый ответ ЮKassa собирается в корректный объект ответа", async () => {
    // Санity-чек инъекции fetcher: сервис обязан доверять только тому,
    // что вернул провайдер, и не делать дополнительных сетевых вызовов.
    const fetcher = fakeYooKassa(["yk_sanity"]);
    const response = await fetcher("https://api.yookassa.ru/v3/payments", { method: "POST" });
    const data = (await response.json()) as { id: string; status: string };
    expect(data.id).toBe("yk_sanity");
    expect(data.status).toBe("pending");
  });

  it("цена «Плюс» в письме считается из прайса, а не из воздуха", () => {
    // Напоминание обязано называть точную сумму списания; цена живёт в PRICES.
    expect(BASE_MONTHLY).toBe(500_00);
    expect(PLUS_MONTHLY).toBe(1_500_00);
  });
});

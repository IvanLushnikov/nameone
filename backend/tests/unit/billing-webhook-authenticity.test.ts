/**
 * UL-D02 (аудит T02): подтверждение оплаты провайдером — fail-closed.
 *
 * ─── ЧТО ЛОВИТ ЭТОТ ФАЙЛ ──────────────────────────────────────────────────
 *
 * D1. НЕИЗВЕСТНОЕ СОСТОЯНИЕ ПЛАТЕЖА = НИКАКИХ ЗАПИСЕЙ + 503.
 *     Прежний код на network/5xx/битом JSON писал alert в лог и ПРОДОЛЖАЛ
 *     активацию: users.plan менялся, подписка создавалась, а провайдер об
 *     этом не знал. Теперь при недоступном провайдере БД не трогают вовсе, а
 *     роутер отдаёт 503 — чтобы провайдер повторил уведомление.
 *
 * D2. ПРОВАЙДЕР ОТВЕТИЛ — И НЕ ПОДТВЕРДИЛ. Отказ окончательный: никаких прав,
 *     никакого изменения тарифа. Проверяются ВСЕ поля канонического объекта:
 *     id, status, paid, amount.value, amount.currency.
 *
 * D3. НЕТ КЛЮЧЕЙ ПРОВАЙДЕРА — ПОДТВЕРЖДАТЬ НЕЧЕМ, ЗНАЧИТ АКТИВАЦИИ НЕТ.
 *     Явный изолированный демо-режим (ALLOW_DEMO_PAYMENTS=true) сохраняет
 *     существующую демо-функциональность, но боевой путь (платёж с
 *     настоящим yk-id) он не открывает.
 *
 * D4. ТАРИФ БЕРЁТСЯ ИЗ НАШЕЙ ЗАПИСИ, А НЕ ИЗ ТЕЛА УВЕДОМЛЕНИЯ. Подмена
 *     metadata.plan при подтверждённой оплате не меняет тариф.
 *
 * D5. REPLAY. Повторное уведомление по уже подтверждённому платежу не
 *     создаёт второй период.
 *
 * ─── ГРАНИЦЫ ТЕСТА ────────────────────────────────────────────────────────
 * Ни одного реального вызова ЮKassa: провайдер подменён инжектированным
 * fetcher'ом. Никаких ключей, списаний, возвратов и писем. Данные
 * синтетические.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "../../src/db/schema.sql?raw";
import { createUser } from "../../src/db/queries";
import { handleWebhook, PRICES, type YooKassaWebhookPayload } from "../../src/services/billing";
import type { Env } from "../../src/env";

const USER = "u_bill_auth";
const YK_ID = "yk_bill_auth_001";
const PAY_ID = "pay_bill_auth_001";
const BASE_MONTHLY = PRICES.base.monthly; // 24900 копеек

const NOW = Math.floor(Date.now() / 1000);

/** Окружение с боевыми ключами: без них сверка с провайдером невозможна. */
function prodEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "production",
    FRONTEND_URL: "https://uchlist.ru",
    APP_PUBLIC_URL: "https://uchlist.ru",
    YOOKASSA_SHOP_ID: "shop_test",
    YOOKASSA_SECRET_KEY: "secret_test",
    ALLOW_DEMO_PAYMENTS: "false",
    RECURRING_BILLING_ENABLED: "false",
    RESEND_API_KEY: undefined,
    ...overrides,
  } as Env;
}

/** Провайдер, который подтверждает платёж на переданную сумму. */
function confirmingProvider(amountKopecks: number = BASE_MONTHLY): typeof globalThis.fetch {
  return (async (url: string) => {
    const id = decodeURIComponent(String(url).split("/").pop() ?? "");
    return new Response(
      JSON.stringify({
        id,
        status: "succeeded",
        paid: true,
        amount: { value: (amountKopecks / 100).toFixed(2), currency: "RUB" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
}

/** Провайдер с заданным ответом — для проверок несовпадений. */
function providerAnswering(
  body: unknown,
  init: { status?: number; raw?: string } = {},
): typeof globalThis.fetch {
  return (async () => {
    if (init.raw !== undefined) {
      return new Response(init.raw, { status: init.status ?? 200 });
    }
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

/** Провайдер, который падает (сеть/таймаут). */
function throwingProvider(): typeof globalThis.fetch {
  return (async () => {
    throw new Error("provider unreachable");
  }) as typeof globalThis.fetch;
}

function notification(overrides: Partial<YooKassaWebhookPayload["object"]> = {}): YooKassaWebhookPayload {
  return {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: YK_ID,
      status: "succeeded",
      amount: { value: (BASE_MONTHLY / 100).toFixed(2), currency: "RUB" },
      ...overrides,
    },
  };
}

async function seedPayment(overrides: { id?: string; ykId?: string; status?: string } = {}) {
  const id = overrides.id ?? PAY_ID;
  const ykId = overrides.ykId ?? YK_ID;
  await env.DB.prepare(
    `INSERT INTO payments
       (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
     VALUES (?1, ?2, 'base', 'monthly', ?3, ?4, ?5, ?6)`,
  )
    .bind(id, USER, BASE_MONTHLY, ykId, overrides.status ?? "pending", NOW)
    .run();
}

/** Снимок всех финансовых строк — сравниваем до и после как строки. */
async function financialSnapshot(): Promise<string> {
  const payments = await env.DB.prepare(
    `SELECT id, user_id, plan, period, amount_rub, yookassa_payment_id, status, completed_at
     FROM payments ORDER BY id`,
  ).all();
  const subscriptions = await env.DB.prepare(
    `SELECT id, user_id, plan, status, period, starts_at, ends_at, auto_renew
     FROM subscriptions ORDER BY id`,
  ).all();
  const users = await env.DB.prepare(`SELECT id, plan FROM users ORDER BY id`).all();
  return JSON.stringify({ payments: payments.results, subscriptions: subscriptions.results, users: users.results });
}

async function activeSubscriptionCount(): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("UL-D02: оплата подтверждается провайдером, неизвестное состояние = 503 и без записей", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [schemaSql] }]);
  });

  beforeEach(async () => {
    for (const table of ["subscriptions", "recurring_payment_methods", "payments", "users"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    await createUser(env.DB, { id: USER, email: "bill-auth@test.local", plan: "free" });
  });

  it("D1a: провайдер вернул 503 — БД не тронута, наружу 503", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    await expect(
      handleWebhook(env.DB, prodEnv(), notification(), { fetcher: providerAnswering(null, { status: 503 }) }),
    ).rejects.toMatchObject({ status: 503 });

    expect(await financialSnapshot()).toBe(before);
    expect(await activeSubscriptionCount()).toBe(0);
  });

  it("D1b: провайдер бросил исключение (сеть/таймаут) — БД не тронута", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    await expect(
      handleWebhook(env.DB, prodEnv(), notification(), { fetcher: throwingProvider() }),
    ).rejects.toMatchObject({ status: 503 });

    expect(await financialSnapshot()).toBe(before);
  });

  it("D1c: провайдер вернул невалидный JSON — БД не тронута", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    await expect(
      handleWebhook(env.DB, prodEnv(), notification(), { fetcher: providerAnswering(null, { raw: "<html>502</html>" }) }),
    ).rejects.toMatchObject({ status: 503 });

    expect(await financialSnapshot()).toBe(before);
  });

  it("D1d: провайдер вернул неполные поля — БД не тронута", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    // Нет `paid` — состояние неизвестно, а не «оплачено».
    await expect(
      handleWebhook(
        env.DB,
        prodEnv(),
        notification(),
        { fetcher: providerAnswering({ id: YK_ID, status: "succeeded" }) },
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(await financialSnapshot()).toBe(before);
  });

  it("D1e: после повторного уведомления с доступным провайдером активация проходит", async () => {
    await seedPayment();

    // Первый раз провайдер недоступен — отказ с 503, записей нет.
    await expect(
      handleWebhook(env.DB, prodEnv(), notification(), { fetcher: providerAnswering(null, { status: 503 }) }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await activeSubscriptionCount()).toBe(0);

    // Провайдер ожил — обычная активация.
    const result = await handleWebhook(env.DB, prodEnv(), notification(), {
      fetcher: confirmingProvider(),
    });
    expect(result.handled).toBe(true);
    expect(await activeSubscriptionCount()).toBe(1);

    const user = await env.DB.prepare(`SELECT plan FROM users WHERE id = ?1`).bind(USER).first<{ plan: string }>();
    expect(user?.plan).toBe("base");
  });

  it("D1f: роутер отдаёт 503, когда провайдер недоступен", async () => {
    await seedPayment();

    const res = await SELF.fetch("https://uchlist.test/api/billing/yookassa-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notification()),
    });

    expect(res.status).toBe(503);
    expect(await activeSubscriptionCount()).toBe(0);
  });

  it("D2a: провайдер ответил «не оплачено» — прав нет, тариф не меняется", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    const result = await handleWebhook(env.DB, prodEnv(), notification(), {
      fetcher: providerAnswering({
        id: YK_ID,
        status: "pending",
        paid: false,
        amount: { value: (BASE_MONTHLY / 100).toFixed(2), currency: "RUB" },
      }),
    });

    expect(result.handled).toBe(false);
    expect(await financialSnapshot()).toBe(before);
    expect(await activeSubscriptionCount()).toBe(0);
  });

  it("D2b: провайдер ответил про ДРУГОЙ платёж — прав нет", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    const result = await handleWebhook(env.DB, prodEnv(), notification(), {
      fetcher: providerAnswering({
        id: "yk_somebody_else",
        status: "succeeded",
        paid: true,
        amount: { value: (BASE_MONTHLY / 100).toFixed(2), currency: "RUB" },
      }),
    });

    expect(result.handled).toBe(false);
    expect(await financialSnapshot()).toBe(before);
  });

  it("D2c: провайдер подтвердил другую сумму — прав нет", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    const result = await handleWebhook(env.DB, prodEnv(), notification(), {
      fetcher: confirmingProvider(BASE_MONTHLY + 1),
    });

    expect(result.handled).toBe(false);
    expect(await financialSnapshot()).toBe(before);
  });

  it("D2d: провайдер подтвердил другую валюту — прав нет", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    const result = await handleWebhook(env.DB, prodEnv(), notification(), {
      fetcher: providerAnswering({
        id: YK_ID,
        status: "succeeded",
        paid: true,
        amount: { value: (BASE_MONTHLY / 100).toFixed(2), currency: "USD" },
      }),
    });

    expect(result.handled).toBe(false);
    expect(await financialSnapshot()).toBe(before);
  });

  it("D3a: без ключей провайдера активации нет", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    await expect(
      handleWebhook(
        env.DB,
        prodEnv({ YOOKASSA_SHOP_ID: undefined, YOOKASSA_SECRET_KEY: undefined }),
        notification(),
        { fetcher: confirmingProvider() },
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(await financialSnapshot()).toBe(before);
    expect(await activeSubscriptionCount()).toBe(0);
  });

  it("D3b: демо-режим сохраняет демо-функциональность для платежа без провайдера", async () => {
    // Демо-платёж создан без провайдера: yookassa_payment_id == наш id.
    await seedPayment({ id: "pay_demo_001", ykId: "pay_demo_001" });

    const result = await handleWebhook(
      env.DB,
      prodEnv({ YOOKASSA_SHOP_ID: undefined, YOOKASSA_SECRET_KEY: undefined, ALLOW_DEMO_PAYMENTS: "true" }),
      notification({ id: "pay_demo_001" }),
      { fetcher: confirmingProvider() },
    );

    expect(result.handled).toBe(true);
    expect(await activeSubscriptionCount()).toBe(1);
  });

  it("D3c: демо-режим НЕ открывает боевой путь (платёж с настоящим yk-id)", async () => {
    await seedPayment();
    const before = await financialSnapshot();

    await expect(
      handleWebhook(
        env.DB,
        prodEnv({ YOOKASSA_SHOP_ID: undefined, YOOKASSA_SECRET_KEY: undefined, ALLOW_DEMO_PAYMENTS: "true" }),
        notification(),
        { fetcher: confirmingProvider() },
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(await financialSnapshot()).toBe(before);
    expect(await activeSubscriptionCount()).toBe(0);
  });

  it("D3d: демо-режим выключен — платёж без провайдера не активируется", async () => {
    await seedPayment({ id: "pay_demo_002", ykId: "pay_demo_002" });
    const before = await financialSnapshot();

    await expect(
      handleWebhook(
        env.DB,
        prodEnv({ YOOKASSA_SHOP_ID: undefined, YOOKASSA_SECRET_KEY: undefined, ALLOW_DEMO_PAYMENTS: "false" }),
        notification({ id: "pay_demo_002" }),
        { fetcher: confirmingProvider() },
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(await financialSnapshot()).toBe(before);
  });

  it("D4a: подмена metadata.plan не меняет тариф — право по нашей записи", async () => {
    await seedPayment();

    const result = await handleWebhook(env.DB, prodEnv(), notification({ metadata: { user_id: USER, plan: "plus", period: "academicYear" } }), {
      fetcher: confirmingProvider(),
    });

    expect(result.handled).toBe(true);
    const sub = await env.DB
      .prepare(`SELECT plan, period FROM subscriptions WHERE user_id = ?1`)
      .bind(USER)
      .first<{ plan: string; period: string }>();
    expect(sub?.plan).toBe("base");
    expect(sub?.period).toBe("monthly");

    const user = await env.DB.prepare(`SELECT plan FROM users WHERE id = ?1`).bind(USER).first<{ plan: string }>();
    expect(user?.plan).toBe("base");
  });

  it("D4b: без нашей записи о платеже прав нет", async () => {
    const before = await financialSnapshot();

    const result = await handleWebhook(env.DB, prodEnv(), notification({ id: "yk_never_existed" }), {
      fetcher: confirmingProvider(),
    });

    expect(result.handled).toBe(false);
    expect(await financialSnapshot()).toBe(before);
    expect(await activeSubscriptionCount()).toBe(0);
  });

  it("D5: повтор по уже подтверждённому платежу не создаёт второй период", async () => {
    await seedPayment();

    await handleWebhook(env.DB, prodEnv(), notification(), { fetcher: confirmingProvider() });
    const first = await env.DB
      .prepare(`SELECT id, ends_at FROM subscriptions WHERE user_id = ?1`)
      .bind(USER)
      .first<{ id: string; ends_at: number }>();

    await handleWebhook(env.DB, prodEnv(), notification(), { fetcher: confirmingProvider() });
    const second = await env.DB
      .prepare(`SELECT id, ends_at FROM subscriptions WHERE user_id = ?1`)
      .bind(USER)
      .first<{ id: string; ends_at: number }>();

    expect(second?.id).toBe(first?.id);
    expect(second?.ends_at).toBe(first?.ends_at);
    expect(await activeSubscriptionCount()).toBe(1);
  });
});

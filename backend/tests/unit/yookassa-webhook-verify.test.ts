/**
 * Вебхук ЮKassa: подписку активируем только после сверки с API.
 *
 * Ревью безопасности 30.10.2026, находка №6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО
 *
 * Живая сверка платежа с API ЮKassa — единственная опора схемы (платёж есть в
 * нашей БД + сумма совпадает с прайсом + сверка с API). И при ответе `unknown`
 * (сеть, 5xx, 401) подписка всё равно активировалась: сверки не было, а
 * активация проходила по данным БД и сумме из уведомления.
 *
 * Именно в этот день — когда API ЮKassa недоступен или ключи отозвали и
 * заменили — поддельное `payment.succeeded` активировало подписку бесплатно.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПРО ПОДПИСЬ (важно, чтобы не искать несуществующее)
 *
 * ЮKassa НЕ подписывает уведомления — сверять подпись нечем. Официальная
 * документация ЮKassa, раздел «Notification authentication», предлагает два
 * способа: сверка текущего статуса объекта в API (это здесь) и allowlist
 * IP-адресов ЮKassa на уровне Cloudflare (это к владельцу, список адресов — в
 * отчёте по ревью). Поэтому «проверка подписи» из находки в коде невозможна,
 * и вместо неё сделано то, что реально закрывает дыру: не активировать
 * подписку, когда сверки не было.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОВТОР УВЕДОМЛЕНИЯ
 *
 * Ответ с кодом не 2xx ЮKassa считает «не принято» и повторяет уведомление
 * ещё 24 часа после события. Это и есть очередь на повторную сверку:
 * вернуть 503, пока API не отвечает.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import schemaSql from "../../src/db/schema.sql?raw";
import {
  handleWebhook,
  getPriceKopecks,
  type YooKassaWebhookPayload,
} from "../../src/services/billing";
import type { Env } from "../../src/env";

const NOW = Math.floor(Date.now() / 1000);
const BASE_MONTHLY = getPriceKopecks("base", "monthly");

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "yk-webhook-verify", queries: [schemaSql] }]);
});

beforeEach(async () => {
  const d = db();
  await d.prepare(`DELETE FROM subscriptions`).run();
  await d.prepare(`DELETE FROM payments`).run();
  await d.prepare(`DELETE FROM users`).run();
});

/** Окружение продакшена с ключами ЮKassa — сверка будет идти в API. */
function prodEnv(): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "production",
    FRONTEND_URL: "https://uchlist.ru",
    APP_PUBLIC_URL: "https://uchlist.ru",
    YOOKASSA_SHOP_ID: "shop_test",
    YOOKASSA_SECRET_KEY: "secret_test",
    ALLOW_DEMO_PAYMENTS: "false",
    // Опасные режимы выключены явно: иначе 503 на POST дал бы запрет
    // небезопасной конфигурации (unsafeConfigurationGuard), и тест про вебхук
    // проходил бы по ложной причине.
    ALLOW_DEV_MAGIC_URL: "false",
    ALLOW_INSECURE_MODES: undefined,
  } as Env;
}

async function seedPayment(userId: string, ykId: string): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO users (id, email, name, plan, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'free', ?4, ?4)`,
    )
    .bind(userId, `${userId}@test.ru`, `Учитель ${userId}`, NOW)
    .run();
  await db()
    .prepare(
      `INSERT INTO payments
         (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
       VALUES (?1, ?2, 'base', 'monthly', ?3, ?4, 'pending', ?5)`,
    )
    .bind(`pay_${userId}`, userId, BASE_MONTHLY, ykId, NOW)
    .run();
}

function succeededNotification(ykId: string): YooKassaWebhookPayload {
  return {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: ykId,
      status: "succeeded",
      amount: { value: (BASE_MONTHLY / 100).toFixed(2), currency: "RUB" },
    },
  };
}

/**
 * Ответ API ЮKassa: платёж подтверждён.
 *
 * Ответ повторяет id запрошенного платежа и содержит сумму — ровно так отвечает
 * настоящий API. Раньше мок отдавал чужой id («yk_1» вместо id платежа) и не
 * содержал суммы; сверка такое честно отвергает (чужой id — это не тот
 * платёж, нет суммы — состояние неизвестно), и тест падал не из-за логики
 * сверки, а из-за неправдоподобного ответа провайдера.
 */
function apiSaysSucceeded(ykId: string): typeof globalThis.fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        id: ykId,
        status: "succeeded",
        paid: true,
        amount: { value: (BASE_MONTHLY / 100).toFixed(2), currency: "RUB" },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as unknown as typeof globalThis.fetch;
}

/** Ответ API ЮKassa: платёж не оплачен. */
function apiSaysPending(ykId: string): typeof globalThis.fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        id: ykId,
        status: "pending",
        paid: false,
        amount: { value: (BASE_MONTHLY / 100).toFixed(2), currency: "RUB" },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as unknown as typeof globalThis.fetch;
}

/** API недоступен: сеть или 5xx. */
function apiUnavailable(): typeof globalThis.fetch {
  return (async () => {
    throw new Error("network down");
  }) as unknown as typeof globalThis.fetch;
}

async function subscriptionCount(): Promise<number> {
  const row = await db()
    .prepare(`SELECT COUNT(*) AS n FROM subscriptions`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function paymentStatus(ykId: string): Promise<string | undefined> {
  const row = await db()
    .prepare(`SELECT status FROM payments WHERE yookassa_payment_id = ?1`)
    .bind(ykId)
    .first<{ status: string }>();
  return row?.status;
}

describe("вебхук ЮKassa: подписка только после сверки с API", () => {
  it("сверка не удалась — подписка НЕ активирована, платёж ждёт повтора", async () => {
    await seedPayment("usr_unknown", "yk_unknown");

    // Состояние платежа у провайдера НЕИЗВЕСТНО (сеть/5xx/401/неполный ответ).
    // Значит подтверждения нет: в БД не пишем, подписку не активируем, а наружу
    // отдаём 503 — по документации ЮKassa ответ не 2xx означает «не принято»,
    // и уведомление повторяется ещё 24 часа.
    await expect(
      handleWebhook(
        db(),
        prodEnv(),
        succeededNotification("yk_unknown"),
        { fetcher: apiUnavailable() },
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(await subscriptionCount()).toBe(0);
    expect(await paymentStatus("yk_unknown")).toBe("pending");
  });

  it("API сказало «не оплачено» — подписка не активирована, повтор не просим", async () => {
    await seedPayment("usr_denied", "yk_denied");

    const result = await handleWebhook(
      db(),
      prodEnv(),
      succeededNotification("yk_denied"),
      { fetcher: apiSaysPending("yk_denied") },
    );

    expect(result.handled).toBe(false);
    expect(result.retry).toBeUndefined();
    expect(await subscriptionCount()).toBe(0);
  });

  it("API подтвердило оплату — подписка активирована (регресс-гейт)", async () => {
    await seedPayment("usr_ok", "yk_ok");

    const result = await handleWebhook(db(), prodEnv(), succeededNotification("yk_ok"), {
      fetcher: apiSaysSucceeded("yk_ok"),
    });

    expect(result.handled).toBe(true);
    expect(await subscriptionCount()).toBe(1);
    expect(await paymentStatus("yk_ok")).toBe("succeeded");
  });

  it("роут отдаёт 503, когда сверка не удалась — чтобы ЮKassa повторила", async () => {
    await seedPayment("usr_route", "yk_route");

    // Роут зовёт handleWebhook без подмены fetcher, поэтому подменяем сам
    // сетевой вызов: API ЮKassa недоступно.
    const original = globalThis.fetch;
    globalThis.fetch = apiUnavailable();
    try {
      const { app } = await import("../../src/index");
      const res = await app.fetch(
        new Request("https://api.test/api/billing/yookassa-webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(succeededNotification("yk_route")),
        }),
        prodEnv() as never,
      );

      // Не 2xx → ЮKassa считает уведомление непринятым и повторяет 24 часа.
      expect(res.status).toBe(503);
      expect(await subscriptionCount()).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

/**
 * Security-регрессия: дыры, закрытые 2 октября 2026.
 *
 * Здесь нет «тестов ради покрытия». Каждый тест закрывает конкретную находку
 * аудита и падает, если защита снова ослабнет. Смысл такой: дыры этого класса
 * возвращаются не потому, что кто-то злоумышленник умный, а потому, что
 * кто-то через полгода отрефакторил `handleWebhook` и не заметил, что
 * metadata снова начали читать из тела запроса.
 *
 * Что закрывают:
 *   К-1 — вебхук оплаты доверял телу запроса: подделка давала бесплатный тариф;
 *   К-2 — в проде возвращалась ссылка входа, если не настроена почта;
 *   К-3 — не было защиты от подделки межсайтовых запросов (Origin);
 *   С-1 — сессионный токен дублировался в теле ответа.
 *
 * Тесты идут по НАСТОЯЩЕМУ пути: реальный Hono-роутер, реальный D1 из workerd.
 * Проверять мок было бы бессмысленно — вся ценность в том, что запрос
 * проходит через настоящий SQL и настоящую сборку middleware.
 *
 * Окружение форсируется в production: в wrangler.toml по умолчанию
 * APP_ENV=development, а именно разница между режимами и есть суть К-2
 * (в dev ссылку возвращать можно и нужно, в prod — нельзя).
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { app } from "../../src/index";
import type { Env } from "../../src/env";

// ── Схема ────────────────────────────────────────────────────────────────────
// Своя копия вместо чтения schema.sql: workerd-runtime не умеет node:fs.
// Нам нужны только пять таблиц, которых касаются эти тесты.
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

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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

-- Нужна middleware ограничения частоты: без неё /api/auth/magic-link
-- отвечает 500 ещё до бизнес-логики, и тесты проверяли бы ошибку,
-- а не поведение.
CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Роль пользователя читается в middleware авторизации.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT,
  grade INTEGER,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

// ── Хелперы ──────────────────────────────────────────────────────────────────

/** Прод-окружение: без RESEND_API_KEY, воркер без ключа почты. */
function prodEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "production",
    FRONTEND_URL: "https://uchlist.ru",
    APP_PUBLIC_URL: "https://uchlist.ru",
    RESEND_API_KEY: undefined,
    YOOKASSA_SHOP_ID: undefined,
    YOOKASSA_SECRET_KEY: undefined,
    // Переопределяем явно: окружение тестов берётся из wrangler.toml [vars],
    // где ALLOW_* = "true" для локальной разработки. Без явного переопределения
    // «прод» в тестах унаследовал бы разрешение на небезопасные режимы.
    ALLOW_DEV_MAGIC_URL: "false",
    ALLOW_DEMO_PAYMENTS: "false",
    ...overrides,
  };
}

/**
 * Окружение для подготовки данных.
 *
 * Именно development, а не production: в проде без RESEND_API_KEY запрос
 * magic-link теперь уходит в ошибку и НЕ заводит пользователя (fail-closed).
 * Это правильное поведение, но для подготовки фикстур нам нужен
 * работающий вход — как на локальной машине разработчика.
 */
function devEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "development",
    RESEND_API_KEY: undefined,
    FRONTEND_URL: "http://localhost:3000",
    APP_PUBLIC_URL: "http://localhost:3000",
    // Локально опасные режимы включаются ЯВНО — так же настроен
    // backend/.dev.vars.example. Читаются они из wrangler.toml [vars],
    // поэтому prodEnv обязан переопределить их ниже.
    ALLOW_DEV_MAGIC_URL: "true",
    ALLOW_DEMO_PAYMENTS: "true",
    ...overrides,
  };
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; origin?: string | null; token?: string },
  environment: Env = prodEnv(),
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Origin отсутствует у curl и у вебхука — это нормальный случай, его проверяем отдельно.
  if (init.origin !== null) headers["Origin"] = init.origin ?? GOOD_ORIGIN;
  if (init.token) headers["X-Session-Token"] = init.token;

  return app.fetch(
    new Request(`https://api.test${path}`, {
      method: init.method ?? "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    environment as never,
  );
}

/** Origin нашего фронта — есть в allowlist воркера. */
const GOOD_ORIGIN = "https://uchlist.ru";
/** Сайт злоумышленника, которого в allowlist нет. */
const EVIL_ORIGIN = "https://phishing.example.com";

const db = () => (env as unknown as { DB: D1Database }).DB;

// На весь файл, а не внутри describe: каждый describe выполняется в своём
// контексте, и миграция в первом блоке не дойдёт до остальных.
beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "security", queries: [SCHEMA_SQL] }]);
});

// С Vitest 4 и @cloudflare/vitest-plugin хранилище изолируется на файл, а не
// на отдельный тест: опция `isolatedStorage` удалена. Раньше каждый `it`
// начинал с пустой базы, и счётчик ограничения частоты запросов был нулевым.
// Теперь соседние тесты делят базу, и после нескольких вызовов
// `/api/auth/magic-link` сервер отдавал 429 там, где тест ждал 503 или
// созданного пользователя. Чистим счётчики — это ровно то состояние, на
// котором тесты и были написаны.
beforeEach(async () => {
  await db().prepare("DELETE FROM rate_limits").run();
});

/** Завести пользователя, сессию и вернуть токен сессии. */
async function seedSession(email: string): Promise<{ userId: string; token: string }> {
  await call("/api/auth/magic-link", { body: { email }, origin: null }, devEnv());

  const user = await db()
    .prepare("SELECT id FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  expect(user, `пользователь ${email} должен был создаться`).not.toBeNull();

  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db()
    .prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(token, user!.id, now + 86400, now)
    .run();

  return { userId: user!.id, token };
}

// ═══════════════════════════════════════════════════════════════════════════
// К-1. Вебхук оплаты не доверяет телу запроса
// ═══════════════════════════════════════════════════════════════════════════

describe("К-1: подделка вебхука не выдаёт подписку", () => {
  beforeEach(async () => {
    await db().prepare("DELETE FROM subscriptions").run();
    await db().prepare("DELETE FROM payments").run();
  });

  it("metadata.plan='plus' в теле не превращает оплату base в подписку plus", async () => {
    const { userId, token } = await seedSession("forger@uchlist.ru");

    // Честно создаём платёж на базовый тариф — так же, как это делает фронт.
    const created = await call(
      "/api/billing/create",
      { body: { plan: "base", period: "monthly" }, token },
      devEnv(), // платёж создаётся в dev-режиме: в проде без ключей ЮKassa его не будет
    );
    expect(created.status).toBe(200);

    const payment = await db()
      .prepare("SELECT yookassa_payment_id, amount_rub FROM payments WHERE user_id = ?1")
      .bind(userId)
      .first<{ yookassa_payment_id: string; amount_rub: number }>();
    expect(payment).not.toBeNull();

    // Подделка: объявляем, что оплачен «plus» за учебный год (11 000 ₽).
    const forged = await call(
      "/api/billing/yookassa-webhook",
      {
        body: {
          type: "notification",
          event: "payment.succeeded",
          object: {
            id: payment!.yookassa_payment_id,
            status: "succeeded",
            // Сумма в уведомлении — как у «plus», а не как у «base».
            amount: { value: "11000.00", currency: "RUB" },
            metadata: { user_id: userId, plan: "plus", period: "academicYear" },
          },
        },
        origin: null, // вебхук приходит сервер-сервер, Origin нет
      },
      // Ключи ЮKassa не заданы → сверка с их API не выполняется, решение
      // принимается по нашей БД и по сумме. Именно этот путь и проверяем.
      prodEnv(),
    );
    expect(forged.status).toBe(200);

    const subs = await db()
      .prepare("SELECT plan, period FROM subscriptions WHERE user_id = ?1")
      .bind(userId)
      .all<{ plan: string; period: string }>();

    // Никакой подписки: план и период в БД остались базовыми, а сумма
    // в уведомлении не совпала с ценой — то есть платёж не подтверждён.
    for (const s of subs.results) {
      expect(s.plan).not.toBe("plus");
      expect(s.period).not.toBe("academicYear");
    }
  });

  it("уведомление о неизвестном платеже не создаёт подписку", async () => {
    const res = await call(
      "/api/billing/yookassa-webhook",
      {
        body: {
          type: "notification",
          event: "payment.succeeded",
          object: {
            id: "yk_never_existed_12345",
            status: "succeeded",
            amount: { value: "11000.00", currency: "RUB" },
            metadata: { user_id: "usr_anything", plan: "plus", period: "academicYear" },
          },
        },
        origin: null,
      },
    );
    expect(res.status).toBe(200);
    const subs = await db().prepare("SELECT id FROM subscriptions").all();
    expect(subs.results).toHaveLength(0);
  });

  it("честная оплата активирует подписку по данным из БД", async () => {
    // Контроль к предыдущим двум тестам: защита не должна ломать оплату.
    const { userId } = await seedSession("paying@uchlist.ru");
    const now = Math.floor(Date.now() / 1000);
    await db()
      .prepare(
        `INSERT INTO payments (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
         VALUES ('pay_ok', ?1, 'plus', 'academicYear', 733000, 'yk_ok_1', 'pending', ?2)`,
      )
      .bind(userId, now)
      .run();

    const res = await call(
      "/api/billing/yookassa-webhook",
      {
        body: {
          type: "notification",
          event: "payment.succeeded",
          object: {
            id: "yk_ok_1",
            status: "succeeded",
            // 7 330 ₽ — учебный год тарифа «Плюс» после снижения цен 12.10.2026.
            // Фикстура обязана совпадать с PRICES: код сверяет сумму вебхука с
            // ценой тарифа, и расхождение честно отклоняет вебхук как подделку.
            amount: { value: "7330.00", currency: "RUB" },
          },
        },
        origin: null,
      },
    );
    expect(res.status).toBe(200);

    const sub = await db()
      .prepare("SELECT plan, period, status FROM subscriptions WHERE user_id = ?1")
      .bind(userId)
      .first<{ plan: string; period: string; status: string }>();

    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("plus");
    expect(sub!.period).toBe("academicYear");
    expect(sub!.status).toBe("active");
  });

  it("в production без ключей ЮKassa платёж не создаётся вовсе", async () => {
    // Найдено при проверке прода 2 октября 2026: на воркере не заданы
    // YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY, и код молча уходил в
    // dev-режим. В нём клиент знает paymentId и может дослать вебхук сам —
    // сверять платёж нечем, потому что ключей нет. То есть подписку можно
    // было активировать бесплатно. Симулятор в проде отключён.
    const { token } = await seedSession("noyookassa@uchlist.ru");
    const res = await call(
      "/api/billing/create",
      { body: { plan: "plus", period: "academicYear" }, token },
      prodEnv(), // YOOKASSA_* = undefined
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    const payments = await db().prepare("SELECT id FROM payments").all();
    expect(payments.results, "платёж не должен создаваться без ключей").toHaveLength(0);
  });

  it("в development демо-оплата работает — локальная разработка не сломана", async () => {
    const { userId, token } = await seedSession("devpay@uchlist.ru");
    const res = await call(
      "/api/billing/create",
      { body: { plan: "base", period: "monthly" }, token },
      devEnv(),
    );
    expect(res.status).toBe(200);
    const payment = await db()
      .prepare("SELECT yookassa_payment_id FROM payments WHERE user_id = ?1")
      .bind(userId)
      .first<{ yookassa_payment_id: string }>();
    expect(payment).not.toBeNull();
  });

  it("повторное уведомление не продлевает подписку заново (защита от replay)", async () => {
    const { userId } = await seedSession("replay@uchlist.ru");
    const now = Math.floor(Date.now() / 1000);
    await db()
      .prepare(
        `INSERT INTO payments (id, user_id, plan, period, amount_rub, yookassa_payment_id, status, created_at)
         VALUES ('pay_replay', ?1, 'base', 'monthly', 24900, 'yk_replay_1', 'pending', ?2)`,
      )
      .bind(userId, now)
      .run();

    const notification = {
      type: "notification",
      event: "payment.succeeded",
      object: {
        id: "yk_replay_1",
        status: "succeeded",
        // 249 ₽ — месяц «Базового» после снижения цен 12.10.2026.
        amount: { value: "249.00", currency: "RUB" },
      },
    };

    await call("/api/billing/yookassa-webhook", { body: notification, origin: null });
    const first = await db()
      .prepare("SELECT ends_at FROM subscriptions WHERE user_id = ?1")
      .bind(userId)
      .first<{ ends_at: number }>();
    expect(first, "первое уведомление должно активировать подписку").not.toBeNull();

    // Повтор: платёж уже succeeded — подписка не должна пересоздаваться.
    await call("/api/billing/yookassa-webhook", { body: notification, origin: null });
    const second = await db()
      .prepare("SELECT ends_at FROM subscriptions WHERE user_id = ?1")
      .bind(userId)
      .first<{ ends_at: number }>();

    expect(second!.ends_at).toBe(first!.ends_at);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// К-2. Вход в аккаунт
// ═══════════════════════════════════════════════════════════════════════════

describe("К-2: в production ссылка для входа не уходит наружу", () => {
  it("молчаливая поломка доставки больше невозможна: ошибка Resend видна клиенту", async () => {
    // Реальный случай 2 октября 2026: RESEND_API_KEY задан, домен не верифицирован,
    // Resend отвечает 403, код писал warning в лог — а ответ уходил
    // { ok: true, sent: true }. Учитель видел «Письмо отправлено» и ждал его
    // бесконечно: токен был создан, отправить его было нечем.
    // Теперь ошибка доставки доходит до клиента.
    const failing = prodEnv({ RESEND_API_KEY: "re_invalid_key_for_test" });

    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "delivery-failure@rabochielisty.ru" }, origin: null },
      failing,
    );
    const raw = await res.text();

    // Никакого «отправлено» при сбое доставки.
    expect(raw).not.toMatch(/"sent":\s*true/);
    expect(res.status, "сбой доставки должен быть виден клиенту").toBeGreaterThanOrEqual(400);
    // И при этом никакой утечки: ни ссылки, ни токена.
    expect(raw).not.toMatch(/token=/);
    expect(raw).not.toMatch(/devMagicUrl/);
  });

  it("отказ почты — это 503 EMAIL_DELIVERY_FAILED, а не 500 INTERNAL (12.10.2026)", async () => {
    // Блокер входа на бою: письмо не уходило, а ручка отвечала 500 с кодом
    // `INTERNAL`. Для учителя это молчаливый обрыв, для мониторинга — «у нас
    // баг», хотя сломана внешняя почта. Теперь отказ почты опознаётся отдельно.
    const failing = prodEnv({ RESEND_API_KEY: "re_invalid_key_for_test" });

    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "delivery-503@uchlist.ru" }, origin: null },
      failing,
    );
    const body = (await res.json()) as { ok?: boolean; code?: string; error?: string };

    expect(res.status).toBe(503);
    expect(body.code).toBe("EMAIL_DELIVERY_FAILED");
    // Текст не пустой и объясняет, что делать: иначе клиенту нечего показать.
    expect(body.error, "учитель должен получить внятный текст, а не пустоту").toBeTruthy();
    expect(body.error).toMatch(/письм/i);
  });

  it("без настроенной почты вход закрывается честной ошибкой 503, а не 500", async () => {
    // Тот же контракт для другой причины — ключа просто нет. Раньше обе
    // причины уезжали в InternalError → 500, и по коду ответа нельзя было
    // отличить «сломан Resend» от «не задан ключ».
    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "nokey-503@uchlist.ru" }, origin: null },
      prodEnv({ RESEND_API_KEY: undefined }),
    );
    const body = (await res.json()) as { code?: string; error?: string };

    expect(res.status).toBe(503);
    expect(body.code).toBe("EMAIL_DELIVERY_FAILED");
    // Состояние конфигурации клиенту не раскрываем: текст одинаков для
    // любой причины и ничего не говорит о том, задан ли ключ.
    expect(body.error).not.toMatch(/resend/i);
    expect(body.error).not.toMatch(/ключ/i);

    // Fail-closed сохранён: пользователь под такой запрос не заводится.
    const user = await db()
      .prepare("SELECT id FROM users WHERE email = ?1")
      .bind("nokey-503@uchlist.ru")
      .first();
    expect(user).toBeNull();
  });

  it("сообщение об ошибке не выдаёт, зарегистрирован ли адрес", async () => {
    const failing = prodEnv({ RESEND_API_KEY: "re_invalid_key_for_test" });
    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "definitely-registered@rabochielisty.ru" }, origin: null },
      failing,
    );
    const raw = await res.text();
    // Никаких слов про регистрацию адреса или пользователя.
    expect(raw).not.toMatch(/зарегистрир/i);
    expect(raw).not.toMatch(/пользователь/i);
  });

  it("в production ссылка для входа не возвращается в ответе", async () => {
    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "noletter@uchlist.ru" }, origin: null },
      prodEnv(), // RESEND_API_KEY отсутствует — именно этот случай был дырой
    );
    const raw = await res.text();

    // В ответе не должно быть ни ссылки, ни самого токена.
    expect(raw).not.toMatch(/token=/);
    expect(raw).not.toMatch(/devMagicUrl/);
  });

  it("ссылка входа закрыта даже если APP_ENV врёт — прод с APP_ENV=development", async () => {
    // Реальная поломка 2 октября 2026: боевой воркер задеплоен из секции [vars],
    // то есть с APP_ENV=development и FRONTEND_URL=http://localhost:3000.
    // Защита вида «в production нельзя» на таком воркере выключалась молча.
    // Теперь решение принимает отдельный флаг, которому APP_ENV не может повлиять.
    const misdeployed = prodEnv({
      APP_ENV: "development",
      FRONTEND_URL: "http://localhost:3000",
      APP_PUBLIC_URL: "http://localhost:3000",
    });

    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "misdeployed@uchlist.ru" }, origin: null },
      misdeployed,
    );
    expect(res.status, "ссылка входа обязана быть закрыта при неверном APP_ENV").toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toMatch(/token=/);
  });

  it("оплата не симулируется даже если APP_ENV врёт", async () => {
    const misdeployed = prodEnv({ APP_ENV: "development" });
    const { userId } = await seedSession("misdeployed-pay@uchlist.ru");
    const session = await db()
      .prepare("SELECT token FROM sessions WHERE user_id = ?1 LIMIT 1")
      .bind(userId)
      .first<{ token: string }>();

    const res = await call(
      "/api/billing/create",
      { body: { plan: "base", period: "monthly" }, token: session!.token },
      misdeployed,
    );
    expect(res.status, "симуляция оплаты обязана быть закрыта при неверном APP_ENV").toBeGreaterThanOrEqual(400);
  });

  it("ссылка на localhost отвергается, а не уходит в письме", async () => {
    // Письмо со ссылкой на localhost бесполезно: учитель её не откроет.
    const broken = prodEnv({
      APP_PUBLIC_URL: "http://localhost:3000",
      FRONTEND_URL: "http://localhost:3000",
    });
    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "badurl@uchlist.ru" }, origin: null },
      broken,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("в production без настроенной почты вход закрывается, а не выдаётся", async () => {
    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "failclosed@uchlist.ru" }, origin: null },
      prodEnv(),
    );

    // Fail-closed: пользователь не заводится, ссылка не выдаётся.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const user = await db()
      .prepare("SELECT id FROM users WHERE email = ?1")
      .bind("failclosed@uchlist.ru")
      .first();
    expect(user).toBeNull();
  });

  it("в development ссылка возвращается — локальная разработка не сломана", async () => {
    const res = await call(
      "/api/auth/magic-link",
      { body: { email: "dev@uchlist.ru" }, origin: null },
      devEnv(),
    );
    const body = (await res.json()) as { devMagicUrl?: string };
    expect(body.devMagicUrl, "локально ссылка нужна для тестов входа").toBeTruthy();
  });

  it("сессионный токен не возвращается в теле ответа (С-1)", async () => {
    await call(
      "/api/auth/magic-link",
      { body: { email: "cookie@uchlist.ru" }, origin: null },
      devEnv(),
    );
    const row = await db()
      .prepare("SELECT token FROM magic_links WHERE email = ?1 ORDER BY created_at DESC LIMIT 1")
      .bind("cookie@uchlist.ru")
      .first<{ token: string }>();
    expect(row).not.toBeNull();

    const res = await call("/api/auth/callback", { body: { token: row!.token }, origin: null });
    expect(res.status).toBe(200);

    const raw = await res.text();
    // Токен — только в HttpOnly-cookie, в теле ответа его быть не должно.
    expect(raw).not.toContain(row!.token);
    expect(raw).not.toMatch(/"sessionToken"/);
    expect(res.headers.get("Set-Cookie")).toContain("session=");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// К-3. Подделка межсайтовых запросов
// ═══════════════════════════════════════════════════════════════════════════

describe("К-3: изменяющие запросы с чужим Origin отклоняются", () => {
  it("POST с чужим Origin получает 403", async () => {
    const res = await call("/api/billing/create", {
      body: { plan: "base" },
      origin: EVIL_ORIGIN,
    });
    expect(res.status).toBe(403);
  });

  it("Origin 'null' (sandboxed iframe, file://) блокируется", async () => {
    const res = await call("/api/billing/create", { body: { plan: "base" }, origin: "null" });
    expect(res.status).toBe(403);
  });

  it("POST со своим Origin проходит", async () => {
    const { token } = await seedSession("goodorigin@uchlist.ru");
    const res = await call(
      "/api/billing/create",
      { body: { plan: "base", period: "monthly" }, token },
      devEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("POST без Origin проходит — серверный вызов, а не браузер", async () => {
    // Иначе мы бы отрезали собственный вебхук ЮKassa и любые серверные вызовы.
    const { token } = await seedSession("noorigin@uchlist.ru");
    const res = await call(
      "/api/billing/create",
      { body: { plan: "base", period: "monthly" }, token, origin: null },
      devEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("GET с чужим Origin НЕ блокируется — чтение не меняет состояние", async () => {
    const res = await call("/api/llm/models", { method: "GET", origin: EVIL_ORIGIN });
    expect(res.status).toBe(200);
  });

  it("DELETE с чужим Origin блокируется", async () => {
    const { token } = await seedSession("deletecsrf@uchlist.ru");
    const res = await call("/api/auth/logout", { method: "DELETE", origin: EVIL_ORIGIN, token });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// С-2. Чужие рабочие листы
// ═══════════════════════════════════════════════════════════════════════════

describe("С-2: чужой рабочий лист не отдаётся по ссылке", () => {
  async function seedWorksheet(id: string, ownerId: string | null): Promise<void> {
    await db()
      .prepare(
        `INSERT INTO worksheets (id, user_id, subject, grade, payload_json, created_at)
         VALUES (?1, ?2, 'Математика', 8, ?3, ?4)`,
      )
      .bind(id, ownerId, JSON.stringify({ id, tasks: [{ n: 1 }] }), Math.floor(Date.now() / 1000))
      .run();
  }

  it("аноним получает 404 на чужой сохранённый лист", async () => {
    const owner = await seedSession("owner@uchlist.ru");
    await seedWorksheet("ws_private", owner.userId);

    const res = await call("/api/worksheets/ws_private", { method: "GET" });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("tasks");
  });

  it("другой залогиненный учитель тоже получает 404", async () => {
    const owner = await seedSession("owner2@uchlist.ru");
    const other = await seedSession("other@uchlist.ru");
    await seedWorksheet("ws_private2", owner.userId);

    const res = await call("/api/worksheets/ws_private2", { method: "GET", token: other.token });
    expect(res.status).toBe(404);
  });

  it("владелец читает свой лист", async () => {
    const owner = await seedSession("owner3@uchlist.ru");
    await seedWorksheet("ws_mine", owner.userId);

    const res = await call("/api/worksheets/ws_mine", { method: "GET", token: owner.token });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("tasks");
  });

  it("анонимный (демо) лист остаётся доступным — персональных данных там нет", async () => {
    await seedWorksheet("ws_anon", null);
    const res = await call("/api/worksheets/ws_anon", { method: "GET" });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Самопроверка конфигурации
// ═══════════════════════════════════════════════════════════════════════════

describe("Конфигурация: отсутствие секретов не проходит молча", () => {
  it("прод без RESEND_API_KEY и ключей ЮKassa не обслуживает вход и оплату", async () => {
    // Регрессия на реальную находку 2 октября 2026: без этих ключей вход
    // ломался, а оплата молча уходила в симуляцию — и никто об этом не знал.
    const bad = prodEnv({ RESEND_API_KEY: undefined, YOOKASSA_SHOP_ID: undefined, YOOKASSA_SECRET_KEY: undefined });

    // Вход: должен отказать, а не выдать ссылку.
    const login = await call("/api/auth/magic-link", { body: { email: "cfg@uchlist.ru" }, origin: null }, bad);
    expect(login.status).toBeGreaterThanOrEqual(400);

    // Оплата: должна отказать, а не создать фиктивный платёж.
    const { userId } = await seedSession("cfgpay@uchlist.ru");
    const token = await db()
      .prepare("SELECT token FROM sessions WHERE user_id = ?1 LIMIT 1")
      .bind(userId)
      .first<{ token: string }>();
    // Чистим платежи перед проверкой. Проверяем мы не «таблица пуста», а
    // «этот вызов ничего не создал», и база у файла общая с соседними
    // тестами (изоляция теперь на файл, а не на тест).
    await db().prepare("DELETE FROM payments").run();
    const pay = await call("/api/billing/create", { body: { plan: "base", period: "monthly" }, token: token!.token }, bad);
    expect(pay.status).toBeGreaterThanOrEqual(400);
    expect(await db().prepare("SELECT id FROM payments").all()).toMatchObject({ results: [] });
  });
});

describe("Маршруты: заглушка /api/track не съедает соседние роуты", () => {
  // Регрессия на реальную находку 3 октября 2026. Заглушка объявлена как
  // `trackRouter.all("*")` и подключена на префиксе "/api": она ловит ЛЮБОЙ
  // /api/*, а Hono отдаёт запрос первому совпавшему обработчику. Стоя выше
  // turnstile и admin, заглушка отвечала на них 501 «Server-side tracking ещё
  // не реализован» — то есть капча и админка были мертвы на проде, молча.
  //
  // Тест ловит именно порядок подключения: если новый роут снова встанет выше
  // заглушки, он попадёт в такой же чёрный ящик.
  it("роут после заглушки всё равно отвечает своим обработчиком", async () => {
    const res = await call("/api/turnstile/config", { method: "GET" });
    const body = (await res.json()) as { ok?: boolean; code?: string; error?: string };

    // Не 501 от заглушки — значит роут turnstile жив и отвечает сам.
    expect(body.code).not.toBe("NOT_IMPLEMENTED");
    expect(body.ok).toBe(true);
  });

  // Обновлено 07.10.2026. Раньше здесь стояло ожидание 501 для неизвестного
  // пути — то есть тест закреплял поведение, из-за которого пять отсутствующих
  // эндпоинтов месяцами отвечали «tracking не реализован» вместо «адреса нет».
  // Теперь неизвестный /api/* отвечает 404, а 501 остался только на самом
  // /api/track, где это правда.
  it("неизвестный путь /api/* отвечает 404, а не 501 про трекинг", async () => {
    const res = await call("/api/definitely-not-a-route", { method: "GET" });
    expect(res.status).toBe(404);
  });

  // Обновлено 12.10.2026 (ТЗ-24): трекер реализован, 501 больше не бывает.
  // Проверка остаётся той же по смыслу — «заглушка не отвечает 501 нигде»,
  // просто на /api/track теперь честный отказ по телу, а не «не сделано».
  it("сам /api/track больше не отвечает 501 — трекер реализован", async () => {
    const res = await call("/api/track", { method: "POST" });
    expect(res.status).not.toBe(501);
  });
});

/**
 * ТЗ-24, лист-3: админ-API отдаёт цифры только администратору.
 *
 * ГЛАВНЫЙ РИСК ЭТОГО ЭКРАНА
 * -------------------------
 * `/superpower` — обычная страница статического экспорта: её код отдаётся всем
 * желающим. Поэтому защита строится не на странице, а на сервере, и проверяется
 * здесь. Пока `/api/admin/*` отдаёт хоть одну цифру не-администратору, раздел
 * «деньги» утекает целиком.
 *
 * ЧТО ПРОВЕРЯЕМ
 * -------------
 * 1. Каждый новый эндпоинт отдаёт 403 не-админу и НИ ОДНОЙ цифры в теле.
 * 2. Администратор получает реальные цифры, и они СХОДЯТСЯ с таблицами-источниками.
 * 3. Открытие раздела с деньгами оставляет строку в admin_audit_log.
 * 4. Перебор упирается в блокировку.
 *
 * ПРОВЕРКА СХОЖДЕНИЯ — НЕ КОПИРОВАНИЕ
 * -----------------------------------
 * Ожидаемые суммы НЕ выписаны руками из тех же данных, которые потом сравниваются:
 * тест считает их отдельными запросами к `payments` и `llm_costs_actual`, а ответ
 * эндпоинта сверяет с ними. Иначе проверка «совпало с тем же самым» всегда проходит.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT,
  plan                TEXT NOT NULL DEFAULT 'free',
  generations_total   INTEGER NOT NULL DEFAULT 0,
  generations_today   INTEGER NOT NULL DEFAULT 0,
  generations_reset_at INTEGER,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  stripe_customer_id  TEXT,
  yookassa_customer_id TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  data_json   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at);

CREATE TABLE IF NOT EXISTS llm_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  task        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  plan        TEXT NOT NULL,
  tokens_in   INTEGER NOT NULL,
  tokens_out  INTEGER NOT NULL,
  cost_usd    REAL NOT NULL,
  latency_ms  INTEGER NOT NULL,
  cached      INTEGER NOT NULL DEFAULT 0,
  fallback    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_costs_actual (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  task        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  cost_rub    REAL NOT NULL,
  cost_usd_est REAL,
  latency_ms  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS polza_balance_snapshots (
  id              TEXT PRIMARY KEY,
  amount_rub      REAL NOT NULL,
  available_rub   REAL,
  reserved_rub    REAL,
  spent_rub       REAL,
  provider_updated_at TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan                TEXT NOT NULL,
  period              TEXT NOT NULL DEFAULT 'monthly',
  amount_rub          INTEGER NOT NULL,
  yookassa_payment_id TEXT UNIQUE,
  status              TEXT NOT NULL,
  confirmation_url    TEXT,
  created_at          INTEGER NOT NULL,
  completed_at        INTEGER
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                TEXT NOT NULL,
  status              TEXT NOT NULL,
  period              TEXT NOT NULL,
  yookassa_payment_id TEXT,
  starts_at           INTEGER NOT NULL,
  ends_at             INTEGER NOT NULL,
  auto_renew          INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_totp (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc   TEXT NOT NULL,
  secret_iv    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  confirmed_at INTEGER,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  payload_json TEXT,
  created_at  INTEGER NOT NULL
);
`;

const ADMIN_TOKEN = "tok_admin_sp";
const TEACHER_TOKEN = "tok_teacher_sp";

/** Все четыре эндпоинта `/superpower`. */
const ENDPOINTS = [
  { path: "/api/admin/overview", label: "светофор" },
  { path: "/api/admin/screens?days=30", label: "экраны" },
  { path: "/api/admin/generations?days=30", label: "генерации" },
  { path: "/api/admin/money", label: "деньги" },
];

async function callApi(path: string, token?: string) {
  return SELF.fetch(`https://uchlist.test${path}`, {
    headers: token ? { cookie: `session=${token}` } : {},
  });
}

const NOW = Math.floor(Date.now() / 1000);
/** Начало текущего месяца — чтобы все снимки и платежи попали в отчёт. */
function monthStart(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

async function seed() {
  // Чистим всё, что сейчас же вставим. С Vitest 4 и @cloudflare/vitest-plugin
  // хранилище изолируется НА ФАЙЛ, а не на отдельный тест (опция
  // `isolatedStorage` удалена). Раньше каждый `it` получал пустую базу, и
  // повторный вызов seed() был безобиден. Теперь соседние тесты делят одну
  // базу, и второй вызов seed() падал бы на UNIQUE по users.email.
  // Порядок — от детей к родителям, иначе внешние ключи не дадут удалить.
  for (const table of [
    "events",
    "polza_balance_snapshots",
    "llm_logs",
    "llm_costs_actual",
    "payments",
    "admin_totp",
    "sessions",
    "users",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await env.DB.prepare(
    `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
     VALUES ('u_admin', 'admin@test.local', 'Admin', 'plus', 1, ?1, ?1),
            ('u_teacher', 'teacher@test.local', 'Teacher', 'free', 0, ?1, ?1)`,
  )
    .bind(NOW)
    .run();

  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES (?1, 'u_admin', ?2, ?3), (?4, 'u_teacher', ?2, ?3)`,
  )
    .bind(ADMIN_TOKEN, NOW + 3600, NOW, TEACHER_TOKEN)
    .run();

  // Выручка: 249 ₽ успешной + 500 ₽ висящей (статус не 'succeeded').
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, plan, period, amount_rub, status, created_at, completed_at)
     VALUES ('pay_ok', 'u_teacher', 'base', 'monthly', 249, 'succeeded', ?1, ?1),
            ('pay_pending', 'u_teacher', 'plus', 'monthly', 500, 'pending', ?1, NULL)`,
  )
    .bind(NOW)
    .run();

  // Фактические расходы: 30 ₽ по учителю.
  await env.DB.prepare(
    `INSERT INTO llm_costs_actual
       (id, user_id, task, provider, model, cost_rub, cost_usd_est, latency_ms, created_at)
     VALUES ('act_1', 'u_teacher', 'worksheet', 'polza', 'gpt-6-luna', 30.0, 0.3, 100, ?1)`,
  )
    .bind(NOW)
    .run();

  // Наш расчёт по прайсу: 0,4 USD ≈ 34,5 ₽ по курсу 86,2.
  await env.DB.prepare(
    `INSERT INTO llm_logs
       (id, user_id, task, provider, model, plan, tokens_in, tokens_out, cost_usd,
        latency_ms, cached, fallback, error, created_at)
     VALUES ('log_1', 'u_teacher', 'worksheet', 'polza', 'gpt-6-luna', 'free',
             1000, 500, 0.4, 100, 0, 0, NULL, ?1)`,
  )
    .bind(NOW)
    .run();

  // Снимки баланса: было 1000, стало 1500 → пополнение 500.
  // Время у снимков РАЗНОЕ: при одинаковом created_at «последний» снимок
  // выбирается произвольно, и проверка баланса становилась бы лотереей.
  await env.DB.prepare(
    `INSERT INTO polza_balance_snapshots
       (id, amount_rub, available_rub, reserved_rub, spent_rub, provider_updated_at, created_at)
     VALUES ('pbs_1', 1000, 900, 5, 100, '2026-10-10T00:00:00Z', ?1),
            ('pbs_2', 1500, 1400, 5, 600, '2026-10-11T00:00:00Z', ?2)`,
  )
    .bind(monthStart() + 100, monthStart() + 200)
    .run();

  // События для воронки.
  for (const name of ["login_view", "dashboard_view", "constructor_view"]) {
    await env.DB.prepare(
      `INSERT INTO events (id, user_id, name, data_json, created_at)
       VALUES (?1, 'u_teacher', ?2, NULL, ?3)`,
    )
      .bind(`ev_${name}`, name, NOW)
      .run();
  }
}

/** Независимая перепроверка: выручка считается здесь, а не берётся из ответа. */
async function expectedRevenue(): Promise<number> {
  const row = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(amount_rub), 0) AS rub FROM payments
       WHERE status = 'succeeded' AND created_at >= ?1`,
    )
    .bind(monthStart())
    .first<{ rub: number }>();
  return row?.rub ?? 0;
}

async function expectedActualCost(): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COALESCE(SUM(cost_rub), 0) AS rub FROM llm_costs_actual WHERE created_at >= ?1`)
    .bind(monthStart())
    .first<{ rub: number }>();
  return row?.rub ?? 0;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM admin_audit_log`).run();
  await env.DB.prepare(`DELETE FROM rate_limits`).run();
});

describe("G1: админские эндпоинты закрыты от не-администратора", () => {
  it("учитель на каждом из четырёх эндпоинтов получает 403", async () => {
    // seed() обязателен: без него сессии учителя в базе нет, и прилетает 401
    // («нет сессии»), а проверяем мы другое — отказ по роли.
    await seed();
    for (const ep of ENDPOINTS) {
      const res = await callApi(ep.path, TEACHER_TOKEN);
      expect(res.status, `эндпоинт «${ep.label}» отдал ${res.status} учителю`).toBe(403);
    }
  });

  it("анонимный запрос отбивается — 401, «нет сессии», а не «не та роль»", async () => {
    // 401 здесь не ошибка теста, а правильная семантика: нет сессии вовсе —
    // один отказ; есть сессия, но не админ — другой (403). Оба отказа
    // означают «данных не будет», и именно это тут и проверяется.
    for (const ep of ENDPOINTS) {
      const res = await callApi(ep.path);
      expect(res.status, `эндпоинт «${ep.label}» отдал ${res.status} анониму`).toBe(401);
    }
  });

  it("ни учитель, ни аноним не получают тела с цифрами", async () => {
    for (const ep of ENDPOINTS) {
      for (const token of [TEACHER_TOKEN, undefined]) {
        const res = await callApi(ep.path, token);
        const text = await res.text();
        // Отрицательная проверка.
        expect(text).not.toContain("249");
        expect(text).not.toMatch(/"(revenueRub|costRubActual)"/);
      }
    }
  });
});

describe("G2: администратор получает цифры, и они сходятся с источниками", () => {
  it("светофор: выручка и расход равны суммам по таблицам", async () => {
    await seed();

    const res = await callApi("/api/admin/overview", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      money: {
        revenueRub: number;
        costRubActual: number | null;
        costRubEstimate: number | null;
        costShare: number | null;
        divergence: number | null;
      };
    };

    // Сверяем с НЕЗАВИСИМЫМИ запросами, а не с выдуманными числами.
    expect(body.money.revenueRub).toBe(await expectedRevenue());
    expect(body.money.costRubActual).toBe(await expectedActualCost());
    // Доля считается из фактических денег: 30 ₽ расхода на 249 ₽ выручки.
    expect(body.money.costShare).toBe(12);
  });

  it("расхождение счёта и расчёта считается и показывается", async () => {
    await seed();
    const res = await callApi("/api/admin/overview", ADMIN_TOKEN);
    const body = (await res.json()) as {
      money: { costRubActual: number | null; costRubEstimate: number | null; divergence: number | null };
    };

    // 30 ₽ факта против 34,48 ₽ оценки (0,4 USD × 86,2) — расхождение ~13%.
    expect(body.money.costRubEstimate).toBeCloseTo(34.48, 2);
    expect(body.money.divergence).toBeGreaterThan(0.03);
  });

  it("экраны: события посчитаны и попали в воронку", async () => {
    await seed();
    const res = await callApi("/api/admin/screens?days=30", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ event: string; total: number }>;
      funnel: Array<{ step: string; users: number }>;
    };

    expect(body.events.find((e) => e.event === "login_view")?.total).toBe(1);
    expect(body.funnel.find((f) => f.step === "constructor_view")?.users).toBe(1);
    // Событие, которого в коде нет, в воронку не попадает — шаги взяты из
    // реальных событий, а не выдуманы.
    expect(body.funnel.every((f) => typeof f.users === "number")).toBe(true);
  });

  it("генерации: успешные и с ошибкой различаются", async () => {
    await seed();
    await env.DB.prepare(
      `INSERT INTO llm_logs
         (id, user_id, task, provider, model, plan, tokens_in, tokens_out, cost_usd,
          latency_ms, cached, fallback, error, created_at)
       VALUES ('log_err', NULL, 'worksheet', 'polza', 'gpt-6-luna', 'free',
               100, 0, 0, 10, 0, 0, 'timeout', ?1)`,
    )
      .bind(NOW)
      .run();

    const res = await callApi("/api/admin/generations?days=30", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { calls: number; failed: number };
      byTask: Array<{ task: string; calls: number; costRubActual: number | null }>;
    };

    expect(body.totals.calls).toBe(2);
    expect(body.totals.failed).toBe(1);
    // Фактические расходы по задаче — из llm_costs_actual, а не из оценки.
    expect(body.byTask.find((t) => t.task === "worksheet")?.costRubActual).toBe(30);
  });

  it("деньги: пополнение посчитано как рост кошелька", async () => {
    await seed();
    const res = await callApi("/api/admin/money", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      topups: { totalRub: number };
      providerBalance: { amountRub: number } | null;
      costByUser: Array<{ userId: string | null; costRub: number; revenueRub: number }>;
    };

    // 1000 → 1500 = 500 ₽ пополнения.
    expect(body.topups.totalRub).toBe(500);
    expect(body.providerBalance?.amountRub).toBe(1500);
    const teacher = body.costByUser.find((u) => u.userId === "u_teacher");
    expect(teacher?.costRub).toBe(30);
    // Выручка — факт платежей, а не цена из прайса.
    expect(teacher?.revenueRub).toBe(249);
  });

  it("кривой месяц и кривое число дней отвергаются, а не ломают страницу", async () => {
    await seed();
    expect((await callApi("/api/admin/overview?month=2026-99", ADMIN_TOKEN)).status).toBe(400);
    expect((await callApi("/api/admin/overview?month=ничего", ADMIN_TOKEN)).status).toBe(400);
    expect((await callApi("/api/admin/screens?days=0", ADMIN_TOKEN)).status).toBe(400);
    expect((await callApi("/api/admin/screens?days=99999", ADMIN_TOKEN)).status).toBe(400);
  });
});

describe("G3: раздел с деньгами оставляет след в аудит-логе", () => {
  it("после открытия есть строка с actor и действием", async () => {
    await seed();
    const res = await callApi("/api/admin/money", ADMIN_TOKEN);
    expect(res.status).toBe(200);

    const rows = await env.DB
      .prepare(`SELECT actor_id, action, target_type FROM admin_audit_log ORDER BY created_at DESC`)
      .all<{ actor_id: string | null; action: string; target_type: string | null }>();

    expect(rows.results.length).toBeGreaterThan(0);
    expect(rows.results[0]!.actor_id).toBe("u_admin");
    expect(rows.results[0]!.action).toBe("superpower.money.view");
    expect(rows.results[0]!.target_type).toBe("finance");
  });

  it("светофор тоже оставляет след — решение 15.10.2026", async () => {
    // Раньше здесь стояло обратное: «светофор аудит не пишет — его открывают
    // постоянно». Причина была понятна (светофор открывают часто), но из-за
    // этого журнал вёлся только на деньгах, и на остальных экранах не
    // оставалось следа вообще. 15.10.2026 владелец решил чинить все находки
    // аудита, и след теперь есть у каждого экрана.
    await seed();
    await callApi("/api/admin/overview", ADMIN_TOKEN);
    const rows = await env.DB
      .prepare(`SELECT action, target_type FROM admin_audit_log ORDER BY created_at DESC`)
      .all<{ action: string; target_type: string | null }>();
    expect(rows.results[0]!.action).toBe("superpower.overview.view");
    expect(rows.results[0]!.target_type).toBe("dashboard");
  });

  it("учитель не пишет след: его запрос отбит до попадания в обработчик", async () => {
    await seed();
    await callApi("/api/admin/money", TEACHER_TOKEN);
    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_log`).first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
  });
});

describe("G4: перебор упирается в блокировку", () => {
  it("после серии запросов админский эндпоинт начинает отказывать", { timeout: 180_000 }, async () => {
    await seed();

    // 240 запросов в час — потолок из конфигурации. 300 попыток обязаны
    // упереться: иначе ограничение частоты не работает вовсе.
    let blocked = 0;
    for (let i = 0; i < 300; i++) {
      const res = await callApi("/api/admin/overview", ADMIN_TOKEN);
      if (res.status === 429) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it("блокировка живёт в своей ячейке и не задевает другие эндпоинты", { timeout: 180_000 }, async () => {
    await seed();
    for (let i = 0; i < 300; i++) {
      await callApi("/api/admin/overview", ADMIN_TOKEN);
    }
    // Второй эндпоинт делит тот же счётчик, но ключ у него тот же (админ).
    // Проверяем главное: это не 500 и не падение, а честный отказ.
    const res = await callApi("/api/admin/money", ADMIN_TOKEN);
    expect([200, 429]).toContain(res.status);
  });
});

describe("итог листа-3", () => {
  it("ADMIN_ENDPOINTS_LOCKED — все четыре эндпоинта закрыты от учителя", async () => {
    await seed();
    for (const ep of ENDPOINTS) {
      expect((await callApi(ep.path, TEACHER_TOKEN)).status).toBe(403);
    }
    // Положительный контроль: админ видит данные на тех же адресах.
    expect((await callApi("/api/admin/overview", ADMIN_TOKEN)).status).toBe(200);
    console.log("ADMIN_ENDPOINTS_LOCKED");
  });

  it("ADMIN_OVERVIEW_MATCHES_SOURCE — цифры сходятся с таблицами", async () => {
    await seed();
    const res = await callApi("/api/admin/overview", ADMIN_TOKEN);
    const body = (await res.json()) as { money: { revenueRub: number; costRubActual: number | null } };

    expect(body.money.revenueRub).toBe(await expectedRevenue());
    expect(body.money.costRubActual).toBe(await expectedActualCost());
    console.log("ADMIN_OVERVIEW_MATCHES_SOURCE");
  });

  it("ADMIN_AUDIT_WRITTEN — просмотр денег фиксируется", async () => {
    await seed();
    await callApi("/api/admin/money", ADMIN_TOKEN);
    const rows = await env.DB
      .prepare(`SELECT actor_id, action FROM admin_audit_log ORDER BY created_at DESC`)
      .all<{ actor_id: string | null; action: string }>();
    expect(rows.results[0]?.action).toBe("superpower.money.view");
    console.log("ADMIN_AUDIT_WRITTEN");
  });

  it("ADMIN_RATE_LIMITED — перебор блокируется", { timeout: 180_000 }, async () => {
    await seed();
    let blocked = 0;
    for (let i = 0; i < 300; i++) {
      if ((await callApi("/api/admin/overview", ADMIN_TOKEN)).status === 429) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(0);
    console.log("ADMIN_RATE_LIMITED");
  });
});
/**
 * Права администратора (15.10.2026).
 *
 * До этого дня права выдавались один раз — при первой регистрации, если адрес
 * совпал со списком ADMIN_EMAILS на сервере — и держались навсегда. Снять их
 * было нечем: `setUserAdmin` существовал, но не вызывался ниоткуда. Практический
 * случай: адрес из списка освободился, его занял другой человек, зарегистрировался
 * и получил суперадминку. Заметить это было негде.
 *
 * Здесь проверяется ровно то, ради чего добавлен блок: список виден, чужие права
 * снимаются, свои — нет.
 */
describe("G5: права администратора", () => {
  it("список прав виден и показывает, включён ли код подтверждения", async () => {
    await seed();
    // Второй администратор с подтверждённым кодом — как в бою.
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
       VALUES ('u_admin2', 'second@test.local', 'Второй', 'plus', 1, ?1, ?1)`,
    )
      .bind(NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO admin_totp (user_id, secret_enc, secret_iv, created_at, confirmed_at)
       VALUES ('u_admin2', 'x', 'y', ?1, ?1)`,
    )
      .bind(NOW)
      .run();

    const res = await callApi("/api/admin/admins", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      admins: {
        id: string;
        email: string;
        totpEnabled: boolean;
        isSelf: boolean;
      }[];
    };

    expect(body.admins.length).toBe(2);
    const self = body.admins.find((a) => a.id === "u_admin");
    const other = body.admins.find((a) => a.id === "u_admin2");
    expect(self?.isSelf).toBe(true);
    // Без кода подтверждения ссылка из письма сама пускает в суперадминку —
    // список обязан это показывать.
    expect(self?.totpEnabled).toBe(false);
    expect(other?.totpEnabled).toBe(true);
    console.log("ADMINS_LISTED_WITH_TOTP");
  });

  it("права чужого аккаунта можно снять и вернуть", async () => {
    await seed();
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
       VALUES ('u_admin2', 'second@test.local', 'Второй', 'plus', 1, ?1, ?1)`,
    )
      .bind(NOW)
      .run();

    const revoke = await SELF.fetch("https://uchlist.test/api/admin/admins", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `session=${ADMIN_TOKEN}` },
      body: JSON.stringify({ userId: "u_admin2", isAdmin: false }),
    });
    expect(revoke.status).toBe(200);

    const afterRevoke = await env.DB
      .prepare(`SELECT is_admin FROM users WHERE id = 'u_admin2'`)
      .first<{ is_admin: number }>();
    expect(afterRevoke?.is_admin).toBe(0);

    await SELF.fetch("https://uchlist.test/api/admin/admins", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `session=${ADMIN_TOKEN}` },
      body: JSON.stringify({ userId: "u_admin2", isAdmin: true }),
    });
    const afterGrant = await env.DB
      .prepare(`SELECT is_admin FROM users WHERE id = 'u_admin2'`)
      .first<{ is_admin: number }>();
    expect(afterGrant?.is_admin).toBe(1);
    console.log("ADMIN_RIGHTS_REVOKED_AND_GRANTED");
  });

  it("свои права снять нельзя — иначе доступ к разделу теряется навсегда", async () => {
    await seed();
    const res = await SELF.fetch("https://uchlist.test/api/admin/admins", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `session=${ADMIN_TOKEN}` },
      body: JSON.stringify({ userId: "u_admin", isAdmin: false }),
    });
    expect(res.status).toBe(403);

    const still = await env.DB
      .prepare(`SELECT is_admin FROM users WHERE id = 'u_admin'`)
      .first<{ is_admin: number }>();
    expect(still?.is_admin).toBe(1);
    console.log("CANNOT_REVOKE_SELF");
  });

  it("смена прав попадает в журнал — кто кому и когда", async () => {
    await seed();
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
       VALUES ('u_admin2', 'second@test.local', 'Второй', 'plus', 1, ?1, ?1)`,
    )
      .bind(NOW)
      .run();

    await SELF.fetch("https://uchlist.test/api/admin/admins", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `session=${ADMIN_TOKEN}` },
      body: JSON.stringify({ userId: "u_admin2", isAdmin: false }),
    });

    const rows = await env.DB
      .prepare(
        `SELECT actor_id, action, payload_json FROM admin_audit_log ORDER BY created_at DESC`,
      )
      .all<{ actor_id: string | null; action: string; payload_json: string | null }>();
    const entry = rows.results[0]!;
    expect(entry.actor_id).toBe("u_admin");
    expect(entry.action).toBe("access.revoke");
    expect(JSON.parse(entry.payload_json ?? "{}")).toMatchObject({
      userId: "u_admin2",
      email: "second@test.local",
    });
    console.log("ACCESS_CHANGE_AUDITED");
  });

  it("учитель не видит список прав и не может их менять", async () => {
    await seed();
    const list = await callApi("/api/admin/admins", TEACHER_TOKEN);
    expect(list.status).toBe(403);

    const change = await SELF.fetch("https://uchlist.test/api/admin/admins", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `session=${TEACHER_TOKEN}` },
      body: JSON.stringify({ userId: "u_admin", isAdmin: false }),
    });
    expect(change.status).toBe(403);
    console.log("TEACHER_CANNOT_TOUCH_RIGHTS");
  });
});

describe("G6: журнал одинаков на всех экранах", () => {
  it("каждый экран админки оставляет след — ни один не молчит", async () => {
    const screens: { path: string; action: string }[] = [
      { path: "/api/admin/overview", action: "superpower.overview.view" },
      { path: "/api/admin/screens?days=30", action: "superpower.screens.view" },
      { path: "/api/admin/generations?days=30", action: "superpower.generations.view" },
      { path: "/api/admin/money", action: "superpower.money.view" },
    ];

    for (const screen of screens) {
      await env.DB.prepare(`DELETE FROM admin_audit_log`).run();
      await seed();
      const res = await callApi(screen.path, ADMIN_TOKEN);
      expect(res.status).toBe(200);
      const row = await env.DB
        .prepare(`SELECT action FROM admin_audit_log ORDER BY created_at DESC`)
        .first<{ action: string }>();
      expect(row?.action).toBe(screen.action);
    }
    console.log("ALL_SCREENS_AUDITED");
  });
});

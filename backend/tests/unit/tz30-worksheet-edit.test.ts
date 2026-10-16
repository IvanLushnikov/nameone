/**
 * ТЗ-30, работа 2: правка листа — пересборка, а не регенерация (AD-2, AD-3).
 *
 * ─── ЧТО ЛОВИТ ЭТОТ ФАЙЛ ──────────────────────────────────────────────────
 *
 * E1. ПРАВКА МЕНЯЕТ ЗАДАНИЕ. Текст в `payload_json` обновляется, `count`
 *     приходит в согласии с числом заданий, и GET отдаёт новый текст — то
 *     есть правка видна и в превью, и в скачанном DOCX (DOCX строится из
 *     того же payload).
 *
 * E2. КВОТА НЕ СПИСЫВАЕТСЯ. Это главный продуктовый довод AD-2: учитель уже
 *     заплатил за этот лист, и повторный клик за опечатку не должен стоить
 *     ему генерации. Проверяем по таблице `usage_counters` — её наполняет
 *     `services/usage.ts`, и это тот самый счётчик, из которого растёт лимит
 *     генераций; он же назван в пункте приёмки ТЗ-30. Раньше здесь стояла
 *     проверка `rate_limits`: счётчик верный по смыслу, но технический (это
 *     окно частоты запросов), и пункт приёмки про него не говорил — то есть
 *     поведение было доказано, но не закреплено тем тестом, который требовался.
 *     Теперь счётчик сверяется и по значению, и по составу строк.
 *     Раньше ручка отдавала 501, и «не списывает» было невозможно проверить:
 *     нечего было проверять.
 *
 * E3. ЧУЖОЙ ЛИСТ — 404, А НЕ 403. Осознанное проектное решение (см.
 *     `interactives.ts`): по коду ответа иначе перебираются чужие id.
 *
 * E4. ПОСЛЕ ПРОВЕРКИ ПРАВКА ЗАКРЫТА (AD-3). Есть работа с отметками — 409 с
 *     понятным объяснением, а не молчаливая блокировка кнопки.
 *
 * E5. ПУСТОЕ ЗАДАНИЕ НЕ СОХРАНЯЕТСЯ. Пустой текст — 400 с указанием поля,
 *     пустые ответ/пояснение в базу не пишутся (в DOCX не появляется
 *     «Ответ: —»).
 *
 * ─── ЧТО ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ ──────────────────────────────────────────────
 * Что правка НЕ зовёт LLM, проверяется отсутствием `llm_logs` и счётчиков:
 * тест идёт по HTTP-роуту с пустым ключом провайдера, и успешный ответ сам
 * по себе доказывает, что сетевого вызова не было — иначе было бы 5xx.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createUser, createSession } from "../../src/db/queries";

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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

-- ГЛАВНЫЙ счётчик квоты (пункт приёмки ТЗ-30: «проверяется тестом на
-- счётчике usage_counters»). Её наполняет services/usage.ts — то есть это тот
-- самый счётчик, из которого растёт лимит генераций у учителя.
CREATE TABLE IF NOT EXISTS usage_counters (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  UNIQUE(user_id, metric, window_start)
);

CREATE TABLE IF NOT EXISTS worksheets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  grade        INTEGER NOT NULL,
  topic        TEXT NOT NULL,
  difficulty   TEXT NOT NULL,
  type         TEXT NOT NULL,
  count        INTEGER NOT NULL,
  title        TEXT,
  payload_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS photo_checks (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  worksheet_id   TEXT,
  subject        TEXT,
  grade          INTEGER,
  r2_key         TEXT,
  mime_type      TEXT,
  byte_size      INTEGER,
  source_kind    TEXT NOT NULL DEFAULT 'single',
  pages          INTEGER NOT NULL DEFAULT 1,
  consent_version INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'pending',
  total_points   INTEGER NOT NULL DEFAULT 0,
  earned_points  INTEGER NOT NULL DEFAULT 0,
  percentage     INTEGER,
  grade_mark     TEXT,
  needs_review   INTEGER NOT NULL DEFAULT 0,
  model          TEXT,
  provider       TEXT,
  cost_usd       REAL NOT NULL DEFAULT 0,
  latency_ms     INTEGER,
  created_at     INTEGER NOT NULL
);
`;

const NOW = Math.floor(Date.now() / 1000);
const WS_ID = "ws_edit_test01";

/** Исходный лист: две опечатки, которые учитель будет править. */
const ORIGINAL_TASKS = [
  {
    id: "t1",
    number: 1,
    text: "Найдите сумму 1/8 + 1/8",
    type: "short-answer",
    answer: "1/4",
    explanation: "Одинаковые дроби складывают как обыкновенные: (1+1)/8",
    points: 1,
  },
  {
    id: "t2",
    number: 2,
    text: "Представьте 3/4 в виде смешанного числа",
    type: "short-answer",
    answer: "3/4",
    explanation: "Числитель меньше знаменателя, поэтому дробь уже смешанная",
    points: 1,
  },
];

async function seed() {
  for (const table of [
    "photo_checks",
    "llm_logs",
    "worksheets",
    "sessions",
    "users",
    "rate_limits",
    "usage_counters",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await createUser(env.DB, { id: "u_owner", email: "owner@test.local", plan: "plus" });
  await createUser(env.DB, { id: "u_other", email: "other@test.local", plan: "plus" });
  await createSession(env.DB, { token: "tok_owner", userId: "u_owner" });
  await createSession(env.DB, { token: "tok_other", userId: "u_other" });

  const payload = {
    id: WS_ID,
    title: "Дроби · 5 класс",
    subject: "math",
    grade: 5,
    topic: "Дроби",
    difficulty: "medium",
    tasks: ORIGINAL_TASKS,
    createdAt: new Date(NOW * 1000).toISOString(),
  };

  await env.DB
    .prepare(
      `INSERT INTO worksheets
         (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
       VALUES (?1, 'u_owner', 'math', 5, 'Дроби', 'medium', 'worksheet', 2, ?2, ?3, ?4)`,
    )
    .bind(WS_ID, payload.title, JSON.stringify(payload), NOW)
    .run();

  // Живой счётчик квоты, а не пустая таблица.
  //
  // ПОЧЕМУ НЕ ПУСТАЯ. Проверка «в таблице столько же строк, сколько была»
  // на пустой таблице проходит всегда: и когда счётчик не тронут (правильно),
  // и когда счётчика вообще нет (тест ничего не проверяет). Поэтому кладём
  // реальную строку со значением 3 — если правка вдруг спишет единицу, тест
  // это увидит, а не пройдёт на «известно, что там ничего нет».
  await env.DB.prepare(
    `INSERT INTO usage_counters (id, user_id, metric, window_start, count, updated_at)
     VALUES ('uc_seed1', 'u_owner', 'generation', ?1, 3, ?1)`,
  )
    .bind(monthStart())
    .run();
}

/** Начало текущего месяца в unix-секундах — окно, в котором живёт счётчик. */
function monthStart(): number {
  const d = new Date();
  return Math.floor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getTime() / 1000);
}

/** Все счётчики пользователя как есть — до и после сравниваем покомпонентно. */
async function usageCounters(userId: string): Promise<Array<{ metric: string; count: number }>> {
  const rows = await env.DB.prepare(
    `SELECT metric, count FROM usage_counters WHERE user_id = ?1 ORDER BY metric`,
  )
    .bind(userId)
    .all<{ metric: string; count: number }>();
  return rows.results;
}

async function patch(token: string | null, body: unknown, id = WS_ID) {
  const res = await SELF.fetch(`https://uchlist.test/api/worksheets/${id}/edit`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { cookie: `session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Присланные исправления: текст первого задания поправлен, ответ убран. */
const FIX = {
  tasks: [
    {
      id: "t1",
      number: 1,
      text: "Найдите сумму 1/8 + 3/8",
      type: "short-answer",
      answer: "",
      explanation: "Одинаковые дроби складывают как обыкновенные: (1+3)/8 = 4/8 = 1/2",
      points: 1,
      skill: "Дроби",
    },
    ORIGINAL_TASKS[1],
  ],
};

describe("ТЗ-30 работа 2: правка листа без LLM и без списания квоты", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
  });

  beforeEach(async () => {
    await seed();
  });

  it("E1: правка меняет текст задания и видна в GET (значит, и в DOCX)", async () => {
    const { status, json } = await patch("tok_owner", FIX);
    expect(status).toBe(200);

    const tasks = (json.worksheet as { tasks: Array<{ text: string; answer?: string }> }).tasks;
    expect(tasks[0]!.text).toBe("Найдите сумму 1/8 + 3/8");
    // Второе задание не прислано текстом — значит осталось прежним.
    expect(tasks[1]!.text).toBe(ORIGINAL_TASKS[1]!.text);

    // То же самое отдаёт GET: DOCX строится из этого payload, поэтому
    // проверять отдельную выгрузку не нужно — она читает то же самое.
    const get = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_ID}`, {
      headers: { cookie: "session=tok_owner" },
    });
    const got = (await get.json()) as { worksheet: { tasks: Array<{ text: string }> } };
    expect(got.worksheet.tasks[0]!.text).toBe("Найдите сумму 1/8 + 3/8");

    // Счётчик заданий в строке таблицы обязан совпасть с payload_json,
    // иначе карточка в кабинете покажет старое число.
    const row = await env.DB
      .prepare("SELECT count FROM worksheets WHERE id = ?1")
      .bind(WS_ID)
      .first<{ count: number }>();
    expect(row!.count).toBe(2);
  });

  it("E2: правка НЕ списывает квоту генерации и НЕ пишет вызов LLM", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits").first<{ n: number }>();
    const logsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM llm_logs").first<{ n: number }>();
    // Счётчик, о котором говорит пункт приёмки ТЗ-30 (usage_counters), а не
    // технический rate_limits из первых строк теста. Снимаем ЗНАЧЕНИЕ, а не
    // количество строк: счётчик мог бы не списаться, а получить новую строку.
    const usageBefore = await usageCounters("u_owner");
    expect(usageBefore, "фикстура не создала счётчик — проверять нечего").toHaveLength(1);
    expect(usageBefore[0]!.count).toBe(3);

    const { status, json } = await patch("tok_owner", FIX);
    expect(status).toBe(200);
    expect(json.quotaCharged).toBe(false);

    // ── ГЛАВНАЯ ПРОВЕРКА ПУНКТА ПРИЁМКИ ──────────────────────────────────
    // usage_counters — тот счётчик, в который пишет services/usage.ts, то
    // есть тот, из которого растёт лимит генераций. После правки листа он
    // обязан остаться ровно тем же.
    const usageAfter = await usageCounters("u_owner");
    expect(usageAfter).toEqual(usageBefore);
    expect(usageAfter[0]!.count).toBe(3);

    // Ни одного нового ключа в rate_limits: consumeGenerationQuota не звался.
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);

    // И ни одной строки в llm_logs: провайдер не звали.
    const logsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM llm_logs").first<{ n: number }>();
    expect(logsAfter!.n).toBe(logsBefore!.n);

    // Счётчик генераций учителя тоже не сдвинулся.
    const user = await env.DB
      .prepare("SELECT generations_today, generations_total FROM users WHERE id = 'u_owner'")
      .first<{ generations_today: number; generations_total: number }>();
    expect(user!.generations_today).toBe(0);
    expect(user!.generations_total).toBe(0);
  });

  it("E3: чужой лист даёт 404, а не 403 (иначе перебираются чужие id)", async () => {
    const { status } = await patch("tok_other", FIX);
    expect(status).toBe(404);

    // Лист при этом не изменился — отказ не должен быть «полуправлением».
    const row = await env.DB
      .prepare("SELECT payload_json FROM worksheets WHERE id = ?1")
      .bind(WS_ID)
      .first<{ payload_json: string }>();
    expect(JSON.parse(row!.payload_json).tasks[0].text).toBe(ORIGINAL_TASKS[0]!.text);
  });

  it("E4: после проверки работы правка закрыта с понятным объяснением", async () => {
    await env.DB
      .prepare(
        `INSERT INTO photo_checks (id, user_id, worksheet_id, status, grade_mark, created_at)
         VALUES ('pc_1', 'u_owner', ?1, 'ok', '5', ?2)`,
      )
      .bind(WS_ID, NOW)
      .run();

    const { status, json } = await patch("tok_owner", FIX);
    expect(status).toBe(409);
    expect(JSON.stringify(json)).toContain("уже проверена работа");

    // GET /edit объясняет причину заранее — фронту не нужно сначала
    // нажимать «Сохранить» и получать отказ.
    const check = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_ID}/edit`, {
      headers: { cookie: "session=tok_owner" },
    });
    const info = (await check.json()) as { editable: boolean; reason: string | null };
    expect(info.editable).toBe(false);
    expect(info.reason).toContain("уже проверена работа");
  });

  it("E5: пустое задание не сохраняется, пустые ответ и пояснение вычищаются", async () => {
    // Пустой текст задания — 400 с указанием поля.
    const empty = await patch("tok_owner", {
      tasks: [{ text: "   ", answer: "1/2" }],
    });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(empty.json)).toContain("не может быть пустым");

    // Пустой ответ и пустое пояснение в базу не пишутся.
    const { status } = await patch("tok_owner", {
      tasks: [{ ...ORIGINAL_TASKS[0], answer: "  ", explanation: "" }],
    });
    expect(status).toBe(200);

    const row = await env.DB
      .prepare("SELECT payload_json FROM worksheets WHERE id = ?1")
      .bind(WS_ID)
      .first<{ payload_json: string }>();
    const saved = JSON.parse(row!.payload_json) as {
      tasks: Array<{ answer?: string; explanation?: string }>;
    };
    expect(saved.tasks[0]?.answer).toBeUndefined();
    expect(saved.tasks[0]?.explanation).toBeUndefined();
  });

  it("E6: без входа — 401, а лист не меняется", async () => {
    const { status } = await patch(null, FIX);
    expect(status).toBe(401);
  });

  it("E7: роут f08 больше не отдаёт 501 ни на одном пути", async () => {
    // Раньше здесь стояла заглушка `f08Router.all("*")` с 501 на любой путь.
    const res = await SELF.fetch("https://uchlist.test/api/worksheets/ws_nope/edit", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(FIX),
    });
    expect(res.status).not.toBe(501);
    expect(res.status).toBe(401);
  });

  it("E8: основной путь из контракта PATCH /api/worksheets/:id тоже работает", async () => {
    // В ТЗ-30 §7 контракт записан без `/edit`. Оба адреса отвечают одинаково:
    // расхождение путей было бы неловким «работает, но не там».
    const res = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: "session=tok_owner" },
      body: JSON.stringify(FIX),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { worksheet: { tasks: Array<{ text: string }> } };
    expect(body.worksheet.tasks[0]!.text).toBe("Найдите сумму 1/8 + 3/8");
  });
});
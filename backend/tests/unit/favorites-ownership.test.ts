/**
 * Избранное не должно открывать чужой приватный материал.
 *
 * Два независимых источника требований, слитых в один файл:
 *
 * 1. UL-D01 (аудит T01) — чужой лист это 404, а не 403. Тот же принцип, что у
 *    GET /api/worksheets/:id: по коду ответа нельзя перебирать чужие id. Раньше
 *    POST /api/users/favorites отдавал 200 и создавал связь favorites(B, wsA), а
 *    GET /api/users/favorites отдавал B полный payload листа A.
 *
 * 2. Находка №4 ревью безопасности от 30.10.2026 — POST /api/users/favorites
 *    проверял только «существует ли лист с таким id», но не «чей это лист».
 *
 * ─── ЧТО ЛОВИТ ЭТОТ ФАЙЛ ──────────────────────────────────────────────────
 *
 * D1. ЧУЖОЙ ЛИСТ — 404, А НЕ 403.
 * D2. ЧУЖОЙ PAYLOAD НЕ ВЫДАЁТСЯ В СПИСКЕ. Даже если связь уже есть в базе
 *     (заведённая до починки, руками, чужим импортом) — список обязан её
 *     отфильтровать. Проверяются оба пути listFavorites: с курсором и без.
 * D3. СВОЁ РАБОТАЕТ КАК РАНЬШЕ. Свой лист добавляется дважды — связь одна и
 *     содержимое прежнее. Импорт нового payload сохраняется под своим
 *     владельцем. Анонимный лист (user_id IS NULL) остаётся доступным.
 * D4. ТЕЛО ЗАПРОСА. Без tasks — 400, а не 500. Поля листа (text_latex, skill,
 *     chartSpec, isDemo) не теряются на пути в payload_json и обратно.
 *
 * ─── ГРАНИЦЫ ТЕСТА ────────────────────────────────────────────────────────
 * Синтетические данные: два пользователя, один лист, никаких чужих материалов
 * и никаких детей. Провайдеры не зовутся — тест работает с D1 напрямую.
 *
 * Две обвязки в одном файле намеренно:
 *   • через SELF.fetch + cookie-сессию — как ходит настоящий клиент;
 *   • через app.fetch + заголовок X-Session-Token — как в auth.test.ts.
 * Наборы тестов независимы и не делят состояние: у первого своя подготовка
 * (beforeEach), у второго пользователи заводятся внутри самого теста.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "../../src/db/schema.sql?raw";
import { createSession, createUser } from "../../src/db/queries";
import { listFavorites } from "../../src/db/userResources";
import { app } from "../../src/index";
import type { Env } from "../../src/env";

const OWNER = "u_owner_fav";
const OTHER = "u_other_fav";
const TOK_OWNER = "tok_owner_fav";
const TOK_OTHER = "tok_other_fav";

const WS_OWNED = "ws_owned_fav_001";
const WS_ANON = "ws_anon_fav_002";

const NOW = Math.floor(Date.now() / 1000);

/** Заголовок листа A — по нему проверяем, что payload A нигде не утёк. */
const SECRET_TITLE = "Тайный лист учителя A — дроби";
const SECRET_TASK_TEXT = "Решите уравнение с секретным числом 4242";

function makePayload(id: string, title: string, text: string) {
  return {
    id,
    title,
    subject: "math",
    grade: 5,
    topic: "Дроби",
    difficulty: "medium",
    tasks: [
      {
        id: "t1",
        number: 1,
        text,
        type: "short-answer",
        answer: "1/2",
        explanation: "Складываем дроби с одинаковым знаменателем",
        points: 1,
      },
    ],
    createdAt: new Date(NOW * 1000).toISOString(),
  };
}

async function insertWorksheet(
  id: string,
  userId: string | null,
  title: string,
  text: string,
  createdAt: number,
) {
  const payload = makePayload(id, title, text);
  await env.DB
    .prepare(
      `INSERT INTO worksheets
         (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
       VALUES (?1, ?2, 'math', 5, 'Дроби', 'medium', 'worksheet', 1, ?3, ?4, ?5)`,
    )
    .bind(id, userId, title, JSON.stringify(payload), createdAt)
    .run();
}

async function seed() {
  for (const table of ["favorites", "worksheets", "sessions", "users"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await createUser(env.DB, { id: OWNER, email: "owner-fav@test.local", plan: "plus" });
  await createUser(env.DB, { id: OTHER, email: "other-fav@test.local", plan: "plus" });
  await createSession(env.DB, { token: TOK_OWNER, userId: OWNER });
  await createSession(env.DB, { token: TOK_OTHER, userId: OTHER });

  // Приватный лист учителя A.
  await insertWorksheet(WS_OWNED, OWNER, SECRET_TITLE, SECRET_TASK_TEXT, NOW - 10);
  // Анонимный лист (user_id IS NULL) — по текущему контракту он доступен всем
  // по прямой ссылке, поэтому в избранное его добавлять можно.
  await insertWorksheet(WS_ANON, null, "Анонимный лист", "Открытая задача", NOW - 5);
}

async function postFavorite(token: string, worksheet: unknown) {
  const res = await SELF.fetch("https://uchlist.test/api/users/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `session=${token}` },
    body: JSON.stringify({ worksheet }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getFavorites(token: string) {
  const res = await SELF.fetch("https://uchlist.test/api/users/favorites", {
    headers: { cookie: `session=${token}` },
  });
  return { status: res.status, raw: await res.text() };
}

async function countFavorites(userId: string): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?1")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Окружение для запросов — development.
 *
 * Именно development: в проде без RESEND_API_KEY вход по magic-link не
 * работает. Само вхождение здесь не нужно — пользователя и сессию мы заводим
 * прямо в D1, — но окружение должно совпадать с локальным.
 */
function devEnv(): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "development",
    ALLOW_DEV_MAGIC_URL: "true",
    // Тестовая среда — не опубликованный воркер.
    ALLOW_INSECURE_MODES: "true",
  };
}

const db = () => (env as unknown as { DB: D1Database }).DB;

/** Завести учителя и его сессию (как в auth.test.ts). */
async function seedUser(email: string): Promise<{ id: string; sessionToken: string }> {
  const userId = `usr_${crypto.randomUUID()}`;
  const sessionToken = `sess_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);

  await db()
    .prepare(
      `INSERT INTO users (id, email, name, plan, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'free', ?4, ?5)`,
    )
    .bind(userId, email, `Учитель ${email}`, now, now)
    .run();
  await db()
    .prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(sessionToken, userId, now + 86400, now)
    .run();

  return { id: userId, sessionToken };
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers["X-Session-Token"] = init.token;

  return app.fetch(
    new Request(`https://api.test${path}`, {
      method: init.method ?? "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    devEnv() as never,
  );
}

/** Лист, который фронт кладёт в избранное. */
function worksheet(id: string, topic = "Дроби") {
  return {
    id,
    title: "Лист по математике",
    subject: "math",
    grade: 5,
    topic,
    difficulty: "medium",
    createdAt: new Date().toISOString(),
    tasks: [
      {
        number: 1,
        text: "Сложите 1/2 и 1/3",
        type: "computation",
        answer: "5/6",
        points: 2,
      },
    ],
  };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "favorites-ownership", queries: [schemaSql] }]);
});

describe("UL-D01: избранное не открывает чужой приватный лист", () => {
  beforeEach(async () => {
    await seed();
  });

  it("D1a: прямой GET чужого листа — 404 (регрессия существующей защиты)", async () => {
    const res = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_OWNED}`, {
      headers: { cookie: `session=${TOK_OTHER}` },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SECRET_TITLE);
  });

  it("D1b: POST favorites с чужим id — 404 и НИКАКОЙ связи в базе", async () => {
    const { status } = await postFavorite(TOK_OTHER, makePayload(WS_OWNED, SECRET_TITLE, SECRET_TASK_TEXT));
    expect(status).toBe(404);
    expect(await countFavorites(OTHER)).toBe(0);
  });

  it("D1c: чужой payload не утекает и через POST с подменённым содержимым", async () => {
    // Клиент подмешивает «своё» содержимое — сервер всё равно не должен
    // ни отдать чужой лист, ни перезаписать его payload.
    const { status } = await postFavorite(TOK_OTHER, {
      ...makePayload(WS_OWNED, "Подмена заголовка", "Подмена текста"),
    });
    expect(status).toBe(404);

    const row = await env.DB
      .prepare("SELECT title, payload_json FROM worksheets WHERE id = ?1")
      .bind(WS_OWNED)
      .first<{ title: string; payload_json: string }>();
    expect(row?.title).toBe(SECRET_TITLE);
    expect(row?.payload_json).toContain(SECRET_TASK_TEXT);
    expect(row?.payload_json).not.toContain("Подмена заголовка");
  });

  it("D2a: заранее заведённая чужая связь не выдаётся в списке (без курсора)", async () => {
    await env.DB
      .prepare(
        `INSERT INTO favorites (id, user_id, worksheet_id, created_at)
         VALUES ('fav_bad_001', ?1, ?2, ?3)`,
      )
      .bind(OTHER, WS_OWNED, NOW)
      .run();

    const { status, raw } = await getFavorites(TOK_OTHER);
    expect(status).toBe(200);
    expect(raw).not.toContain(SECRET_TITLE);
    expect(raw).not.toContain(SECRET_TASK_TEXT);
    expect(raw).not.toContain(WS_OWNED);
  });

  it("D2b: та же чужая связь не выдаётся listFavorites с курсором", async () => {
    await env.DB
      .prepare(
        `INSERT INTO favorites (id, user_id, worksheet_id, created_at)
         VALUES ('fav_bad_002', ?1, ?2, ?3)`,
      )
      .bind(OTHER, WS_OWNED, NOW)
      .run();

    // Прямой вызов функции с курсором — тем же кодом, что и роут.
    const result = await listFavorites(env.DB, OTHER, 50, NOW + 1);
    expect(result.items).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(SECRET_TITLE);
    expect(JSON.stringify(result)).not.toContain(SECRET_TASK_TEXT);
  });

  it("D3a: свой лист добавляется дважды — одна связь и прежнее содержимое", async () => {
    const first = await postFavorite(TOK_OWNER, makePayload(WS_OWNED, SECRET_TITLE, SECRET_TASK_TEXT));
    expect(first.status).toBe(200);
    expect(first.json.alreadyFavorited).toBe(false);

    const second = await postFavorite(TOK_OWNER, makePayload(WS_OWNED, SECRET_TITLE, SECRET_TASK_TEXT));
    expect(second.status).toBe(200);
    expect(second.json.alreadyFavorited).toBe(true);
    expect(second.json.favoriteId).toBe(first.json.favoriteId);

    expect(await countFavorites(OWNER)).toBe(1);

    const { status, raw } = await getFavorites(TOK_OWNER);
    expect(status).toBe(200);
    expect(raw).toContain(SECRET_TITLE);
  });

  it("D3b: импорт нового payload сохраняется под своим владельцем", async () => {
    const payload = makePayload("ws_imported_fav_003", "Импортированный лист", "Задача импорта");
    const { status, json } = await postFavorite(TOK_OTHER, payload);
    expect(status).toBe(200);
    expect(json.worksheetId).toBe("ws_imported_fav_003");

    const row = await env.DB
      .prepare("SELECT user_id FROM worksheets WHERE id = ?1")
      .bind("ws_imported_fav_003")
      .first<{ user_id: string | null }>();
    expect(row?.user_id).toBe(OTHER);
  });

  it("D3c: анонимный лист по текущему контракту добавляется в избранное", async () => {
    const { status } = await postFavorite(TOK_OTHER, makePayload(WS_ANON, "Анонимный лист", "Открытая задача"));
    expect(status).toBe(200);
    expect(await countFavorites(OTHER)).toBe(1);

    const { status: listStatus, raw } = await getFavorites(TOK_OTHER);
    expect(listStatus).toBe(200);
    expect(raw).toContain("Анонимный лист");
  });

  it("D3d: два независимых пользователя не обходят проверку друг друга", async () => {
    // A добавляет свой лист, B пытается добавить тот же id.
    const own = await postFavorite(TOK_OWNER, makePayload(WS_OWNED, SECRET_TITLE, SECRET_TASK_TEXT));
    expect(own.status).toBe(200);

    const stolen = await postFavorite(TOK_OTHER, makePayload(WS_OWNED, SECRET_TITLE, SECRET_TASK_TEXT));
    expect(stolen.status).toBe(404);
    expect(await countFavorites(OTHER)).toBe(0);

    // У B список пуст — чужого payload нет.
    const { raw } = await getFavorites(TOK_OTHER);
    expect(raw).not.toContain(SECRET_TITLE);
  });
});

describe("избранное: чужой лист положить нельзя", () => {
  it("учитель Б получает 404 на лист учителя А", async () => {
    const a = await seedUser("a-owner@example.com");
    const b = await seedUser("b-other@example.com");

    // Учитель А добавляет свой лист.
    const created = await call("/api/users/favorites", {
      body: { worksheet: worksheet("ws-owner-a") },
      token: a.sessionToken,
    });
    expect(created.status).toBe(200);

    // Учитель Б пытается положить тот же лист в избранное.
    const attempt = await call("/api/users/favorites", {
      body: { worksheet: worksheet("ws-owner-a") },
      token: b.sessionToken,
    });
    expect(attempt.status).toBe(404);
  });

  it("в избранном учителя Б нет листа учителя А", async () => {
    const a = await seedUser("a-list@example.com");
    const b = await seedUser("b-list@example.com");

    await call("/api/users/favorites", {
      body: { worksheet: worksheet("ws-list-a") },
      token: a.sessionToken,
    });
    // Попытка учителя Б — чтобы проверить не только ответ, но и результат.
    await call("/api/users/favorites", {
      body: { worksheet: worksheet("ws-list-a") },
      token: b.sessionToken,
    });

    const list = await call("/api/users/favorites", {
      method: "GET",
      token: b.sessionToken,
    });
    const body = (await list.json()) as { items: Array<{ worksheetId: string }> };

    expect(list.status).toBe(200);
    expect(body.items.map((item) => item.worksheetId)).not.toContain("ws-list-a");
  });

  it("учитель А свой лист добавить может", async () => {
    const a = await seedUser("a-own@example.com");

    const res = await call("/api/users/favorites", {
      body: { worksheet: worksheet("ws-own-a") },
      token: a.sessionToken,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; worksheetId: string };
    expect(body.ok).toBe(true);
    expect(body.worksheetId).toBe("ws-own-a");
  });

  it("лист, которого ещё нет в базе, добавляется — обычный сценарий", async () => {
    const b = await seedUser("b-new@example.com");

    const res = await call("/api/users/favorites", {
      body: { worksheet: worksheet("ws-brand-new") },
      token: b.sessionToken,
    });

    expect(res.status).toBe(200);
  });

  it("анонимный лист (без владельца) добавляется — его не у кого отнимать", async () => {
    const b = await seedUser("b-anon@example.com");
    const now = Math.floor(Date.now() / 1000);

    // Лист, созданный анонимной генерацией: владельца нет.
    await db()
      .prepare(
        `INSERT INTO worksheets
          (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
         VALUES (?1, NULL, 'math', 5, 'Дроби', 'medium', 'worksheet', 1, 'Лист', ?2, ?3)`,
      )
      .bind("ws-anonymous", JSON.stringify(worksheet("ws-anonymous")), now)
      .run();

    const res = await call("/api/users/favorites", {
      body: { worksheet: worksheet("ws-anonymous") },
      token: b.sessionToken,
    });

    expect(res.status).toBe(200);
  });

  it("тело без tasks получает 400, а не 500", async () => {
    const b = await seedUser("b-bad-body@example.com");

    const res = await call("/api/users/favorites", {
      body: { worksheet: { id: "ws-no-tasks", title: "Без заданий", subject: "math", grade: 5 } },
      token: b.sessionToken,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("поля листа не теряются: text_latex, skill, chartSpec, isDemo", async () => {
    // Регрессия, которую вносит любая zod-схема: неизвестные ключи по
    // умолчанию выбрасываются, а payload_json читается обратно — и потерянное
    // поле теряется навсегда (дробь печатается в одну строку, водяной знак
    // «заготовка» пропадает).
    const b = await seedUser("b-fields@example.com");

    const res = await call("/api/users/favorites", {
      body: {
        worksheet: {
          ...worksheet("ws-fields"),
          isDemo: true,
          chartSpec: { kind: "bar", values: [1, 2, 3] },
          tasks: [
            {
              ...worksheet("ws-fields").tasks[0],
              text_latex: "Сократите дробь: $\\frac{8}{12}$",
              skill: "Давление твёрдых тел",
            },
          ],
        },
      },
      token: b.sessionToken,
    });
    expect(res.status).toBe(200);

    const list = await call("/api/users/favorites", { method: "GET", token: b.sessionToken });
    const body = (await list.json()) as {
      items: Array<{ worksheet: { isDemo?: boolean; chartSpec?: unknown; tasks: Array<Record<string, unknown>> } }>;
    };
    const saved = body.items.find((item) => item.worksheet.tasks.length > 0)?.worksheet;

    expect(saved?.isDemo).toBe(true);
    expect(saved?.chartSpec).toEqual({ kind: "bar", values: [1, 2, 3] });
    expect(saved?.tasks[0]?.text_latex).toBe("Сократите дробь: $\\frac{8}{12}$");
    expect(saved?.tasks[0]?.skill).toBe("Давление твёрдых тел");
  });
});

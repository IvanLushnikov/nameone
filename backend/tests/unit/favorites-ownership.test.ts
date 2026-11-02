/**
 * UL-D01 (аудит T01): избранное не должно открывать чужой приватный материал.
 *
 * ─── ЧТО ЛОВИТ ЭТОТ ФАЙЛ ──────────────────────────────────────────────────
 *
 * D1. ЧУЖОЙ ЛИСТ — 404, А НЕ 403. Тот же принцип, что у GET /api/worksheets/:id:
 *     по коду ответа нельзя перебирать чужие id. Раньше POST /api/users/favorites
 *     отдавал 200 и создавал связь favorites(B, wsA), а GET /api/users/favorites
 *     отдавал B полный payload листа A.
 *
 * D2. ЧУЖОЙ PAYLOAD НЕ ВЫДАЁТСЯ В СПИСКЕ. Даже если связь уже есть в базе
 *     (заведённая до починки, руками, чужим импортом) — список обязан её
 *     отфильтровать. Проверяется оба пути listFavorites: с курсором и без.
 *
 * D3. СВОЁ РАБОТАЕТ КАК РАНЬШЕ. Свой лист добавляется дважды — связь одна и
 *     содержимое прежнее. Импорт нового payload сохраняется под своим
 *     владельцем. Анонимный лист (user_id IS NULL) остаётся доступным.
 *
 * ─── ГРАНИЦЫ ТЕСТА ────────────────────────────────────────────────────────
 * Синтетические данные: два пользователя, один лист, никаких чужих материалов
 * и никаких детей. Провайдеры не зовутся — тест работает с D1 напрямую.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "../../src/db/schema.sql?raw";
import { createSession, createUser } from "../../src/db/queries";
import { listFavorites } from "../../src/db/userResources";

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

describe("UL-D01: избранное не открывает чужой приватный лист", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [schemaSql] }]);
  });

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

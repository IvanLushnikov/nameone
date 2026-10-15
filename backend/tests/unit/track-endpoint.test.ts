/**
 * ТЗ-24, лист-1: /api/track принимает событие и кладёт его в `events`.
 *
 * Проверяем не «вернулся ли 200», а две вещи, которые ломаются чаще всего:
 *
 *   1. Событие действительно ЛЕЖИТ в базе, а не просто съедено без ошибки.
 *   2. В базу не попало то, чего там быть не должно — а именно персональные
 *      данные и неизвестные имена событий.
 *
 * Пункт 2 — отрицательная проверка, поэтому у каждой отрицательной проверки
 * есть ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: в том же запросе кладём разрешённое поле и
 * убеждаемся, что оно доехало. Иначе тест «email не записался» проходил бы
 * тривиально — потому что не записалось вообще ничего.
 *
 * D1 реальная (workerd-pool). Схема продублирована прямо здесь: workerd не даёт
 * читать fs (см. шапку tests/unit/auth.test.ts).
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

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

CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  data_json   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at);
`;

async function postTrack(body: unknown) {
  return SELF.fetch("https://uchlist.test/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Строки событий по имени — для проверок содержимого. */
async function rowsByName(name: string) {
  const res = await env.DB.prepare(
    `SELECT id, user_id, name, data_json, created_at FROM events WHERE name = ?1 ORDER BY created_at DESC`,
  )
    .bind(name)
    .all<{ id: string; user_id: string | null; name: string; data_json: string | null }>();
  return res.results ?? [];
}

async function countEvents(): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events`).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeAll(async () => {
  // applyD1Migrations, а не DB.exec: exec не умеет многострочный SQL и роняется
  // на первом же CREATE (см. tests/unit/auth.test.ts).
  await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
});

describe("/api/track — событие доходит до базы", () => {
  it("валидное событие лежит в events с правильным именем и данными", async () => {
    const before = await countEvents();

    const res = await postTrack({
      name: "constructor_view",
      data: { mode: "list", grade: 7, subject: "math" },
    });

    expect(res.status).toBe(204);
    expect(await countEvents()).toBe(before + 1);

    const rows = await rowsByName("constructor_view");
    const written = rows[0];
    expect(written).toBeDefined();

    const data = JSON.parse(written!.data_json ?? "{}");
    expect(data.mode).toBe("list");
    expect(data.grade).toBe(7);
    expect(data.subject).toBe("math");
  });

  it("анонимное событие пишется с пустым user_id — по нему строится воронка до входа", async () => {
    const before = await countEvents();

    const res = await postTrack({ name: "login_view", data: {} });

    expect(res.status).toBe(204);
    expect(await countEvents()).toBe(before + 1);
    const rows = await rowsByName("login_view");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("событие от пользователя с сессией привязывается к user_id", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, plan, is_admin, created_at, updated_at)
       VALUES ('u_track_1', 'track@test.local', 'Track', 'free', 0, ?1, ?1)`,
    )
      .bind(now)
      .run();
    await env.DB.prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at)
       VALUES ('tok_track_1', 'u_track_1', ?1, ?1)`,
    )
      .bind(now + 3600)
      .run();

    const res = await SELF.fetch("https://uchlist.test/api/track", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=tok_track_1" },
      body: JSON.stringify({ name: "dashboard_view", data: { subsection: "history" } }),
    });

    expect(res.status).toBe(204);
    const rows = await rowsByName("dashboard_view");
    expect(rows[0]?.user_id).toBe("u_track_1");
  });
});

describe("/api/track — белый список", () => {
  it("неизвестное имя события не пишется (контроль: известное — пишется)", async () => {
    const before = await countEvents();

    const bad = await postTrack({ name: "totally_made_up_event", data: { a: 1 } });
    expect(bad.status).toBe(400);

    // Положительный контроль: соседний запрос с известным именем обязан записаться.
    const good = await postTrack({ name: "paywall_open", data: { plan: "plus" } });
    expect(good.status).toBe(204);

    // Ровно одна новая строка — от «хорошего» события.
    expect(await countEvents()).toBe(before + 1);
    expect((await rowsByName("totally_made_up_event")).length).toBe(0);
  });

  it("поля вне белого списка выбрасываются (контроль: разрешённое поле доезжает)", async () => {
    const res = await postTrack({
      name: "photo_check_done",
      data: {
        source: "photo", // разрешённое — обязано сохраниться
        email: "ilushnikov98@icloud.com", // персональные данные — не должны
        userName: "Иван",
        sessionToken: "tok_track_1",
        nested: { a: { b: 1 } },
      },
    });

    expect(res.status).toBe(204);

    const rows = await rowsByName("photo_check_done");
    const raw = rows[0]?.data_json ?? "";
    const data = JSON.parse(raw);

    // Положительный контроль: событие записалось и разрешённое поле на месте.
    expect(data.source).toBe("photo");

    // Отрицательные: ни в JSON, ни в сырой строке нет следов персональных данных.
    expect(data.email).toBeUndefined();
    expect(data.userName).toBeUndefined();
    expect(data.sessionToken).toBeUndefined();
    expect(data.nested).toBeUndefined();
    expect(raw).not.toContain("icloud.com");
    expect(raw).not.toContain("tok_track_1");
  });

  it("вложенные объекты и массивы не принимаются", async () => {
    const res = await postTrack({
      name: "constructor_step",
      data: { from: 1, to: 2, payload: [1, 2, 3], obj: { deep: true } },
    });

    expect(res.status).toBe(204);
    const rows = await rowsByName("constructor_step");
    const data = JSON.parse(rows[0]?.data_json ?? "{}");

    expect(data.from).toBe(1);
    expect(data.to).toBe(2);
    expect(data.payload).toBeUndefined();
    expect(data.obj).toBeUndefined();
  });

  it("слишком длинная строка обрезается", async () => {
    const long = "я".repeat(500);
    const res = await postTrack({ name: "worksheet_edit_apply", data: { error: long } });

    expect(res.status).toBe(204);
    const rows = await rowsByName("worksheet_edit_apply");
    const data = JSON.parse(rows[0]?.data_json ?? "{}");
    expect(typeof data.error).toBe("string");
    expect((data.error as string).length).toBe(120);
  });

  it("пустое тело и не-JSON не роняют эндпоинт, а отвечают 400", async () => {
    expect((await postTrack({})).status).toBe(400);
    expect((await postTrack({ data: { a: 1 } })).status).toBe(400);

    const res = await SELF.fetch("https://uchlist.test/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    expect(res.status).toBe(400);
  });
});

describe("/api/track — семантика адресов", () => {
  it("чужие адреса под /api по-прежнему дают 404, а не 501", async () => {
    const res = await SELF.fetch("https://uchlist.test/api/definitely-not-here", {
      method: "GET",
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/track не принимается — событие только методом POST", async () => {
    const res = await SELF.fetch("https://uchlist.test/api/track", { method: "GET" });
    expect(res.status).toBe(404);
  });
});

describe("итог листа-1", () => {
  it("TRACK_EVENT_PERSISTED — событие физически лежит в базе", async () => {
    const before = await countEvents();
    const res = await postTrack({ name: "dashboard_template_saved", data: { from: "constructor" } });
    expect(res.status).toBe(204);
    expect(await countEvents()).toBe(before + 1);
    expect((await rowsByName("dashboard_template_saved")).length).toBeGreaterThan(0);
    console.log("TRACK_EVENT_PERSISTED");
  });

  it("TRACK_ALLOWLIST_ENFORCED — персональные данные не попадают в базу", async () => {
    const res = await postTrack({
      name: "share_form_created",
      data: { email: "ilushnikov98@icloud.com", hasCode: true },
    });
    expect(res.status).toBe(204);
    const rows = await rowsByName("share_form_created");
    const raw = rows[0]?.data_json ?? "";
    expect(raw).not.toContain("icloud.com");
    // Положительный контроль в том же событии: разрешённое поле на месте.
    expect(JSON.parse(raw).hasCode).toBe(true);
    console.log("TRACK_ALLOWLIST_ENFORCED");
  });
});
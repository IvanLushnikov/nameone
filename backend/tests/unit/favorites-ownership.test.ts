/**
 * Чужой рабочий лист в избранном — находка №4 ревью безопасности от 30.10.2026.
 *
 * Что было сломано: `POST /api/users/favorites` проверял только «существует ли
 * лист с таким id», но не «чей это лист». Учитель Б мог положить в избранное
 * лист учителя А, и `GET /api/users/favorites` отдавал ему payload листа А —
 * со всеми заданиями и ответами.
 *
 * Тест проверяет ровно тот сценарий, который был в ревью: два разных
 * учителя, лист одного и попытка положить его в избранное другого.
 */
/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../../src/index";
import type { Env } from "../../src/env";

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "sec-favorites-owner", queries: [schemaSql] }]);
});

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

/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * Тесты учительского бэкенда форм (TZ-12, этап 1) — `routes/f07.ts`.
 *
 *   F1. POST /forms без входа → 401
 *   F2. POST /forms с payload → 201, formId/token/url, check_mode по составу заданий
 *   F3. GET /forms → список только своих форм + счётчики ответов
 *   F4. GET /forms/:id → форма + drill-down по ответам ученика
 *   F5. Чужая форма → 404 (не 403 — не подсказываем, что она существует)
 *   F6. PATCH close → публичная ссылка перестаёт работать (410)
 *   F7. PATCH rotate-token → старый токен мёртв, новый живой, ответы сохранены
 *   F8. export.csv → UTF-8 BOM, разделитель `;`, attachment-заголовок
 *   F9. DELETE → форма и ответы исчезают (каскад)
 *
 * Схема D1 зашита в SCHEMA_SQL (workerd не умеет fs.readFileSync).
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Env } from "../../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

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

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL, grade INTEGER NOT NULL, topic TEXT NOT NULL,
  difficulty TEXT NOT NULL, type TEXT NOT NULL, count INTEGER NOT NULL,
  title TEXT, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forms (
  id             TEXT PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worksheet_id   TEXT,
  title          TEXT NOT NULL,
  subject        TEXT NOT NULL,
  grade          INTEGER NOT NULL,
  payload_json   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  access_code    TEXT,
  expires_at     INTEGER NOT NULL,
  closed_at      INTEGER,
  show_answers   INTEGER NOT NULL DEFAULT 0,
  check_mode     TEXT NOT NULL DEFAULT 'auto',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS form_responses (
  id              TEXT PRIMARY KEY,
  form_id         TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  student_name    TEXT NOT NULL,
  student_label   TEXT,
  score_total     INTEGER NOT NULL DEFAULT 0,
  score_max       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'submitted',
  duration_sec    INTEGER,
  ip_hash         TEXT,
  user_agent      TEXT,
  started_at      INTEGER,
  submitted_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS form_answers (
  id              TEXT PRIMARY KEY,
  response_id     TEXT NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,
  task_number     INTEGER NOT NULL,
  task_type       TEXT NOT NULL,
  student_answer  TEXT,
  is_correct      INTEGER,
  points_awarded  INTEGER NOT NULL DEFAULT 0,
  points_max      INTEGER NOT NULL DEFAULT 0,
  needs_review    INTEGER NOT NULL DEFAULT 0,
  check_method    TEXT NOT NULL,
  check_meta_json TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

-- 2026-10-02: роли (teacher/student). Живёт отдельной таблицей, а не колонкой в
-- users: миграция это повторный прогон schema.sql, а ALTER TABLE ADD COLUMN
-- в SQLite не идемпотентен. Нет строки = teacher, то есть поведение прежнее.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

`;

// ─────────────────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────────────────

const TEACHER_A = "usr_teacherAAAA01";
const TEACHER_B = "usr_teacherBBBB01";

async function createUser(id: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO users (id, email, name, plan, generations_total, generations_today,
                          is_admin, created_at, updated_at)
       VALUES (?1, ?2, 'Учитель', 'base', 0, 0, 0, ?3, ?3)`,
    )
    .bind(id, email, now)
    .run();
  const session = `sess_${id}`;
  await env.DB
    .prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(session, id, now + 3600, now)
    .run();
  return session;
}

const TASKS = [
  {
    number: 1,
    text: "Сколько будет 2+2?",
    type: "computation",
    answer: "4",
    explanation: "Складываем",
    points: 2,
  },
  {
    number: 2,
    text: "Выбери верный вариант",
    type: "multiple-choice",
    options: ["А", "Б"],
    answer: "1",
    points: 1,
  },
];

/** Заголовки учительского запроса (cookie session = requireAuth). */
function authHeaders(session: string): Record<string, string> {
  return { "Content-Type": "application/json", Cookie: `session=${session}` };
}

async function createForm(session: string, body: Record<string, unknown> = {}): Promise<Response> {
  return SELF.fetch("https://worker.test/api/assignments/forms", {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({
      title: "Лист по математике",
      subject: "math",
      grade: 5,
      payload: { tasks: TASKS },
      ...body,
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Тесты
// ─────────────────────────────────────────────────────────────────────────────

describe("учительские формы (TZ-12, f07)", () => {
  let sessionA = "";
  let sessionB = "";

  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
    sessionA = await createUser(TEACHER_A, "a@example.test");
    sessionB = await createUser(TEACHER_B, "b@example.test");
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM form_answers").run();
    await env.DB.prepare("DELETE FROM form_responses").run();
    await env.DB.prepare("DELETE FROM forms").run();
  });

  it("F1: без входа → 401", async () => {
    const res = await SELF.fetch("https://worker.test/api/assignments/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "t", subject: "math", grade: 5, payload: { tasks: TASKS } }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("F2: создание формы → 201, токен 32 символа, ссылка с ?t=", async () => {
    const res = await createForm(sessionA);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      formId: string;
      token: string;
      url: string;
      responsesCount: number;
    };

    expect(body.ok).toBe(true);
    expect(body.formId).toMatch(/^frm_[0-9a-z]{12}$/);
    expect(body.token).toHaveLength(32);
    expect(body.url).toContain(`/form/?t=${body.token}`);
    expect(body.responsesCount).toBe(0);

    // Эталон сохранён на сервере — и только на сервере.
    const row = await env.DB
      .prepare("SELECT payload_json, status, expires_at, check_mode, show_answers FROM forms WHERE id = ?1")
      .bind(body.formId)
      .first<{ payload_json: string; status: string; expires_at: number; check_mode: string; show_answers: number }>();

    expect(row!.status).toBe("open");
    expect(row!.check_mode).toBe("auto"); // нет short-answer → auto
    expect(row!.show_answers).toBe(0); // по умолчанию ответы НЕ показываем
    expect(row!.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(JSON.parse(row!.payload_json).tasks[0].answer).toBe("4");
  });

  it("F2b: short-answer в листе → check_mode = llm", async () => {
    const res = await createForm(sessionA, {
      payload: {
        tasks: [{ number: 1, text: "Что такое атмосфера?", type: "short-answer", answer: "воздух", points: 2 }],
      },
    });
    const body = (await res.json()) as { formId: string };
    const row = await env.DB
      .prepare("SELECT check_mode FROM forms WHERE id = ?1")
      .bind(body.formId)
      .first<{ check_mode: string }>();
    expect(row!.check_mode).toBe("llm");
  });

  it("F3: список форм — только свои, со счётчиком и средним баллом", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string; token: string };

    // Один ответ от ученика: 2 из 3 баллов.
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT INTO form_responses (id, form_id, student_name, score_total, score_max, status, submitted_at, created_at)
         VALUES ('rsp_test1', ?1, 'Иван', 2, 3, 'submitted', ?2, ?2)`,
      )
      .bind(created.formId, now)
      .run();

    const mine = await SELF.fetch("https://worker.test/api/assignments/forms", {
      headers: { Cookie: `session=${sessionA}` },
    });
    const mineBody = (await mine.json()) as {
      forms: Array<{ id: string; responsesCount: number; scoreAvg: number; scoreMaxAvg: number }>;
    };
    expect(mineBody.forms).toHaveLength(1);
    expect(mineBody.forms[0]!.responsesCount).toBe(1);
    expect(mineBody.forms[0]!.scoreAvg).toBe(2);
    expect(mineBody.forms[0]!.scoreMaxAvg).toBe(3);

    // У второго учителя список пуст — чужие формы не подмешиваются.
    const other = await SELF.fetch("https://worker.test/api/assignments/forms", {
      headers: { Cookie: `session=${sessionB}` },
    });
    const otherBody = (await other.json()) as { forms: unknown[] };
    expect(otherBody.forms).toHaveLength(0);
  });

  it("F4: GET /forms/:id → форма с заданиями и drill-down по ответам", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string; token: string };
    const now = Math.floor(Date.now() / 1000);

    await env.DB
      .prepare(
        `INSERT INTO form_responses (id, form_id, student_name, student_label, score_total, score_max,
                                     status, duration_sec, submitted_at, created_at)
         VALUES ('rsp_drill', ?1, 'Иван Петров', '5А', 3, 3, 'submitted', 240, ?2, ?2)`,
      )
      .bind(created.formId, now)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO form_answers (id, response_id, task_number, task_type, student_answer,
                                   is_correct, points_awarded, points_max, needs_review, check_method, created_at)
         VALUES ('ans_d1', 'rsp_drill', 1, 'computation', '4', 1, 2, 2, 0, 'auto', ?1)`,
      )
      .bind(now)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO form_answers (id, response_id, task_number, task_type, student_answer,
                                   is_correct, points_awarded, points_max, needs_review, check_method, created_at)
         VALUES ('ans_d2', 'rsp_drill', 2, 'multiple-choice', '0', 0, 1, 1, 0, 'auto', ?1)`,
      )
      .bind(now)
      .run();

    const res = await SELF.fetch(`https://worker.test/api/assignments/forms/${created.formId}`, {
      headers: { Cookie: `session=${sessionA}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      form: { id: string; tasks: Array<{ answer?: string }>; status: string };
      responses: Array<{
        id: string;
        studentName: string;
        studentLabel: string;
        scoreTotal: number;
        durationSec: number;
        answers: Array<{ taskNumber: number; isCorrect: number | null; pointsAwarded: number }>;
      }>;
    };

    expect(body.form.id).toBe(created.formId);
    expect(body.form.status).toBe("open");
    // Учитель видит эталоны — ему они нужны для проверки.
    expect(body.form.tasks[0]!.answer).toBe("4");

    expect(body.responses).toHaveLength(1);
    expect(body.responses[0]!.studentName).toBe("Иван Петров");
    expect(body.responses[0]!.studentLabel).toBe("5А");
    expect(body.responses[0]!.durationSec).toBe(240);
    expect(body.responses[0]!.answers).toHaveLength(2);
    expect(body.responses[0]!.answers[0]).toMatchObject({ taskNumber: 1, isCorrect: 1, pointsAwarded: 2 });
  });

  it("F5: чужая форма → 404, а не 403", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string };
    const res = await SELF.fetch(`https://worker.test/api/assignments/forms/${created.formId}`, {
      headers: { Cookie: `session=${sessionB}` },
    });
    expect(res.status).toBe(404);
  });

  it("F6: PATCH close → ссылка учителя перестаёт работать (410)", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string; token: string };

    const patch = await SELF.fetch(`https://worker.test/api/assignments/forms/${created.formId}`, {
      method: "PATCH",
      headers: authHeaders(sessionA),
      body: JSON.stringify({ action: "close" }),
    });
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as { ok: boolean; status: string; token: string };
    expect(patchBody.status).toBe("closed");
    expect(patchBody.token).toBe(created.token);

    const publicRes = await SELF.fetch(`https://worker.test/api/public/forms/${created.token}`);
    expect(publicRes.status).toBe(410);
    const publicBody = (await publicRes.json()) as { code: string };
    expect(publicBody.code).toBe("FORM_CLOSED");
  });

  it("F6b: PATCH reopen + extend продлевают срок", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string; token: string };
    const before = Math.floor(Date.now() / 1000);

    const res = await SELF.fetch(`https://worker.test/api/assignments/forms/${created.formId}`, {
      method: "PATCH",
      headers: authHeaders(sessionA),
      body: JSON.stringify({ action: "extend", days: 30 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: number };
    expect(body.expiresAt).toBeGreaterThan(before + 29 * 86400);
  });

  it("F7: PATCH rotate-token → старый токен мёртв, ответы сохранены", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string; token: string };
    const oldToken = created.token;
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT INTO form_responses (id, form_id, student_name, score_total, score_max, status, submitted_at, created_at)
         VALUES ('rsp_rot', ?1, 'Ученик', 3, 3, 'submitted', ?2, ?2)`,
      )
      .bind(created.formId, now)
      .run();

    const res = await SELF.fetch(`https://worker.test/api/assignments/forms/${created.formId}`, {
      method: "PATCH",
      headers: authHeaders(sessionA),
      body: JSON.stringify({ action: "rotate-token" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; url: string };
    expect(body.token).not.toBe(oldToken);
    expect(body.token).toHaveLength(32);
    expect(body.url).toContain(body.token);

    // Старая ссылка больше не открывается, новая — работает.
    const oldRes = await SELF.fetch(`https://worker.test/api/public/forms/${oldToken}`);
    expect(oldRes.status).toBe(404);
    const newRes = await SELF.fetch(`https://worker.test/api/public/forms/${body.token}`);
    expect(newRes.status).toBe(200);

    // Ответы на месте.
    const cnt = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM form_responses WHERE form_id = ?1")
      .bind(created.formId)
      .first<{ cnt: number }>();
    expect(cnt?.cnt).toBe(1);
  });

  it("F8: export.csv → BOM, разделитель `;`, attachment", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string };
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT INTO form_responses (id, form_id, student_name, student_label, score_total, score_max,
                                     status, submitted_at, created_at)
         VALUES ('rsp_csv', ?1, 'Иван;Петров', '5А', 2, 3, 'submitted', ?2, ?2)`,
      )
      .bind(created.formId, now)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO form_answers (id, response_id, task_number, task_type, student_answer,
                                   is_correct, points_awarded, points_max, needs_review, check_method, created_at)
         VALUES ('ans_c1', 'rsp_csv', 1, 'computation', '4', 1, 2, 2, 0, 'auto', ?1)`,
      )
      .bind(now)
      .run();

    const res = await SELF.fetch(
      `https://worker.test/api/assignments/forms/${created.formId}/export.csv`,
      { headers: { Cookie: `session=${sessionA}` } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toMatch(/filename="otchet-\d{4}-\d{2}-\d{2}\.csv"/);

    const csv = await res.text();
    // UTF-8 BOM — без него русский Excel открывает кракозябры.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const body = csv.slice(1);
    const lines = body.trim().split("\r\n");
    expect(lines[0]).toBe("ФИО;Класс;Задание;Ответ ученика;Верно;Балл;Макс.балл");
    // Имя с точкой с запятой экранируется кавычками, иначе CSV разъедется.
    expect(lines[1]).toContain('"Иван;Петров"');
    expect(lines[1]).toContain("Задание 1");
    // Пропущенное задание тоже попадает в отчёт — учитель должен видеть «не решено».
    expect(lines.some((l) => l.includes("Задание 2") && l.includes("не отвечено"))).toBe(true);
  });

  it("F9: DELETE → форма и ответы удалены каскадом", async () => {
    const created = (await (await createForm(sessionA)).json()) as { formId: string; token: string };
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT INTO form_responses (id, form_id, student_name, score_total, score_max, status, submitted_at, created_at)
         VALUES ('rsp_del', ?1, 'Ученик', 1, 3, 'submitted', ?2, ?2)`,
      )
      .bind(created.formId, now)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO form_answers (id, response_id, task_number, task_type, is_correct,
                                   points_awarded, points_max, needs_review, check_method, created_at)
         VALUES ('ans_del', 'rsp_del', 1, 'computation', 1, 1, 2, 0, 'auto', ?1)`,
      )
      .bind(now)
      .run();

    const res = await SELF.fetch(`https://worker.test/api/assignments/forms/${created.formId}`, {
      method: "DELETE",
      headers: { Cookie: `session=${sessionA}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    for (const table of ["forms", "form_responses", "form_answers"]) {
      const cnt = await env.DB
        .prepare(`SELECT COUNT(*) AS cnt FROM ${table}`)
        .first<{ cnt: number }>();
      expect(cnt?.cnt, `${table} должна быть пуста`).toBe(0);
    }

    // Ссылка учителя больше не работает.
    const publicRes = await SELF.fetch(`https://worker.test/api/public/forms/${created.token}`);
    expect(publicRes.status).toBe(404);
  });
});

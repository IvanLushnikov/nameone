/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * Тесты публичного бэкенда форм (TZ-12, этап 2) + ЗАЩИТА ОТ УТЕЧКИ ЭТАЛОНОВ.
 *
 * Главный тест файла — S1: `GET /api/public/forms/:token` не должен отдавать
 * `tasks[].answer` и `tasks[].explanation`. Это критично: если эталон утечёт
 * в публичный ответ, ученик читает ответы из devtools и форма теряет смысл
 * (а для контрольной это ещё и слив ответов всей параллели).
 *
 * Остальное — контракт публичных эндпоинтов:
 *   S2. Закрытая форма → 410 FORM_CLOSED
 *   S3. Истёкшая форма → 410 FORM_EXPIRED
 *   S4. Неизвестный токен → 404 FORM_NOT_FOUND
 *   S5. POST submit: серверная автосверка, баллы, эталон НЕ уходит
 *   S6. show_answers = 1 → эталон уходит (учитель разрешил)
 *   S7. Неверный код класса → 403 FORM_CODE_REQUIRED
 *   S8. GET /status → open | closed | expired | not_found
 *
 * Схема D1 зашита в SCHEMA_SQL: workerd не имеет fs.readFileSync
 * (см. комментарий в начале worksheets.test.ts).
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import type { Env } from "../../src/env";
import type { WorksheetTask } from "../../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

// Только нужные для публичных роутов таблицы: формы, ответы и rate_limits
// (её трогает rateLimitMiddleware на каждом публичном запросе).
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

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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

const TEACHER_ID = "usr_testteacher01";

/** Секретные строки, которых не должно быть в публичном ответе. */
const SECRET_ANSWER = "СЕКРЕТНЫЙ_ЭТАЛОН_42";
const SECRET_EXPLANATION = "СЕКРЕТНОЕ_ОБЪЯСНЕНИЕ_С_ХОЛЯДОЙ";
const SECRET_EXTRA = "СЕКРЕТНОЕ_ДОП_ПОЛЕ";

interface FormOpts {
  tasks?: WorksheetTask[];
  status?: "open" | "closed";
  expiresAt?: number;
  accessCode?: string | null;
  showAnswers?: boolean;
}

let seq = 0;

/** Положить форму в D1 напрямую и вернуть её токен. */
async function seedForm(opts: FormOpts = {}): Promise<{ id: string; token: string }> {
  seq += 1;
  const id = `frm_test${String(seq).padStart(8, "0")}`;
  const token = `testtoken${String(seq).padStart(16, "0")}`;
  const now = Math.floor(Date.now() / 1000);

  // Задание-эталон: answer/explanation обязаны НЕ уехать к ученику.
  // `verifiedExplanation` — реальное поле из POST /api/worksheets/save
  // (src/routes/worksheets.ts), его нет в WorksheetTask: идеальный
  // проверочный слой — если «протечёт» даже оно, whitelist сломан.
  const tasks: WorksheetTask[] = opts.tasks ?? [
    {
      number: 1,
      text: "Сколько будет 2+2?",
      type: "computation",
      answer: SECRET_ANSWER,
      explanation: SECRET_EXPLANATION,
      points: 2,
    },
    {
      number: 2,
      text: "Выбери верный вариант",
      type: "multiple-choice",
      options: ["Вариант А", "Вариант Б"],
      answer: "1",
      explanation: SECRET_EXPLANATION,
      points: 1,
    },
  ];
  (tasks[0] as unknown as Record<string, unknown>).verifiedExplanation = SECRET_EXTRA;

  await env.DB
    .prepare(
      `INSERT INTO forms
         (id, token, user_id, worksheet_id, title, subject, grade, payload_json, status,
          access_code, expires_at, show_answers, check_mode, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, 'Лист по математике', 'math', 5, ?4, ?5, ?6, ?7, ?8, 'auto', ?9, ?9)`,
    )
    .bind(
      id,
      token,
      TEACHER_ID,
      JSON.stringify({ tasks }),
      opts.status ?? "open",
      opts.accessCode ?? null,
      opts.expiresAt ?? Math.floor(Date.now() / 1000) + 14 * 86400,
      opts.showAnswers ? 1 : 0,
      Math.floor(Date.now() / 1000),
    )
    .run();

  return { id, token };
}

function get(token: string, ip = "10.0.0.1"): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/public/forms/${token}`, {
    headers: { "cf-connecting-ip": ip },
  });
}

function postSubmit(
  token: string,
  body: unknown,
  ip = "10.0.0.1",
): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/public/forms/${token}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Тесты
// ─────────────────────────────────────────────────────────────────────────────

describe("публичные формы (TZ-12)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
    await env.DB
      .prepare(
        `INSERT INTO users (id, email, name, plan, generations_total, generations_today,
                            is_admin, created_at, updated_at)
         VALUES (?1, ?2, 'Учитель', 'base', 0, 0, 0, ?3, ?3)`,
      )
      .bind(TEACHER_ID, "teacher@example.test", Math.floor(Date.now() / 1000))
      .run();
  });

  // ── S1. ГЛАВНЫЙ ТЕСТ БЕЗОПАСНОСТИ ────────────────────────────────────────
  it("S1: GET /:token НЕ возвращает answer, explanation и прочие секретные поля", async () => {
    const { token } = await seedForm();

    const res = await get(token);
    expect(res.status).toBe(200);

    const raw = await res.text();
    const body = JSON.parse(raw) as {
      ok: boolean;
      form: {
        title: string;
        tasks: Array<Record<string, unknown>>;
        needsCode: boolean;
        expiresAt: number;
      };
    };

    expect(body.ok).toBe(true);
    // Ученик получает условие и баллы.
    expect(body.form.title).toBe("Лист по математике");
    expect(body.form.tasks).toHaveLength(2);
    expect(body.form.tasks[0]).toMatchObject({
      number: 1,
      text: "Сколько будет 2+2?",
      type: "computation",
      points: 2,
    });

    // 1) Ни у одного задания нет ключей answer/explanation.
    for (const t of body.form.tasks) {
      expect(Object.keys(t)).not.toContain("answer");
      expect(Object.keys(t)).not.toContain("explanation");
      expect(Object.keys(t)).not.toContain("verifiedExplanation");
      expect(t.answer).toBeUndefined();
      expect(t.explanation).toBeUndefined();
    }

    // 2) Секретных строк нет в теле ответа вообще (включая вложенные места).
    expect(raw).not.toContain(SECRET_ANSWER);
    expect(raw).not.toContain(SECRET_EXPLANATION);
    expect(raw).not.toContain(SECRET_EXTRA);

    // 3) Варианты ответа multiple-choice отдаём — они не секрет.
    expect(body.form.tasks[1]!.options).toEqual(["Вариант А", "Вариант Б"]);
  });

  it("S1b: whitelist устойчив — options пустые не отдаются, лишние поля не проходят", async () => {
    const { token } = await seedForm({
      tasks: [
        {
          number: 1,
          text: "Только текст",
          type: "essay",
          points: 5,
          // Поля, которых нет в whitelist:
          answer: SECRET_ANSWER,
          explanation: SECRET_EXPLANATION,
          options: [],
        },
      ],
    });

    const raw = await (await get(token)).text();
    const body = JSON.parse(raw) as { form: { tasks: Array<Record<string, unknown>> } };
    const t = body.form.tasks[0]!;

    expect(t).toEqual({
      number: 1,
      text: "Только текст",
      type: "essay",
      points: 5,
    });
    expect(raw).not.toContain(SECRET_ANSWER);
    expect(raw).not.toContain(SECRET_EXPLANATION);
  });

  // ── S2–S4. Ошибки для ученика ────────────────────────────────────────────
  it("S2: закрытая форма → 410 FORM_CLOSED", async () => {
    const { token } = await seedForm({ status: "closed" });
    const res = await get(token);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok: boolean; code: string; error: string };
    expect(body.code).toBe("FORM_CLOSED");
    expect(body.error).toBe("Форма закрыта учителем");
  });

  it("S3: истёкшая форма → 410 FORM_EXPIRED", async () => {
    const { token } = await seedForm({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    const res = await get(token);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORM_EXPIRED");
  });

  it("S4: неизвестный токен → 404 FORM_NOT_FOUND", async () => {
    const res = await get("nosuchtoken000000000000");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("FORM_NOT_FOUND");
    expect(body.error).toContain("Попросите учителя");
  });

  // ── S5. Приём ответов + автосверка ───────────────────────────────────────
  it("S5: POST submit → 201, автосверка на сервере, эталон не уходит", async () => {
    const { id, token } = await seedForm({
      tasks: [
        { number: 1, text: "2+2", type: "computation", answer: "4", points: 2 },
        { number: 2, text: "Вариант?", type: "multiple-choice", options: ["А", "Б"], answer: "1", points: 1 },
        { number: 3, text: "Вставь 3, 5", type: "fill-blank", answer: "3, 5", points: 2 },
        { number: 4, text: "Обоснуйте", type: "essay", answer: "эталон", points: 5 },
      ],
    });

    const res = await postSubmit(token, {
      studentName: "Иван Петров",
      answers: [
        { taskNumber: 1, value: "4" },
        { taskNumber: 2, value: "0" },
        { taskNumber: 3, value: "3, 5" },
        { taskNumber: 4, value: "потому что" },
      ],
    });

    expect(res.status).toBe(201);
    const raw = await res.text();
    const body = JSON.parse(raw) as {
      ok: boolean;
      scoreTotal: number;
      scoreMax: number;
      perTask: Array<{ taskNumber: number; status: string; answer?: unknown }>;
    };

    expect(body.ok).toBe(true);
    expect(body.scoreTotal).toBe(4); // 2 + 0 + 2 + 0 (эссе — учителю)
    expect(body.scoreMax).toBe(10);
    expect(body.perTask.map((p) => p.status)).toEqual([
      "correct",
      "wrong",
      "correct",
      "unreviewed",
    ]);
    // show_answers = 0 → эталона нет в ответе.
    for (const p of body.perTask) expect(p.answer).toBeUndefined();
    expect(raw).not.toContain('"answer"');

    // Ответ реально записан в БД вместе с разбивкой по заданиям.
    const respRow = await env.DB
      .prepare("SELECT id, student_name, score_total, score_max, ip_hash FROM form_responses WHERE form_id = ?1")
      .bind(id)
      .first<{ id: string; student_name: string; score_total: number; score_max: number; ip_hash: string }>();
    expect(respRow).not.toBeNull();
    expect(respRow!.student_name).toBe("Иван Петров");
    expect(respRow!.score_total).toBe(4);
    // Сырой IP не хранится — только хэш.
    expect(respRow!.ip_hash).toMatch(/^[0-9a-z]+$/);

    const answers = await env.DB
      .prepare("SELECT task_number, is_correct, points_awarded, needs_review, check_method FROM form_answers WHERE response_id = ?1 ORDER BY task_number")
      .bind(respRow!.id)
      .all<{ task_number: number; is_correct: number | null; points_awarded: number; needs_review: number; check_method: string }>();

    expect(answers.results).toHaveLength(4);
    expect(answers.results[0]!.is_correct).toBe(1);
    expect(answers.results[1]!.is_correct).toBe(0);
    // Эссе: is_correct = NULL, needs_review = 1, check_method = manual.
    expect(answers.results[3]!.is_correct).toBeNull();
    expect(answers.results[3]!.needs_review).toBe(1);
    expect(answers.results[3]!.check_method).toBe("manual");
  });

  it("S5b: ответ на несуществующее задание игнорируется (нельзя нафантазировать балл)", async () => {
    const { id, token } = await seedForm({
      tasks: [{ number: 1, text: "2+2", type: "computation", answer: "4", points: 2 }],
    });

    const res = await postSubmit(token, {
      studentName: "Хитрый",
      answers: [
        { taskNumber: 1, value: "4" },
        { taskNumber: 99, value: "хочу 100 баллов" },
      ],
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { scoreTotal: number; scoreMax: number };
    expect(body.scoreTotal).toBe(2);
    expect(body.scoreMax).toBe(2);

    const count = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM form_answers WHERE task_number = 99")
      .first<{ cnt: number }>();
    expect(count?.cnt).toBe(0);
    void id;
  });

  // ── S6. show_answers ─────────────────────────────────────────────────────
  it("S6: show_answers = 1 → эталон уходит в perTask", async () => {
    const { token } = await seedForm({
      showAnswers: true,
      tasks: [{ number: 1, text: "2+2", type: "computation", answer: "4", points: 2 }],
    });

    const res = await postSubmit(token, {
      studentName: "Ученик",
      answers: [{ taskNumber: 1, value: "4" }],
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { perTask: Array<{ answer?: string }> };
    expect(body.perTask[0]!.answer).toBe("4");
  });

  // ── S7. Код класса ───────────────────────────────────────────────────────
  it("S7: неверный код класса → 403 FORM_CODE_REQUIRED, ответы не сохраняются", async () => {
    const { id, token } = await seedForm({
      accessCode: "5А",
      tasks: [{ number: 1, text: "2+2", type: "computation", answer: "4", points: 2 }],
    });

    const res = await postSubmit(token, {
      studentName: "Ученик",
      studentCode: "9Z",
      answers: [{ taskNumber: 1, value: "4" }],
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("FORM_CODE_REQUIRED");
    expect(body.error).toContain("код");

    const rows = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM form_responses WHERE form_id = ?1")
      .bind(id)
      .first<{ cnt: number }>();
    expect(rows?.cnt).toBe(0);
  });

  it("S7b: верный код класса (в любом регистре) → ответ принимается", async () => {
    const { token } = await seedForm({
      accessCode: "5А",
      tasks: [{ number: 1, text: "2+2", type: "computation", answer: "4", points: 2 }],
    });

    const res = await postSubmit(token, {
      studentName: "Ученик",
      studentCode: "5а",
      answers: [{ taskNumber: 1, value: "4" }],
    });
    expect(res.status).toBe(201);
  });

  // ── S8. Статус ссылки ────────────────────────────────────────────────────
  it("S8: GET /:token/status → open / closed / expired / not_found", async () => {
    const open = await seedForm();
    const closed = await seedForm({ status: "closed" });
    const expired = await seedForm({ expiresAt: Math.floor(Date.now() / 1000) - 1 });

    const read = async (token: string): Promise<string> => {
      const res = await SELF.fetch(`https://worker.test/api/public/forms/${token}/status`, {
        headers: { "cf-connecting-ip": "10.0.0.2" },
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { status: string }).status;
    };

    expect(await read(open.token)).toBe("open");
    expect(await read(closed.token)).toBe("closed");
    expect(await read(expired.token)).toBe("expired");
    // Неизвестный токен — 200 + not_found, а не 404: фронт сам покажет текст.
    expect(await read("nosuchtoken000000000000")).toBe("not_found");
  });

  // ── Закрытая форма не принимает ответы ──────────────────────────────────
  it("закрытая форма не принимает новые ответы (410 на submit)", async () => {
    const { id, token } = await seedForm({ status: "closed" });
    const res = await postSubmit(token, {
      studentName: "Ученик",
      answers: [{ taskNumber: 1, value: "4" }],
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORM_CLOSED");

    const rows = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM form_responses WHERE form_id = ?1")
      .bind(id)
      .first<{ cnt: number }>();
    expect(rows?.cnt).toBe(0);
  });
});

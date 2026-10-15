/// <reference types="@cloudflare/vitest-plugin" />
/**
 * Классы, ученики и персональный QR (лист 3.1.1).
 *
 * Проверяем сквозной сценарий листа: учитель заводит класс и список учеников,
 * каждому выдаётся своя ссылка, ученик по ней отвечает, учитель видит, кто что
 * ответил. Ключевые требования и тесты, которые их закрывают:
 *
 *   S1  Класс и ученики заводятся из кабинета (по одному и списком).
 *   S2  Персональная ссылка работает: ученик получает задания и сдает ответ,
 *       ответ привязывается к НЕМУ, а не к тому, что он написал.
 *   S3  БЕЗОПАСНОСТЬ: по ссылке не узнать ни своё, ни чужое имя; эталоны не уходят.
 *   S4  Чужой класс по чужой ссылке — отказ 403, а не пустой ответ.
 *   S5  Учитель видит и правит только свой класс: чужой класс/ученик — 403,
 *       причём именно 403, а не 404 (иначе «нет такого» == «не твой»).
 *   S6  Удаление ученика НЕ оставляет его ответы без хозяина, а ссылка гаснет.
 *   S7  Обратная совместимость: учитель без учеников работает как раньше,
 *       старая ссылка на форму открывается.
 *   S8  Лимиты отправки НЕ изменились: персональная ссылка тратит тот же
 *       бюджет, что и общая (тот же bucket и тот же ключ), а не свой второй.
 *   S9  Один ученик на две работы — две разные привязки.
 *   S10 Удаление класса с ответами не стирает сами ответы.
 *   S11 Два учителя с одинаковым названием класса не мешают друг другу.
 *   S12 Кириллица, латиница, длинные фамилии и одинаковые имена в классе.
 *   S13 Повторное открытие одной ссылки — учитель видит оба ответа.
 *
 * Тесты идут в workerd с настоящим D1 и настоящими роутами (SELF.fetch).
 * LLM не вызывается: сверка ответов — чистая арифметика в services/formGrading,
 * ни одного сетевого вызова на пути (см. образец polza-cost-regression.test.ts).
 *
 * Схема D1 зашита в SCHEMA_SQL: workerd не имеет fs.readFileSync (см. начало
 * worksheets.test.ts).
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { WorksheetTask } from "../../src/types";

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
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_user_name ON classes(user_id, name_key);
CREATE INDEX IF NOT EXISTS idx_classes_user ON classes(user_id, created_at);

CREATE TABLE IF NOT EXISTS class_students (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  removed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id, position);
CREATE INDEX IF NOT EXISTS idx_class_students_token ON class_students(token);

CREATE TABLE IF NOT EXISTS class_student_answers (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES class_students(id) ON DELETE CASCADE,
  form_id      TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  response_id  TEXT NOT NULL,
  score_total  INTEGER NOT NULL DEFAULT 0,
  score_max    INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csa_student_form ON class_student_answers(student_id, form_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_csa_form ON class_student_answers(form_id, submitted_at DESC);
`;

/* ───────────────────────────────────────────────────────────────────────────
 * Фикстуры
 * ─────────────────────────────────────────────────────────────────────────── */

const TEACHER = "usr_teachermain1";
const OTHER_TEACHER = "usr_otherteach1";
const SESSION_A = "sess_token_teacher_a";
const SESSION_B = "sess_token_teacher_b";

/** Секреты, которых не должно быть в ответе ученику. */
const SECRET_ANSWER = "СЕКРЕТНЫЙ_ЭТАЛОН_42";
const SECRET_EXPLANATION = "СЕКРОТНОЕ_ОБЪЯСНЕНИЕ";

function auth(session: string): Record<string, string> {
  return { Cookie: `session=${session}`, "Content-Type": "application/json" };
}

function anon(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

let formSeq = 0;

/** Положить форму учителю и вернуть id + токен. */
async function seedForm(
  userId: string,
  opts: { status?: string; expiresAt?: number; accessCode?: string | null } = {},
): Promise<{ id: string; token: string }> {
  formSeq += 1;
  const id = `frm_roster${String(formSeq).padStart(6, "0")}`;
  const token = `formtoken${String(formSeq).padStart(6, "0")}zzzzzzzzzzzzzzzz`;
  const now = Math.floor(Date.now() / 1000);
  const tasks: WorksheetTask[] = [
    { number: 1, text: "Сколько будет 2+2?", type: "computation", answer: "4", explanation: SECRET_EXPLANATION, points: 2 },
    { number: 2, text: "Выбери верный вариант", type: "multiple-choice", options: ["Да", "Нет"], answer: "1", explanation: SECRET_EXPLANATION, points: 1 },
    // Эталон-секрет живёт в ЭССЕ: такие задания машина не сверяет, их смотрит
    // учитель. Заодно это проверка, что секретный `answer` не уезжает ученику.
    { number: 3, text: "Почему так?", type: "essay", answer: SECRET_ANSWER, explanation: SECRET_EXPLANATION, points: 3 },
  ];

  await env.DB
    .prepare(
      `INSERT INTO forms
         (id, token, user_id, worksheet_id, title, subject, grade, payload_json, status,
          access_code, expires_at, show_answers, check_mode, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, 'Дроби', 'math', 5, ?4, ?5, ?6, ?7, 0, 'auto', ?8, ?8)`,
    )
    .bind(
      id,
      token,
      userId,
      JSON.stringify({ tasks }),
      opts.status ?? "open",
      opts.accessCode ?? null,
      opts.expiresAt ?? now + 7 * 86400,
      now,
    )
    .run();

  return { id, token };
}

/** Завести класс и вернуть его id. */
async function createClass(session: string, name: string): Promise<string> {
  const res = await SELF.fetch("https://worker.test/api/classes", {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({ name }),
  });
  expect(res.status, `создание класса «${name}»`).toBe(201);
  const body = (await res.json()) as { class: { id: string } };
  return body.class.id;
}

/** Добавить учеников списком и вернуть их строки. */
async function addStudents(
  session: string,
  classId: string,
  names: string[],
): Promise<Array<{ id: string; name: string; token: string }>> {
  const res = await SELF.fetch(`https://worker.test/api/classes/${classId}/students`, {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({ names }),
  });
  expect(res.status, `добавление учеников в класс`).toBe(201);
  const body = (await res.json()) as { students: Array<{ id: string; name: string; token: string }> };
  return body.students;
}

/** Ученик сдал работу по персональной ссылке. */
function submitPersonal(st: string, t: string, body: unknown, ip = "10.0.0.1"): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/public/class-links/${st}/forms/${t}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

/** Задания по персональной ссылке. */
function loadPersonal(st: string, t: string, ip = "10.0.0.1"): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/public/class-links/${st}/forms/${t}`, {
    headers: { "cf-connecting-ip": ip },
  });
}

/**
 * Правильные ответы на фикстуру формы: 2+1 = 3 балла из 6, третье задание —
 * ручное (эссе), его сверяет учитель, поэтому машина даёт 0 и ждёт проверки.
 */
const correctAnswers = [
  { taskNumber: 1, value: "4" },
  { taskNumber: 2, value: "1" },
  { taskNumber: 3, value: SECRET_ANSWER },
];

/* ───────────────────────────────────────────────────────────────────────────
 * Тесты
 * ─────────────────────────────────────────────────────────────────────────── */

describe("классы, ученики и персональный QR (лист 3.1.1)", () => {
  // С Vitest 4 и @cloudflare/vitest-plugin хранилище изолируется на файл, а не
  // на отдельный тест: опция `isolatedStorage` удалена. Раньше каждый `it`
  // получал пустую базу, и проверки вида «у учителя нет учеников» или
  // «потрачен ровно один лимит отправки» проходили на чистом старте. Теперь
  // соседние тесты делят базу, и эти проверки видели данные предыдущих.
  // Учителей из beforeAll не трогаем — они нужны каждому тесту.
  beforeEach(async () => {
    for (const table of [
      "class_student_answers",
      "class_students",
      "classes",
      "form_answers",
      "form_responses",
      "forms",
      "rate_limits",
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
  });

  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
    const now = Math.floor(Date.now() / 1000);
    for (const [id, email] of [
      [TEACHER, "teacher-a@example.test"],
      [OTHER_TEACHER, "teacher-b@example.test"],
    ] as const) {
      await env.DB
        .prepare(
          `INSERT INTO users (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
           VALUES (?1, ?2, 'Учитель', 'base', 0, 0, 0, ?3, ?3)`,
        )
        .bind(id, email, now)
        .run();
      await env.DB
        .prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`)
        .bind(id === TEACHER ? SESSION_A : SESSION_B, id, now + 86400, now)
        .run();
    }
  });

  // ── S1. Учитель заводит класс и учеников ─────────────────────────────────
  it("S1: класс и список учеников заводятся из кабинета, список чистится от повторов", async () => {
    const classId = await createClass(SESSION_A, " 5А ");
    // Импорт списком — с дублем, пустой строкой и разными регистрами фамилий.
    const students = await addStudents(SESSION_A, classId, [
      "Иванов Иван",
      "Петрова  Анастасия   Сергеевна",
      "  ",
      "иванов иван",
    ]);

    // « 5А » → «5А»: схлопнули пробелы. Дубль и пустая строка отброшены.
    expect(students).toHaveLength(2);
    expect(students[0]!.name).toBe("Иванов Иван");
    expect(students[1]!.name).toBe("Петрова Анастасия Сергеевна");

    // Токен у каждого свой и достаточно длинный, чтобы ссылку не подобрали.
    const tokens = students.map((s) => s.token);
    expect(new Set(tokens).size).toBe(2);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-z]{32}$/);

    const list = await SELF.fetch("https://worker.test/api/classes", { headers: auth(SESSION_A) });
    const body = (await list.json()) as {
      classes: Array<{ id: string; name: string; students: Array<{ name: string }> }>;
    };
    expect(body.classes[0]!.name).toBe("5А");
    expect(body.classes[0]!.students).toHaveLength(2);
  });

  // ── S2. ГЛАВНЫЙ ТЕСТ ЛИСТА: персональная ссылка работает ──────────────────
  it("S2: ученик по своей ссылке решает, а ответ привязывается к нему", async () => {
    const classId = await createClass(SESSION_A, "5Б");
    const [ivan, petrova] = await addStudents(SESSION_A, classId, ["Иванов Иван", "Петрова Анастасия"]);
    const form = await seedForm(TEACHER);

    // Ученик открывает СВОЮ ссылку.
    const loaded = await loadPersonal(ivan!.token, form.token);
    expect(loaded.status).toBe(200);
    const formBody = (await loaded.json()) as { form: { tasks: unknown[]; needsCode: boolean } };
    expect(formBody.form.tasks).toHaveLength(3);
    // Персональная ссылка сама по себе пропуск — код класса не спрашивается.
    expect(formBody.form.needsCode).toBe(false);

    // Отвечает. Имени в теле нет НИКАКОГО — сервер подставит его сам.
    const submitted = await submitPersonal(ivan!.token, form.token, { answers: correctAnswers });
    expect(submitted.status).toBe(201);
    const result = (await submitted.json()) as { scoreTotal: number; scoreMax: number };
    expect(result.scoreTotal).toBe(3);
    expect(result.scoreMax).toBe(6);

    // 1) В ответе лежит ФАМИЛИЯ из класса, а не то, что ученик написал.
    const response = await env.DB
      .prepare("SELECT id, student_name, score_total FROM form_responses WHERE form_id = ?1")
      .bind(form.id)
      .first<{ id: string; student_name: string; score_total: number }>();
    expect(response!.student_name).toBe("Иванов Иван");
    expect(response!.score_total).toBe(3);

    // 2) Привязка «чей это ответ» ведёт на конкретного ученика, а не на класс.
    const link = await env.DB
      .prepare(
        `SELECT s.name, a.form_id, a.score_total FROM class_student_answers a
           JOIN class_students s ON s.id = a.student_id
          WHERE a.response_id = ?1`,
      )
      .bind(response!.id)
      .first<{ name: string; form_id: string; score_total: number }>();
    expect(link!.name).toBe("Иванов Иван");
    expect(link!.form_id).toBe(form.id);
    expect(link!.score_total).toBe(3);

    // 3) Второй ученик по своей ссылке — отдельная строка ответа.
    await submitPersonal(petrova!.token, form.token, { answers: [{ taskNumber: 1, value: "5" }] });
    const count = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM form_responses WHERE form_id = ?1")
      .bind(form.id)
      .first<{ cnt: number }>();
    expect(count!.cnt).toBe(2);
  });

  // ── S3. БЕЗОПАСНОСТЬ ПЕРСОНАЛЬНЫХ ДАННЫХ ────────────────────────────────
  it("S3: по ссылке нельзя узнать ни своё, ни чужое имя, эталоны не уходят", async () => {
    const classId = await createClass(SESSION_A, "5В");
    const [first, second] = await addStudents(SESSION_A, classId, [
      "СекретнаяПервая Ученица",
      "СекретныйВторой Ученик",
    ]);
    const form = await seedForm(TEACHER);

    const raw = await (await loadPersonal(first!.token, form.token)).text();

    // Ни своего, ни чужого имени в ответе нет — сервер их не отдаёт.
    expect(raw).not.toContain("СекретнаяПервая");
    expect(raw).not.toContain("СекретныйВторой");
    expect(raw).not.toContain("Ученица");
    expect(raw).not.toContain("Ученик");
    // Ни эталонов, ни разбора.
    expect(raw).not.toContain(SECRET_ANSWER);
    expect(raw).not.toContain(SECRET_EXPLANATION);
    expect(raw).not.toContain("answer");
    // И токен соседа по классу тоже не утёк.
    expect(raw).not.toContain(second!.token);

    // Имя едет ТОЛЬКО в базу, и едет из строки ученика, а не из запроса.
    await submitPersonal(first!.token, form.token, {
      studentName: "Ученик написал своё имя",
      answers: [{ taskNumber: 1, value: "4" }],
    });
    const row = await env.DB
      .prepare("SELECT student_name FROM form_responses ORDER BY rowid DESC LIMIT 1")
      .first<{ student_name: string }>();
    expect(row!.student_name).toBe("СекретнаяПервая Ученица");
  });

  // ── S4. Чужой класс по чужой ссылке — отказ ──────────────────────────────
  it("S4: чужой класс по чужой ссылке → 403, а не пустой ответ", async () => {
    const classA = await createClass(SESSION_A, "7А");
    const [studentA] = await addStudents(SESSION_A, classA, ["Чужой Ученик"]);
    // Форма ВТОРОГО учителя. Ссылка ученика первого на неё не действует.
    const foreignForm = await seedForm(OTHER_TEACHER);

    const loaded = await loadPersonal(studentA!.token, foreignForm.token);
    expect(loaded.status).toBe(403);
    const body = (await loaded.json()) as { code: string; error: string };
    expect(body.code).toBe("CLASS_LINK_FORBIDDEN");

    const submitted = await submitPersonal(studentA!.token, foreignForm.token, { answers: correctAnswers });
    expect(submitted.status).toBe(403);
    // И ничего не записалось.
    const rows = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM form_responses WHERE form_id = ?1")
      .bind(foreignForm.id)
      .first<{ cnt: number }>();
    expect(rows!.cnt).toBe(0);
  });

  // ── S5. Учитель правит только свой класс ─────────────────────────────────
  it("S5: чужой класс и чужой ученик → 403 (а не 404: «не твой» ≠ «нет»)", async () => {
    const mine = await createClass(SESSION_A, "8А");
    const theirs = await createClass(SESSION_B, "8А"); // то же имя у другого учителя — S11
    const [myStudent] = await addStudents(SESSION_A, mine, ["Мой Ученик"]);
    const [theirStudent] = await addStudents(SESSION_B, theirs, ["Их Ученик"]);

    const cases: Array<[string, string, RequestInit]> = [
      ["PATCH чужой класс", `https://worker.test/api/classes/${theirs}`, { method: "PATCH", body: JSON.stringify({ name: "Моё" }) }],
      ["DELETE чужой класс", `https://worker.test/api/classes/${theirs}`, { method: "DELETE" }],
      ["POST в чужой класс", `https://worker.test/api/classes/${theirs}/students`, { method: "POST", body: JSON.stringify({ name: "Свой" }) }],
      ["PATCH чужой ученик", `https://worker.test/api/classes/${theirs}/students/${theirStudent!.id}`, { method: "PATCH", body: JSON.stringify({ name: "Своё" }) }],
      ["DELETE чужой ученик", `https://worker.test/api/classes/${theirs}/students/${theirStudent!.id}`, { method: "DELETE" }],
    ];
    for (const [label, url, init] of cases) {
      const res = await SELF.fetch(url, { ...init, headers: auth(SESSION_A) });
      expect(res.status, label).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code, label).toBe("CLASS_FORBIDDEN");
    }

    // Свой класс и ученик при этом не пострадали, чужой — тоже на месте.
    const mineList = (await (await SELF.fetch("https://worker.test/api/classes", { headers: auth(SESSION_A) })).json()) as {
      classes: Array<{ id: string; students: Array<{ id: string }> }>;
    };
    const own = mineList.classes.find((c) => c.id === mine);
    expect(own?.students.map((s) => s.id)).toContain(myStudent!.id);

    const theirsList = (await (await SELF.fetch("https://worker.test/api/classes", { headers: auth(SESSION_B) })).json()) as {
      classes: Array<{ id: string; students: Array<{ id: string }> }>;
    };
    const foreign = theirsList.classes.find((c) => c.id === theirs);
    expect(foreign?.students.map((s) => s.id)).toEqual([theirStudent!.id]);
  });

  // ── S6. Удаление ученика не бросает его ответы ───────────────────────────
  it("S6: убранный ученик сохраняет свои ответы, а его ссылка гаснет (410)", async () => {
    const classId = await createClass(SESSION_A, "9А");
    const [leaver] = await addStudents(SESSION_A, classId, ["Ушедший Ученик"]);
    const form = await seedForm(TEACHER);

    await submitPersonal(leaver!.token, form.token, { answers: correctAnswers });

    const res = await SELF.fetch(`https://worker.test/api/classes/${classId}/students/${leaver!.id}`, {
      method: "DELETE",
      headers: auth(SESSION_A),
    });
    expect(res.status).toBe(200);

    // 1) Строка ученика на месте — ответ не остался без хозяина.
    const still = await env.DB
      .prepare("SELECT name, removed_at FROM class_students WHERE id = ?1")
      .bind(leaver!.id)
      .first<{ name: string; removed_at: number | null }>();
    expect(still!.name).toBe("Ушедший Ученик");
    expect(still!.removed_at).not.toBeNull();

    // 2) Учитель видит ушедшего и его баллы отдельным списком.
    const list = await SELF.fetch("https://worker.test/api/classes", { headers: auth(SESSION_A) });
    const body = (await list.json()) as {
      removedStudents: Array<{ id: string; name: string; removed: boolean }>;
    };
    const removed = body.removedStudents.find((s) => s.id === leaver!.id);
    expect(removed).toBeDefined();
    expect(removed!.name).toBe("Ушедший Ученик");
    expect(removed!.removed).toBe(true);

    // 3) Привязка ответа жива и по-прежнему резолвится в имя.
    const link = await env.DB
      .prepare(
        `SELECT s.name FROM class_student_answers a
           JOIN class_students s ON s.id = a.student_id WHERE a.student_id = ?1`,
      )
      .bind(leaver!.id)
      .first<{ name: string }>();
    expect(link!.name).toBe("Ушедший Ученик");

    // 4) Ссылка перестала работать — отданный QR нельзя переиспользовать.
    const after = await loadPersonal(leaver!.token, form.token);
    expect(after.status).toBe(410);
    const afterBody = (await after.json()) as { code: string };
    expect(afterBody.code).toBe("STUDENT_REMOVED");

    // 5) Вернуть можно одной кнопкой, ответы при этом не теряются.
    const restored = await SELF.fetch(`https://worker.test/api/classes/${classId}/students/${leaver!.id}/restore`, {
      method: "POST",
      headers: auth(SESSION_A),
    });
    expect(restored.status).toBe(200);
    expect((await loadPersonal(leaver!.token, form.token)).status).toBe(200);
  });

  // ── S7. Обратная совместимость ───────────────────────────────────────────
  it("S7: учитель без учеников работает как раньше, старая ссылка открывается", async () => {
    // 1) Пустой кабинет — не ошибка, а пустой список.
    const empty = await SELF.fetch("https://worker.test/api/classes", { headers: auth(SESSION_B) });
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as { classes: unknown[] };
    expect(emptyBody.classes).toEqual([]);

    // 2) Старая общая ссылка (без учеников) продолжает работать.
    const form = await seedForm(TEACHER, { accessCode: "5А" });
    const old = await SELF.fetch(`https://worker.test/api/public/forms/${form.token}/status`);
    expect(old.status).toBe(200);
    expect(((await old.json()) as { status: string }).status).toBe("open");

    // 3) Ученик без персональной ссылки сдаёт как раньше: сам вводит имя.
    const submitted = await SELF.fetch(`https://worker.test/api/public/forms/${form.token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.5.0.1" },
      body: JSON.stringify({ studentName: "Анонимный С Текста", studentCode: "5а", answers: correctAnswers }),
    });
    expect(submitted.status).toBe(201);
    const row = await env.DB
      .prepare("SELECT student_name FROM form_responses WHERE form_id = ?1")
      .bind(form.id)
      .first<{ student_name: string }>();
    expect(row!.student_name).toBe("Анонимный С Текста");
  });

  // ── S8. Лимиты отправки не изменились ───────────────────────────────────
  /**
   * Персональная ссылка обязана тратить ТОТ ЖЕ бюджет, что и общая. Иначе
   * класс из 30 человек получил бы 60 + 60 отправок в час с одного школьного
   * Wi-Fi, и ровно тот поломанный урок, ради которого лимит поднимали до 60,
   * вернулся бы с другой стороны.
   *
   * Проверяем не «в коде 60», а главное: оба пути пишут в ОДИН bucket по
   * ОДНОМУ ключу. Само число 60 и потолок 200 зафиксированы скриптом
   * `scripts/check-class-roster.mjs`.
   */
  it("S8: персональная и общая ссылки тратят один бюджет (тот же bucket и ключ)", async () => {
    const classId = await createClass(SESSION_A, "9Б");
    const [student] = await addStudents(SESSION_A, classId, ["Лимит Ученик"]);
    const form = await seedForm(TEACHER);
    const ip = "10.6.0.7";

    await submitPersonal(student!.token, form.token, { answers: correctAnswers }, ip);
    const afterPersonal = await env.DB
      .prepare("SELECT key, count FROM rate_limits WHERE key LIKE 'form-submit:%'")
      .all<{ key: string; count: number }>();
    expect(afterPersonal.results).toHaveLength(1);

    await SELF.fetch(`https://worker.test/api/public/forms/${form.token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ studentName: "С Текста", answers: correctAnswers }),
    });

    const afterBoth = await env.DB
      .prepare("SELECT key, count FROM rate_limits WHERE key LIKE 'form-submit:%'")
      .all<{ key: string; count: number }>();

    // Та же строка, а не вторая: счётчик общий, второй путь его долил.
    expect(afterBoth.results).toHaveLength(1);
    expect(afterBoth.results[0]!.key).toBe(afterPersonal.results[0]!.key);
    expect(afterBoth.results[0]!.count).toBe(afterPersonal.results[0]!.count + 1);
    // И ключ устроен как «форма + IP» — токен ФОРМЫ, а не токен ученика.
    expect(afterBoth.results[0]!.key).toContain(form.token);
  });

  // ── S9. Один ученик на две работы ────────────────────────────────────────
  it("S9: один ученик на две работы — две разные привязки, ничего не перепутано", async () => {
    const classId = await createClass(SESSION_A, "10А");
    const [student] = await addStudents(SESSION_A, classId, ["Двухсотый Ученик"]);
    const first = await seedForm(TEACHER);
    const second = await seedForm(TEACHER);

    await submitPersonal(student!.token, first.token, { answers: correctAnswers });
    await submitPersonal(student!.token, second.token, { answers: [{ taskNumber: 1, value: "5" }] });

    const links = await env.DB
      .prepare(
        `SELECT form_id, score_total FROM class_student_answers
          WHERE student_id = ?1 ORDER BY submitted_at ASC`,
      )
      .bind(student!.id)
      .all<{ form_id: string; score_total: number }>();
    expect(links.results).toHaveLength(2);
    expect(links.results[0]!.form_id).toBe(first.id);
    expect(links.results[0]!.score_total).toBe(3);
    expect(links.results[1]!.form_id).toBe(second.id);
    expect(links.results[1]!.score_total).toBe(0);
  });

  // ── S10. Удаление класса с ответами ──────────────────────────────────────
  it("S10: удаление класса не стирает ответы — они остаются у формы с именем", async () => {
    const classId = await createClass(SESSION_A, "10Б");
    const [student] = await addStudents(SESSION_A, classId, ["Класс Удалят"]);
    const form = await seedForm(TEACHER);
    await submitPersonal(student!.token, form.token, { answers: correctAnswers });

    const res = await SELF.fetch(`https://worker.test/api/classes/${classId}`, {
      method: "DELETE",
      headers: auth(SESSION_A),
    });
    expect(res.status).toBe(200);

    // Ответ у формы остался вместе с именем.
    const response = await env.DB
      .prepare("SELECT student_name, score_total FROM form_responses WHERE form_id = ?1")
      .bind(form.id)
      .first<{ student_name: string; score_total: number }>();
    expect(response!.student_name).toBe("Класс Удалят");
    expect(response!.score_total).toBe(3);

    // Привязки к удалённому ученику больше нет, но и мусора не осталось.
    const links = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM class_student_answers WHERE student_id = ?1")
      .bind(student!.id)
      .first<{ cnt: number }>();
    expect(links!.cnt).toBe(0);
  });

  // ── S11. Одинаковое название класса у двух учителей ─────────────────────
  it("S11: два учителя с классом «11А» не мешают друг другу", async () => {
    const a = await createClass(SESSION_A, "11А");
    const b = await createClass(SESSION_B, "11А");
    expect(a).not.toBe(b);

    // Регистр и лишние пробелы — это тот же класс, второй раз не создаётся.
    const dup = await SELF.fetch("https://worker.test/api/classes", {
      method: "POST",
      headers: auth(SESSION_A),
      body: JSON.stringify({ name: " 11а " }),
    });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { code: string }).code).toBe("CLASS_EXISTS");
  });

  // ── S12. Кириллица, латиница, длинные фамилии, одинаковые имена ─────────
  it("S12: длинные фамилии и одинаковые имена внутри класса не ломают выдачу", async () => {
    const classId = await createClass(SESSION_A, "11Б");
    // Фамилия длиннее любого разумного: обрезается, но не рвётся и не теряется.
    const longName = `${"К".repeat(200)}`;
    const students = await addStudents(SESSION_A, classId, [
      "Johansson-Öberg Änn-Liisa",
      longName,
    ]);
    // Тезка, добавленный ОТДЕЛЬНЫМ вызовом, — это второй ученик, а не дубль
    // первого: в одной вставке одинаковые строки схлопываются (S1), в разных —
    // нет. В 5А два «Иванов И.» это норма, а не опечатка.
    const namesake1 = await addStudents(SESSION_A, classId, ["Иванов Иван Иванович"]);
    const namesake2 = await addStudents(SESSION_A, classId, ["Иванов Иван Иванович"]);
    expect(namesake1[0]!.token).not.toBe(namesake2[0]!.token);
    students.push(...namesake1, ...namesake2);
    expect(students).toHaveLength(4);

    const form = await seedForm(TEACHER);
    for (const s of students) {
      const res = await submitPersonal(s.token, form.token, { answers: correctAnswers });
      expect(res.status, `ссылка ученика ${s.name.slice(0, 12)}`).toBe(201);
    }

    const names = await env.DB
      .prepare(
        `SELECT r.student_name FROM form_responses r ORDER BY r.submitted_at ASC`,
      )
      .all<{ student_name: string }>();
    const last = names.results.slice(-4).map((r) => r.student_name);
    expect(last).toContain("Johansson-Öberg Änn-Liisa");
    // Длинная фамилия обрезалась до 120 символов, но не развалилась.
    expect(last).toContain(longName.slice(0, 120));
    // Тезак — две отдельные строки, а не одна склеенная.
    const ivanovs = last.filter((n) => n === "Иванов Иван Иванович");
    expect(ivanovs).toHaveLength(2);
  });

  // ── S13. Повторное открытие одной ссылки ─────────────────────────────────
  it("S13: ученик открыл ссылку дважды и сдал дважды — оба ответа сохранились", async () => {
    const classId = await createClass(SESSION_A, "6А");
    const [student] = await addStudents(SESSION_A, classId, ["Дважды Ученик"]);
    const form = await seedForm(TEACHER);

    const first = await submitPersonal(student!.token, form.token, { answers: correctAnswers });
    const second = await submitPersonal(student!.token, form.token, { answers: [{ taskNumber: 1, value: "не знаю" }] });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const rows = await env.DB
      .prepare(
        `SELECT a.score_total FROM class_student_answers a
           JOIN form_responses r ON r.id = a.response_id
          WHERE a.student_id = ?1 AND a.form_id = ?2 ORDER BY a.rowid ASC`,
      )
      .bind(student!.id, form.id)
      .all<{ score_total: number }>();
    expect(rows.results.map((r) => r.score_total)).toEqual([3, 0]);

    // В кабинете у учителя виден ПОСЛЕДНИЙ ответ, а не первый.
    const list = await SELF.fetch("https://worker.test/api/classes", { headers: auth(SESSION_A) });
    const body = (await list.json()) as { classes: Array<{ students: Array<{ id: string }> }> };
    const target = body.classes.flatMap((c) => c.students).find((s) => s.id === student!.id);
    expect(target).toBeDefined();
  });
});
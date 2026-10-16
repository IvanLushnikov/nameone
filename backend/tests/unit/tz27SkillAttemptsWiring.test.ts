/// <reference types="@cloudflare/vitest-plugin" />
/**
 * ТЗ-27, ПРОБЕЛЫ 1, 3, 5, 6 — попытки по темам доживают до экрана.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ФАЙЛ
 * ─────────────────────────────────────────────────────────────────────────────
 * G1 (ПРОБЕЛ 1, главный). Попытка по теме записывается на ОСНОВНОМ пути
 *     проверки — `PATCH /api/assignments/forms/:id/responses/:rid/answers/:n`,
 *     то есть тем самым запросом, который делает интерфейс учителя
 *     (`FormSummary.tsx`). Раньше пересчёт жил только в журнале и по кнопке
 *     recheck, поэтому учитель правил отметку и не получал НИ ОДНОЙ строки в
 *     «темах, где просели»: фича выглядела как неработающая.
 *     Плюс второй путь — закрытие формы (`close`), при котором пересчёт
 *     ловит все работы класса сразу.
 *
 * G2 (ПРОБЕЛ 1, вердикт машины). Автосверка при сдаче по персональной ссылке
 *     тоже пишет попытки. Иначе основная масса строк (а их всегда больше,
 *     чем ручных правок) не появилась бы никогда.
 *
 * G3 (ПРОБЕЛ 3). Учитель меняет метку через `PATCH /api/worksheets/:id`:
 *     новая метка доезжает до `payload_json`, старая не «срастается» с новой,
 *     пустая строка означает «метки нет», а не «оставь старую».
 *
 * G4 (ПРОБЕЛ 5). `GET /api/classes/:id/report` отдаёт `skills` — те же строки
 *     и в том же порядке, что и `GET /api/journal/classes/:id/skills`
 *     (худшая тема сверху). Класс без меток отдаёт пустой массив, а не ошибку.
 *
 * G5 (ПРОБЕЛ 6). `schema.sql` — файл, который реально накатывается на боевую
 *     базу (`npm run db:migrate:prod`), и в нём таблица `skill_attempts`
 *     объявлена РОВНО ОДИН раз. Дубль выглядел безобидно (`IF NOT EXISTS`
 *     тихо оставляет первую половину), но индексы второй половины при этом
 *     создавались, а первая половина — нет: схема в разных сборках отличалась
 *     набором индексов при одинаковых колонках.
 *
 * Тесты идут в workerd с настоящим D1 и настоящими роутами (SELF.fetch).
 *
 * LLM НЕ ВЫЗЫВАЕТСЯ, и это не обход, а устройство пути сдачи по персональной
 * ссылке: `submitLinkAnswer` зовёт обычную `gradeSubmission` (src/routes/classes.ts),
 * без движка коротких ответов — движок живёт только в `publicForms`. Поэтому
 * «вердикт машины» на этом пути — это сверка с ЭТАЛОНОМ у заданий, которые
 * сверяются автоматически (`multiple-choice`, `computation`, `fill-blank`).
 * Короткие ответы и эссе уходят учителю с `is_correct = NULL`, и их строки
 * появляются позже, на учительском пути (G1) — это проверяется отдельно.
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createUser, createSession } from "../../src/db/queries";

import BOOTSTRAP_SCHEMA from "../../src/db/schema.sql?raw";

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

CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_user_name ON classes(user_id, name_key);

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
CREATE INDEX IF NOT EXISTS idx_csa_form ON class_student_answers(form_id, submitted_at DESC);

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
  percentage     REAL,
  grade_mark     TEXT,
  needs_review   INTEGER NOT NULL DEFAULT 0,
  model          TEXT,
  provider       TEXT,
  cost_usd       REAL NOT NULL DEFAULT 0,
  latency_ms     INTEGER,
  error_code     TEXT,
  deleted_at     INTEGER,
  delete_at      INTEGER,
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS form_answer_photos (
  id             TEXT PRIMARY KEY,
  response_id    TEXT NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,
  task_number    INTEGER NOT NULL,
  photo_check_id TEXT NOT NULL,
  r2_key         TEXT NOT NULL,
  delete_at      INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fap_response_task ON form_answer_photos(response_id, task_number);

-- ТЗ-27: единственное объявление таблицы попыток. В боевой базе её создаёт
-- 'schema.sql' (npm run db:migrate:prod), поэтому объявление тут — ровно то же,
-- что в src/db/schema.sql, а не «сокращённая версия для теста».
CREATE TABLE IF NOT EXISTS skill_attempts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  skill        TEXT NOT NULL,
  form_id      TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  response_id  TEXT NOT NULL,
  student_id   TEXT REFERENCES class_students(id) ON DELETE CASCADE,
  checked_at   INTEGER NOT NULL,
  correct      INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_response_skill ON skill_attempts(response_id, skill);
CREATE INDEX IF NOT EXISTS idx_sa_class_skill_time ON skill_attempts(class_id, skill, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_student_skill_time ON skill_attempts(student_id, skill, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_form ON skill_attempts(form_id);
CREATE INDEX IF NOT EXISTS idx_sa_user_class_skill_time ON skill_attempts(user_id, class_id, skill, checked_at DESC);
`;

const OWNER = "usr_tz27owner1";
const STRANGER = "usr_tz27other1";
const SESSION = "sess_tz27_owner";
const WS_ID = "ws_tz27skill01";

/** Метки листа: два задания одной темы, одно — другой. */
const TASKS = [
  { number: 1, text: "Найдите сумму 1/8 + 1/8", type: "short-answer", answer: "1/4", points: 1, skill: "Давление твёрдых тел" },
  { number: 2, text: "Представьте 3/4 в виде смешанного числа", type: "short-answer", answer: "3/4", points: 1, skill: "Давление твёрдых тел" },
  { number: 3, text: "Почему 1/2 больше 1/3?", type: "short-answer", answer: "потому что", points: 1, skill: "Дроби" },
];

/**
 * Те же метки, но задания сверяются АВТОМАТИЧЕСКИ, по эталону.
 *
 * Нужны для проверок, где пересчёт запускается в момент СДАЧИ: у `short-answer`
 * на этом пути `is_correct = NULL` (короткий ответ проверяет учитель или модель),
 * а пересчёт ответы без вердикта не считает — и правильно. Чтобы «строка
 * появилась сразу при сдаче» вообще было возможно, у задания должен быть
 * вердикт, то есть автосверяемый тип.
 */
const TASKS_AUTO = [
  { number: 1, text: "Найдите сумму 1/8 + 1/8", type: "fill-blank", answer: "1/4", points: 1, skill: "Давление твёрдых тел" },
  { number: 2, text: "Представьте 3/4 в виде смешанного числа", type: "fill-blank", answer: "3/4", points: 1, skill: "Давление твёрдых тел" },
  { number: 3, text: "Найдите разность 1/2 - 1/3", type: "fill-blank", answer: "1/6", points: 1, skill: "Дроби" },
];

function auth(token: string): Record<string, string> {
  return { cookie: `session=${token}`, "Content-Type": "application/json" };
}

let formSeq = 0;

/**
 * Лист с указанными заданиями.
 *
 * Метки берутся из `TASKS` по умолчанию — именно из листа их и читает
 * пересчёт, а не из ответа: правка метки в листе обязана менять разрез.
 */
async function seedForm(
  userId: string,
  tasks: Array<Record<string, unknown>> = TASKS,
): Promise<{ id: string; token: string }> {
  formSeq += 1;
  const id = `frm_tz27_${String(formSeq).padStart(4, "0")}`;
  const token = `tz27token${String(formSeq).padStart(4, "0")}aaaaaaaaaaaaaaaa`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO forms
         (id, token, user_id, worksheet_id, title, subject, grade, payload_json, status,
          access_code, expires_at, show_answers, check_mode, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, 'Давление', 'physics', 7, ?4, 'open', NULL, ?5, 0, 'manual', ?6, ?6)`,
    )
    .bind(id, token, userId, JSON.stringify({ tasks }), now + 7 * 86400, now)
    .run();
  return { id, token };
}

/** Класс с одним учеником. */
async function seedClass(session: string, name: string): Promise<string> {
  const res = await SELF.fetch("https://uchlist.test/api/classes", {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({ name }),
  });
  expect(res.status, "создание класса").toBe(201);
  const body = (await res.json()) as { class: { id: string } };
  return body.class.id;
}

async function seedStudent(session: string, classId: string, name: string) {
  const res = await SELF.fetch(`https://uchlist.test/api/classes/${classId}/students`, {
    method: "POST",
    headers: auth(session),
    body: JSON.stringify({ names: [name] }),
  });
  expect(res.status, "добавление ученика").toBe(201);
  const body = (await res.json()) as { students: Array<{ id: string; token: string }> };
  return body.students[0]!;
}

/**
 * Сдача работы по персональной ссылке.
 *
 * Это настоящий путь ученика, а не INSERT в базу: он же триггерит автосверку
 * и пересчёт попыток на сервере, и только так проверяется, что машина тоже
 * пишет строки (ПРОБЕЛ 1, ветка «вердикт машины»).
 *
 * IP у каждой отправки свой: пара «форма + IP» попадает под лимит частоты.
 */
async function submitPersonal(
  studentToken: string,
  formToken: string,
  answers: Array<{ taskNumber: number; value: string }>,
  ip: string,
): Promise<string> {
  const res = await SELF.fetch(
    `https://uchlist.test/api/public/class-links/${studentToken}/forms/${formToken}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ answers }),
    },
  );
  expect(res.status, "сдача работы").toBe(201);
  const body = (await res.json()) as { responseId?: string };
  return body.responseId ?? "";
}

/** Последний ответ по форме — тот самый `rid`, который правит учитель. */
async function latestResponseId(formId: string): Promise<string> {
  const row = await env.DB
    .prepare(`SELECT id FROM form_responses WHERE form_id = ?1 ORDER BY submitted_at DESC LIMIT 1`)
    .bind(formId)
    .first<{ id: string }>();
  if (!row) throw new Error("у формы нет ответов");
  return String(row.id);
}

/** Отметка учителя по одному заданию — основной путь проверки из интерфейса. */
async function reviewAnswer(
  formId: string,
  responseId: string,
  taskNumber: number,
  isCorrect: boolean,
  session = SESSION,
) {
  return SELF.fetch(
    `https://uchlist.test/api/assignments/forms/${formId}/responses/${responseId}/answers/${taskNumber}`,
    {
      method: "PATCH",
      headers: auth(session),
      body: JSON.stringify({ isCorrect }),
    },
  );
}

/** Строки попыток по теме — как их читает и экран, и выгрузка. */
async function attemptRows(classId: string): Promise<Array<{ skill: string; correct: number; total: number }>> {
  const rows = await env.DB
    .prepare(`SELECT skill, correct, total FROM skill_attempts WHERE class_id = ?1 ORDER BY skill`)
    .bind(classId)
    .all<{ skill: string; correct: number; total: number }>();
  return rows.results ?? [];
}

/** Разрез из ответа ведомости. */
async function reportSkills(session: string, classId: string) {
  const res = await SELF.fetch(`https://uchlist.test/api/classes/${classId}/report`, {
    headers: auth(session),
  });
  expect(res.status, "GET report").toBe(200);
  const body = (await res.json()) as {
    report: { skills?: Array<{ skill: string; correct: number; total: number; percent: number | null }> };
  };
  return body.report.skills;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
});

beforeEach(async () => {
  for (const table of [
    "skill_attempts",
    "class_student_answers",
    "form_answers",
    "form_responses",
    "class_students",
    "classes",
    "forms",
    "worksheets",
    "photo_checks",
    "sessions",
    "usage_counters",
    "rate_limits",
    "users",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  formSeq = 0;

  await createUser(env.DB, { id: OWNER, email: "tz27-owner@test.local", plan: "plus" });
  await createUser(env.DB, { id: STRANGER, email: "tz27-other@test.local", plan: "plus" });
  await createSession(env.DB, { token: SESSION, userId: OWNER });

  const payload = {
    id: WS_ID,
    title: "Давление · 7 класс",
    subject: "physics",
    grade: 7,
    topic: "Давление твёрдых тел",
    difficulty: "medium",
    tasks: TASKS,
    createdAt: new Date().toISOString(),
  };
  await env.DB
    .prepare(
      `INSERT INTO worksheets
         (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
       VALUES (?1, ?2, 'physics', 7, 'Давление твёрдых тел', 'medium', 'worksheet', 3, ?3, ?4, ?5)`,
    )
    .bind(WS_ID, OWNER, payload.title, JSON.stringify(payload), Math.floor(Date.now() / 1000))
    .run();
});

describe("G1: попытки по темам пишутся на ОСНОВНОМ пути проверки", () => {
  it("правка отметки учителем через PATCH answers пишет строки skill_attempts", async () => {
    const classId = await seedClass(SESSION, "7А");
    const student = await seedStudent(SESSION, classId, "Петров");
    const form = await seedForm(OWNER);
    const responseId = await submitPersonal(
      student.token,
      form.token,
      [
        { taskNumber: 1, value: "неверно" },
        { taskNumber: 2, value: "неверно" },
      ],
      "10.0.0.1",
    );

    // Сначала чистим то, что могло записаться при самой сдаче, чтобы тест
    // проверял РОВНО путь учителя, а не смесь путей.
    await env.DB.prepare(`DELETE FROM skill_attempts`).run();

    const res = await reviewAnswer(form.id, responseId, 1, false);
    expect(res.status, "правка отметки").toBe(200);
    const body = (await res.json()) as { skillAttemptsRecorded?: number };
    expect(
      Number(body.skillAttemptsRecorded ?? 0),
      "правка отметки обязана пересчитать попытки по темам",
    ).toBeGreaterThan(0);

    const rows = await attemptRows(classId);
    expect(rows.length, "учительская правка должна писать попытки").toBeGreaterThan(0);
    expect(rows.some((r) => r.skill === "Давление твёрдых тел")).toBe(true);
  });

  it("закрытие формы тоже пересчитывает — учитель жмёт «закрыть», а не правит каждое задание", async () => {
    const classId = await seedClass(SESSION, "7Б");
    const student = await seedStudent(SESSION, classId, "Сидоров");
    const form = await seedForm(OWNER);
    const responseId = await submitPersonal(
      student.token,
      form.token,
      [{ taskNumber: 1, value: "неверно" }],
      "10.0.0.2",
    );

    // Ответ сначала проверяется учителем: пока ответ не проверен, правильных
    // и не��равных нет, а пересчитывать нечего. Это не «тест сломался», это
    // порядок работы, который проверяем.
    await reviewAnswer(form.id, responseId, 1, false);

    await env.DB.prepare(`DELETE FROM skill_attempts`).run();

    const res = await SELF.fetch(`https://uchlist.test/api/assignments/forms/${form.id}`, {
      method: "PATCH",
      headers: auth(SESSION),
      body: JSON.stringify({ action: "close" }),
    });
    expect(res.status, "закрытие формы").toBe(200);
    const body = (await res.json()) as { skillAttemptsRecorded?: number };
    expect(Number(body.skillAttemptsRecorded ?? 0)).toBeGreaterThan(0);
    expect((await attemptRows(classId)).length).toBeGreaterThan(0);
  });

  it("лист без меток не ломает пересчёт: 0 строк — это норма, а не ошибка", async () => {
    const classId = await seedClass(SESSION, "7В");
    const form = await seedForm(OWNER, [
      { number: 1, text: "Без метки", type: "fill-blank", answer: "x", points: 1 },
    ]);
    const st = await seedStudent(SESSION, classId, "Кузнецов");
    await submitPersonal(st.token, form.token, [{ taskNumber: 1, value: "неверно" }], "10.0.0.3");

    expect(await attemptRows(classId), "без меток строк быть не должно").toEqual([]);
  });

  it("чужая форма — 404, а не 403: по коду ответа иначе перебираются чужие id", async () => {
    const classId = await seedClass(SESSION, "7Г");
    const student = await seedStudent(SESSION, classId, "Никитин");
    const form = await seedForm(OWNER);
    const responseId = await submitPersonal(student.token, form.token, [{ taskNumber: 1, value: "x" }], "10.0.0.4");

    const strangerSession = "sess_tz27_stranger";
    await createSession(env.DB, { token: strangerSession, userId: STRANGER });
    const res = await reviewAnswer(form.id, responseId, 1, false, strangerSession);
    expect(res.status, "чужой лист").toBe(404);
  });
});

describe("G2: вердикт МАШИНЫ тоже пишет попытки", () => {
  it("автосверка при сдаче по персональной ссылке наполняет skill_attempts", async () => {
    const classId = await seedClass(SESSION, "8А");
    const student = await seedStudent(SESSION, classId, "Орлов");

    // Задания сверяются автоматически, по эталону: только так у ответа на
    // момент сдачи есть вердикт. Обновлять `check_mode` здесь не нужно и
    // бессмысленно — на пути персональной сдачи он не читается: сверку решает
    // ТИП задания, а не флажок формы.
    const form = await seedForm(OWNER, TASKS_AUTO);

    await submitPersonal(
      student.token,
      form.token,
      [
        { taskNumber: 1, value: "1/4" },
        { taskNumber: 2, value: "3/4" },
      ],
      "10.0.1.1",
    );

    const rows = await attemptRows(classId);
    expect(rows.length, "сдача с автосверкой должна писать попытки").toBeGreaterThan(0);
    const pressure = rows.find((r) => r.skill === "Давление твёрдых тел");
    expect(pressure, "метка задания должна доехать до попытки").toBeDefined();
    expect(pressure?.correct).toBe(2);
  });
});

describe("G3: учитель меняет метку листа (ПРОБЕЛ 3)", () => {
  it("PATCH /api/worksheets/:id сохраняет новую метку в payload_json", async () => {
    const res = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_ID}`, {
      method: "PATCH",
      headers: auth(SESSION),
      body: JSON.stringify({
        tasks: [
          { number: 1, text: "Найдите сумму 1/8 + 1/8", skill: "Своя формулировка" },
          { number: 2, text: "Представьте 3/4", skill: "Своя формулировка" },
          { number: 3, text: "Почему 1/2 больше 1/3?", skill: "" },
        ],
      }),
    });
    expect(res.status, "правка листа").toBe(200);

    const row = await env.DB
      .prepare(`SELECT payload_json FROM worksheets WHERE id = ?1`)
      .bind(WS_ID)
      .first<{ payload_json: string }>();
    const tasks = (JSON.parse(String(row?.payload_json)) as { tasks: Array<{ number: number; skill?: string }> })
      .tasks;
    expect(tasks[0]?.skill).toBe("Своя формулировка");
    expect(tasks[1]?.skill).toBe("Своя формулировка");
    // Пустая строка — это «метки нет», а не «оставь старую»: иначе учитель
    // не смог бы убрать метку с задания.
    expect(tasks[2]?.skill ?? "").toBe("");
  });

  it("метка, которую не прислали, сохраняется — правка текста не стирает метку", async () => {
    const before = await env.DB
      .prepare(`SELECT payload_json FROM worksheets WHERE id = ?1`)
      .bind(WS_ID)
      .first<{ payload_json: string }>();
    expect(before?.payload_json).toContain("Давление твёрдых тел");

    const res = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_ID}`, {
      method: "PATCH",
      headers: auth(SESSION),
      body: JSON.stringify({
        tasks: [
          { number: 1, text: "Найдите сумму 1/8 + 1/8" },
          { number: 2, text: "Представьте 3/4" },
          { number: 3, text: "Почему 1/2 больше 1/3?" },
        ],
      }),
    });
    expect(res.status, "правка только текста").toBe(200);

    const row = await env.DB
      .prepare(`SELECT payload_json FROM worksheets WHERE id = ?1`)
      .bind(WS_ID)
      .first<{ payload_json: string }>();
    const tasks = (JSON.parse(String(row?.payload_json)) as { tasks: Array<{ number: number; skill?: string }> })
      .tasks;
    expect(tasks[0]?.skill, "метка не должна теряться при правке текста").toBe("Давление твёрдых тел");
  });

  it("метка длиннее лимита — 400, а не молчаливая обрезка", async () => {
    const res = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_ID}`, {
      method: "PATCH",
      headers: auth(SESSION),
      body: JSON.stringify({
        tasks: [{ number: 1, text: "Задание", skill: "я".repeat(200) }],
      }),
    });
    expect(res.status, "слишком длинная метка").toBe(400);
  });

  it("чужой лист — 404", async () => {
    const strangerSession = "sess_tz27_stranger_ws";
    await createSession(env.DB, { token: strangerSession, userId: STRANGER });
    const res = await SELF.fetch(`https://uchlist.test/api/worksheets/${WS_ID}`, {
      method: "PATCH",
      headers: auth(strangerSession),
      body: JSON.stringify({ tasks: [{ number: 1, text: "Задание", skill: "Тема" }] }),
    });
    expect(res.status, "чужой лист").toBe(404);
  });
});

describe("G4: отчёт класса отдаёт skills (ПРОБЕЛ 5)", () => {
  it("в ответе есть строки разреза, худшая тема сверху", async () => {
    const classId = await seedClass(SESSION, "9А");
    const student = await seedStudent(SESSION, classId, "Зайцев");

    // Две темы с ЗАВЕДОМО РАЗНЫМ процентом: «Давление» посчитана полностью
    // верной, «Дроби» — с ошибкой. Порядок строк проверяет сортировку.
    // Задания автосверяемые: сортировать нечего, пока строк нет.
    const form = await seedForm(OWNER, TASKS_AUTO);
    await submitPersonal(
      student.token,
      form.token,
      [
        { taskNumber: 1, value: "1/4" },
        { taskNumber: 2, value: "3/4" },
        { taskNumber: 3, value: "мимо" },
      ],
      "10.0.2.1",
    );

    const skills = await reportSkills(SESSION, classId);
    expect(Array.isArray(skills), "skills обязан быть массивом").toBe(true);
    if (!Array.isArray(skills)) throw new Error("skills не массив");
    expect(skills.length, "в отчёте должны быть строки разреза").toBeGreaterThan(0);
    {
      const percents = skills.map((s) => s.percent ?? 0);
      const sorted = [...percents].sort((a, b) => a - b);
      expect(percents, "разрез должен идти по возрастанию процента").toEqual(sorted);
      // Худшая тема — ПЕРВОЙ строкой, а не просто «где-то в списке»: именно
      // этого учитель ждёт, открывая блок.
      expect(skills[0]?.skill, "худшая тема должна быть сверху").toBe("Дроби");
      expect(skills.every((s) => typeof s.total === "number")).toBe(true);
    }
  });

  it("в ответе есть total и correct — по ним учитель понимает, откуда процент", async () => {
    const classId = await seedClass(SESSION, "9Б");
    const student = await seedStudent(SESSION, classId, "Гусев");
    const form = await seedForm(OWNER, TASKS_AUTO);
    await submitPersonal(
      student.token,
      form.token,
      [
        { taskNumber: 1, value: "1/4" },
        { taskNumber: 2, value: "3/4" },
      ],
      "10.0.2.2",
    );

    const skills = await reportSkills(SESSION, classId);
    const pressure = skills?.find((s) => s.skill === "Давление твёрдых тел");
    expect(pressure, "метка листа обязана появиться в отчёте").toBeDefined();
    expect(pressure?.correct).toBe(2);
    expect(pressure?.total).toBe(2);
    expect(pressure?.percent).toBe(100);
  });

  it("класс без меток отдаёт пустой массив, а не ошибку и не undefined", async () => {
    const classId = await seedClass(SESSION, "9В");
    await seedStudent(SESSION, classId, "Белов");
    const skills = await reportSkills(SESSION, classId);
    expect(skills, "у класса без попыток skills должен быть []").toEqual([]);
  });

  it("чужой класс не отдаёт чужие темы: 403 и никаких строк", async () => {
    const classId = await seedClass(SESSION, "9Г");
    await seedStudent(SESSION, classId, "Орлов");
    const strangerSession = "sess_tz27_stranger_report";
    await createSession(env.DB, { token: strangerSession, userId: STRANGER });

    const res = await SELF.fetch(`https://uchlist.test/api/classes/${classId}/report`, {
      headers: auth(strangerSession),
    });
    expect(res.status, "чужой класс").toBe(403);
    const text = await res.text();
    expect(text.includes("Давление")).toBe(false);
  });
});

describe("G5: skill_attempts в схеме объявлена один раз (ПРОБЕЛ 6)", () => {
  it("в db/schema.sql ровно одно объявление таблицы, и оно не оборвано", async () => {
    // Файл читается текстом, а не через fs: workerd не имеет файловой системы
    // (см. начало worksheets.test.ts). Проверка смысловая: сколько раз таблица
    // объявлена в том самом файле, который накатывается на боевую базу.
    // Файл читается через `?raw` — так же, как cron-dispatch.test.ts и
    // freeQuotaAccounting.test.ts: workerd не имеет fs, а raw-импорт отдаёт
    // ровно тот файл, который накатывает npm run db:migrate:prod.
    const matches = BOOTSTRAP_SCHEMA.match(/CREATE TABLE IF NOT EXISTS skill_attempts/gu) ?? [];
    expect(matches.length, "таблица skill_attempts должна быть объявлена ровно один раз").toBe(1);
  });

  it("schema.sql заканчивается завершённым statement — сплиттер не отдаст пустой запрос", () => {
    const trimmed = BOOTSTRAP_SCHEMA.trim();
    expect(trimmed.length, "схема не должна быть пустой").toBeGreaterThan(0);
    expect(trimmed.endsWith(";"), "файл должен заканчиваться точкой с запятой").toBe(true);
  });
});
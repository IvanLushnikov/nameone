/// <reference types="@cloudflare/vitest-plugin" />
/**
 * Ведомость по классу: сводка, отметки и выгрузка (лист 3.1.3).
 *
 * Требования листа и тесты, которые их закрывают:
 *
 *   R1  Сводка считается СЕРВЕРОМ: числа «сколько сдали» и «кто не сдал»
 *       приезжают готовыми, а не собираются в браузере. Без входа — 401.
 *   R2  Чужой класс не виден: и сводка, и выгрузка чужого класса отказывают
 *       403 ДО того, как что-либо прочитали. Ошибка — «это класс другого
 *       учителя», а не «не найдено».
 *   R3  Ученик без ответов виден как «не сдал»: строка есть и в сводке, и в
 *       CSV, и не исчезает из ведомости.
 *   R4  Отметка ИИ и отметка учителя не сливаются: вердикт машины без шага
 *       учителя помечен отдельно и в числах сводки, и в выгрузке. После правки
 *       учителя метка меняется — и это видно.
 *   R5  Выгрузка — файл, а не текст на экране: UTF-8 BOM, разделитель `;`,
 *       CRLF, кириллица цела, запятая в фамилии файл не портит.
 *   R6  Пустое состояние объясняет причину: нет учеников / нет работ /
 *       нет ответов — три разных ответа, а не голый ноль.
 *   R7  Краевые случаи: класс из 30 человек, удалённый ученик, пересдача
 *       одной работы, две работы одного ученика, два учителя с одинаковым
 *       названием класса, работа по общей ссылке (её нельзя отнести к ученику).
 *
 * Тесты идут в workerd с настоящим D1 и настоящими роутами (SELF.fetch).
 * LLM не вызывается ни разу: сверка ответов — чистая арифметика в
 * `services/formGrading`, сетевых вызовов на пути нет (образец — см.
 * polza-cost-regression.test.ts). Состояние «оценила машина» задаётся прямо
 * в `check_meta_json`: этот снимок пишет сверка моделью, и подменять его
 * руками ровно то же самое, что происходит в бою.
 *
 * Схема D1 зашита в SCHEMA_SQL: workerd не имеет fs.readFileSync (см. начало
 * worksheets.test.ts и classes.test.ts).
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

const TEACHER = "usr_reportmain1";
const OTHER_TEACHER = "usr_reportother1";
const SESSION_A = "sess_report_teacher_a";
const SESSION_B = "sess_report_teacher_b";

function auth(session: string): Record<string, string> {
  return { Cookie: `session=${session}`, "Content-Type": "application/json" };
}

/** Что ждёт клиент от сводки. Ничего не выдумываем: ровно поля ответа. */
interface ReportCellView {
  formId: string;
  score: number;
  max: number;
  source: "teacher" | "teacher_with_model" | "model" | "auto" | "none";
  pendingTasks: number;
  modelTasks: number;
  teacherTasks: number;
  unconfirmedByTeacher: boolean;
}

interface ReportView {
  class: { id: string; name: string };
  works: Array<{ id: string; title: string; isOpen: boolean }>;
  students: Array<{ id: string; name: string; works: ReportCellView[] }>;
  summary: {
    studentsTotal: number;
    studentsSubmitted: number;
    studentsNotSubmitted: number;
    submittedWorks: number;
    pendingWorks: number;
    unconfirmedWorks: number;
    averagePercent: number | null;
    bySource: Record<string, number>;
    unlinkedAnswers: number;
  };
  worksTotal: number;
  worksTruncated: boolean;
  emptyReason: "no_students" | "no_works" | "no_answers" | null;
}

let formSeq = 0;

/**
 * Задать учителю форму.
 *
 * Задания подобраны так, чтобы различать три источника отметки: число и
 * вариант (считаются сами), эссе (ждёт учителя) и короткий ответ, которому в
 * тестах мы сами прописываем вердикт модели.
 */
async function seedForm(
  userId: string,
  opts: { title?: string; status?: string; subject?: string; expiresAt?: number } = {},
): Promise<{ id: string; token: string }> {
  formSeq += 1;
  const id = `frm_report${String(formSeq).padStart(6, "0")}`;
  const token = `reporttoken${String(formSeq).padStart(6, "0")}zzzzzzzzzzzzzz`;
  const now = Math.floor(Date.now() / 1000);
  const tasks: WorksheetTask[] = [
    { number: 1, text: "Сколько будет 2+2?", type: "computation", answer: "4", explanation: "", points: 2 },
    { number: 2, text: "Выбери верный вариант", type: "multiple-choice", options: ["Да", "Нет"], answer: "1", explanation: "", points: 1 },
    { number: 3, text: "Почему так?", type: "essay", answer: "42", explanation: "", points: 3 },
  ];

  await env.DB
    .prepare(
      `INSERT INTO forms
         (id, token, user_id, worksheet_id, title, subject, grade, payload_json, status,
          access_code, expires_at, show_answers, check_mode, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, 5, ?6, ?7, NULL, ?8, 0, 'auto', ?9, ?9)`,
    )
    .bind(
      id,
      token,
      userId,
      opts.title ?? "Дроби",
      opts.subject ?? "math",
      JSON.stringify({ tasks }),
      opts.status ?? "open",
      opts.expiresAt ?? now + 7 * 86400,
      now,
    )
    .run();

  return { id, token };
}

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
  expect(res.status, "добавление учеников").toBe(201);
  const body = (await res.json()) as { students: Array<{ id: string; name: string; token: string }> };
  return body.students;
}

/**
 * Ученик сдал работу по персональной ссылке — настоящий путь, без обхода
 * базы: так привязка «чей это ответ» проверяется по-настоящему.
 *
 * IP у каждой отправки свой: пара «форма + IP» попадает под лимит 60/час, и
 * класс из 30 человек на одном школьном Wi-Fi иначе упёрся бы в него.
 */
async function submitPersonal(
  st: string,
  t: string,
  answers: Array<{ taskNumber: number; value: string }>,
  ip: string,
): Promise<void> {
  const res = await SELF.fetch(`https://worker.test/api/public/class-links/${st}/forms/${t}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ answers }),
  });
  expect(res.status, `отправка работы по персональной ссылке`).toBe(201);
}

async function fetchReport(session: string, classId: string): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/classes/${classId}/report`, {
    headers: auth(session),
  });
}

async function readReport(session: string, classId: string): Promise<ReportView> {
  const res = await fetchReport(session, classId);
  expect(res.status, "GET report").toBe(200);
  const body = (await res.json()) as { ok: boolean; report: ReportView };
  return body.report;
}

async function fetchCsv(session: string, classId: string): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/classes/${classId}/report.csv`, {
    headers: auth(session),
  });
}

/** Правильные ответы на фикстуру формы: 3 балла из 6, эссе ждёт учителя. */
const correctAnswers = [
  { taskNumber: 1, value: "4" },
  { taskNumber: 2, value: "1" },
  { taskNumber: 3, value: "42" },
];

/**
 * Пометить ответ так, будто его оценила машина.
 *
 * Снимок `check_meta_json` пишет сверка коротких ответов моделью; мы кладём
 * ровно такой же JSON руками, потому что вызов модели здесь стоил бы денег и
 * ключа, а проверяем мы чтение снимка, а не сам вызов.
 */
async function markAnswerByModel(responseId: string, taskNumber: number, isCorrect: boolean): Promise<string> {
  const id = `ans_model_${responseId}_${taskNumber}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO form_answers
         (id, response_id, task_number, task_type, student_answer, is_correct,
          points_awarded, points_max, needs_review, check_method, check_meta_json, created_at)
       VALUES (?1, ?2, ?3, 'short-answer', 'ответ ученика', ?4, ?5, 2, 0, 'llm', ?6, ?7)`,
    )
    .bind(
      id,
      responseId,
      taskNumber,
      isCorrect ? 1 : 0,
      isCorrect ? 2 : 0,
      JSON.stringify({
        decidedBy: "model",
        modelVerdict: isCorrect ? "correct" : "incorrect",
        confidence: 0.91,
        llmChecked: true,
        decidedAt: now,
      }),
      now,
    )
    .run();
  return id;
}

/** id ответа по паре «ученик + работа» — нужен, чтобы найти ответы работы. */
async function responseIdOf(studentId: string, formId: string): Promise<string> {
  const row = await env.DB
    .prepare("SELECT response_id FROM class_student_answers WHERE student_id = ?1 AND form_id = ?2")
    .bind(studentId, formId)
    .first<{ response_id: string }>();
  return String(row!.response_id);
}

/**
 * Посчитать ячейки в строке CSV с кавычками.
 *
 * Наивный `split(";")` считал бы разделителем точку с запятой ВНУТРИ кавычек и
 * «нашёл» бы поломанную выгрузку там, где всё в порядке. Это ровно тот способ,
 * которым такой дефект обычно и пропускают.
 */
function countCsvCells(line: string): number {
  let cells = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
    } else if (ch === ";" && !inQuotes) {
      cells += 1;
    }
  }
  return cells;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Тесты
 * ─────────────────────────────────────────────────────────────────────────── */

describe("ведомость по классу (лист 3.1.3)", () => {
  // С Vitest 4 и @cloudflare/vitest-plugin хранилище изолируется на файл, а не
  // на отдельный тест: опция `isolatedStorage` удалена. Раньше каждый `it`
  // начинал с пустой базы, и проверки «ведомость пуста», «больше 12 работ
  // обрезается», «спецсимволы не ломают CSV» считали ровно свои строки.
  // Теперь соседние тесты делят базу, и ведомость включала чужие работы.
  // Учителей из beforeAll не трогаем — они нужны каждому тесту.
  beforeEach(async () => {
    for (const table of ["class_student_answers", "form_answers", "form_responses", "forms"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
  });

  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
    const now = Math.floor(Date.now() / 1000);
    for (const [id, email] of [
      [TEACHER, "report-a@example.test"],
      [OTHER_TEACHER, "report-b@example.test"],
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

  // ── R1. Сводка считается сервером ────────────────────────────────────────
  it("R1: сводка по классу приезжает посчитанной с сервера и требует входа", async () => {
    const classId = await createClass(SESSION_A, "5А");
    const students = await addStudents(SESSION_A, classId, ["Иванов Иван", "Петрова Анастасия", "Сидоров Пётр"]);
    const form = await seedForm(TEACHER, { title: "Дроби" });

    // Без входа сводки нет — даже пустой. Иначе по ссылке читался бы чужой класс.
    const anon = await SELF.fetch(`https://worker.test/api/classes/${classId}/report`);
    expect(anon.status).toBe(401);
    const anonCsv = await SELF.fetch(`https://worker.test/api/classes/${classId}/report.csv`);
    expect(anonCsv.status).toBe(401);

    // Двое сдали, один — нет.
    await submitPersonal(students[0]!.token, form.token, correctAnswers, "10.1.0.1");
    await submitPersonal(students[1]!.token, form.token, correctAnswers, "10.1.0.2");

    const report = await readReport(SESSION_A, classId);

    // Числа ПРИЕХАЛИ готовыми — их нельзя было бы получить, не считая на сервере.
    expect(report.class.name).toBe("5А");
    expect(report.summary.studentsTotal).toBe(3);
    expect(report.summary.studentsSubmitted).toBe(2);
    expect(report.summary.studentsNotSubmitted).toBe(1);
    expect(report.summary.submittedWorks).toBe(2);
    expect(report.works).toHaveLength(1);
    expect(report.works[0]!.id).toBe(form.id);
    expect(report.emptyReason).toBeNull();

    // Средний процент: у обоих 3 из 6 = 50%.
    expect(report.summary.averagePercent).toBe(50);

    const ivan = report.students.find((s) => s.name === "Иванов Иван")!;
    expect(ivan.works).toHaveLength(1);
    expect(ivan.works[0]!.score).toBe(3);
    expect(ivan.works[0]!.max).toBe(6);
    // Эссе ждёт учителя, и это видно числом, а не молчаливым нулём.
    expect(ivan.works[0]!.pendingTasks).toBe(1);
    expect(report.summary.pendingWorks).toBe(2);
  });

  // ── R2. Чужой класс не виден ─────────────────────────────────────────────
  it("R2: чужой класс не виден ни в сводке, ни в выгрузке — отказ 403", async () => {
    const classId = await createClass(SESSION_A, "5Б");
    const [ivan] = await addStudents(SESSION_A, classId, ["Иванов Иван"]);
    const form = await seedForm(TEACHER, { title: "Дроби 2" });
    await submitPersonal(ivan!.token, form.token, correctAnswers, "10.2.0.1");

    // Свой класс учитель видит целиком.
    const mine = await readReport(SESSION_A, classId);
    expect(mine.summary.studentsTotal).toBe(1);

    // Чужой учитель получает отказ, а не «пустой класс».
    const stolen = await fetchReport(SESSION_B, classId);
    expect(stolen.status).toBe(403);
    const stolenBody = await stolen.text();
    expect(JSON.parse(stolenBody)).toMatchObject({
      code: "CLASS_FORBIDDEN",
      error: expect.stringContaining("другого учителя"),
    });
    // И ни одного чужого имени в теле отказа.
    expect(stolenBody).not.toContain("Иванов Иван");

    // Выгрузка чужого класса — тоже отказ, и файла не отдаётся.
    const stolenCsv = await fetchCsv(SESSION_B, classId);
    expect(stolenCsv.status).toBe(403);
    expect(stolenCsv.headers.get("Content-Type")).not.toContain("text/csv");
    expect(await stolenCsv.text()).not.toContain("Иванов Иван");

    // Несуществующий класс — 404: «нет такого» и «не твоё» остались разными.
    const missing = await fetchReport(SESSION_A, "cls_nosuchclass1");
    expect(missing.status).toBe(404);
  });

  // ── R3. Ученик без ответов виден как «не сдал» ───────────────────────────
  it("R3: ученик без ответов стоит в ведомости строкой «не сдал»", async () => {
    const classId = await createClass(SESSION_A, "5В");
    const [first, second] = await addStudents(SESSION_A, classId, ["Иванов Иван", "Кузнецова, Мария"]);
    const form = await seedForm(TEACHER, { title: "Дроби 3" });
    await submitPersonal(first!.token, form.token, correctAnswers, "10.3.0.1");

    const report = await readReport(SESSION_A, classId);
    expect(report.students).toHaveLength(2);

    const nobody = report.students.find((s) => s.name === "Кузнецова, Мария")!;
    expect(nobody).toBeDefined();
    // Строка есть, работ у неё ноль — «не сдал», а не исчезновение из ведомости.
    expect(nobody.works).toHaveLength(0);
    expect(report.summary.studentsNotSubmitted).toBe(1);

    // В выгрузке та же картина: ученик строкой, ячейка со словом «не сдал».
    const csv = await (await fetchCsv(SESSION_A, classId)).text();
    const line = csv.split("\r\n").find((l) => l.includes("Кузнецова, Мария"))!;
    expect(line).toBeDefined();
    expect(line).toContain("не сдал");
    // Запятая в фамилии не порвала строку: разделитель у нас «точка с запятой»,
    // поэтому значение с запятой остаётся одним полем.
    expect(line.startsWith("2;Кузнецова, Мария;не сдал;")).toBe(true);
  });

  // ── R4. Отметка ИИ и отметка учителя не сливаются ────────────────────────
  it("R4: вердикт ИИ без шага учителя виден отдельно и меняется после правки", async () => {
    const classId = await createClass(SESSION_A, "5Г");
    const [ivan] = await addStudents(SESSION_A, classId, ["Иванов Иван"]);
    const form = await seedForm(TEACHER, { title: "Короткие ответы" });
    await submitPersonal(ivan!.token, form.token, correctAnswers, "10.4.0.1");

    const responseId = await responseIdOf(ivan!.id, form.id);
    // Два коротких ответа оценила машина: учитель потом поправит только один.
    const answerId = await markAnswerByModel(responseId, 9, true);
    await markAnswerByModel(responseId, 10, false);

    const before = await readReport(SESSION_A, classId);
    const cellBefore = before.students[0]!.works[0]!;
    // Источник — «машина», и флаг «учитель не подтвердил» поднят.
    expect(cellBefore.source).toBe("model");
    expect(cellBefore.modelTasks).toBe(2);
    expect(cellBefore.teacherTasks).toBe(0);
    expect(cellBefore.unconfirmedByTeacher).toBe(true);
    expect(before.summary.unconfirmedWorks).toBe(1);

    // Выгрузка говорит об этом словами, а не просто числом балла.
    const csvBefore = await (await fetchCsv(SESSION_A, classId)).text();
    expect(csvBefore).toContain("вердикт ИИ, не подтверждён учителем");

    // Учитель открывает работу и засчитывает ответ — тем же путём, что в журнале.
    const override = await SELF.fetch(`https://worker.test/api/journal/answers/${answerId}/override`, {
      method: "POST",
      headers: auth(SESSION_A),
      body: JSON.stringify({ accepted: true, points: 2 }),
    });
    expect(override.status).toBe(200);

    const after = await readReport(SESSION_A, classId);
    const cellAfter = after.students[0]!.works[0]!;
    // Теперь это ОТМЕТКА УЧИТЕЛЯ, и «не подтверждён» погас.
    expect(cellAfter.source).toBe("teacher_with_model");
    expect(cellAfter.teacherTasks).toBe(1);
    expect(cellAfter.unconfirmedByTeacher).toBe(false);
    expect(after.summary.unconfirmedWorks).toBe(0);
    expect(after.summary.bySource.teacher_with_model).toBe(1);

    const csvAfter = await (await fetchCsv(SESSION_A, classId)).text();
    expect(csvAfter).toContain("учитель поправил ИИ");
  });

  // ── R5. Выгрузка — файл для таблицы ──────────────────────────────────────
  it("R5: выгрузка приходит файлом с BOM, «;» и CRLF, а не текстом на экране", async () => {
    const classId = await createClass(SESSION_A, "5Д");
    const [ivan] = await addStudents(SESSION_A, classId, ["Иванов Иван"]);
    const form = await seedForm(TEACHER, { title: "Дроби 4" });
    await submitPersonal(ivan!.token, form.token, correctAnswers, "10.5.0.1");

    const res = await fetchCsv(SESSION_A, classId);
    expect(res.status).toBe(200);
    // Файл, а не JSON и не страница.
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment");
    // Имя класса кириллицей едет отдельной частью (RFC 5987), ASCII-дубль — рядом.
    expect(disposition).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)![1]!)).toContain("5Д");

    // BOM — из-за него русский Excel открывает файл таблицей, а не кракозябрами.
    //
    // Проверяем байты ответа, а не `res.text()`: ведущий BOM при декодировании
    // текста срезается (в новом workerd — тоже), хотя в самом ответе он есть и
    // именно его видит Excel. Проверка на тексте ловила бы особенность
    // декодера, а не выгрузку.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8").decode(bytes);
    // Переводы строк CRLF: русский Excel не «склеивает» строки в одну.
    expect(text).toContain("\r\n");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    // Разделитель — «точка с запятой»: русская локаль открывает такой файл
    // таблицей сама. Считаем колонки, а не ищем запятую: запятая внутри
    // названия работы (мы её печатаем) файл не ломает — Excel режет по «;».
    const report = await readReport(SESSION_A, classId);
    const headerLine = text.replace("\uFEFF", "").split("\r\n")[2]!;
    expect(headerLine).toContain(";");
    // №, ФИО, по колонке на работу, потом Сдал / Ждут / ИИ / Средний %.
    expect(headerLine.split(";")).toHaveLength(2 + report.works.length + 4);
    // Кириллица цела, фамилия на месте.
    expect(text).toContain("Иванов Иван");
    // Строка шапки с названием класса — по ней понятно, чья это ведомость.
    expect(text).toContain("Ведомость класса 5Д");
  });

  // ── R6. Пустое состояние объясняет причину ───────────────────────────────
  it("R6: пустая ведомость объясняет, что делать дальше, а не показывает ноль", async () => {
    // 1. Класс есть, учеников нет.
    const emptyClass = await createClass(SESSION_A, "5Е");
    const noStudents = await readReport(SESSION_A, emptyClass);
    expect(noStudents.emptyReason).toBe("no_students");
    expect(noStudents.summary.studentsTotal).toBe(0);

    // Выгрузка пустого класса — тоже файл с объяснением, а не таблица в пустоту.
    // BOM проверяем по байтам: при декодировании текста ведущий BOM срезается
    // (в том числе в новом workerd), хотя в самом ответе он остаётся и его
    // видит Excel. Проверка на тексте ловила особенность декодера.
    const emptyBytes = new Uint8Array(await (await fetchCsv(SESSION_A, emptyClass)).arrayBuffer());
    expect([emptyBytes[0], emptyBytes[1], emptyBytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const emptyCsv = new TextDecoder("utf-8").decode(emptyBytes);
    expect(emptyCsv).toContain("В этом классе пока нет учеников");
    // Расшифровки нет: таблицы нет — расшифровывать нечего.
    expect(emptyCsv).not.toContain("Расшифровка:");

    // 2. Ученики есть, работ нет.
    const classId = await createClass(SESSION_A, "5Ж");
    await addStudents(SESSION_A, classId, ["Иванов Иван"]);
    const noWorks = await readReport(SESSION_A, classId);
    expect(noWorks.emptyReason).toBe("no_works");
    const noWorksCsv = await (await fetchCsv(SESSION_A, classId)).text();
    expect(noWorksCsv).toContain("По этому классу пока нет работ");
    // Ученики при этом посчитаны — сводка не обнулилась вместе с работами.
    expect(noWorks.summary.studentsTotal).toBe(1);
    expect(noWorks.summary.studentsNotSubmitted).toBe(1);

    // 3. Работа выдана, ответов нет.
    await seedForm(TEACHER, { title: "Дроби 5" });
    const noAnswers = await readReport(SESSION_A, classId);
    expect(noAnswers.emptyReason).toBe("no_answers");
    expect(noAnswers.works).toHaveLength(1);
    expect(noAnswers.summary.submittedWorks).toBe(0);
    // «Среднего нет» — это null, а не 0: разные утверждения.
    expect(noAnswers.summary.averagePercent).toBeNull();

    // Пустая ведомость всё равно остаётся файлом с объяснением, а не пустым.
    const csv = await (await fetchCsv(SESSION_A, classId)).text();
    expect(csv).toContain("не сдал");
    expect(csv).toContain("Расшифровка:");
  });

  // ── R7. Краевые случаи ───────────────────────────────────────────────────
  it("R7: большой класс, пересдача, удалённый ученик, общая ссылка и одноимённые классы", async () => {
    // 30 человек — обычный класс, а не «много». Сводка обязана посчитать всех.
    const bigClass = await createClass(SESSION_A, "6А");
    const names = Array.from({ length: 30 }, (_, i) => `Ученик номер ${i + 1}`);
    const bigStudents = await addStudents(SESSION_A, bigClass, names);
    expect(bigStudents).toHaveLength(30);

    const bigForm = await seedForm(TEACHER, { title: "Контрольная 6А" });
    for (const [index, student] of bigStudents.entries()) {
      // Половина класса сдала.
      if (index >= 15) break;
      await submitPersonal(student.token, bigForm.token, correctAnswers, `10.6.0.${index + 1}`);
    }

    const big = await readReport(SESSION_A, bigClass);
    expect(big.summary.studentsTotal).toBe(30);
    expect(big.summary.studentsSubmitted).toBe(15);
    expect(big.summary.studentsNotSubmitted).toBe(15);
    expect(big.students).toHaveLength(30);

    // Пересдача одной работы: в ведомости последний ответ, а не первый.
    const resubmitted = bigStudents[0]!;
    const res = await SELF.fetch(
      `https://worker.test/api/public/class-links/${resubmitted.token}/forms/${bigForm.token}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.6.9.9" },
        body: JSON.stringify({ answers: [{ taskNumber: 1, value: "5" }] }),
      },
    );
    expect(res.status).toBe(201);

    const afterResubmit = await readReport(SESSION_A, bigClass);
    const row = afterResubmit.students.find((s) => s.name === "Ученик номер 1")!;
    // Одна работа = одна ячейка, и в ней последняя попытка (0 баллов из 6).
    expect(row.works).toHaveLength(1);
    expect(row.works[0]!.score).toBe(0);
    // Пересдача не создала «второго сдавшего».
    expect(afterResubmit.summary.submittedWorks).toBe(15);

    // Две РАЗНЫЕ работы одного ученика — две ячейки.
    const secondForm = await seedForm(TEACHER, { title: "Контрольная 6А, часть 2" });
    await submitPersonal(resubmitted.token, secondForm.token, correctAnswers, "10.6.9.10");
    const twoWorks = await readReport(SESSION_A, bigClass);
    const rowTwo = twoWorks.students.find((s) => s.name === "Ученик номер 1")!;
    expect(rowTwo.works).toHaveLength(2);
    expect(new Set(rowTwo.works.map((w) => w.formId)).size).toBe(2);
    expect(twoWorks.summary.submittedWorks).toBe(16);

    // Удалённый ученик в ведомость не попадает — но его ответы никуда не делись.
    const removed = await SELF.fetch(
      `https://worker.test/api/classes/${bigClass}/students/${resubmitted.id}`,
      { method: "DELETE", headers: auth(SESSION_A) },
    );
    expect(removed.status).toBe(200);
    const afterRemove = await readReport(SESSION_A, bigClass);
    expect(afterRemove.summary.studentsTotal).toBe(29);
    expect(afterRemove.students.some((s) => s.name === "Ученик номер 1")).toBe(false);
    const answersLeft = await env.DB
      .prepare("SELECT COUNT(*) AS cnt FROM class_student_answers WHERE student_id = ?1")
      .bind(resubmitted.id)
      .first<{ cnt: number }>();
    expect(answersLeft!.cnt).toBe(3);

    // Работа по ОБЩЕЙ ссылке: ученик сам представился, привязки к ученику нет.
    // Она не «не сдал» — её посчитали отдельно и сказали об этом числом.
    const generalForm = await seedForm(TEACHER, { title: "Контрольная 6А, общая ссылка" });
    await env.DB
      .prepare(
        `INSERT INTO form_responses
           (id, form_id, student_name, student_label, score_total, score_max, status,
            submitted_at, created_at)
         VALUES ('rsp_general_report', ?1, 'Новенький, которого нет в списке', NULL, 1, 6, 'submitted', ?2, ?2)`,
      )
      .bind(generalForm.id, Math.floor(Date.now() / 1000))
      .run();
    const withGeneral = await readReport(SESSION_A, bigClass);
    expect(withGeneral.summary.unlinkedAnswers).toBe(1);

    // Два учителя с ОДИНАКОВЫМ названием класса видят только свой класс.
    const sameName = await createClass(SESSION_B, "6А");
    const otherStudents = await addStudents(SESSION_B, sameName, ["Чужой Ученик"]);
    const otherForm = await seedForm(OTHER_TEACHER, { title: "Работа второго учителя" });
    await submitPersonal(otherStudents[0]!.token, otherForm.token, correctAnswers, "10.6.7.1");

    const mine = await readReport(SESSION_A, bigClass);
    const theirs = await readReport(SESSION_B, sameName);
    expect(mine.class.name).toBe("6А");
    expect(theirs.class.name).toBe("6А");
    expect(mine.summary.studentsTotal).toBe(29);
    expect(theirs.summary.studentsTotal).toBe(1);
    expect(theirs.students[0]!.name).toBe("Чужой Ученик");

    const mineCsv = await (await fetchCsv(SESSION_A, bigClass)).text();
    expect(mineCsv).not.toContain("Чужой Ученик");
    expect(mineCsv).not.toContain("Работа второго учителя");
    const theirsCsv = await (await fetchCsv(SESSION_B, sameName)).text();
    expect(theirsCsv).toContain("Чужой Ученик");
    expect(theirsCsv).not.toContain("Ученик номер 1");
  });

  // ── R8. Спецсимволы в ФИО и истёкшая работа ──────────────────────────────
  it("R8: спецсимволы в ФИО не портят CSV, истёкшая работа не зовётся открытой", async () => {
    const classId = await createClass(SESSION_A, "8А");
    // Разделитель, кавычка и перевод строки внутри ФИО — три способа сломать
    // выгрузку, если их не экранировать.
    const students = await addStudents(SESSION_A, classId, [
      'Петров "Петя"; Иванович',
      "Сидорова;Анна",
      "Обычный Ученик",
    ]);
    const fresh = await seedForm(TEACHER, { title: "Свежая работа" });
    const expired = await seedForm(TEACHER, {
      title: "Истёкшая работа",
      // Статус остаётся «open», но срок вышел — так и бывает у учителя.
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
    });
    await submitPersonal(students[0]!.token, fresh.token, correctAnswers, "10.8.0.1");

    const report = await readReport(SESSION_A, classId);
    // Истёкшая работа в ведомости остаётся (её сдавали), но «ещё открыта» — нет.
    expect(report.works).toHaveLength(2);
    expect(report.works.find((w) => w.id === expired.id)!.isOpen).toBe(false);
    expect(report.works.find((w) => w.id === fresh.id)!.isOpen).toBe(true);

    const csv = await (await fetchCsv(SESSION_A, classId)).text();
    const lines = csv.replace("\uFEFF", "").split("\r\n");
    // Название работ печатается как есть: запятая в нём файл не ломает.
    expect(csv).toContain("Свежая работа (math, ещё открыта)");
    expect(csv).not.toContain("Истёкшая работа (math, ещё открыта)");

    // ФИО с кавычкой и «;» экранированы: строка ученика не разъехалась на две,
    // и кавычка внутри значения удвоена по правилам CSV.
    const quoted = lines.find((l) => l.startsWith("1;"))!;
    expect(quoted).toContain('"Петров ""Петя""; Иванович"');
    // Ячейка рядом с ним осталась целой: балл, источник и «ждёт вас».
    expect(quoted).toContain("3 из 6 · посчитали сами · ждёт вас: 1");

    // ФИО без спецсимволов кавыками не оборачивается — лишние кавычки в ведомости
    // тоже мусор, но главное, что поле осталось целым.
    expect(lines.find((l) => l.startsWith("3;"))).toContain("3;Обычный Ученик;");

    // У каждой строки ученика ровно столько ячеек, сколько колонок в шапке.
    // Разделитель внутри кавычек разделителем не считается.
    const columns = countCsvCells(lines[2]!);
    expect(lines[2]!.split(";").length).toBe(2 + report.works.length + 4);
    for (const prefix of ["1;", "2;", "3;"]) {
      const row = lines.find((l) => l.startsWith(prefix))!;
      expect(countCsvCells(row)).toBe(columns);
    }
  });

  // ── R7b. Обрезанный список работ — честно, а не молча ────────────────────
  it("R7b: больше 12 работ ведомость обрезает и говорит об этом, а не притворяется полной", async () => {
    const classId = await createClass(SESSION_A, "7А");
    const students = await addStudents(SESSION_A, classId, ["Иванов Иван"]);
    const now = Math.floor(Date.now() / 1000);

    // 14 закрытых работ с ответами этого класса + одна открытая.
    for (let i = 0; i < 14; i += 1) {
      const form = await seedForm(TEACHER, { title: `Работа ${i + 1}`, status: "closed" });
      const student = students[0]!;
      await env.DB
        .prepare(
          `INSERT INTO form_responses
             (id, form_id, student_name, score_total, score_max, status, submitted_at, created_at)
           VALUES (?1, ?2, 'Ученик из класса', 3, 6, 'submitted', ?3, ?3)`,
        )
        .bind(`rsp_${classId}_${i}`, form.id, now + i)
        .run();
      // Привязка «эту работу сдал этот ученик» — без неё работа закрыта и в
      // ведомость не попадает (в неё берутся открытые + сданные классом).
      await env.DB
        .prepare(
          `INSERT INTO class_student_answers
             (id, student_id, form_id, response_id, score_total, score_max, submitted_at, created_at)
           VALUES (?1, ?2, ?3, ?4, 3, 6, ?5, ?5)`,
        )
        .bind(`csa_${classId}_${i}`, student.id, form.id, `rsp_${classId}_${i}`, now + i)
        .run();
    }

    const report = await readReport(SESSION_A, classId);
    expect(report.worksTotal).toBe(14);
    expect(report.works).toHaveLength(12);
    // Обрезание объявлено: молчаливая «полная» ведомость была бы выдумкой.
    expect(report.worksTruncated).toBe(true);
  });
});
/// <reference types="@cloudflare/vitest-plugin" />
/**
 * Разбор результатов класса по темам (ТЗ-27).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 *   A. Расчёт без базы: доли верных, сортировка худшей сверху, список
 *      «ошибается два раза подряд» по датам, пустой лист без меток.
 *   B. Настоящий путь: работа с метками → повторный пересчёт → строки в
 *      `skill_attempts` → `GET /api/journal/classes/:id/skills` и карточка темы.
 *   C. Границы: без входа — 401, чужой класс — 404, чужая форма на пересчёт — 404.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЧАСТЬ ТЕСТОВ БЕЗ D1
 * ─────────────────────────────────────────────────────────────────────────────
 * Считающие функции в `db/skill-attempts.ts` ходят в базу только в соседних
 * обёртках. Проверять их на настоящих ответах учеников дорого и не нужно:
 * порядок строк и правило «две даты подряд» — это решения, которые легко
 * испортить правкой на видном месте, и их удобно проверять списком примеров.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LLM НЕ ВЫЗЫВАЕТСЯ НИ РАЗУ
 * ─────────────────────────────────────────────────────────────────────────────
 * Как и в `classReport.test.ts`: состояние «оценила машина» задаётся прямо в
 * `check_meta_json` — тем же JSON, который пишет сверка моделью. Мы проверяем
 * чтение и агрегацию, а не вызов модели.
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  buildRecentChecks,
  buildSkillBreakdown,
  buildTaskBreakdown,
  findStrugglingStudents,
  listSkillAttempts,
  readTaskSkills,
  trendPercent,
  type SkillAttempt,
  type TaskStat,
} from "../../src/db/skill-attempts";
import { migrateSkillAttempts } from "../../src/db/migrations/0008_skill_attempts";

const SCHEMA_SQL = `
-- Колонка stripe_customer_id нужна middleware/auth: без неё любой запрос
-- с входом падает на 500 ещё до роутера, и проверки границ (401/404) мерили бы
-- не то, а ошибку фикстуры.
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT,
  plan                TEXT NOT NULL DEFAULT 'free',
  generations_total   INTEGER NOT NULL DEFAULT 0,
  generations_today   INTEGER NOT NULL DEFAULT 0,
  generations_reset_at INTEGER,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id  TEXT,
  yookassa_customer_id TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
`;

// ─────────────────────────────────────────────────────────────────────────────
// Чистые примеры
// ─────────────────────────────────────────────────────────────────────────────

/** Одна попытка. Даты — фиксированные, чтобы тест не зависел от «сегодня». */
function attempt(over: Partial<SkillAttempt> = {}): SkillAttempt {
  return {
    skill: "Давление твёрдых тел",
    correct: 1,
    total: 1,
    checkedAt: 1_760_000_000,
    formId: "frm_1",
    responseId: "rsp_1",
    studentId: "cst_1",
    studentName: "Иванов Иван",
    formTitle: "Контрольная №3",
    ...over,
  };
}

/**
 * Два соседних дня: 14 и 15 октября 2026.
 *
 * Взяты настоящими числами, а не «сегодня минус N дней»: тест про «две даты
 * подряд» обязан быть одинаковым и сегодня, и через год, а «отрицательные
 * смещения от текущего времени» однажды дали бы дату, которой ещё не было.
 */
const DAY_ONE = Date.UTC(2026, 9, 14) / 1000;
const DAY_TWO = Date.UTC(2026, 9, 15) / 1000;

describe("ТЗ-27 · разрез по темам: расчёт", () => {
  it("лист без меток даёт пустой разрез, а не ошибку и не «тему в ноль»", () => {
    // Ноль попыток: именно так выглядит класс, где все листы созданы до меток.
    expect(buildSkillBreakdown([])).toEqual([]);
    expect(findStrugglingStudents([])).toEqual([]);
    expect(buildRecentChecks([])).toEqual([]);

    // Попытка, где оценивать было нечего, в разрез не попадает: строка «0 из 0»
    // выглядела бы как провал темы, которого не было.
    const empty = buildSkillBreakdown([attempt({ correct: 0, total: 0 })]);
    expect(empty).toEqual([]);
  });

  it("считает доли верных и ставит худшую тему сверху", () => {
    const rows = buildSkillBreakdown([
      // 20 из 28 по «Давление твёрдых тел»
      ...Array.from({ length: 28 }, (_, i) =>
        attempt({ correct: i < 20 ? 1 : 0, responseId: `rsp_t${i}` }),
      ),
      // 8 из 10 по «Давление жидкостей» — лучше всех, хотя ответов всего 10:
      // порядок должен быть по ДОЛЕ, а не по числу ответов
      ...Array.from({ length: 10 }, (_, i) =>
        attempt({
          skill: "Давление жидкостей",
          correct: i < 8 ? 1 : 0,
          responseId: `rsp_l${i}`,
        }),
      ),
      // 31% — самая проваленная
      ...Array.from({ length: 32 }, (_, i) =>
        attempt({
          skill: "Площадь прямоугольника",
          correct: i < 10 ? 1 : 0,
          responseId: `rsp_p${i}`,
        }),
      ),
    ]);

    expect(rows.map((r) => r.skill)).toEqual([
      "Площадь прямоугольника",
      "Давление твёрдых тел",
      "Давление жидкостей",
    ]);

    const solid = rows.find((r) => r.skill === "Давление твёрдых тел")!;
    // Ровно те числа, из которых ТЗ-27 §9 ждёт строку разреза.
    expect(solid.correct).toBe(20);
    expect(solid.total).toBe(28);
    expect(solid.attempts).toBe(28);
  });

  it("одна тема, много попыток: доли считаются по всем ответам, а не по средней попытке", () => {
    const rows = buildSkillBreakdown([
      attempt({ responseId: "rsp_1", correct: 1, total: 4 }),
      attempt({ responseId: "rsp_2", correct: 0, total: 4, checkedAt: 1_787_452_800 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ correct: 1, total: 8, attempts: 2 });
  });

  it("«ошибается два раза подряд» считается по датам", () => {
    const list = findStrugglingStudents([
      attempt({ studentId: "cst_1", studentName: "Иванов Иван", correct: 1, total: 2, checkedAt: DAY_ONE }),
      attempt({
        studentId: "cst_1",
        studentName: "Иванов Иван",
        correct: 0,
        total: 2,
        checkedAt: DAY_TWO,
        responseId: "rsp_2",
      }),
      // Сидоров ошибался один раз — его в списке нет
      attempt({ studentId: "cst_2", studentName: "Сидоров Пётр", correct: 0, total: 2, checkedAt: DAY_TWO }),
    ]);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ studentId: "cst_1", studentName: "Иванов Иван" });
    expect(list[0]!.dates).toEqual(["2026-10-14", "2026-10-15"]);
  });

  it("две отправки в один день — это одна проверка, а не «две ошибки подряд»", () => {
    // Пересдал вечером: дважды за день не дают права назвать его «ошибается
    // два раза подряд» — это одна проверка, просто сданная дважды.
    const list = findStrugglingStudents([
      attempt({ studentId: "cst_1", correct: 0, total: 2, checkedAt: DAY_TWO }),
      attempt({
        studentId: "cst_1",
        correct: 0,
        total: 2,
        checkedAt: DAY_TWO + 3600,
        responseId: "rsp_resend",
      }),
    ]);
    expect(list).toEqual([]);
  });

  it("ошибался, справился, ошибался — это не «два раза подряд»", () => {
    const list = findStrugglingStudents([
      attempt({ studentId: "cst_1", correct: 0, total: 2, checkedAt: DAY_ONE }),
      attempt({ studentId: "cst_1", correct: 2, total: 2, checkedAt: DAY_TWO, responseId: "rsp_2" }),
      attempt({
        studentId: "cst_1",
        correct: 0,
        total: 2,
        checkedAt: DAY_TWO + 3 * 86400,
        responseId: "rsp_3",
      }),
    ]);
    // Последние две проверки: справился и ошибся — не серия.
    expect(list).toEqual([]);
  });

  it("ответ без ученика (общая ссылка) не попадает в список «позвать поговорить»", () => {
    const list = findStrugglingStudents([
      attempt({ studentId: null, studentName: null, correct: 0, total: 2, checkedAt: DAY_ONE }),
      attempt({
        studentId: null,
        studentName: null,
        correct: 0,
        total: 2,
        checkedAt: DAY_TWO,
        responseId: "rsp_2",
      }),
    ]);
    expect(list).toEqual([]);
    // Но в срез темы эти ответы попадают: тема-то проверилась.
    expect(buildSkillBreakdown([attempt({ studentId: null, correct: 0, total: 2 })])).toHaveLength(1);
  });

  it("последние проверки — одна строка на работу, а не на попытку", () => {
    const recent = buildRecentChecks([
      ...Array.from({ length: 28 }, (_, i) =>
        attempt({ correct: i < 20 ? 1 : 0, responseId: `rsp_${i}`, checkedAt: DAY_TWO }),
      ),
      attempt({ responseId: "rsp_old", correct: 1, total: 1, checkedAt: DAY_ONE, formId: "frm_0" }),
    ]);

    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ formId: "frm_1", percent: 71 });
    expect(recent[1]).toMatchObject({ formId: "frm_0", percent: 100 });
    expect(trendPercent(recent)).toMatchObject({ previous: 100, latest: 71, percent: -29 });
  });

  it("одна проверка — стрелки нет: сравнивать не с чем", () => {
    const recent = buildRecentChecks([attempt({ correct: 1, total: 2 })]);
    expect(recent).toHaveLength(1);
    expect(trendPercent(recent)).toBeNull();
  });

  it("разбор по заданиям ставит проваленное задание сверху", () => {
    const stats: TaskStat[] = [
      { formId: "frm_1", formTitle: "Контрольная", taskNumber: 1, prompt: "Сила давления", skill: "Давление", correct: 25, total: 28 },
      { formId: "frm_1", formTitle: "Контрольная", taskNumber: 2, prompt: "Атмосферное давление", skill: "Давление", correct: 6, total: 28 },
      { formId: "frm_1", formTitle: "Контрольная", taskNumber: 3, prompt: "Чужое задание", skill: "Другая тема", correct: 0, total: 28 },
    ];
    const rows = buildTaskBreakdown(stats, "Давление");
    expect(rows.map((r) => r.taskNumber)).toEqual([2, 1]);
    // Чужая тема в разбор этой темы не попадает, даже если задание лежит рядом.
    expect(rows.every((r) => r.prompt !== "Чужое задание")).toBe(true);
  });

  it("метка читается из снимка заданий, пустая метка — это «метки нет»", () => {
    const map = readTaskSkills([
      { number: 1, skill: "Давление жидкостей" },
      { number: 2, skill: "   " },
      { number: 3 },
      { number: 4, skill: null },
    ]);
    expect([...map.entries()]).toEqual([[1, "Давление жидкостей"]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Настоящий путь: база и роуты
// ─────────────────────────────────────────────────────────────────────────────

const TEACHER = "usr_tz27teacher1";
const OTHER = "usr_tz27other01";
const SESSION_A = "sess_tz27_a";
const SESSION_B = "sess_tz27_b";

function auth(session: string): Record<string, string> {
  return { Cookie: `session=${session}`, "Content-Type": "application/json" };
}

let seq = 0;

interface Seeded {
  classId: string;
  formId: string;
  studentTokens: string[];
}

/**
 * Класс из двух учеников и работа с МЕТКАМИ тем.
 *
 * Задания: 1 — «Давление твёрдых тел», 2 — «Площадь прямоугольника»,
 * 3 — без метки. Одна тема = одно задание намеренно: пример из ТЗ-27 §9 («20
 * верных из 28») — это двадцать восемь ОТВЕТОВ, а не двадцать восемь учеников,
 * и проверять надо именно такой счёт. Плюс третье задание без метки — чтобы в
 * разбор тем оно не попало.
 */
async function seedWithSkills(): Promise<Seeded> {
  seq += 1;
  const now = Math.floor(Date.now() / 1000);

  const classId = `cls_tz27${String(seq).padStart(5, "0")}`;
  await env.DB
    .prepare(
      `INSERT INTO classes (id, user_id, name, name_key, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
    )
    .bind(classId, TEACHER, "7Б", "7б", now)
    .run();

  const studentTokens: string[] = [];
  for (const [index, name] of ["Иванов Иван", "Петрова Анастасия"].entries()) {
    const token = `tz27token${seq}${index}aaaaaaaaaaaaaaaa`;
    studentTokens.push(token);
    await env.DB
      .prepare(
        `INSERT INTO class_students (id, class_id, token, name, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
      )
      .bind(`cst_tz27${seq}${index}`, classId, token, name, index, now)
      .run();
  }

  const formId = `frm_tz27${String(seq).padStart(5, "0")}`;
  const formToken = `tz27formtoken${seq}bbbbbbbbbbbbbb`;
  const tasks = [
    { number: 1, text: "Сила давления", type: "short-answer", skill: "Давление твёрдых тел", points: 1, answer: "a" },
    { number: 2, text: "Площадь прямоугольника", type: "short-answer", skill: "Площадь прямоугольника", points: 1, answer: "b" },
    { number: 3, text: "Задание без метки", type: "short-answer", points: 1, answer: "c" },
  ];
  await env.DB
    .prepare(
      `INSERT INTO forms
         (id, token, user_id, worksheet_id, title, subject, grade, payload_json, status,
          access_code, expires_at, show_answers, check_mode, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, ?4, 'Физика', 7, ?5, 'open', NULL, ?6, 0, 'llm', ?7, ?7)`,
    )
    .bind(formId, formToken, TEACHER, "Контрольная №3", JSON.stringify({ tasks }), now + 86400, now)
    .run();

  return { classId, formId, studentTokens };
}

/** Сдать работу по персональной ссылке — настоящий путь, без вставок в базу. */
async function submit(st: string, t: string, ip: string): Promise<string> {
  const res = await SELF.fetch(`https://worker.test/api/public/class-links/${st}/forms/${t}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({
      answers: [
        { taskNumber: 1, value: "a" },
        { taskNumber: 2, value: "b" },
        { taskNumber: 3, value: "c" },
      ],
    }),
  });
  expect(res.status, "отправка работы").toBe(201);
  // Форма ответа `submit` — это то, что на самом деле отдаёт обработчик
  // (`responseId`, а не вложенный объект). Имена взяты из кода роута, а не
  // придуманы: иначе тест проверял бы собственную фантазию, а не отправку.
  const body = (await res.json()) as { ok: boolean; responseId: string };
  expect(body.ok).toBe(true);
  return body.responseId;
}

/** Проставить вердикты по ответам: это то, что делает модель или учитель. */
async function mark(responseId: string, isCorrect: Record<number, boolean>): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const answers = await env.DB
    .prepare(`SELECT id, task_number, points_max FROM form_answers WHERE response_id = ?1`)
    .bind(responseId)
    .all<{ id: string; task_number: number; points_max: number }>();

  for (const answer of answers.results ?? []) {
    const ok = isCorrect[answer.task_number] ?? false;
    await env.DB
      .prepare(
        `UPDATE form_answers
            SET is_correct = ?1, points_awarded = ?2, needs_review = 0, check_method = 'llm',
                check_meta_json = ?3
          WHERE id = ?4`,
      )
      .bind(
        ok ? 1 : 0,
        ok ? answer.points_max : 0,
        JSON.stringify({ decidedBy: "model", modelVerdict: ok ? "correct" : "incorrect", llmChecked: true, decidedAt: now }),
        answer.id,
      )
      .run();
  }
}

describe("ТЗ-27 · разрез по темам: настоящий путь", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
    const migration = await migrateSkillAttempts(env.DB);
    expect(migration.applied, `миграция skill_attempts: ${migration.reason}`).toBe(true);
    // Вторая прогонка обязана быть безопасной: деплой не должен падать.
    expect((await migrateSkillAttempts(env.DB)).applied).toBe(false);

    const now = Math.floor(Date.now() / 1000);
    for (const [id, email, session] of [
      [TEACHER, "tz27-a@example.test", SESSION_A],
      [OTHER, "tz27-b@example.test", SESSION_B],
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
        .bind(session, id, now + 86400, now)
        .run();
    }
  });

  beforeEach(async () => {
    for (const table of ["skill_attempts", "class_student_answers", "form_answers", "form_responses", "forms", "class_students", "classes"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
  });

  it("28 ответов, 20 верных по одной метке → одна строка разреза correct: 20, total: 28", async () => {
    const { classId, formId, studentTokens } = await seedWithSkills();
    const formToken = (
      await env.DB.prepare(`SELECT token FROM forms WHERE id = ?1`).bind(formId).first<{ token: string }>()
    )!.token;

    // 20 из 28 «Давление твёрдых тел» — ровно пример из ТЗ-27 §9.
    for (let i = 0; i < 28; i += 1) {
      const responseId = await submit(studentTokens[0]!, formToken, `10.2.0.${i + 1}`);
      // 20 верных по «Давлению» и 10 по «Площади»: ровно тот пример из ТЗ-27 §9,
      // где худшая тема (36%) обязана встать выше лучшей (71%).
      const ok: Record<number, boolean> = { 1: i < 20, 2: i < 10, 3: i < 25 };
      await mark(responseId, ok);
    }
    await recheck(SESSION_A, formId);

    const rows = await listSkillAttempts(env.DB, TEACHER, classId);
    const breakdown = buildSkillBreakdown(rows);
    const solid = breakdown.find((r) => r.skill === "Давление твёрдых тел")!;
    expect(solid).toMatchObject({ correct: 20, total: 28, attempts: 28 });
    // «Площадь» провалилась сильнее — обязана стоять выше.
    expect(breakdown[0]!.skill).toBe("Площадь прямоугольника");

    const res = await SELF.fetch(`https://worker.test/api/journal/classes/${classId}/skills`, {
      headers: auth(SESSION_A),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skills: Array<{ skill: string; correct: number; total: number; percent: number }> };
    const apiSolid = body.skills.find((s) => s.skill === "Давление твёрдых тел")!;
    expect(apiSolid.correct).toBe(20);
    expect(apiSolid.total).toBe(28);
    // Сортировку делает сервер — браузеру нечего «исправлять».
    expect(body.skills[0]!.percent).toBeLessThan(apiSolid.percent);
  });

  it("работа без меток даёт пустой разрез без ошибки", async () => {
    const { classId, formId, studentTokens } = await seedWithSkills();
    const now = Math.floor(Date.now() / 1000);
    // Снимаем метки — так выглядит любой лист, созданный до этого блока.
    await env.DB
      .prepare(`UPDATE forms SET payload_json = ?1 WHERE id = ?2`)
      .bind(
        JSON.stringify({
          tasks: [
            { number: 1, text: "Сила давления", type: "short-answer", points: 1, answer: "a" },
            { number: 2, text: "Что дальше", type: "short-answer", points: 1, answer: "b" },
          ],
        }),
        formId,
      )
      .run();
    await env.DB
      .prepare(`INSERT INTO class_students (id, class_id, token, name, position, created_at, updated_at)
                VALUES ('cst_noskill', ?1, 'noskilltoken0000000000a', 'Сидоров Пётр', 0, ?2, ?2)`)
      .bind(classId, now)
      .run();

    const responseId = await submit("noskilltoken0000000000a", (
      await env.DB.prepare(`SELECT token FROM forms WHERE id = ?1`).bind(formId).first<{ token: string }>()
    )!.token, "10.3.0.1");
    await mark(responseId, { 1: true, 2: false });

    const recheckBody = await recheck(SESSION_A, formId);
    expect(recheckBody.recorded, "без меток попыток не пишется").toBe(0);

    // Ведомость ведёт себя как раньше: список пуст, ошибки нет.
    const res = await SELF.fetch(`https://worker.test/api/journal/classes/${classId}/skills`, {
      headers: auth(SESSION_A),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skills: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.skills).toEqual([]);
  });

  it("карточка темы отдаёт проверки, список ошибающихся и разбор по заданиям", async () => {
    const { classId, formId, studentTokens } = await seedWithSkills();
    const formToken = (
      await env.DB.prepare(`SELECT token FROM forms WHERE id = ?1`).bind(formId).first<{ token: string }>()
    )!.token;

    // Иванов ошибся по теме дважды (две работы), Петрова — один раз.
    for (const [dayShift, studentIndex] of [[0, 0], [0, 1], [1, 0]] as const) {
      seq += 1;
      const now = Math.floor(Date.now() / 1000);
      const otherFormId = `frm_tz27x${String(seq).padStart(5, "0")}`;
      await env.DB
        .prepare(
          `INSERT INTO forms
             (id, token, user_id, worksheet_id, title, subject, grade, payload_json, status,
              access_code, expires_at, show_answers, check_mode, created_at, updated_at)
           VALUES (?1, ?2, ?3, NULL, ?4, 'Физика', 7, ?5, 'open', NULL, ?6, 0, 'llm', ?7, ?7)`,
        )
        .bind(
          otherFormId,
          `tz27xtoken${seq}cccccccccccccccc`,
          TEACHER,
          dayShift === 0 ? "Контрольная №3" : "Проверочная №4",
          JSON.stringify({
            tasks: [
              { number: 1, text: "Сила давления", type: "short-answer", skill: "Давление твёрдых тел", points: 1, answer: "a" },
              { number: 2, text: "Площадь прямоугольника", type: "short-answer", skill: "Площадь прямоугольника", points: 1, answer: "c" },
            ],
          }),
          now + 86400,
          now - dayShift * 86400,
        )
        .run();

      const responseId = await submit(studentTokens[studentIndex]!, `tz27xtoken${seq}cccccccccccccccc`, `10.4.0.${seq}${studentIndex}`);
      await mark(responseId, studentIndex === 0 ? { 1: false } : { 1: false });
      // Сдвигаем дату проверки назад для первой работы — «три последние проверки»
      // должны различаться по датам, иначе список схлопнется.
      await env.DB
        .prepare(`UPDATE form_responses SET submitted_at = submitted_at - ?1 WHERE id = ?2`)
        .bind(dayShift * 86400, responseId)
        .run();
      await recheck(SESSION_A, otherFormId);
    }

    const res = await SELF.fetch(
      `https://worker.test/api/journal/classes/${classId}/skills/${encodeURIComponent("Давление твёрдых тел")}`,
      { headers: auth(SESSION_A) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      skill: string;
      recent: Array<{ title: string; percent: number | null }>;
      struggling: Array<{ studentName: string; dates: string[] }>;
      tasks: Array<{ prompt: string; correct: number; total: number }>;
    };

    expect(body.skill).toBe("Давление твёрдых тел");
    // Проверок было три, но строк — по работам, а не по попыткам учеников.
    expect(body.recent.length).toBeGreaterThan(0);
    expect(body.tasks.some((t) => t.prompt === "Сила давления")).toBe(true);
    // Иванов ошибается дважды подряд — попадает в список; Петрова — нет.
    const ivanov = body.struggling.find((s) => s.studentName === "Иванов Иван");
    expect(ivanov, "Иванов ошибается два раза подряд").toBeTruthy();
    expect(ivanov!.dates).toHaveLength(2);
    expect(body.struggling.some((s) => s.studentName === "Петрова Анастасия")).toBe(false);
  });

  it("границы: без входа — 401, чужой класс — 404, чужая форма на пересчёт — 404", async () => {
    const { classId, formId } = await seedWithSkills();

    const anon = await SELF.fetch(`https://worker.test/api/journal/classes/${classId}/skills`);
    expect(anon.status).toBe(401);

    // Чужой учитель не должен ни увидеть чужой класс, ни отличить его своим
    // кодом ответа — поэтому 404, а не 403 (см. комментарий в interactives.ts).
    const foreign = await SELF.fetch(`https://worker.test/api/journal/classes/${classId}/skills`, {
      headers: auth(SESSION_B),
    });
    expect(foreign.status).toBe(404);

    const foreignForm = await SELF.fetch(`https://worker.test/api/journal/forms/${formId}/recheck`, {
      method: "POST",
      headers: auth(SESSION_B),
    });
    expect(foreignForm.status).toBe(404);
  });

  it("пустая тема в адресе — 400, а не «пустой разбор»", async () => {
    const { classId } = await seedWithSkills();
    const res = await SELF.fetch(`https://worker.test/api/journal/classes/${classId}/skills/${encodeURIComponent(" ")}`, {
      headers: auth(SESSION_A),
    });
    expect(res.status).toBe(400);
  });
});

async function recheck(session: string, formId: string): Promise<{ recorded: number }> {
  const res = await SELF.fetch(`https://worker.test/api/journal/forms/${formId}/recheck`, {
    method: "POST",
    headers: auth(session),
  });
  expect(res.status, `пересчёт ${formId}`).toBe(200);
  return (await res.json()) as { recorded: number };
}
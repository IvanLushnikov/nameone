/// <reference types="@cloudflare/vitest-plugin" />
/**
 * ТЗ-28: мобильный доступ ученика — сдача работы с телефона без приложения.
 *
 * Закрываем те требования, где легко ошибиться молча:
 *
 *   M1  Код класса: 6 знаков БЕЗ похожих символов (0/O, 1/I/L) и уникален
 *       между классами и между учителями.
 *   M2  Вход по коду: чужой фамилии нет — 404; своя фамилия + cookie работает.
 *   M3  Чужой ученик по тому же коду получает СВОИ задания: попытка подставить
 *       чужой токен в персональную ссылку даёт 403, а не чужие задания.
 *   M4  Сдача БЕЗ фото работает ровно как раньше (обратная совместимость).
 *   M5  Сдача С фото принимается: фото привязано к ответу, лежит в том же
 *       бакете, и удаляется по той же дате, что и работа учителя.
 *
 * Тесты идут в workerd с настоящим D1 и настоящими роутами (SELF.fetch).
 * LLM не вызывается: сверка ответов — чистая арифметика в services/formGrading.
 * Схема D1 зашита в SCHEMA_SQL: workerd не имеет fs.readFileSync.
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PHOTO_RETENTION_SECONDS } from "../../src/services/photoCheckGrading";

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
  closed_at      TEXT,
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

CREATE TABLE IF NOT EXISTS class_codes (
  class_id   TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_fap_response_task
  ON form_answer_photos(response_id, task_number);

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
  percentage     INTEGER,
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
`;

const TEACHER = "usr_teacher_tz28";
const SESSION_A = "sess_tz28_teacher";

function auth(): Record<string, string> {
  return { Cookie: `session=${SESSION_A}`, "Content-Type": "application/json" };
}

function anon(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

/** Класс + его код из ответа учителя. */
async function createClass(name: string): Promise<{ id: string; code: string }> {
  const res = await SELF.fetch("https://worker.test/api/classes", {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ name }),
  });
  expect(res.status, `создание класса «${name}»`).toBe(201);
  const body = (await res.json()) as { class: { id: string; classCode: string | null } };
  expect(body.class.classCode, "у нового класса должен быть код").toBeTruthy();
  return { id: body.class.id, code: body.class.classCode as string };
}

async function addStudents(classId: string, names: string[]) {
  const res = await SELF.fetch(`https://worker.test/api/classes/${classId}/students`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ names }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { students: Array<{ id: string; name: string; token: string }> };
  return body.students;
}

let formSeq = 0;

async function seedForm(userId: string, title = "Дроби"): Promise<{ id: string; token: string }> {
  formSeq += 1;
  const id = `frm_tz28${String(formSeq).padStart(4, "0")}`;
  const token = `formtoken_tz28_${String(formSeq).padStart(4, "0")}`;
  const now = Math.floor(Date.now() / 1000);
  const tasks = [
    { number: 1, text: "Сколько будет 2+2?", type: "computation", answer: "4", points: 2 },
    { number: 2, text: "Найди значение 3/4 + 1/8", type: "computation", answer: "", points: 2 },
  ];
  await env.DB
    .prepare(
      `INSERT INTO forms
         (id, token, user_id, title, subject, grade, payload_json, status,
          expires_at, show_answers, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'math', 5, ?5, 'open', ?6, 0, ?6, ?6)`,
    )
    .bind(id, token, userId, title, JSON.stringify({ tasks }), now + 7 * 86400)
    .run();
  return { id, token };
}

/** Ответ по коду класса: cookie ставит логин, дальше cookie пересылается вручную. */
async function login(code: string, name: string): Promise<string | null> {
  const res = await SELF.fetch(`https://worker.test/api/classes/code/${code}/login`, {
    method: "POST",
    headers: anon(),
    body: JSON.stringify({ name }),
  });
  expect(res.status, `вход по фамилии «${name}»`).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = /class_student_[A-Z0-9]+=([^;]+)/.exec(setCookie);
  return match?.[1] ?? null;
}

describe("ТЗ-28: доступ ученика с телефона", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "schema", queries: [SCHEMA_SQL] }]);
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT INTO users (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
         VALUES (?1, 'teacher-tz28@example.test', 'Учитель', 'base', 0, 0, 0, ?2, ?2)`,
      )
      .bind(TEACHER, now)
      .run();
    await env.DB
      .prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`)
      .bind(SESSION_A, TEACHER, now + 86400, now)
      .run();
  });

  beforeEach(async () => {
    for (const table of [
      "form_answer_photos",
      "class_student_answers",
      "form_answers",
      "form_responses",
      "photo_checks",
      "class_codes",
      "class_students",
      "classes",
      "forms",
      "rate_limits",
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
  });

  // ── M1. Код класса ───────────────────────────────────────────────────────
  it("M1: код — 6 знаков без похожих символов и не повторяется между классами", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      const cls = await createClass(`5${String.fromCharCode(65 + i)}`);
      expect(cls.code, "код должен состоять из 6 знаков").toHaveLength(6);
      // 0/O и 1/I/L исключены: их не различают ни на доске, ни в мелком шрифте.
      expect(cls.code).not.toMatch(/[01ILO]/);
      expect(cls.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
      expect(seen.has(cls.code), `код ${cls.code} повторился`).toBe(false);
      seen.add(cls.code);
    }
  });

  // ── M2. Вход по коду ─────────────────────────────────────────────────────
  it("M2: по коду вход только своей фамилией, чужая — 404", async () => {
    const cls = await createClass("7Б");
    await addStudents(cls.id, ["Петрова Аня"]);

    const stranger = await SELF.fetch(`https://worker.test/api/classes/code/${cls.code}/login`, {
      method: "POST",
      headers: anon(),
      body: JSON.stringify({ name: "Посторонний Иван" }),
    });
    expect(stranger.status).toBe(404);

    const cookie = await login(cls.code, "Петрова Аня");
    expect(cookie, "сервер должен выдать cookie ученика").toBeTruthy();

    const tasks = await SELF.fetch(
      `https://worker.test/api/classes/code/${cls.code}/tasks`,
      { headers: { Cookie: `class_student_${cls.code}=${cookie}` } },
    );
    expect(tasks.status).toBe(200);
    const body = (await tasks.json()) as { needName: boolean; studentName: string };
    expect(body.needName).toBe(false);
    expect(body.studentName).toBe("Петрова Аня");
  });

  it("M2: без cookie код показывает только вопрос «кто сдаёт», без имён класса", async () => {
    const cls = await createClass("8В");
    await addStudents(cls.id, ["Сидоров Пётр"]);

    const raw = await (
      await SELF.fetch(`https://worker.test/api/classes/code/${cls.code}/tasks`, { headers: anon() })
    ).text();
    expect(raw).not.toContain("Сидоров");
    const body = JSON.parse(raw) as { needName: boolean };
    expect(body.needName).toBe(true);
  });

  // ── M3. Свой / чужой ученик ──────────────────────────────────────────────
  it("M3: по своему коду ученик получает свой класс и свои ответы, а не чужие", async () => {
    const clsA = await createClass("6А");
    const clsB = await createClass("6Б");
    const [anya, petya] = await addStudents(clsA.id, ["Петрова Аня", "Петров Пётр"]);
    const [misha] = await addStudents(clsB.id, ["Сидоров Миша"]);
    const form = await seedForm(TEACHER);

    // Cookie Ани из класса «6А» под именем «6Б» не открывает «6Б»: сервер
    // сверяет, что ученик найденной cookie живёт именно в этом классе.
    const anyaCookie = await login(clsA.code, "Петрова Аня");
    const cross = await SELF.fetch(`https://worker.test/api/classes/code/${clsB.code}/tasks`, {
      headers: { Cookie: `class_student_${clsB.code}=${anyaCookie}` },
    });
    expect(cross.status).toBe(200);
    const crossBody = (await cross.json()) as { needName: boolean; tasks?: unknown };
    expect(crossBody.needName, "чужой cookie = «кто сдаёт?» и ни одного задания").toBe(true);
    expect(crossBody.tasks).toBeUndefined();
    expect(misha).toBeTruthy();

    // Аня сдаёт работу — балл должен записаться на НЕЁ, а не на Петю.
    const cookie = await login(clsA.code, "Петрова Аня");
    const res = await SELF.fetch(
      `https://worker.test/api/classes/code/${clsA.code}/forms/${form.token}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `class_student_${clsA.code}=${cookie}` },
        body: JSON.stringify({ answers: [{ taskNumber: 1, value: "4" }] }),
      },
    );
    expect(res.status).toBe(201);

    const mine = await env.DB
      .prepare(
        `SELECT a.score_total FROM class_student_answers a WHERE a.student_id = ?1`,
      )
      .bind(anya!.id)
      .first<{ score_total: number }>();
    expect(mine!.score_total, "ответ записан на того, кто сдавал").toBe(2);

    const neighbour = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM class_student_answers WHERE student_id = ?1`)
      .bind(petya!.id)
      .first<{ c: number }>();
    expect(neighbour!.c, "у соседа по парте не должно появиться лишнего ответа").toBe(0);

    // Персональная ссылка ученика по-прежнему открывает ту же форму.
    const own = await SELF.fetch(
      `https://worker.test/api/public/class-links/${anya!.token}/forms/${form.token}`,
    );
    expect(own.status).toBe(200);
    const body = (await own.json()) as { form: { tasks: Array<{ number: number }> } };
    expect(body.form.tasks).toHaveLength(2);
  });

  // ── M4. Обратная совместимость: сдача без фото ───────────────────────────
  it("M4: сдача без фото работает ровно как раньше", async () => {
    const cls = await createClass("4Г");
    const [anya] = await addStudents(cls.id, ["Кузнецова Маша"]);
    const form = await seedForm(TEACHER);

    const res = await SELF.fetch(
      `https://worker.test/api/public/class-links/${anya!.token}/forms/${form.token}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.0.0.9" },
        body: JSON.stringify({ answers: [{ taskNumber: 1, value: "4" }] }),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; scoreTotal: number; photosSaved: number };
    expect(body.ok).toBe(true);
    expect(body.scoreTotal).toBe(2);
    expect(body.photosSaved, "без фото photosSaved = 0").toBe(0);

    const photos = await env.DB.prepare("SELECT COUNT(*) AS c FROM form_answer_photos").first<{ c: number }>();
    expect(photos!.c).toBe(0);
  });

  // ── M5. Сдача с фото ─────────────────────────────────────────────────────
  it("M5: фото ученика принимается, лежит в общем бакете и удаляется по общей дате", async () => {
    const cls = await createClass("3Д");
    const [anya] = await addStudents(cls.id, ["Кузнецова Маша"]);
    const form = await seedForm(TEACHER);
    const cookie = await login(cls.code, "Кузнецова Маша");

    // Загрузка фото по коду класса (cookie-вход, без токена в URL).
    const upload = await SELF.fetch(
      `https://worker.test/api/classes/code/${cls.code}/forms/${form.token}/photo`,
      {
        method: "POST",
        headers: { Cookie: `class_student_${cls.code}=${cookie}` },
        body: (() => {
          const fd = new FormData();
          fd.append("photo", new File([new Uint8Array([1, 2, 3, 4])], "photo.jpg", { type: "image/jpeg" }));
          return fd;
        })(),
      },
    );
    expect(upload.status, "фото должно загрузиться").toBe(201);
    const uploaded = (await upload.json()) as { photoR2Key: string };

    // Объект реально лежит в бакет�� PDFS.
    const inBucket = await env.PDFS.head(uploaded.photoR2Key);
    expect(inBucket, "фото должно лежать в PDFS — том же бакете, что и работа учителя").not.toBeNull();

    // Отправляем работу: задание 2 сдано фотографией.
    const res = await SELF.fetch(
      `https://worker.test/api/classes/code/${cls.code}/forms/${form.token}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `class_student_${cls.code}=${cookie}` },
        body: JSON.stringify({
          answers: [
            { taskNumber: 1, value: "4" },
            { taskNumber: 2, value: "", photoR2Key: uploaded.photoR2Key },
          ],
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { photosSaved: number };
    expect(body.photosSaved).toBe(1);

    const photo = await env.DB
      .prepare("SELECT task_number, r2_key, delete_at FROM form_answer_photos")
      .first<{ task_number: number; r2_key: string; delete_at: number }>();
    expect(photo!.task_number).toBe(2);
    expect(photo!.r2_key).toBe(uploaded.photoR2Key);

    // ГЛАВНОЕ ПРО RETENTION: та же константа, что у работы, загруженной учителем,
    // и та же таблица, поэтому тот же скрипт удалит фото ученика.
    const check = await env.DB
      .prepare("SELECT delete_at, created_at, user_id FROM photo_checks WHERE r2_key = ?1")
      .bind(uploaded.photoR2Key)
      .first<{ delete_at: number; created_at: number; user_id: string | null }>();
    expect(check!.delete_at - check!.created_at).toBe(PHOTO_RETENTION_SECONDS);
    expect(check!.user_id, "разбор фото делает учитель-владелец формы").toBe(TEACHER);

    // Строка видна retention-скрипту: тот же запрос, что у работы учителя.
    const expired = await env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM photo_checks
          WHERE delete_at IS NOT NULL AND delete_at <= ?1 AND r2_key IS NOT NULL`,
      )
      .bind(check!.delete_at)
      .first<{ c: number }>();
    expect(expired!.c).toBe(1);
  });

  it("M5: чужой ключ фото подставить нельзя", async () => {
    const cls = await createClass("3Е");
    const [anya, misha] = await addStudents(cls.id, ["Кузнецова Маша", "Кузнецов Миша"]);
    const form = await seedForm(TEACHER);
    const cookie = await login(cls.code, "Кузнецов Миша");

    // Фото МАШИ, отправленное от лица Миши (тот же класс, та же форма).
    const upload = await SELF.fetch(
      `https://worker.test/api/public/class-links/${anya!.token}/forms/${form.token}/photo`,
      {
        method: "POST",
        // Content-Type НЕ задаём: границу multipart проставляет fetch сам.
        body: (() => {
          const fd = new FormData();
          fd.append("photo", new File([new Uint8Array([9, 9, 9])], "photo.jpg", { type: "image/jpeg" }));
          return fd;
        })(),
      },
    );
    expect(upload.status).toBe(201);
    const foreign = (await upload.json()) as { photoR2Key: string };

    const res = await SELF.fetch(
      `https://worker.test/api/classes/code/${cls.code}/forms/${form.token}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `class_student_${cls.code}=${cookie}` },
        body: JSON.stringify({ answers: [{ taskNumber: 2, value: "", photoR2Key: foreign.photoR2Key }] }),
      },
    );
    // Ответ принят (это его работа), но чужое фото к ней НЕ привязано.
    expect(res.status).toBe(201);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS c FROM form_answer_photos").first<{ c: number }>();
    expect(rows!.c, "фото чужого ученика привязано быть не должно").toBe(0);
    expect(misha).toBeTruthy();
  });

  // ── M6. Лимиты не должны были измениться (п. 14 приёмки) ─────────────────
  //
  // Два независимых потолка, и оба должны держаться ровно на ТЗ-22:
  //   60/час на ПАРУ «форма + IP» — персональная ссылка не должна стать вторым
  //   карманом, иначе класс из 30 человек получил бы вдвое больший бюджет;
  //   200/час на IP — общий потолок, он выше парного, потому что считает всё.
  it(
    "M6: 60 отправок на пару «форма + IP», дальше 429; тот же IP получает не больше 200 в час",
    { timeout: 120_000 },
    async () => {
      const cls = await createClass("2Ж");
      const [anya] = await addStudents(cls.id, ["Никитина Аня"]);
      const formA = await seedForm(TEACHER, "Работа А");
      const ip = "10.1.0.7";

      const submit = (token: string) =>
        SELF.fetch(`https://worker.test/api/public/class-links/${anya!.token}/forms/${token}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
          body: JSON.stringify({ answers: [{ taskNumber: 1, value: "4" }] }),
        });

      // ── Парный лимит: 60 проходят, 61-я отправка отказана.
      const first = await submit(formA.token);
      expect(first.status, "первая отправка проходит").toBe(201);
      for (let i = 1; i < 60; i += 1) {
        const res = await submit(formA.token);
        expect(res.status, `отправка №${i + 1} должна пройти`).toBe(201);
      }
      const overPair = await submit(formA.token);
      expect(overPair.status, "61-я отправка с той же пары «форма + IP» отклонена").toBe(429);

      // Тот же ученик с ДРУГОГО адреса проходит: лимит на пару, а не на ученика.
      const otherIp = await SELF.fetch(
        `https://worker.test/api/public/class-links/${anya!.token}/forms/${formA.token}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.1.0.8" },
          body: JSON.stringify({ answers: [{ taskNumber: 1, value: "4" }] }),
        },
      );
      expect(otherIp.status, "с другого IP пара «форма + IP» своя").toBe(201);
    },
  );

  it(
    "M6b: общий потолок 200 отправок в час на IP — много форм с одного адреса",
    { timeout: 180_000 },
    async () => {
      const cls = await createClass("2З");
      const [anya] = await addStudents(cls.id, ["Орлова Аня"]);
      const ip = "10.2.0.7";

      const submit = (formToken: string) =>
        SELF.fetch(`https://worker.test/api/public/class-links/${anya!.token}/forms/${formToken}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
          body: JSON.stringify({ answers: [{ taskNumber: 1, value: "4" }] }),
        });

      // Пять форм по 40 отправок: парный лимит (60) не срабатывает ни разу, а
      // общий потолок набивается только суммой по всем работам.
      const forms = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => seedForm(TEACHER, `Работа ${n}`)),
      );
      for (const form of forms) {
        for (let i = 0; i < 40; i += 1) {
          const res = await submit(form.token);
          expect(res.status, "до 200 отправок с одного IP всё проходит").toBe(201);
        }
      }

      const sixth = await seedForm(TEACHER, "Работа 6");
      const over = await submit(sixth.token);
      expect(over.status, "201-я отправка с одного IP отклонена").toBe(429);
      expect(cls.id).toBeTruthy();
    },
  );
});
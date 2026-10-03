/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * Ручные отметки учителя после проверки по фото (ТЗ-19).
 *
 * Две половины одной фичи, и обе проверяются здесь:
 *
 *   M1–M9 — чистое слияние `mergeManualMarks`: что происходит с итогом, когда
 *           учитель подтвердил всё, подтвердил часть, поставил мусорный балл
 *           или сказал «не засчитано»;
 *   D1–D8 — реальный D1 из workerd: отметка пишется и переживает перезапись,
 *           снимок машины НЕ перетирается, photo_checks пересчитывается, а
 *           строка журнала одна на проверку, а не по записи на клик.
 *
 * Почему снимок машины проверяется отдельно и так настырно: ровно на этом
 * требовании ТЗ-19 §3 держится «через месяц видно, где кончилась машина и
 * начался человек». Если UPSERT начнёт переписывать `model_verdict` при
 * повторной правке, эта информация пропадёт тихо и навсегда.
 *
 * Запуск: `cd backend && npx vitest run tests/unit/photoCheckManualMarks.test.ts`
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../src/env";
import type { AppEnv } from "../../src/types";
import { authMiddleware } from "../../src/middleware/auth";
import { errorMiddleware } from "../../src/middleware/error";
import { journalRouter } from "../../src/routes/journal";
import {
  journalSourceFor,
  machineResultOf,
  mergeManualMarks,
  normalizeTeacherPoints,
  type StoredCheckItem,
} from "../../src/services/photoCheckGrading";
import { getManualMarks } from "../../src/db/photoChecks";
import { listJournalEntries } from "../../src/db/journal";

// Своя копия нужных таблиц: workerd-runtime не умеет node:fs, а тянуть весь
// schema.sql ради трёх таблиц смысла нет.
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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS photo_check_items (
  id             TEXT PRIMARY KEY,
  check_id       TEXT NOT NULL REFERENCES photo_checks(id) ON DELETE CASCADE,
  task_number    INTEGER NOT NULL,
  task_text      TEXT,
  expected       TEXT,
  student_answer TEXT,
  verdict        TEXT NOT NULL DEFAULT 'unclear',
  points_awarded INTEGER NOT NULL DEFAULT 0,
  max_points     INTEGER NOT NULL DEFAULT 1,
  confidence     REAL,
  needs_review   INTEGER NOT NULL DEFAULT 0,
  comment        TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE(check_id, task_number)
);

CREATE TABLE IF NOT EXISTS photo_check_manual_marks (
  id            TEXT PRIMARY KEY,
  check_id      TEXT NOT NULL REFERENCES photo_checks(id) ON DELETE CASCADE,
  task_number   INTEGER NOT NULL,
  accepted      INTEGER NOT NULL,
  points        INTEGER NOT NULL DEFAULT 0,
  model_verdict TEXT,
  model_points  INTEGER,
  author        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(check_id, task_number)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_id      TEXT NOT NULL REFERENCES photo_checks(id) ON DELETE CASCADE,
  subject       TEXT,
  grade         INTEGER,
  mark          TEXT,
  percentage    INTEGER,
  earned_points INTEGER NOT NULL DEFAULT 0,
  total_points  INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'machine',
  pending_tasks INTEGER NOT NULL DEFAULT 0,
  occurred_at   INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(user_id, check_id)
);
`;

// ── Хелперы ────────────────────────────────────────────────────────────────

const TEACHER_A = "usr_teacherAAAA19";
const TEACHER_B = "usr_teacherBBBB19";
const OTHER_USER = "usr_teacherCCCC19";

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

function authHeaders(session: string): Record<string, string> {
  return { "Content-Type": "application/json", Cookie: `session=${session}` };
}

/**
 * Проверка с тремя заданиями: №1 верное машина разобрала, №2 машина ошиблась,
 * №3 неразборчиво. Итог машины — 2 из 4, то есть 50% и отметка «3».
 */
async function seedCheck(ownerId: string, checkId: string, status = "partial"): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO photo_checks
         (id, user_id, subject, grade, status, total_points, earned_points, percentage,
          grade_mark, needs_review, model, created_at, completed_at)
       VALUES (?1, ?2, 'Математика', 5, ?3, 4, 2, 50, '3', 1, 'gpt-test-vision', ?4, ?4)`,
    )
    .bind(checkId, ownerId, status, now)
    .run();

  const items: Array<[number, string, number, number, number]> = [
    [1, "correct", 2, 2, 0],
    [2, "incorrect", 0, 1, 1],
    [3, "unclear", 0, 1, 1],
  ];
  for (const [num, verdict, awarded, max, review] of items) {
    await env.DB
      .prepare(
        `INSERT INTO photo_check_items
           (id, check_id, task_number, task_text, expected, student_answer, verdict,
            points_awarded, max_points, confidence, needs_review, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, 'эталон', 'ответ', ?5, ?6, ?7, 0.9, ?8, NULL, ?9)`,
      )
      .bind(`pci_${checkId}_${num}`, checkId, num, `Задание ${num}`, verdict, awarded, max, review, now)
      .run();
  }
}

function saveMarks(session: string, checkId: string, marks: unknown): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/assignments/photo-checks/${checkId}/manual-marks`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ marks }),
  });
}

/**
 * Журнал проверяем на отдельном Hono-приложении, а не через SELF.
 *
 * `journalRouter` монтируется в `backend/src/index.ts` строкой
 * `app.route("/api/journal", journalRouter)` — а index.ts в этой фиче не трогаем
 * (он не наш файл). Собираем ровно ту же сборку, что и воркер: та же
 * authMiddleware, тот же errorMiddleware, тот же роутер. Тест проверяет роут, а
 * не наличие строчки в index.ts.
 */
const journalApp = new Hono<AppEnv>();
journalApp.use("*", authMiddleware());
journalApp.onError(errorMiddleware);
journalApp.route("/api/journal", journalRouter);

async function callJournal(session: string, query = ""): Promise<Response> {
  return Promise.resolve(
    journalApp.fetch(
      new Request(`https://worker.test/api/journal${query}`, { headers: authHeaders(session) }),
      env as never,
    ),
  );
}

// ── Чистое слияние ─────────────────────────────────────────────────────────

/** Разбор машины: 2 из 4, задания 2 и 3 сомнительные. */
const ITEMS: StoredCheckItem[] = [
  { number: 1, verdict: "correct", pointsAwarded: 2, maxPoints: 2, needsReview: false },
  { number: 2, verdict: "incorrect", pointsAwarded: 0, maxPoints: 1, needsReview: true },
  { number: 3, verdict: "unclear", pointsAwarded: 0, maxPoints: 1, needsReview: true },
];

describe("mergeManualMarks · отметка учителя поверх машины (ТЗ-19 §2)", () => {
  it("M1: без ручных отметок результат машины не меняется, итог есть", () => {
    const merged = mergeManualMarks(ITEMS, []);
    expect(merged.earnedPoints).toBe(2);
    expect(merged.totalPoints).toBe(4);
    expect(merged.items.every((i) => i.decidedBy === "model")).toBe(true);
    // Сомнительные есть — отметки нет, но totalPoints полный.
    expect(merged.pendingReview).toBe(2);
    expect(merged.percentage).toBeNull();
    expect(merged.gradeMark).toBeNull();
  });

  it("M2: учитель закрыл ВСЕ сомнительные — отметка считается", () => {
    const merged = mergeManualMarks(ITEMS, [
      { taskNumber: 2, accepted: true, points: 1 },
      { taskNumber: 3, accepted: true, points: 1 },
    ]);
    expect(merged.pendingReview).toBe(0);
    expect(merged.earnedPoints).toBe(4);
    expect(merged.percentage).toBe(100);
    expect(merged.gradeMark).toBe("5");
    expect(merged.items.filter((i) => i.decidedBy === "teacher")).toHaveLength(2);
  });

  it("M3: учитель закрыл ЧАСТЬ — итоговой отметки нет, это не ноль", () => {
    const merged = mergeManualMarks(ITEMS, [{ taskNumber: 3, accepted: true, points: 1 }]);
    expect(merged.pendingReview).toBe(1);
    expect(merged.earnedPoints).toBe(3);
    // Ключевое: процент и отметка null, а не 75% и не «3».
    expect(merged.percentage).toBeNull();
    expect(merged.gradeMark).toBeNull();
    // totalPoints полный — неразобранное задание не исчезло из знаменателя.
    expect(merged.totalPoints).toBe(4);
  });

  it("M4: отметка учителя побеждает вердикт модели, но снимок машины сохранён", () => {
    const merged = mergeManualMarks(ITEMS, [
      { taskNumber: 2, accepted: true, points: 1 },
      { taskNumber: 3, accepted: false, points: 0 },
    ]);
    const two = merged.items.find((i) => i.number === 2);
    // Машина сказала «неверно», учитель засчитал.
    expect(two?.verdict).toBe("correct");
    expect(two?.pointsAwarded).toBe(1);
    expect(two?.decidedBy).toBe("teacher");
    // …и это видно: машина считала иначе, решение — человека.
    expect(two?.modelVerdict).toBe("incorrect");
    expect(two?.modelPoints).toBe(0);
  });

  it("M5: accepted:false даёт 0 баллов, даже если учитель прислал points > 0", () => {
    const merged = mergeManualMarks(ITEMS, [
      { taskNumber: 2, accepted: false, points: 3 },
      { taskNumber: 3, accepted: false, points: 5 },
    ]);
    expect(merged.earnedPoints).toBe(2);
    expect(merged.items.find((i) => i.number === 2)?.pointsAwarded).toBe(0);
    expect(merged.percentage).toBe(50);
    expect(merged.gradeMark).toBe("3");
  });

  it("M6: балл учителя клампится в 0..maxPoints", () => {
    expect(normalizeTeacherPoints(99, 2)).toBe(2);
    expect(normalizeTeacherPoints(-5, 2)).toBe(0);
    expect(normalizeTeacherPoints(1.4, 2)).toBe(1);
    expect(normalizeTeacherPoints(1.6, 2)).toBe(2);
    // Мусор на входе — 0, а НЕ исключение наружу: учитель не должен видеть 500
    // из-за одного кривого поля.
    expect(normalizeTeacherPoints(NaN, 2)).toBe(0);
    expect(normalizeTeacherPoints("2", 2)).toBe(2);
    expect(normalizeTeacherPoints("abc", 2)).toBe(0);
    expect(normalizeTeacherPoints(null, 2)).toBe(0);
    expect(normalizeTeacherPoints(undefined, 2)).toBe(0);
    expect(normalizeTeacherPoints({} as unknown, 2)).toBe(0);

    const merged = mergeManualMarks(ITEMS, [
      { taskNumber: 2, accepted: true, points: 77 },
      { taskNumber: 3, accepted: true, points: 0 },
    ]);
    expect(merged.items.find((i) => i.number === 2)?.pointsAwarded).toBe(1);
  });

  it("M7: неразобранное задание без отметки учителя не тянет итог молча", () => {
    // Никаких отметок, но totalPoints = 4, а не 2: процент не может вырасти
    // только потому, что модель что-то не прочитала.
    const merged = mergeManualMarks(ITEMS, []);
    expect(merged.totalPoints).toBe(4);
    expect(merged.earnedPoints).toBe(2);
    expect(merged.needsReview).toBe(true);
  });

  it("M8: modelResult отличается от итога после ручных правок", () => {
    const machine = machineResultOf(ITEMS);
    expect(machine.percentage).toBe(50);
    expect(machine.gradeMark).toBe("3");

    const merged = mergeManualMarks(ITEMS, [
      { taskNumber: 2, accepted: true, points: 1 },
      { taskNumber: 3, accepted: true, points: 1 },
    ]);
    // Через месяц видно: машина предлагала «3», человек поставил «5».
    expect(merged.gradeMark).toBe("5");
  });

  it("M9: источник решения для журнала различает machine/teacher/mixed", () => {
    expect(journalSourceFor(0, 0)).toBe("machine");
    expect(journalSourceFor(0, 2)).toBe("machine");
    expect(journalSourceFor(2, 0)).toBe("teacher");
    expect(journalSourceFor(1, 1)).toBe("mixed");
  });
});

// ── D1 ─────────────────────────────────────────────────────────────────────

describe("ручные отметки · D1 и роуты (ТЗ-19 §3)", () => {
  let sessionA = "";
  let sessionB = "";

  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "tz19", queries: [SCHEMA_SQL] }]);
    sessionA = await createUser(TEACHER_A, "a19@example.test");
    sessionB = await createUser(TEACHER_B, "b19@example.test");
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM journal_entries").run();
    await env.DB.prepare("DELETE FROM photo_check_manual_marks").run();
    await env.DB.prepare("DELETE FROM photo_check_items").run();
    await env.DB.prepare("DELETE FROM photo_checks").run();
  });

  it("D1: без входа → 401", async () => {
    await seedCheck(TEACHER_A, "pc_auth001");
    const res = await SELF.fetch(
      "https://worker.test/api/assignments/photo-checks/pc_auth001/manual-marks",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marks: [] }) },
    );
    expect(res.status).toBe(401);
  });

  it("D2: чужой проверки → 404, а не 403 (не подтверждаем существование)", async () => {
    await seedCheck(TEACHER_A, "pc_other001");
    const res = await saveMarks(sessionB, "pc_other001", [{ taskNumber: 2, accepted: true, points: 1 }]);
    expect(res.status).toBe(404);
    // И ничего не записалось.
    const marks = await getManualMarks(env.DB, "pc_other001");
    expect(marks).toHaveLength(0);
  });

  it("D3: сохранение пересчитывает photo_checks и пишет одну строку журнала", async () => {
    await seedCheck(TEACHER_A, "pc_save001");
    const res = await saveMarks(sessionA, "pc_save001", [
      { taskNumber: 2, accepted: true, points: 1 },
      { taskNumber: 3, accepted: true, points: 1 },
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      earnedPoints: number;
      gradeMark: string | null;
      pendingReview: number;
      modelResult: { percentage: number | null; gradeMark: string | null };
      manualMarks: Array<{ taskNumber: number }>;
      items: Array<{ number: number; decidedBy: string; modelVerdict: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.earnedPoints).toBe(4);
    expect(body.gradeMark).toBe("5");
    expect(body.pendingReview).toBe(0);
    expect(body.manualMarks).toHaveLength(2);
    // Разделение «машина / учитель» видно прямо в ответе.
    expect(body.items.find((i) => i.number === 1)?.decidedBy).toBe("model");
    expect(body.items.find((i) => i.number === 2)?.decidedBy).toBe("teacher");
    // Снимок машины на месте: она считала «неверно».
    expect(body.items.find((i) => i.number === 2)?.modelVerdict).toBe("incorrect");
    // …и modelResult показывает, что машина предлагала сама.
    expect(body.modelResult.percentage).toBe(50);
    expect(body.modelResult.gradeMark).toBe("3");

    const check = await env.DB
      .prepare("SELECT earned_points, grade_mark, needs_review, status FROM photo_checks WHERE id = ?1")
      .bind("pc_save001")
      .first<{ earned_points: number; grade_mark: string; needs_review: number; status: string }>();
    expect(check?.earned_points).toBe(4);
    expect(check?.grade_mark).toBe("5");
    expect(check?.needs_review).toBe(0);
    expect(check?.status).toBe("ok");

    const journal = await listJournalEntries(env.DB, { userId: TEACHER_A, limit: 20 });
    expect(journal).toHaveLength(1);
    expect(journal[0]?.source).toBe("teacher");
    expect(journal[0]?.mark).toBe("5");
    expect(journal[0]?.pending_tasks).toBe(0);
  });

  it("D4: частичное сохранение даёт source=mixed, mark=null, а не двойку", async () => {
    await seedCheck(TEACHER_A, "pc_mixed01");
    const res = await saveMarks(sessionA, "pc_mixed01", [{ taskNumber: 3, accepted: true, points: 1 }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gradeMark: string | null; percentage: number | null; pendingReview: number };
    expect(body.gradeMark).toBeNull();
    expect(body.percentage).toBeNull();
    expect(body.pendingReview).toBe(1);

    const journal = await listJournalEntries(env.DB, { userId: TEACHER_A, limit: 20 });
    expect(journal[0]?.source).toBe("mixed");
    expect(journal[0]?.mark).toBeNull();
    expect(journal[0]?.pending_tasks).toBe(1);
  });

  it("D5: повторное сохранение не плодит строки и НЕ перетирает снимок машины", async () => {
    await seedCheck(TEACHER_A, "pc_twice1");
    await saveMarks(sessionA, "pc_twice1", [{ taskNumber: 2, accepted: true, points: 1 }]);
    // Учитель вернулся и передумал — теперь считает задание неверным.
    await saveMarks(sessionA, "pc_twice1", [{ taskNumber: 2, accepted: false, points: 0 }]);

    const marks = await getManualMarks(env.DB, "pc_twice1");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.accepted).toBe(0);
    expect(marks[0]?.points).toBe(0);
    // Снимок машины остался ПЕРВЫМ: «что она предложила тогда».
    expect(marks[0]?.model_verdict).toBe("incorrect");
    expect(marks[0]?.model_points).toBe(0);

    // И строка журнала по-прежнему одна — не по записи на клик.
    const journal = await listJournalEntries(env.DB, { userId: TEACHER_A, limit: 20 });
    expect(journal).toHaveLength(1);
  });

  it("D6: неизвестный номер задания → 400 со списком, а не молчаливый игнор", async () => {
    await seedCheck(TEACHER_A, "pc_bad001");
    const res = await saveMarks(sessionA, "pc_bad001", [
      { taskNumber: 2, accepted: true, points: 1 },
      { taskNumber: 99, accepted: true, points: 1 },
    ]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string; details?: { unknownTaskNumbers: number[] } };
    expect(body.code).toBe("BAD_REQUEST");
    expect(body.error).toContain("99");
    expect(body.details?.unknownTaskNumbers).toEqual([99]);
    // Ничего не записалось — проверка целиком отклонена.
    expect(await getManualMarks(env.DB, "pc_bad001")).toHaveLength(0);
  });

  it("D7: неуспешная проверка → 400 с понятным текстом, а не 500", async () => {
    await seedCheck(TEACHER_A, "pc_fail01", "failed");
    const res = await saveMarks(sessionA, "pc_fail01", [{ taskNumber: 1, accepted: true, points: 2 }]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("не распозналась");
  });

  it("D8: повторное открытие возвращает ручные отметки (ТЗ-19, вопрос «б»)", async () => {
    await seedCheck(TEACHER_A, "pc_reopen");
    await saveMarks(sessionA, "pc_reopen", [
      { taskNumber: 2, accepted: true, points: 1 },
      { taskNumber: 3, accepted: false, points: 0 },
    ]);

    const res = await SELF.fetch("https://worker.test/api/assignments/photo-checks/pc_reopen", {
      headers: authHeaders(sessionA),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gradeMark: string;
      manualMarks: Array<{ taskNumber: number; accepted: boolean; points: number; updatedAt: number }>;
      items: Array<{ number: number; decidedBy: string }>;
    };
    // Отметки не потерялись: они вернулись вместе с проверкой.
    expect(body.manualMarks.map((m) => m.taskNumber).sort()).toEqual([2, 3]);
    expect(body.manualMarks.find((m) => m.taskNumber === 3)?.accepted).toBe(false);
    expect(body.manualMarks[0]?.updatedAt).toBeGreaterThan(0);
    expect(body.gradeMark).toBe("4");
    expect(body.items.find((i) => i.number === 3)?.decidedBy).toBe("teacher");
    // Старые поля ответа не сломаны.
    expect(body.items).toHaveLength(3);
  });

  it("D9: GET /api/journal отдаёт только свои записи, чужих не показывает", async () => {
    await createUser(OTHER_USER, "c19@example.test");
    await seedCheck(TEACHER_A, "pc_jrn_a1");
    await seedCheck(TEACHER_B, "pc_jrn_b1");
    await saveMarks(sessionA, "pc_jrn_a1", [
      { taskNumber: 2, accepted: true, points: 1 },
      { taskNumber: 3, accepted: true, points: 1 },
    ]);
    await saveMarks(sessionB, "pc_jrn_b1", [{ taskNumber: 3, accepted: true, points: 1 }]);

    const res = await callJournal(sessionA, "?limit=20");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      entries: Array<{ checkId: string; source: string; mark: string | null; pendingTasks: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.checkId).toBe("pc_jrn_a1");
    expect(body.entries[0]?.source).toBe("teacher");
  });

  it("D10: пустой журнал — валидный ответ, а не 404", async () => {
    const res = await callJournal(sessionB);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; entries: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.entries).toEqual([]);
  });

  it("D11: pendingReview уменьшается по мере сохранения — и учитель может сохранять по частям", async () => {
    await seedCheck(TEACHER_A, "pc_pend01");
    const afterOne = await saveMarks(sessionA, "pc_pend01", [
      { taskNumber: 3, accepted: true, points: 1 },
    ]);
    // Проверка закрыта частично: 2 → 1, и отметка итога ещё НЕ появляется.
    expect(afterOne.status).toBe(200);
    const one = (await afterOne.json()) as { pendingReview: number; gradeMark: string | null };
    expect(one.pendingReview).toBe(1);
    expect(one.gradeMark).toBeNull();

    // Второй заход отдельным запросом — как если бы учитель отвлёкся и вернулся.
    // Итог обязан посчитаться по ВСЕМ сохранённым отметкам, а не по этому запросу.
    const afterTwo = await saveMarks(sessionA, "pc_pend01", [
      { taskNumber: 2, accepted: true, points: 1 },
    ]);
    const two = (await afterTwo.json()) as {
      pendingReview: number;
      gradeMark: string | null;
      percentage: number | null;
    };
    expect(two.pendingReview).toBe(0);
    expect(two.gradeMark).toBe("5");
    expect(two.percentage).toBe(100);
  });

  it("D12: дробный балл → 400, а не тихая подгонка под целое", async () => {
    await seedCheck(TEACHER_A, "pc_junk01");
    const res = await saveMarks(sessionA, "pc_junk01", [{ taskNumber: 2, accepted: true, points: 1.5 }]);
    // zod режет дробь на входе. Альтернатива — молча округлить и записать в
    // журнал балл, которого учитель не ставил, — хуже, чем понятный отказ.
    expect(res.status).toBe(400);
    expect(await getManualMarks(env.DB, "pc_junk01")).toHaveLength(0);
  });

  it("D14: отметка без балла = полный балл задания (points необязателен)", async () => {
    await seedCheck(TEACHER_A, "pc_nopts1");
    const res = await saveMarks(sessionA, "pc_nopts1", [{ taskNumber: 1, accepted: true }]);
    expect(res.status).toBe(200);
    const marks = await getManualMarks(env.DB, "pc_nopts1");
    // Задание №1 стоит 2 балла — «зачтено» без балла значит «зачтено целиком».
    // Трактовать отсутствие балла как ноль было бы наказанием за краткость.
    expect(marks[0]?.points).toBe(2);
  });

  it("D13: балл больше maxPoints сохраняется, но клампится по слиянию", async () => {
    await seedCheck(TEACHER_A, "pc_clamp1");
    const res = await saveMarks(sessionA, "pc_clamp1", [{ taskNumber: 1, accepted: true, points: 99 }]);
    expect(res.status).toBe(200);
    const marks = await getManualMarks(env.DB, "pc_clamp1");
    // Задание №1 стоит 2 балла — 99 записаться не могли.
    expect(marks[0]?.points).toBe(2);
  });
});

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

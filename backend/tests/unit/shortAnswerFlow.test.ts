/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * Поток сверки коротких ответов (лист 3.1.6, G1).
 *
 * Главное, что здесь доказывается ПОВЕДЕНИЕМ, а не комментарием:
 *
 *   F1. Галочка снята (по умолчанию) → ни ОДНОГО вызова модели. Проверяется
 *       счётчиком на подменённом `fetch`, а не «нам кажется, вызова не было»:
 *       именно молчаливый расход денег и был незакрытой дырой этого листа.
 *   F2. Галочка включена → отправка реально сверяет ответ ИИ, вердикт доходит
 *       и в ответ ученику, и в `form_answers` со снимком «чьё это решение».
 *   F3. Модель не уверена → «проверьте сами», а НЕ «неверно».
 *   F4. Провайдер упал / ответил мусором → ученик всё равно сдал (201).
 *   F5. Учитель исправил машину → исправление остаётся исправлением, а снимок
 *       вердикта модели сохраняется.
 *   F6. Учитель ВЫКЛЮЧИЛ сверку после того, как включал → новые работы снова
 *       идут без модели.
 *   F7. В журнале видны РАЗНЫЕ состояния, а не одно на все случаи.
 *
 * Живых вызовов polza здесь НЕТ: провайдер подменяется на уровне `fetch`
 * (приём из tests/integration/polza-cost-regression.test.ts), поэтому проверяется
 * настоящий путь — роут → сервис → роутер LLM → разбор ответа.
 *
 * Роуты зовутся НАПРЯМУЮ, не через SELF: так в окружение подставляется ключ
 * polza, которого в тестовой среде нет, и подменённый `fetch` виден самому
 * проверяемому коду. Схема D1 зашита в SCHEMA_SQL — workerd не имеет
 * fs.readFileSync.
 */

import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { publicFormsRouter } from "../../src/routes/publicForms";
import { journalRouter } from "../../src/routes/journal";
import { authMiddleware } from "../../src/middleware/auth";
import { errorMiddleware } from "../../src/middleware/error";
import { readShortAnswerLlmSettings } from "../../src/services/formGrading";
import type { AppEnv, WorksheetTask } from "../../src/types";
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

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'teacher',
  created_at INTEGER NOT NULL
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────────────────

const TEACHER_ID = "usr_leaf316aaaaa";
const SESSION_TOKEN = "sess_leaf316_test_token_01";
const IP = "10.0.0.77";

/** Ключ polza есть только в тестовом env — в боевой среде демо его не имеет. */
const TEST_ENV = { ...env, POLZA_API_KEY: "test-key" } as unknown as Env;

const app = new Hono<AppEnv>();
app.use("*", authMiddleware());
// Тот же onError, что и в index.ts: без него отказ формы выглядел бы как 500,
// и тест проверял бы не форму, а расхождение с боевым приложением.
app.onError(errorMiddleware);
app.route("/api/public/forms", publicFormsRouter);
app.route("/api/journal", journalRouter);

const realFetch = globalThis.fetch;
let seq = 0;

interface SeedOpts {
  tasks?: WorksheetTask[];
}

/** Форма с одним коротким ответом и одним счётом — как её создаёт учитель. */
async function seedForm(opts: SeedOpts = {}): Promise<{ id: string; token: string }> {
  seq += 1;
  const id = `frm_leaf316${String(seq).padStart(6, "0")}`;
  const token = `leaf316token${String(seq).padStart(16, "0")}`;
  const now = Math.floor(Date.now() / 1000);

  const tasks: WorksheetTask[] = opts.tasks ?? [
    {
      number: 1,
      text: "Почему небо голубое?",
      type: "short-answer",
      answer: "Солнечный свет рассеивается в атмосфере, синий цвет виден сильнее",
      points: 2,
    },
    {
      number: 2,
      text: "Сколько будет 7*6?",
      type: "computation",
      answer: "42",
      points: 1,
    },
  ];

  await env.DB
    .prepare(
      `INSERT INTO forms
         (id, token, user_id, worksheet_id, title, subject, grade, payload_json, status,
          access_code, expires_at, show_answers, check_mode, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, 'Лист по окружающему миру', 'science', 5, ?4, 'open',
              NULL, ?5, 0, 'llm', ?6, ?6)`,
    )
    .bind(id, token, TEACHER_ID, JSON.stringify({ tasks }), now + 14 * 86400, now)
    .run();

  return { id, token };
}

/** Ответ polza (OpenAI-совместимый /chat/completions). */
function polzaResponse(content: string): unknown {
  return {
    model: "openai/gpt-6-luna",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 },
  };
}

/**
 * Подменить провайдера и СЧИТАТЬ ОБРАЩЕНИЯ К НЕМУ.
 *
 * Счётчик — главный инструмент этого файла: «денег не потрачено» доказывается
 * нулём вызовов, а не отсутствием строки в ответе. Всё, что не polza, уходит в
 * настоящий fetch — чтобы тест не сломал сам себя на постороннем запросе.
 */
function stubModel(content: string, opts: { status?: number } = {}) {
  const calls: string[] = [];
  const mock = vi.fn(async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : ((input as Request)?.url ?? String(input));
    calls.push(url);
    return new Response(JSON.stringify(polzaResponse(content)), { status: opts.status ?? 200 });
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

/** Провайдер падает — 5xx, как у polza при перегрузке. */
function stubModelFailure(status = 500) {
  const calls: string[] = [];
  const mock = vi.fn(async (input: unknown) => {
    const url =
      typeof input === "string" ? input : ((input as Request)?.url ?? String(input));
    calls.push(url);
    return new Response("upstream error", { status });
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

interface SubmitResult {
  status: number;
  responseId: string;
  perTask: Array<{ taskNumber: number; status: string }>;
  scoreTotal: number;
}

/** Ученик сдал работу. */
async function submit(token: string, name = "Ученик"): Promise<SubmitResult> {
  const res = await app.request(
    `/api/public/forms/${token}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": IP },
      body: JSON.stringify({
        studentName: name,
        answers: [
          { taskNumber: 1, value: "Солнце светит, и небо кажется голубым из-за рассеяния" },
          { taskNumber: 2, value: "42" },
        ],
      }),
    },
    TEST_ENV,
  );
  // Тестовое приложение повторяет onError и роуты боевого, но не весь index.ts.
  // Тело ответа читаем мягко на случай нестандартной ошибки — контракт ошибок
  // форм проверяется отдельно, в publicForms.test.ts через SELF.
  const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return {
    status: res.status,
    responseId: String(body.responseId ?? ""),
    perTask: (body.perTask ?? []) as SubmitResult["perTask"],
    scoreTotal: Number(body.scoreTotal ?? 0),
  };
}

/** Учитель включил/выключил сверку на форме — тот же путь, что и галочка в ЛК. */
async function setToggle(formId: string, enabled: boolean): Promise<Response> {
  return app.request(
    `/api/journal/forms/${formId}/short-answer-llm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-token": SESSION_TOKEN },
      body: JSON.stringify({ enabled }),
    },
    TEST_ENV,
  );
}

/** Читающий запрос учителя: с его сессией. */
async function teacherGet(path: string): Promise<Response> {
  return app.request(path, { headers: { "x-session-token": SESSION_TOKEN } }, TEST_ENV);
}

interface StoredAnswer {
  id: string;
  response_id: string;
  task_number: number;
  is_correct: number | null;
  points_awarded: number;
  needs_review: number;
  check_method: string;
  check_meta_json: string | null;
}

async function readAnswer(responseId: string, taskNumber = 1): Promise<StoredAnswer> {
  const row = await env.DB
    .prepare(
      `SELECT id, response_id, task_number, is_correct, points_awarded, needs_review,
              check_method, check_meta_json
       FROM form_answers WHERE response_id = ?1 AND task_number = ?2`,
    )
    .bind(responseId, taskNumber)
    .first<StoredAnswer>();
  if (!row) throw new Error(`Ответ ${taskNumber} не найден для ${responseId}`);
  return row;
}

function metaOf(answer: StoredAnswer): Record<string, unknown> {
  return answer.check_meta_json ? (JSON.parse(answer.check_meta_json) as Record<string, unknown>) : {};
}

async function readResponseScore(responseId: string): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT score_total FROM form_responses WHERE id = ?1`)
    .bind(responseId)
    .first<{ score_total: number }>();
  return row?.score_total ?? -1;
}

beforeAll(async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const stmt of SCHEMA_SQL.split(";")) {
    const sql = stmt.trim();
    if (sql) await env.DB.prepare(sql).run();
  }
  await env.DB
    .prepare(
      `INSERT INTO users (id, email, name, plan, generations_total, generations_today,
                          is_admin, created_at, updated_at)
       VALUES (?1, ?2, 'Учитель', 'base', 0, 0, 0, ?3, ?3)`,
    )
    .bind(TEACHER_ID, "leaf316@example.test", now)
    .run();
  await env.DB
    .prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(SESSION_TOKEN, TEACHER_ID, now + 86400, now)
    .run();
  // Второй учитель — чтобы было чем проверять чужую форму.
  await env.DB
    .prepare(
      `INSERT INTO users (id, email, name, plan, generations_total, generations_today,
                          is_admin, created_at, updated_at)
       VALUES ('usr_other000000000', 'other@example.test', 'Другой учитель', 'base', 0, 0, 0, ?1, ?1)`,
    )
    .bind(now)
    .run();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("сверка коротких ответов: поток отправки формы (лист 3.1.6)", () => {
  it("F1: галочка снята — ни одного вызова модели, ответ ждёт учителя", async () => {
    const { token } = await seedForm();
    const model = stubModel(JSON.stringify({ verdict: "correct", confidence: 0.99 }));

    const res = await submit(token);

    expect(res.status).toBe(201);
    // ГЛАВНОЕ УТВЕРЖДЕНИЕ ТЕСТА: провайдер не тронут ни разу.
    expect(model.mock).not.toHaveBeenCalled();

    const answer = await readAnswer(res.responseId, 1);
    expect(answer.check_method).toBe("manual");
    expect(answer.needs_review).toBe(1);
    expect(answer.is_correct).toBeNull();
    expect(metaOf(answer).llmChecked).toBe(false);

    // Детерминированное задание при этом посчитано как раньше.
    const computation = await readAnswer(res.responseId, 2);
    expect(computation.check_method).toBe("auto");
    expect(computation.points_awarded).toBe(1);
    expect(res.scoreTotal).toBe(1);
    // Ученик видит «ждёт проверки», а не «неверно».
    expect(res.perTask[0]?.status).toBe("unreviewed");
  });

  it("F1b: форма без ключа в настройках — то же самое, галочка по умолчанию снята", async () => {
    const { id, token } = await seedForm();
    const stored = await env.DB
      .prepare(`SELECT payload_json FROM forms WHERE id = ?1`)
      .bind(id)
      .first<{ payload_json: string }>();

    expect(readShortAnswerLlmSettings(stored?.payload_json).enabled).toBe(false);

    const model = stubModel(JSON.stringify({ verdict: "correct", confidence: 0.99 }));
    await submit(token);
    expect(model.mock).not.toHaveBeenCalled();
  });

  it("F2: галочка включена — ответ сверен моделью, вердикт сохранён и отдан", async () => {
    const { id, token } = await seedForm();
    const model = stubModel(
      JSON.stringify({
        verdict: "correct",
        confidence: 0.93,
        comment: "Смысл ответа совпадает с эталоном",
      }),
    );

    const toggle = await setToggle(id, true);
    expect(toggle.status).toBe(200);
    expect(((await toggle.json()) as { shortAnswerLlmEnabled: boolean }).shortAnswerLlmEnabled).toBe(
      true,
    );

    const res = await submit(token);

    // Ровно один вызов: одно короткое задание.
    expect(model.mock).toHaveBeenCalledTimes(1);
    expect(model.calls[0]).toContain("/chat/completions");

    const answer = await readAnswer(res.responseId, 1);
    expect(answer.check_method).toBe("llm");
    expect(answer.is_correct).toBe(1);
    expect(answer.points_awarded).toBe(2);
    expect(answer.needs_review).toBe(0);

    const meta = metaOf(answer);
    expect(meta.llmChecked).toBe(true);
    expect(meta.decidedBy).toBe("model");
    expect(meta.modelVerdict).toBe("correct");
    expect(meta.confidence).toBe(0.93);
    expect(meta.comment).toBe("Смысл ответа совпадает с эталоном");

    // Вердикт дошёл и до ученика, и в общий балл работы.
    expect(res.perTask[0]?.status).toBe("correct");
    expect(res.scoreTotal).toBe(3);
  });

  it("F3: модель не уверена — «проверьте сами», а не «неверно»", async () => {
    const { id, token } = await seedForm();
    stubModel(JSON.stringify({ verdict: "correct", confidence: 0.2 }));
    await setToggle(id, true);

    const res = await submit(token);
    expect(res.status).toBe(201);

    const answer = await readAnswer(res.responseId, 1);
    expect(answer.needs_review).toBe(1);
    expect(answer.is_correct).toBeNull();
    expect(answer.points_awarded).toBe(0);

    const meta = metaOf(answer);
    expect(meta.modelVerdict).toBe("uncertain");
    expect(meta.decidedBy).toBe("model");
    expect(String(meta.reason)).toContain("не уверен");
    expect(res.perTask[0]?.status).toBe("unreviewed");
  });

  it("F4: провайдер упал — ученик всё равно сдал, работа у учителя", async () => {
    const { id, token } = await seedForm();
    stubModelFailure(503);
    await setToggle(id, true);

    const res = await submit(token);

    expect(res.status).toBe(201);
    expect(res.responseId).not.toBe("");
    const answer = await readAnswer(res.responseId, 1);
    expect(answer.needs_review).toBe(1);
    expect(answer.check_method).toBe("manual");
    expect(metaOf(answer).modelVerdict).toBeNull();
  });

  it("F4b: модель ответила мусором — это не «неверно»", async () => {
    const { id, token } = await seedForm();
    stubModel("простите, я не могу ответить");
    await setToggle(id, true);

    const res = await submit(token);
    expect(res.status).toBe(201);

    const answer = await readAnswer(res.responseId, 1);
    expect(answer.needs_review).toBe(1);
    expect(answer.is_correct).toBeNull();
    expect(metaOf(answer).decidedBy).toBe("model");
  });

  it("F5: учитель исправил машину — исправление остаётся, снимок модели сохранён", async () => {
    const { id, token } = await seedForm();
    stubModel(JSON.stringify({ verdict: "incorrect", confidence: 0.95 }));
    await setToggle(id, true);

    const res = await submit(token);
    const answer = await readAnswer(res.responseId, 1);
    expect(answer.is_correct).toBe(0);
    expect(answer.check_method).toBe("llm");

    const override = await app.request(
      `/api/journal/answers/${answer.id}/override`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": SESSION_TOKEN },
        // Учитель посмотрел работу и ответ верный — балл полный.
        body: JSON.stringify({ accepted: true, points: 2 }),
      },
      TEST_ENV,
    );
    expect(override.status).toBe(200);

    const after = await readAnswer(res.responseId, 1);
    expect(after.is_correct).toBe(1);
    expect(after.points_awarded).toBe(2);
    expect(after.needs_review).toBe(0);
    expect(after.check_method).toBe("manual");

    const meta = metaOf(after);
    expect(meta.decidedBy).toBe("teacher");
    // Снимок машины не затирается: через месяц видно, что именно поправил человек.
    expect(meta.modelVerdict).toBe("incorrect");
    expect(meta.confidence).toBe(0.95);

    // Итог работы пересчитан, а не остался от машины.
    expect(await readResponseScore(res.responseId)).toBe(3);
  });

  it("F6: учитель выключил сверку после того, как включал — деньги снова не тратятся", async () => {
    const { id, token } = await seedForm();
    stubModel(JSON.stringify({ verdict: "correct", confidence: 0.9 }));

    await setToggle(id, true);
    const first = await submit(token);
    expect(metaOf(await readAnswer(first.responseId, 1)).decidedBy).toBe("model");

    await setToggle(id, false);
    const model = stubModel(JSON.stringify({ verdict: "correct", confidence: 0.9 }));
    const second = await submit(token);

    expect(second.status).toBe(201);
    expect(model.mock).not.toHaveBeenCalled();
    const answer = await readAnswer(second.responseId, 1);
    expect(answer.check_method).toBe("manual");
    expect(answer.needs_review).toBe(1);
    // Старая работа с вердиктом машины не переписалась.
    expect(metaOf(await readAnswer(first.responseId, 1)).decidedBy).toBe("model");
  });

  it("F7: одинаковые ответы сверяются независимо, каждый ответ виден в журнале", async () => {
    const { id, token } = await seedForm();
    const model = stubModel(JSON.stringify({ verdict: "correct", confidence: 0.88 }));
    await setToggle(id, true);

    const a = await submit(token, "Первый");
    const b = await submit(token, "Второй");

    // Две работы по одному короткому ответу — два вызова, две строки.
    expect(model.mock).toHaveBeenCalledTimes(2);
    expect(metaOf(await readAnswer(a.responseId, 1)).modelVerdict).toBe("correct");
    expect(metaOf(await readAnswer(b.responseId, 1)).modelVerdict).toBe("correct");

    // Учитель ставит «неверно» только у второго.
    const secondAnswer = await readAnswer(b.responseId, 1);
    await app.request(
      `/api/journal/answers/${secondAnswer.id}/override`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": SESSION_TOKEN },
        body: JSON.stringify({ accepted: false }),
      },
      TEST_ENV,
    );

    const journal = await teacherGet(`/api/journal/forms/${id}/responses`);
    const body = (await journal.json()) as {
      responses: Array<{ studentName: string; answers: Array<{ state: string; decidedBy: string }> }>;
    };
    expect(journal.status).toBe(200);

    const byName = new Map(body.responses.map((r) => [r.studentName, r.answers[0]!.state]));
    // Три разных состояния, а не одно на все случаи.
    expect(byName.get("Первый")).toBe("model_correct");
    expect(byName.get("Второй")).toBe("teacher_incorrect");

    // Первая работа машину не трогала — отвечает учитель, а не машина.
    const firstStill = await readAnswer(a.responseId, 1);
    expect(firstStill.check_method).toBe("llm");
  });

  it("F10: закрытая форма не сверяется — 410 и ни одного вызова модели", async () => {
    // Учитель закрыл форму, ученик отправил по старой ссылке. Отказ должен
    // случиться ДО сверки: платить за работу, которую не примут, нельзя.
    const { id, token } = await seedForm();
    await setToggle(id, true);
    await env.DB.prepare(`UPDATE forms SET status = 'closed' WHERE id = ?1`).bind(id).run();

    const model = stubModel(JSON.stringify({ verdict: "correct", confidence: 0.99 }));
    const res = await submit(token);

    expect(res.status).toBe(410);
    expect(model.mock).not.toHaveBeenCalled();
  });

  it("F9: модель уверена в одном ответе и сомневается в другом — решения разные", async () => {
    // Клас из тридцати человек, где на половину ответов модель не уверена: такие
    // ответы обязаны УЙТИ УЧИТЕЛЮ, а не превратиться в «неверно» из-за того,
    // что вердикт у машины оказался «не уверен».
    const { id, token } = await seedForm({
      tasks: [
        {
          number: 1,
          text: "Почему небо голубое?",
          type: "short-answer",
          answer: "Рассеяние света в атмосфере",
          points: 2,
        },
        {
          number: 2,
          text: "Почему листья желтеют осенью?",
          type: "short-answer",
          answer: "Распадается хлорофилл",
          points: 2,
        },
      ],
    });

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        calls.push(body);
        // На вопрос про желтые листья модель честно признаётся, что не уверена.
        const content = body.includes("желтеют")
          ? JSON.stringify({ verdict: "correct", confidence: 0.3, comment: "затрудняюсь" })
          : JSON.stringify({ verdict: "correct", confidence: 0.95 });
        return new Response(JSON.stringify(polzaResponse(content)), { status: 200 });
      }),
    );
    await setToggle(id, true);

    const res = await submit(token);
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(2);

    const sure = await readAnswer(res.responseId, 1);
    expect(sure.check_method).toBe("llm");
    expect(sure.is_correct).toBe(1);
    expect(sure.points_awarded).toBe(2);
    expect(sure.needs_review).toBe(0);

    const unsure = await readAnswer(res.responseId, 2);
    expect(unsure.needs_review).toBe(1);
    expect(unsure.is_correct).toBeNull();
    expect(unsure.points_awarded).toBe(0);
    expect(metaOf(unsure).modelVerdict).toBe("uncertain");

    // Один балл из двух: посчитан только уверенный ответ.
    expect(res.scoreTotal).toBe(2);
    expect(res.perTask.map((t) => t.status)).toEqual(["correct", "unreviewed"]);
  });

  it("F8: чужая форма и чужой ответ недоступны через журнал", async () => {
    const { id } = await seedForm();

    const foreign = await env.DB
      .prepare(
        `INSERT INTO forms (id, token, user_id, title, subject, grade, payload_json, status,
                            access_code, expires_at, show_answers, check_mode, created_at, updated_at)
         VALUES ('frm_foreign316xxx', 'foreigntoken316xxxxxxxx', 'usr_other000000000',
                 'Чужая', 'math', 5, '{"tasks":[]}', 'open', NULL, 4102444800, 0, 'auto',
                 1, 1)`,
      )
      .run();

    expect(foreign.success).toBe(true);

    const res = await app.request(
      `/api/journal/forms/${id}/short-answer-llm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": SESSION_TOKEN },
        body: JSON.stringify({ enabled: true }),
      },
      TEST_ENV,
    );
    expect(res.status).toBe(200);

    // Формы, которой у учителя нет, в списке нет.
    const list = (await (await teacherGet("/api/journal/forms")).json()) as {
      forms: Array<{ id: string }>;
    };
    expect(list.forms.map((f) => f.id)).toContain(id);
    expect(list.forms.map((f) => f.id)).not.toContain("frm_foreign316xxx");
  });
});
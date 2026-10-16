/**
 * ТЗ-30, работа 4: длительность экзамена приходит из профиля, а не из
 * литерала в промпте (AD-5).
 *
 * ─── ЧТО БЫЛО ─────────────────────────────────────────────────────────────
 * В `llm/prompts/exam-gen.ts` стояло `args.exam === "oge" ? 235 : 235` с
 * комментарием «TODO: разделить базовый/профильный позже». То есть ОГЭ и ЕГЭ
 * объявлялись одинаковыми, хотя длительности разные, а у математики они
 * различаются ещё и по профилю. Учитель узнаёт об этом на пробном экзамене
 * вместе с учениками.
 *
 * ─── ЧТО ПРОВЕРЯЕМ ───────────────────────────────────────────────────────
 * X1. Профиль ОГЭ даёт свою длительность, и она попадает в промпт.
 * X2. Профиля нет → 235 минут, и в ответе честно сказано, что это дефолт.
 * X3. Точный профиль предмета важнее общего профиля экзамена.
 * X4. Миграция `exam_profiles` идемпотентна и реально создаёт таблицу.
 *
 * Проверяем функцию `getExamMinutes` напрямую и промпт: полный HTTP-путь
 * `/api/exams/generate` требует тарифа «Плюс» и живого провайдера, а
 * проверять тут нужно ровно решение «какое число назвать», а не платёж.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getExamMinutes } from "../../src/db/examProfiles";
import { buildExamPrompt, DEFAULT_EXAM_MINUTES } from "../../src/llm/prompts/exam-gen";
import { migrateExamProfiles } from "../../src/db/migrations/0006_exam_profiles";
import { createUser } from "../../src/db/queries";

const NOW = Math.floor(Date.now() / 1000);

/** Только `users` — миграция 0004 проверяется на голой базе, как в бою. */
const USERS_SQL = `
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
`;

async function addProfile(slug: string, subject: string, minutes: number) {
  await env.DB
    .prepare(
      `INSERT INTO exam_profiles (slug, subject, minutes, fgos_profile, user_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'u_expert', ?5, ?5)`,
    )
    .bind(slug, subject, minutes, null, NOW)
    .run();
}

describe("ТЗ-30 работа 4: длительность экзамена из профиля", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "users", queries: [USERS_SQL] }]);
    const first = await migrateExamProfiles(env.DB);
    expect(first.applied, "миграция не создала exam_profiles").toBe(true);
    await createUser(env.DB, { id: "u_expert", email: "expert@test.local" });
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM exam_profiles").run();
  });

  it("X4: миграция идемпотентна — второй вызов ничего не ломает", async () => {
    const second = await migrateExamProfiles(env.DB);
    expect(second.applied).toBe(false);
    expect(second.reason).toContain("уже есть");
  });

  it("X1: профиль ОГЭ даёт свою длительность, и она попадает в промпт", async () => {
    await addProfile("oge", "math", 210);

    const res = await getExamMinutes(env.DB, { exam: "oge", subject: "math" });
    expect(res.minutes).toBe(210);
    expect(res.source).toBe("profile");
    expect(res.profileSlug).toBe("oge");

    // Число обязано быть в промпте: иначе модель раздаёт задания на другое
    // время, а учитель печатает вариант с неверной продолжительностью.
    const prompt = buildExamPrompt({
      exam: "oge",
      subject: "math",
      variantNumber: 1,
      minutes: res.minutes,
    });
    expect(prompt.expectedDuration).toBe(210);
    expect(prompt.user).toContain('"продолжительность_мин": 210');
    expect(prompt.user).not.toContain('"продолжительность_мин": 235');
  });

  it("X2: без профиля — 235 минут, и это сказано честно (source: default)", async () => {
    const res = await getExamMinutes(env.DB, { exam: "ege", subject: "biology" });
    expect(res.minutes).toBe(DEFAULT_EXAM_MINUTES);
    expect(res.minutes).toBe(235);
    expect(res.source).toBe("default");
    expect(res.profileSlug).toBeNull();
  });

  it("X3: точный профиль предмета важнее общего профиля экзамена", async () => {
    await addProfile("ege", "любой предмет", 220);
    await addProfile("ege-math-profile", "math", 235);

    const math = await getExamMinutes(env.DB, { exam: "ege", subject: "math" });
    expect(math.profileSlug).toBe("ege-math-profile");
    expect(math.minutes).toBe(235);

    // Предмет без своего профиля берёт общий — иначе профиль был бы
    // мёртвым: английский и биология получили бы 235 вместо 220.
    const other = await getExamMinutes(env.DB, { exam: "ege", subject: "english" });
    expect(other.profileSlug).toBe("ege");
    expect(other.minutes).toBe(220);
  });

  it("X5: сломанный профиль (0 минут) не печатает неверное время молча", async () => {
    // CHECK в схеме не пустит 0 в таблицу — это защита D1. Здесь проверяем
    // вторую сторону: если CHECK вдруг исчезнет, код обязан откатиться к
    // дефолту, а не отдать учителю вариант на 0 минут.
    await env.DB.prepare("PRAGMA ignore_check_constraints = 1").run();
    await addProfile("oge", "math", 0);

    const res = await getExamMinutes(env.DB, { exam: "oge", subject: "math" });
    expect(res.minutes).toBe(DEFAULT_EXAM_MINUTES);
    expect(res.source).toBe("default");
  });

  it("X6: промпт без minutes тоже даёт 235, а не 0 и не undefined", () => {
    const p = buildExamPrompt({ exam: "oge", subject: "math", variantNumber: 3 });
    expect(p.expectedDuration).toBe(235);
    expect(p.user).toContain('"продолжительность_мин": 235');
  });
});
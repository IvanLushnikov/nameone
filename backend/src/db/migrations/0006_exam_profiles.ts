/**
 * Лист ТЗ-30, AD-5: длительность экзамена хранится в профиле, а не в промпте.
 *
 * ─── ЧТО ДЕЛАЕТ ────────────────────────────────────────────────────────────
 * Создаёт таблицу `exam_profiles`: слаг профиля → предмет, длительность в
 * минутах и профиль ФГОС.
 *
 * ─── ПОЧЕМУ ТАБЛИЦА, А НЕ КОНСТАНТА В ПРОМПТЕ ──────────────────────────────
 * До 15.10.2026 в `llm/prompts/exam-gen.ts` стояло
 * `args.exam === "oge" ? 235 : 235` — то есть ОГЭ и ЕГЭ объявлялись
 * одинаковыми, и комментарий обещал «разделить позже». Это не «косметика»:
 * длительность у ОГЭ и ЕГЭ разная, а ещё разная у профильной и базовой
 * математики. Учитель, который распечатал вариант на 235 минут там, где надо
 * 210, узнаёт об этом на пробном экзамене вместе с учениками.
 *
 * Число минут — это свойство ПРОФИЛЯ, а не кода: его правят эксперты по
 * предметам, и правка не должна требовать релиза. Поэтому профиль — строка в
 * базе, а число — её колонка.
 *
 * ─── ПОЧЕМУ В МИГРАЦИИ, А НЕ ТОЛЬКО В schema.sql ───────────────────────────
 * Тот же компромисс, что в 0003_user_materials: `schema.sql` правит соседняя
 * работа, и ждать её правки — значит блокировать таблицу. DDL хранится
 * константой здесь; когда владелец schema.sql внесёт этот же CREATE дословно,
 * пути совпадут. Для свежей базы файл прогоняется после schema.sql:
 *
 *   npx wrangler d1 execute rabochielisty --remote \
 *     --command=".read src/db/migrations/0004_exam_profiles.sql"
 *   # либо программно:
 *   import { migrateExamProfiles } from "./src/db/migrations/0004_exam_profiles";
 *   await migrateExamProfiles(db);
 *
 * ─── ПОЧЕМУ user_id ОБЯЗАТЕЛЕН ─────────────────────────────────────────────
 * Слаг — первичный ключ, то есть профиль на экзамен по предмету один и общий
 * для всех. `user_id` здесь — автор профиля (кто из экспертов его завёл), а не
 * владелец: по нему видно, кому задавать вопрос, когда ФГОС меняется. Каскад
 * ON DELETE CASCADE оставлен по образцу остальных таблиц — удаление автора не
 * должно оставлять в базе строку, на которую никто не ссылается.
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface MigrationResult {
  applied: boolean;
  /** Что именно сделано — одной строкой, для лога деплоя. */
  reason: string;
}

/**
 * DDL листа. Текст ниже — источник истины для этого листа; в schema.sql этот
 * же CREATE должен появиться дословно, когда им дойдёт черёд.
 */
const EXAM_PROFILES_DDL = [
  `CREATE TABLE IF NOT EXISTS exam_profiles (
  -- Слаг профиля, по нему и ищем: 'oge', 'ege', 'ege-math-profile'.
  -- Именно слаг приходит от фронта и хранится в генераторе варианта.
  slug           TEXT PRIMARY KEY,
  subject        TEXT NOT NULL,
  -- Длительность в минутах. CHECK — потому что нулевая или отрицательная
  -- длительность ломает вариант тихо, а валидировать её в коде значит
  -- забыть про вторую точку входа (импорт данных профиля).
  minutes        INTEGER NOT NULL CHECK (minutes > 0),
  fgos_profile   TEXT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_exam_profiles_subject ON exam_profiles(subject)`,
];

/** Есть ли таблица. Спрашиваем у sqlite_master, а не `SELECT *`. */
async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .bind(table)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

/**
 * Применить миграцию листа ТЗ-30 AD-5.
 *
 * Идемпотентна: таблица, которая уже есть, пропускается. `applied: true`
 * возвращается, только если что-то действительно создалось.
 */
export async function migrateExamProfiles(db: D1Database): Promise<MigrationResult> {
  // Таблица ссылается на `users`, и SQLite такой CREATE без `users` отвергнет.
  const anchor = await tableExists(db, "users");
  if (!anchor) {
    return {
      applied: false,
      reason: "базы ещё нет — сначала примените schema.sql (npm run db:migrate:prod)",
    };
  }

  if (await tableExists(db, "exam_profiles")) {
    return { applied: false, reason: "таблица профилей экзамена уже есть" };
  }

  for (const stmt of EXAM_PROFILES_DDL) {
    await db.prepare(stmt).run();
  }

  return { applied: true, reason: "создана таблица exam_profiles" };
}

export default { migrateExamProfiles };
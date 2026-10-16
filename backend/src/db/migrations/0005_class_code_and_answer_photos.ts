/**
 * TZ-28: короткий код класса и фото-работы ученика с телефона.
 *
 * ─── Что делает ───
 * Две таблицы:
 *   `class_codes`         — короткий 6-значный код, по которому ученик открывает
 *                           класс без приложения (вместо сканирования QR);
 *   `form_answer_photos`  — привязка «ответ на задание N» ↔ «загруженное фото».
 *
 * ─── ПОЧЕМУ НЕ КОЛОНКА В `classes` И НЕ КОЛОНКА В `form_answers` ─────────────
 * Обе таблицы уже пишутся десятками `INSERT` с явным списком колонок, и на них
 * висят чужие инлайновые схемы в тестах (`backend/tests/unit/classes.test.ts`
 * и другие). Добавление колонки означало бы правку каждого такого INSERT и
 * каждой чужой тестовой схемы — то есть заход в чужую зону. Отдельная таблица
 * решает то же самое, не трогая ни одного существующего запроса: код и фото
 * живут рядом, но не участвуют в логике самих таблиц.
 *
 * ─── ПОЧЕМУ `class_codes` УНИКАЛЬНА ─────────────────────────────────────────
 * Код вводится руками с доски. `O` и `0` в этом не участвуют (алфавит без
 * похожих символов), но код всё равно может совпасть с чужим классом другого
 * учителя — UNIQUE не даёт двум ученикам прийти не в тот класс. Конфликт
 * ловится генератором (`assignClassCode` в `db/classes.ts`), а не пользователем.
 *
 * ─── Идемпотентность ───
 * Обе таблицы создаются через `CREATE TABLE IF NOT EXISTS`: повторный запуск на
 * обновлённой базе — ноль изменений, а не ошибка.
 *
 * ─── Запуск ───
 *   cd backend && npx wrangler d1 execute rabochielisty --remote \
 *     --command="SELECT 1"
 *
 *   Либо программно:
 *     import { migrateStudentMobile } from "./src/db/migrations/0004_class_code_and_answer_photos";
 *     await migrateStudentMobile(db);
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface MigrationResult {
  applied: boolean;
  reason: string;
}

/** Таблицы этого листа. Порядок важен только для читаемости: FK ленивые. */
const TABLES = ["class_codes", "form_answer_photos"] as const;

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS class_codes (
     class_id   TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
     code       TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS form_answer_photos (
     id             TEXT PRIMARY KEY,
     response_id    TEXT NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,
     task_number    INTEGER NOT NULL,
     photo_check_id TEXT NOT NULL,
     r2_key         TEXT NOT NULL,
     delete_at      INTEGER NOT NULL,
     created_at     INTEGER NOT NULL
   )`,
  // Один ответ = одно фото. Повторная загрузка по тому же заданию заменяет
  // старую строку (фото «пересняли»), иначе в ведомости было бы по две строки
  // на один и тот же ответ.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_fap_response_task
     ON form_answer_photos(response_id, task_number)`,
  `CREATE INDEX IF NOT EXISTS idx_fap_check
     ON form_answer_photos(photo_check_id)`,
];

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .bind(table)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

/**
 * Применить миграцию TZ-28.
 *
 * Идемпотентна: уже созданные таблицы пропускаются. `applied: true` только если
 * что-то действительно создалось — по нему деплой видит, ехала миграция или нет.
 */
export async function migrateStudentMobile(db: D1Database): Promise<MigrationResult> {
  // Без `users`/`forms` миграция бессмысленна: её таблицы ссылаются на них
  // через FOREIGN KEY, и SQLite такой CREATE отвергнет с внятной ошибкой.
  const anchor = await tableExists(db, "users");
  if (!anchor) {
    return {
      applied: false,
      reason: "базы ещё нет — сначала примените schema.sql (npm run db:migrate:prod)",
    };
  }

  const missing: string[] = [];
  for (const table of TABLES) {
    if (!(await tableExists(db, table))) missing.push(table);
  }

  if (missing.length === 0) {
    return { applied: false, reason: "таблицы ТЗ-28 уже есть" };
  }

  for (const stmt of DDL) {
    await db.prepare(stmt).run();
  }

  return { applied: true, reason: `созданы таблицы: ${missing.join(", ")}` };
}

export default { migrateStudentMobile };
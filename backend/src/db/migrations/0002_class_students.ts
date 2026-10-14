/**
 * TZ-13.1.1: классы с учениками и персональный QR.
 *
 * ─── Что делает ───
 * Создаёт три таблицы листа 3.1.1 — `classes`, `class_students`,
 * `class_student_answers` — ровно теми же `CREATE TABLE IF NOT EXISTS`, что лежат
 * в `schema.sql`. Одна правда на двоих: если здесь написать чуть иначе, то
 * `db:migrate:prod` (повторный прогон schema.sql) и ручной запуск этого скрипта
 * разойдутся, и расхождение всплывёт через месяц на проде.
 *
 * ─── Зачем отдельный файл, если есть schema.sql ───
 * `schema.sql` применяется целиком и умеет только `CREATE TABLE IF NOT EXISTS`.
 * Новые таблицы он создаст сам — и это основной путь. Этот файл нужен для
 * второго случая: база была поднята до этого листа, и её нужно доехать до
 * новых таблиц, не прогоняя весь файл заново и не трогая учителей, у которых
 * уже есть данные.
 *
 * Идемпотентность проверяется на служелах, а не декларируется: каждая таблица
 * создаётся через `CREATE TABLE IF NOT EXISTS`, поэтому повторный запуск на
 * уже-обновлённой базе — не ошибка, а ноль изменений. Обратного перехода нет
 * и не предполагается: данные учеников удаляются только по явному решению
 * учителя, а не откатом миграции.
 *
 * ─── Запуск ───
 *   cd backend && npx wrangler d1 execute rabochielisty --remote \
 *     --command="SELECT 1"
 *
 * Либо через программный runner, который сам читает schema.sql:
 *   import { migrateClassStudents } from "./src/db/migrations/0002_class_students";
 *   await migrateClassStudents(db);
 */

import type { D1Database } from "@cloudflare/workers-types";

/** Таблицы листа 3.1.1. Порядок важен только для читаемости: FK разрешаются лениво. */
const ROSTER_TABLES = ["classes", "class_students", "class_student_answers"] as const;

export interface MigrationResult {
  applied: boolean;
  /** Что именно сделано — одной строкой, для лога деплоя. */
  reason: string;
}

/** Есть ли таблица. Спрашиваем у sqlite_master, а не `SELECT *`: пустая таблица и отсутствующая дают разный результат, и нам нужен именно факт существования. */
async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .bind(table)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

/**
 * Применить миграцию листа 3.1.1.
 *
 * Идемпотентна: таблица, которая уже есть, пропускается. Возвращает
 * `applied: true`, только если что-то действительно создалось, — чтобы вызов
 * можно было писать в крон или в деплой и не гадать, отработала миграция или
 * нет.
 */
export async function migrateClassStudents(db: D1Database): Promise<MigrationResult> {
  // Если schema.sql ещё не применяли (таблицы `users`/`forms` нет) — миграция
  // бессмысленна: её таблицы ссылаются на них через FOREIGN KEY, и SQLite
  // такой CREATE отвергнет с внятной ошибкой. Лучше сказать об этом прямо.
  const anchor = await tableExists(db, "users");
  if (!anchor) {
    return {
      applied: false,
      reason: "базы ещё нет — сначала примените schema.sql (npm run db:migrate:prod)",
    };
  }

  const missing: string[] = [];
  for (const table of ROSTER_TABLES) {
    if (!(await tableExists(db, table))) missing.push(table);
  }

  if (missing.length === 0) {
    return { applied: false, reason: "таблицы классов и учеников уже есть" };
  }

  // Читаем ровно те куски schema.sql, которые относятся к этому листу.
  // Дублировать DDL здесь нельзя: две правки одного объявления разъезжаются
  // при первой же правке и потом молча ломают одно из двух окружений.
  const schema = await loadSchema();
  const statements = extractRosterStatements(schema);

  if (statements.length === 0) {
    return {
      applied: false,
      reason: "в schema.sql не найдены таблицы классов и учеников — проверьте файл",
    };
  }

  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }

  return {
    applied: true,
    reason: `созданы таблицы: ${missing.join(", ")}`,
  };
}

/**
 * Вырезать DDL листа 3.1.1 из schema.sql.
 *
 * В workerd нет fs (см. комментарий в tests/unit/worksheets.test.ts), поэтому
 * этот модуль в проде читает файл только в Node-окружениях; в workerd
 * `loadSchema` вернёт пустую строку и миграция честно скажет, что делать нечего.
 */
async function loadSchema(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    return await readFile(join(here, "..", "..", "db", "schema.sql"), "utf8");
  } catch {
    return "";
  }
}

/**
 * Вытащить из schema.sql только statement'ы трёх наших таблиц и их индексов.
 *
 * Режем по `;` на границе строк — тем же сплиттером, что и `db/migrate.ts`,
 * потому что формат файла тот же. Дальше оставляем только то, что относится к
 * `classes` / `class_students` / `class_student_answers`, чтобы случайно не
 * выполнить чужой DDL.
 */
function extractRosterStatements(schema: string): string[] {
  if (!schema) return [];
  const wanted = new Set<string>([
    ...ROSTER_TABLES,
    "idx_classes_user_name",
    "idx_classes_user",
    "idx_class_students_class",
    "idx_class_students_token",
    "idx_csa_student_form",
    "idx_csa_form",
  ]);

  return schema
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      // Убираем ведущие комментарии-строки, чтобы искать по чистому DDL.
      const sql = s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (!sql) return false;
      const match = /ON\s+([a-z_]+)\s*\(/i.exec(sql);
      if (match) return wanted.has(match[1]!);
      return /\bCREATE TABLE IF NOT EXISTS (classes|class_students|class_student_answers)\b/i.test(sql);
    });
}

export default { migrateClassStudents };
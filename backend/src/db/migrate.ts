/**
 * Программный migration runner.
 *
 * Зачем: в тестах и seed-скрипте удобнее выполнить schema.sql через D1 API,
 * чем дёргать `wrangler d1 execute`. На проде используется wrangler-вариант
 * (`npm run db:migrate:prod`), этот модуль — fallback для CI/локалки.
 *
 * Использование:
 *   const db = ... // D1Database из miniflare или из тестового фикстура
 *   await runMigrations(db);
 *
 * Безопасно идемпотентен — schema.sql написан через CREATE TABLE IF NOT EXISTS.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface MigrationResult {
  statements: number;
  ok: boolean;
  error?: string;
}

/**
 * Выполнить schema.sql побалансово. D1 не поддерживает multi-statement в
 * `.prepare()` для всего файла одним куском (есть prepare_batch, но он требует
 * разделения). Поэтому парсим по `;` на границе statement.
 */
export async function runMigrations(db: D1Database): Promise<MigrationResult> {
  const sql = await loadSchema();
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    return { statements: 0, ok: true };
  }

  try {
    for (const stmt of statements) {
      await db.prepare(stmt).run();
    }
    return { statements: statements.length, ok: true };
  } catch (e) {
    return {
      statements: statements.length,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Загрузить schema.sql. Резолвится относительно этого файла, чтобы работало
 * и через tsx (dev/seed), и через vitest (тесты).
 */
async function loadSchema(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "schema.sql");
  return readFile(path, "utf8");
}

/**
 * Разбить SQL-файл на отдельные statement по `;` на границе строк.
 *
 * Простой сплиттер: режет по `;\n`. Для schema.sql этого хватает (там
 * нет `;` внутри строк или комментариев с `;`). Если формат усложнится —
 * заменить на полноценный парсер.
 */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

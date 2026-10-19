/**
 * Миграция 0009: привязка расхода AI к конкретному листу.
 *
 * ─── Что делает ───
 * Добавляет колонку `worksheet_id` в две таблицы:
 *   `llm_logs`         — наш расчёт по прайсу за каждый вызов;
 *   `llm_costs_actual` — фактическое списание провайдера в рублях.
 *
 * ─── ЗАЧЕМ ────────────────────────────────────────────────────────────────────
 * Аудит 18.10.2026, раздел 9.4 п.4: «Привязать расход к конкретному листу
 * нельзя». В обеих таблицах был только `user_id` и `task`, то есть:
 *   - нельзя было посчитать, сколько стоит ОДИН лист (лист порождает
 *     несколько вызовов: генерация + проверка + дозапрос + второй вариант
 *     контрольной);
 *   - нельзя было отделить расход обычного листа от расхода контрольной
 *     (а это 92,7 % всех денег — 9,77 ₽ против 0,18 ₽ за вызов);
 *   - нельзя было понять, сколько стоит материал конкретного типа.
 *
 * Это одна колонка — и после неё экономика по типам материалов считается.
 *
 * ─── ЧТО НЕ ДЕЛАЕМ ───────────────────────────────────────────────────────────
 * Не заполняем колонку задним числом: старые вызовы к листам не привязаны, и
 * выдумывать привязку — значит врать в отчёте по деньгам. У старых строк
 * `worksheet_id` останется NULL, и это честно: «лист неизвестен».
 *
 * ─── ИДЕМПОТЕНТНОСТЬ ─────────────────────────────────────────────────────────
 * `ALTER TABLE ... ADD COLUMN` в SQLite НЕ идемпотентен: повторный запуск
 * падает с «duplicate column name». Поэтому колонка добавляется только если
 * её ещё нет (PRAGMA table_info), а в `db/schema.sql` она уже есть — там
 * `CREATE TABLE IF NOT EXISTS`, и свежая база создаётся сразу с колонкой.
 *
 * ─── Запуск ───────────────────────────────────────────────────────────────────
 *   cd backend && npx wrangler d1 execute rabochielisty --remote \
 *     --command="ALTER TABLE llm_logs ADD COLUMN worksheet_id TEXT"
 *   cd backend && npx wrangler d1 execute rabochielisty --remote \
 *     --command="ALTER TABLE llm_costs_actual ADD COLUMN worksheet_id TEXT"
 *
 *   Либо программно:
 *     import { migrateWorksheetCostLink } from "./src/db/migrations/0009_worksheet_cost_link";
 *     await migrateWorksheetCostLink(db);
 */

import type { D1Database } from "@cloudflare/workers-types";

export interface MigrationResult {
  applied: boolean;
  /** Что именно сделано — одной строкой, для лога деплоя. */
  reason: string;
}

/** Таблицы, в которых появляется колонка. */
const TABLES = ["llm_logs", "llm_costs_actual"] as const;

/**
 * Есть ли уже колонка в таблице.
 *
 * PRAGMA table_info возвращает по строке на колонку; `name` — её имя.
 */
async function hasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (rows.results ?? []).some((r) => r.name === column);
}

/**
 * Применить миграцию: добавить `worksheet_id` в обе таблицы.
 *
 * Идемпотентно: если колонка уже есть — ничего не делаем.
 */
export async function migrateWorksheetCostLink(db: D1Database): Promise<MigrationResult> {
  const added: string[] = [];
  for (const table of TABLES) {
    if (await hasColumn(db, table, "worksheet_id")) continue;
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN worksheet_id TEXT`).run();
    added.push(table);
  }
  if (added.length === 0) {
    return { applied: false, reason: "worksheet_id уже есть в обеих таблицах" };
  }
  return { applied: true, reason: `worksheet_id добавлена в: ${added.join(", ")}` };
}

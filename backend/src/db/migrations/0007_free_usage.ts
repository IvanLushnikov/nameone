/**
 * Миграция 0004: месячная бесплатная квота (ТЗ-29).
 *
 * ─── Что делает ───
 * Создаёт `free_usage` — историю бесплатной квоты ПО МЕСЯЦАМ. Квота бесплатного
 * тарифа была 3 листа навсегда без сброса; теперь это 5 листов в месяц, и
 * 1-го числа она обнуляется.
 *
 * ─── ПОЧЕМУ НЕ «ОБНУЛИТЬ СЧЁТЧИК» ────────────────────────────────────────────
 * Обнуление одной строки стирает ответ на вопрос владельца «сколько бесплатных
 * учителей доходят до конца квоты» — в D1 нет окон с историей. Поэтому строка
 * перемежается по месяцу: ключ (owner_key, month), прошлый месяц лежит рядом.
 * Логика чтения и записи — в src/db/free-usage.ts, здесь только DDL.
 *
 * ─── ПОЧЕМУ DDL ЗДЕСЬ, А НЕ ТОЛЬКО В schema.sql ───────────────────────────────
 * `db/schema.sql` этой миграции не принадлежит (та же граница владения, что в
 * 0003_user_materials.ts). Таблица объявлена здесь, а код ещё и создаёт её
 * лениво (ensureFreeUsageTable) — потому что если таблицы нет, квота не считается
 * вовсе, и это хуже, чем лишний запрос. На проде миграцию всё равно нужно
 * прогнать явно, чтобы DDL был до первого запроса, а не во время него:
 *
 *   npx wrangler d1 execute rabochielisty --remote --command=".read src/db/migrations/0004_free_usage.sql"
 *   # либо программно:
 *   import { migrateFreeUsage } from "./src/db/migrations/0004_free_usage";
 *   await migrateFreeUsage(db);
 *
 * ─── ПЕРЕНОС ДАННЫХ ───────────────────────────────────────────────────────────
 * Ничего. У старых счётчиков не было месяца, и переносить их некуда: они жили в
 * rate_limits как вечные. Новая таблица начинает историю с месяца установки —
 * это честнее, чем выдумывать «октябрь» задним числом. Премиум-пользователи
 * таблицы не касаются: их расход считает usage_counters по токенам.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { FREE_USAGE_DDL, FREE_USAGE_MONTH_INDEX } from "../free-usage";

export interface MigrationResult {
  applied: boolean;
  /** Что именно сделано — одной строкой, для лога деплоя. */
  reason: string;
}

/** Есть ли таблица. Спрашиваем у sqlite_master, а не `SELECT *`. */
async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .bind(table)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

/**
 * Применить миграцию ТЗ-29.
 *
 * Идемпотентна: если `free_usage` уже есть — ничего не делаем и честно говорим
 * об этом в `reason`, чтобы вызов можно было писать в деплой и не гадать.
 */
export async function migrateFreeUsage(db: D1Database): Promise<MigrationResult> {
  if (await tableExists(db, "free_usage")) {
    return { applied: false, reason: "таблица free_usage уже есть" };
  }
  await db.prepare(FREE_USAGE_DDL).run();
  await db.prepare(FREE_USAGE_MONTH_INDEX).run();
  return { applied: true, reason: "создана таблица free_usage (квота по месяцам)" };
}

export default { migrateFreeUsage };
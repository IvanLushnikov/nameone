/**
 * Миграция 0010: убрать таблицу `model_routing` (ТЗ-43).
 *
 * ─── ЧТО ДЕЛАЕТ ─────────────────────────────────────────────────────────────
 * `DROP TABLE IF EXISTS model_routing` — вместе с индексом
 * `idx_model_routing_enabled`, который SQLite удаляет сам (индекс принадлежит
 * таблице).
 *
 * ─── ПОЧЕМУ УБИРАЕМ, А НЕ НАПОЛНЯЕМ ────────────────────────────────────────
 * Таблица была объявлена в `schema.sql` и ничем не наполнялась: за всё время
 * ноль строк и ноль строк кода записи (ни одного INSERT/UPDATE — проверено
 * поиском по репозиторию). Роутинг моделей живёт в коде:
 * `backend/src/llm/router.ts`, константа `PRIMARY_BY_TASK`.
 *
 * Таблица без данных и без кода — это ложная точка наблюдаемости. Кто-то
 * открывает базу, видит `model_routing`, заключает «настройки роутинга есть,
 * но данные потерялись» — и тратит время на поиск проблемы, которой нет.
 * Наполнять таблицу дефолтами тоже нельзя: получился бы второй источник
 * правды (код + база), который со временем разойдётся, причём читать его
 * было бы некому — кода записи нет и не предвидится.
 *
 * Решение владельца зафиксировано в ТЗ-43 (AD-3): роутинг читается из кода.
 *
 * ─── ИДЕМПОТЕНТНОСТЬ ────────────────────────────────────────────────────────
 * `IF EXISTS` — миграция безопасна и на проде (таблица есть), и на чистой базе,
 * где таблицы уже нет (схема обновлена, миграция прогнана повторно).
 *
 * ─── ЗАПУСК ─────────────────────────────────────────────────────────────────
 *   cd backend && npx wrangler d1 execute rabochielisty --remote \
 *     --command="DROP TABLE IF EXISTS model_routing"
 *
 *   Либо программно:
 *     import { migrateDropModelRouting } from "./src/db/migrations/0010_drop_model_routing";
 *     await migrateDropModelRouting(db);
 */

import type { D1Database } from "@cloudflare/workers-types";

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
 * Применить миграцию ТЗ-43: убрать `model_routing`.
 *
 * Идемпотентна: если таблицы уже нет — ничего не делаем и честно говорим об
 * этом в `reason`, чтобы вызов можно было писать в деплой и не гадать.
 */
export async function migrateDropModelRouting(db: D1Database): Promise<MigrationResult> {
  if (!(await tableExists(db, "model_routing"))) {
    return { applied: false, reason: "таблица model_routing уже отсутствует" };
  }
  await db.prepare(`DROP TABLE IF EXISTS model_routing`).run();
  return { applied: true, reason: "удалена таблица model_routing (роутинг живёт в коде)" };
}

export default { migrateDropModelRouting };

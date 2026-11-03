/**
 * Миграция 0010: согласия при входе (оферта / ПДн / реклама).
 *
 * ─── Что делает ───
 * Создаёт `user_consents` — по одной строке на решение пользователя по
 * конкретному типу и версии документа. UI-галочка на `/login` без этой
 * таблицы ничего не доказывает (D2.4 плана ЮKassa).
 *
 * ─── ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ КОЛОНКИ В users ──────────────────────────
 * Та же причина, что у `user_roles` / `user_passwords`: миграция локально =
 * повторный прогон schema.sql, а `ALTER TABLE ADD COLUMN` в SQLite не
 * идемпотентен. Отдельная таблица ещё даёт историю по версиям документов и
 * ON DELETE CASCADE при удалении пользователя.
 *
 * ─── УНИКАЛЬНОСТЬ ───────────────────────────────────────────────────────────
 * UNIQUE(user_id, type, version): одна запись на версию документа.
 * Повторный вход с той же версией — UPSERT (обновляем время/IP/UA и флаг
 * marketing). Смена юртекста = новый version → новая строка; старые остаются
 * как доказательство «с какой редакцией согласился тогда».
 *
 * ─── Запуск ─────────────────────────────────────────────────────────────────
 *   cd backend && npx wrangler d1 execute rabochielisty --remote \
 *     --command=".read src/db/migrations/0010_user_consents.sql"
 *   # либо программно:
 *   import { migrateUserConsents } from "./src/db/migrations/0010_user_consents";
 *   await migrateUserConsents(db);
 */

import type { D1Database } from "@cloudflare/workers-types";

const TABLE = "user_consents";

export interface MigrationResult {
  applied: boolean;
  reason: string;
}

/**
 * DDL — дословно совпадает с блоком в `schema.sql`.
 */
export const USER_CONSENTS_DDL = [
  `CREATE TABLE IF NOT EXISTS user_consents (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                 -- 'offer' | 'pdn' | 'marketing'
  version      TEXT NOT NULL,                 -- slug версии документа, напр. '1'
  accepted     INTEGER NOT NULL,              -- 1 = да, 0 = отказ (для marketing)
  accepted_at  INTEGER NOT NULL,              -- unix seconds
  ip           TEXT,
  ua           TEXT,
  UNIQUE(user_id, type, version)
)`,
  `CREATE INDEX IF NOT EXISTS idx_user_consents_user
     ON user_consents(user_id, accepted_at DESC)`,
];

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .bind(table)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

/**
 * Применить миграцию. Идемпотентна: повторный вызов не падает.
 */
export async function migrateUserConsents(db: D1Database): Promise<MigrationResult> {
  if (!(await tableExists(db, "users"))) {
    return {
      applied: false,
      reason: "базы ещё нет — сначала примените schema.sql (npm run db:migrate:prod)",
    };
  }
  if (await tableExists(db, TABLE)) {
    return { applied: false, reason: "таблица user_consents уже есть" };
  }
  for (const stmt of USER_CONSENTS_DDL) {
    await db.prepare(stmt).run();
  }
  return { applied: true, reason: `создана таблица: ${TABLE}` };
}

export default { migrateUserConsents };

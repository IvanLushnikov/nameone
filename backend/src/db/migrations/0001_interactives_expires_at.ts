/**
 * TZ-13: одноразовая миграция — добавить `expires_at` в `interactives`.
 *
 * ─── Почему не хватает правки в `schema.sql` ───
 * `schema.sql` применяется целиком (`wrangler d1 execute --file=src/db/schema.sql`,
 * см. `backend/package.json` → `db:migrate:*`). В нём допустим только
 * `CREATE TABLE IF NOT EXISTS`: повторный прогон на уже созданной таблице не
 * добавит колонку, а на существующей БД таблица `interactives` уже создана.
 *
 * ─── Почему не «ALTER TABLE ... ADD COLUMN IF NOT EXISTS» ───
 * D1 (и SQLite) такого синтаксиса не поддерживают — будет ошибка парсинга.
 * А голый `ALTER TABLE ADD COLUMN` падает, если колонка уже есть, то есть
 * файл нельзя гонять повторно. Поэтому сверяемся с `PRAGMA table_info` и
 * добавляем только когда колонки ещё нет.
 *
 * ─── Зачем колонка ───
 * Фронт ждёт `expiresAt` и по нему показывает ученику «ссылка истекла»
 * (410 `INTERACTIVE_EXPIRED`, см. `src/lib/interactives/api.ts:318`). Без
 * колонки эта ветка не срабатывает никогда: интерактив живёт вечно, даже
 * если учитель рассчитывал, что отдаст его на один урок.
 *
 * ─── Запуск ───
 *   cd backend && npx wrangler d1 execute rabochielisty --remote \
 *     --command="ALTER TABLE interactives ADD COLUMN expires_at INTEGER"
 *
 * Либо один раз локально, после чего каталог можно обновлять без риска.
 * Повторный запуск безопасен: скрипт сначала проверяет наличие колонки.
 */

interface ColumnRow {
  name: string;
}

export async function migrateInteractivivesExpiresAt(db: D1Database): Promise<{
  applied: boolean;
  reason: string;
}> {
  const info = await db
    .prepare("PRAGMA table_info(interactives)")
    .all<ColumnRow>();

  const columns = (info.results ?? []).map((r) => r.name);

  if (columns.length === 0) {
    return {
      applied: false,
      reason: "таблицы interactives нет — примените schema.sql, миграция не нужна",
    };
  }

  if (columns.includes("expires_at")) {
    return { applied: false, reason: "колонка expires_at уже есть" };
  }

  await db.prepare("ALTER TABLE interactives ADD COLUMN expires_at INTEGER").run();

  return { applied: true, reason: "колонка expires_at добавлена" };
}

export default { migrateInteractivivesExpiresAt };

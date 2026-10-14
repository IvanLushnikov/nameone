/**
 * Лист 5.1.1: материалы учителей (авторские публикации).
 *
 * ─── Что делает ───
 * Создаёт две таблицы листа — `user_materials` и `user_material_downloads` —
 * теми же `CREATE TABLE IF NOT EXISTS`, которыми они описаны в этом файле.
 *
 * ─── ПОЧЕМУ DDL ЗДЕСЬ, А НЕ ТОЛЬКО В schema.sql ──────────────────────────────
 * Лист 5.1.1 не владеет `db/schema.sql` (его правит соседняя работа), поэтому
 * таблицы объявлены здесь. Расхождение «schema.sql ↔ миграция» — известная и
 * сознательная цена границ владения; как только владелец schema.sql внесёт эти
 * же два CREATE (дословно отсюда), пути совпадут. Пока этого не сделано,
 * главный путь для свежей базы — прогнать ЭТОТ файл вручную после schema.sql:
 *
 *   npx wrangler d1 execute rabochielisty --remote --command=".read src/db/migrations/0003_user_materials.sql"
 *   # либо программно:
 *   import { migrateUserMaterials } from "./src/db/migrations/0003_user_materials";
 *   await migrateUserMaterials(db);
 *
 * ─── ЧЕГО ТУТ НЕТ И ПОЧЕМУ ─────────────────────────────────────────────────
 * Нет ни рейтинга, ни «счётчика просмотров», ни списка скачавших: аудитории у
 * нас нет, а выдуманные числа мы уже удаляли с каталога. Есть ОДИН настоящий
 * счётчик — `user_materials.downloads`, его увеличивает ровно один запрос:
 * учитель нажал «Скачать». Кто именно скачал — не пишется намеренно: это ПДн
 * третьих лиц (учителей), а пользы сбора тут ноль.
 *
 * ─── СТАТУСЫ ────────────────────────────────────────────────────────────────
 *   pending   — учитель отдал материал, ждёт решения владельца.
 *   published — владелец посмотрел и разрешил; только такой виден всем.
 *   rejected  — отказ с причиной (`reject_reason`); учитель видит причину.
 *   withdrawn — автор сам снял с публикации (материал сохраняется у него).
 *
 * Дефолт — `pending`, а не `published`: чужая работа не должна попадать в общий
 * банк раньше, чем её увидит человек. Решение принимает человек, а не код.
 */

import type { D1Database } from "@cloudflare/workers-types";

/**
 * Таблицы листа 5.1.1. Порядок важен только для читаемости: FK разрешаются лениво.
 */
const USER_MATERIAL_TABLES = ["user_materials", "user_material_downloads"] as const;

export interface MigrationResult {
  applied: boolean;
  /** Что именно сделано — одной строкой, для лога деплоя. */
  reason: string;
}

/**
 * DDL листа. Хранится константой, а не читается из schema.sql: файл schema.sql
 * этому листу не принадлежит, и ждать его правки — значит блокировать таблицы.
 * Текст ниже — источник истины для этого листа; в schema.sql эти же два CREATE
 * должны попасть дословно, когда им дойдёт черёд (см. шапку файла).
 */
const USER_MATERIALS_DDL = [
  `CREATE TABLE IF NOT EXISTS user_materials (
  id             TEXT PRIMARY KEY,               -- umt_<12>
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Подпись автора СНИМКОМ на момент сдачи. Снимок, а не ссылка на users.name:
  -- переименование учителя в профиле не должно молча переписывать подпись под
  -- уже опубликованной работой. Почта сюда НЕ попадает никогда — иначе авторство
  -- материала превратилось бы в раздачу чужих адресов.
  author_name    TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  subject        TEXT NOT NULL,
  grade          INTEGER NOT NULL,
  -- Вид материала: рабочий лист, карточки или комплект. Ровно три значения —
  -- столько учитель реально приносит, остальные придуманы.
  kind           TEXT NOT NULL CHECK (kind IN ('worksheet','cards','bundle')),
  -- Тело материала: список заданий тем же JSON, которым мы уже описываем
  -- worksheet. Файла docx здесь нет и быть не может: выгрузка документа —
  -- задача соседнего листа (превью), а не публикации.
  content_json   TEXT NOT NULL,
  -- Дефолт — 'pending'. Материал НЕ появляется в общем банке сам.
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','published','rejected','withdrawn')),
  -- Причина отказа. Обязательна при status='rejected' — проверяется в db/materials.ts,
  -- потому что CHECK в SQLite не умеет смотреть на соседнюю колонку.
  reject_reason  TEXT,
  moderated_by   TEXT,                          -- id владельца, принявшего решение
  moderated_at   INTEGER,
  -- Настоящий счётчик скачиваний. Увеличивается одним запросом «Скачать».
  downloads      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_user_materials_owner ON user_materials(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_user_materials_public ON user_materials(status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS user_material_downloads (
  id          TEXT PRIMARY KEY,                -- umd_<12>
  material_id TEXT NOT NULL REFERENCES user_materials(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_umd_material ON user_material_downloads(material_id, created_at DESC)`,
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
 * Применить миграцию листа 5.1.1.
 *
 * Идемпотентна: таблица, которая уже есть, пропускается. `applied: true`
 * возвращается, только если что-то действительно создалось, — вызов можно
 * писать в деплой и не гадать, отработала миграция или нет.
 */
export async function migrateUserMaterials(db: D1Database): Promise<MigrationResult> {
  // Если schema.sql ещё не применяли — миграция бессмысленна: её таблицы
  // ссылаются на `users`, и SQLite такой CREATE отвергнет. Скажем прямо.
  const anchor = await tableExists(db, "users");
  if (!anchor) {
    return {
      applied: false,
      reason: "базы ещё нет — сначала примените schema.sql (npm run db:migrate:prod)",
    };
  }

  const missing: string[] = [];
  for (const table of USER_MATERIAL_TABLES) {
    if (!(await tableExists(db, table))) missing.push(table);
  }

  if (missing.length === 0) {
    return { applied: false, reason: "таблицы материалов учителей уже есть" };
  }

  for (const stmt of USER_MATERIALS_DDL) {
    await db.prepare(stmt).run();
  }

  return {
    applied: true,
    reason: `созданы таблицы: ${missing.join(", ")}`,
  };
}

export default { migrateUserMaterials };
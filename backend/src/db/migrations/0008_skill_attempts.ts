/**
 * Лист ТЗ-27 (кусок C): связь попыток по теме.
 *
 * ─── Что делает ───
 * Создаёт таблицу `skill_attempts` — по одной строке на «ученик ошибся в теме
 * на этой работе». Из неё потом считаются «три последние проверки по теме» и
 * «кто ошибается два раза подряд».
 *
 * ─── ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ СЧЁТ НА ЛЕТУ (AD-2 ТЗ-27) ────────────────
 * Оба вопроса учителя («эта тема выросла?», «кого позвать поговорить») —
 * выборка по ВСЕМ работам класса и по всем ответам в них. Считать это при
 * каждом открытии ведомости — значит платить те же деньги и ждать тот же
 * ответ каждый раз. Дёшево сделать один раз: при завершении проверки.
 *
 * ─── ПОЧЕМУ ТАБЛИЦА, А НЕ КОЛОНКА ───────────────────────────────────────────
 * Ровно та же причина, что у `user_materials` и `class_student_answers`: миграция
 * здесь — повторный прогон schema.sql, а `ALTER TABLE ADD COLUMN` в SQLite
 * неидемпотентен. Новая таблица создаётся сама собой сколько угодно раз.
 *
 * ─── ДВА ПОЛЯ СВЕРХ СПИСКА ИЗ AD-2, И ПОЧЕМУ ─────────────────────────────────
 * В ТЗ-27 §6 AD-2 перечислены `id, user_id, class_id, skill, form_id,
 * checked_at, correct, total`. Но §7 того же ТЗ требует список «кто ошибается
 * два раза подряд» с фамилией и датами — без `student_id` такой список
 * собрать нечем, а «последние проверки» без `response_id` не отличить одну
 * попытку от другой. Два поля добавлены, а не «две лишние колонки убраны»:
 * список учеников — половина ценности карточки темы.
 *
 * `student_id` nullable: работа по общей ссылке не привязана к ученику, и
 * такие ответы в разрез тем попасть могут (по теме), а в список «позвать
 * поговорить» — нет. Пусто здесь честнее выдуманного «ученик №1».
 *
 * FK объявлены лениво (D1 не проверяет их по умолчанию), как и в
 * `class_student_answers`: каскад здесь документирует намерение, а решение
 * об удалении принимает purge-скрипт, а не СУБД.
 */

import type { D1Database } from "@cloudflare/workers-types";

const SKILL_ATTEMPTS_TABLE = "skill_attempts";

export interface MigrationResult {
  applied: boolean;
  reason: string;
}

/**
 * DDL листа. Хранится константой и ДОСЛОВНО повторяется в `schema.sql` —
 * файл schema.sql этому листу принадлежит, расхождения путей тут быть не
 * должно (см. блок про `user_materials`, где так и было помечено).
 */
const SKILL_ATTEMPTS_DDL = [
  `CREATE TABLE IF NOT EXISTS skill_attempts (
  id           TEXT PRIMARY KEY,               -- ska_<12>
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  -- Название темы СНИМКОМ. Правка метки учителем меняет текст в листе, но не
  -- переписывает историю: вчерашняя попытка была по той формулировке, какая
  -- тогда стояла. Склеивать их задним числом — значит врать учителю в разборе.
  skill        TEXT NOT NULL,
  form_id      TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  -- Чей это ответ. Именно он, а не id строки class_student_answers, потому что
  -- пересдача ученика — новая попытка по той же теме, а не обновление старой.
  response_id  TEXT NOT NULL,
  student_id   TEXT REFERENCES class_students(id) ON DELETE CASCADE,
  checked_at   INTEGER NOT NULL,               -- unix seconds
  -- Сколько заданий этой темы в этой попытке оценено верно / всего.
  -- correct <= total всегда; total = 0 у строки быть не может (см. расчёт).
  correct      INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
)`,
  // Одна попытка = одна тема в одной работе. Повторный пересчёт по этой же
  // работе перезаписывает строку, а не плодит дубли: иначе «три последние
  // проверки» показывали бы одну и ту же работу трижды.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_response_skill
     ON skill_attempts(response_id, skill)`,
  `CREATE INDEX IF NOT EXISTS idx_sa_class_skill_time
     ON skill_attempts(class_id, skill, checked_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sa_student_skill_time
     ON skill_attempts(student_id, skill, checked_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sa_form ON skill_attempts(form_id)`,
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
 * Применить миграцию листа ТЗ-27.
 *
 * Идемпотентна: уже созданная таблица пропускается, `applied: true`
 * возвращается только если что-то действительно создалось — вызов можно писать
 * в деплой и не гадать, отработала миграция или нет.
 */
export async function migrateSkillAttempts(db: D1Database): Promise<MigrationResult> {
  const anchor = await tableExists(db, "users");
  if (!anchor) {
    return {
      applied: false,
      reason: "базы ещё нет — сначала примените schema.sql (npm run db:migrate:prod)",
    };
  }

  if (await tableExists(db, SKILL_ATTEMPTS_TABLE)) {
    return { applied: false, reason: "таблица попыток по темам уже есть" };
  }

  for (const stmt of SKILL_ATTEMPTS_DDL) {
    await db.prepare(stmt).run();
  }

  return { applied: true, reason: `создана таблица: ${SKILL_ATTEMPTS_TABLE}` };
}

export default { migrateSkillAttempts };
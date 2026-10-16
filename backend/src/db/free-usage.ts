/**
 * Месячный счётчик бесплатной квоты — ТЗ-29.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ ЕЩЁ ОДИН СЧЁТЧИК В rate_limits
 * ─────────────────────────────────────────────────────────────────────────────
 * Бесплатная квота была N генераций ВСЕГО, без сброса: одна строка счётчика
 * росла и не обнулялась. Это и было содержанием жалобы учителя: «сделала три
 * листа, написала — ушла». Теперь квота 5 листов В МЕСЯЦ, и 1-го числа её надо
 * обнулить — не уничтожив историю.
 *
 * Если бы мы просто обнулили счётчик, пропал бы ответ на вопрос владельца
 * «сколько бесплатных учителей доходят до конца квоты»: в D1 нет окон с
 * историей, строка одна. Поэтому строка ПЕРЕМЕЖДАЕТСЯ по месяцу — ключ
 * `(owner_key, month)`. Прошлый месяц лежит рядом и никуда не девается.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ owner_key, А НЕ user_id (хотя в ТЗ написано user_id)
 * ─────────────────────────────────────────────────────────────────────────────
 * Счёт ведётся по КЛЮЧУ СЧЁТА, а не по аккаунту: у анонима user_id не существует
 * вовсе, а у вошедшего учителя квота общая с его отпечатками устройств
 * (см. quotaOwnerKeys в services/usage.ts) — иначе «3 с телефона и 3 с
 * ноутбука» снова станут возможны. Поэтому первичный ключ — owner_key того же
 * вида, что и в rate_limits (`fp:<хэш>` или `usr:<id>`), а `user_id` лежит рядом
 * колонкой и nullable: он нужен для отчёта по людям и есть только у аккаунта.
 */

import type { D1Database } from "@cloudflare/workers-types";

/**
 * Смещение Москвы от UTC в миллисекундах.
 *
 * Постоянное, а не через Intl: граница месяца — это «1-е число», о котором мы
 * говорим учителю в интерфейсе, и её нельзя сдвигать тем, с какой версией базы
 * данных ICU собран рантайм воркера. В России перехода на летнее время нет,
 * поэтому смещение одно и постоянное.
 */
export const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Ключ месяца вида «2026-10» по московскому времени.
 *
 * Считается от unix МИЛЛИсекунд, потому что месяц — понятие календарное, а не
 * счётчик: «октябрь» должен один и тот же для учителя, для базы и для письма.
 */
export function monthKeyOf(nowMs: number): string {
  return new Date(nowMs + MSK_OFFSET_MS).toISOString().slice(0, 7);
}

/**
 * Начало следующего месяца по Москве, в unix СЕКУНДАХ.
 *
 * Это то самое «обновится 1-го числа», которое мы показываем в карточке
 * расхода. Считаем календарно, а не «текущий месяц + 30 дней»: 1-го числа
 * учитель ждёт именно числа.
 */
export function nextMonthStartSec(nowMs: number): number {
  const shifted = new Date(nowMs + MSK_OFFSET_MS);
  const next = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1);
  return Math.floor((next - MSK_OFFSET_MS) / 1000);
}

/**
 * DDL таблицы. Живёт здесь константой, а не читается из schema.sql: файл
 * schema.sql этому изменению не принадлежит (та же оговорка, что в
 * migrations/0003_user_materials.ts). Продублирован дословно в
 * `migrations/0004_free_usage.ts` — оттуда его берёт прод-шаг.
 */
export const FREE_USAGE_DDL = `CREATE TABLE IF NOT EXISTS free_usage (
  -- Ключ счёта: fp:<хэш отпечатка> или usr:<id>. Тот же вид, что в rate_limits.
  owner_key     TEXT NOT NULL,
  -- Месяц в виде YYYY-MM по Москве. Граница квоты — 1-е число.
  month         TEXT NOT NULL,
  -- Сколько генераций потрачено В ЭТОМ месяце.
  generations   INTEGER NOT NULL DEFAULT 0,
  -- Аккаунт, если он есть. У анонима NULL, поэтому колонка nullable.
  user_id       TEXT,
  -- Когда письмо о третьей генерации уже уходило (0 — не уходило). Метка на
  -- строке, а не отдельная таблица: письмо должно уйти ОДИН раз в месяц, и
  -- сумма этой метки по всем ключам человека отвечает на вопрос «уже слали?».
  notice_sent_at INTEGER,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (owner_key, month)
)`;

/** Индекс для вопроса владельца «сколько людей дошли до конца квоты в месяце». */
export const FREE_USAGE_MONTH_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_free_usage_month ON free_usage(month, generations)";

/**
 * Биндинги, для которых таблица уже создана.
 *
 * D1-биндинг — объект, поэтому WeakSet годится: он не мешает сборке мусора и не
 * живёт дольше самого биндинга (в изоляте воркера биндинг и есть граница жизни
 * модуля). Нужен, чтобы ленивое создание таблицы не превращалось в DDL на
 * каждой проверке квоты.
 */
const ensured = new WeakSet<object>();

/** Есть ли таблица. Спрашиваем у sqlite_master, а не `SELECT *`. */
async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .bind(table)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

/**
 * Ленивое создание таблицы — один раз на биндинг.
 *
 * ПОЧЕМУ ЛЕНЬ, А НЕ ТОЛЬКО МИГРАЦИЯ. У промоушена есть явный шаг
 * (`migrations/0004_free_usage.ts`), и на проде он обязателен. Но если таблицы
 * нет — квота не считается вовсе, и учитель получит либо 500 на каждой
 * генерации, либо (что хуже) ошибка молча уедет в `catch` и квота станет
 * бесконечной. Поэтому код сам создаёт то, на чём держится его же логика.
 *
 * Идемпотентно: `IF NOT EXISTS` + кэш на биндинг, поэтому платит один запрос
 * за жизнь изолята, а не один на генерацию.
 */
export async function ensureFreeUsageTable(db: D1Database): Promise<void> {
  if (ensured.has(db as unknown as object)) return;
  if (await tableExists(db, "free_usage")) {
    ensured.add(db as unknown as object);
    return;
  }
  await db.prepare(FREE_USAGE_DDL).run();
  await db.prepare(FREE_USAGE_MONTH_INDEX).run();
  ensured.add(db as unknown as object);
}

export interface FreeUsageMonthRow {
  month: string;
  generations: number;
  /** 0, если письмо в этом месяце ещё не уходило. */
  noticeSentAt: number;
}

/** Одна строка месяца по одному ключу счёта. */
export async function readMonthRow(
  db: D1Database,
  ownerKey: string,
  month: string,
): Promise<FreeUsageMonthRow | null> {
  await ensureFreeUsageTable(db);
  const row = await db
    .prepare(
      `SELECT month, generations, COALESCE(notice_sent_at, 0) AS noticeSentAt
         FROM free_usage WHERE owner_key = ?1 AND month = ?2`,
    )
    .bind(ownerKey, month)
    .first<{ month: string; generations: number; noticeSentAt: number }>();
  if (!row) return null;
  return {
    month: row.month,
    generations: Number(row.generations ?? 0),
    noticeSentAt: Number(row.noticeSentAt ?? 0),
  };
}

/**
 * Сколько генераций израсходовано в месяце СУММОЙ по всем ключам человека.
 *
 * Сумма, а не максимум: максимум оставлял бы дыру «3 с одного браузера и 3 с
 * другого» (та же причина, по которой и счётчик считается суммой — см.
 * freeQuotaState в services/usage.ts).
 */
export async function readMonthGenerations(
  db: D1Database,
  ownerKeys: string[],
  month: string,
): Promise<number> {
  await ensureFreeUsageTable(db);
  const keys = [...new Set(ownerKeys)];
  if (keys.length === 0) return 0;
  const marks = keys.map((_, i) => `?${i + 1}`).join(", ");
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(generations), 0) AS used
         FROM free_usage WHERE month = ?${keys.length + 1} AND owner_key IN (${marks})`,
    )
    .bind(...keys, month)
    .first<{ used: number }>();
  return Number(row?.used ?? 0);
}

/** Уходило ли письмо о третьей генерации в этом месяце по любому из ключей. */
export async function readMonthNoticeSent(
  db: D1Database,
  ownerKeys: string[],
  month: string,
): Promise<boolean> {
  await ensureFreeUsageTable(db);
  const keys = [...new Set(ownerKeys)];
  if (keys.length === 0) return false;
  const marks = keys.map((_, i) => `?${i + 1}`).join(", ");
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS sent
         FROM free_usage
        WHERE month = ?${keys.length + 1}
          AND notice_sent_at IS NOT NULL
          AND owner_key IN (${marks})`,
    )
    .bind(...keys, month)
    .first<{ sent: number }>();
  return Number(row?.sent ?? 0) > 0;
}

/**
 * Зачесть одну генерацию в месяц.
 *
 * `limit` в условии DO UPDATE — страховка от двойного списания: попытка
 * занимается ДО вызова провайдера (holdFreeQuotaSlot), и если списание позвать
 * лишний раз, шестая строка в history не появится. Тот же приём, что был на
 * счётчике в rate_limits.
 */
export async function bumpMonthGenerations(
  db: D1Database,
  params: {
    ownerKey: string;
    userId?: string | null;
    month: string;
    limit: number;
    nowSec: number;
  },
): Promise<number> {
  await ensureFreeUsageTable(db);
  await db
    .prepare(
      `INSERT INTO free_usage (owner_key, month, generations, user_id, updated_at)
       VALUES (?1, ?2, 1, ?3, ?4)
       ON CONFLICT(owner_key, month) DO UPDATE
         SET generations = generations + 1, updated_at = ?4
         WHERE generations < ?5`,
    )
    .bind(params.ownerKey, params.month, params.userId ?? null, params.nowSec, params.limit)
    .run();

  const row = await readMonthRow(db, params.ownerKey, params.month);
  return row?.generations ?? 0;
}

/** Отметить, что письмо о квоте в этом месяце уже ушло. */
export async function markMonthNoticeSent(
  db: D1Database,
  ownerKeys: string[],
  month: string,
  nowSec: number,
): Promise<void> {
  await ensureFreeUsageTable(db);
  const keys = [...new Set(ownerKeys)];
  if (keys.length === 0) return;
  // Месяц — отдельный параметр (?2), поэтому ключи начинаются с ?3: раньше
  // метка месяца и первый ключ делили один номер, и D1 ругался на число
  // привязок.
  const marks = keys.map((_, i) => `?${i + 3}`).join(", ");
  await db
    .prepare(
      `UPDATE free_usage SET notice_sent_at = ?1, updated_at = ?1
        WHERE month = ?2 AND owner_key IN (${marks})`,
    )
    .bind(nowSec, month, ...keys)
    .run();
}

/**
 * История по месяцам: сколько генераций в каждом месяце, новые сверху.
 *
 * Это и есть тот ответ, ради которого строка не обнуляется: «сколько
 * бесплатных учителей дошли до конца квоты» читается одним запросом.
 */
export async function readMonthHistory(
  db: D1Database,
  ownerKeys: string[],
  limit = 24,
): Promise<FreeUsageMonthRow[]> {
  await ensureFreeUsageTable(db);
  const keys = [...new Set(ownerKeys)];
  if (keys.length === 0) return [];
  const marks = keys.map((_, i) => `?${i + 1}`).join(", ");
  const rows = await db
    .prepare(
      `SELECT month, SUM(generations) AS generations,
              MAX(COALESCE(notice_sent_at, 0)) AS noticeSentAt
         FROM free_usage WHERE owner_key IN (${marks})
        GROUP BY month ORDER BY month DESC LIMIT ?${keys.length + 1}`,
    )
    .bind(...keys, limit)
    .all<{ month: string; generations: number; noticeSentAt: number }>();
  return (rows?.results ?? []).map((r) => ({
    month: r.month,
    generations: Number(r.generations ?? 0),
    noticeSentAt: Number(r.noticeSentAt ?? 0),
  }));
}
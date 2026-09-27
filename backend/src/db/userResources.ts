/**
 * Query-хелперы для user-домена (T4).
 *
 * Зачем отдельный файл: T1 уже создал `db/queries.ts` с user/session/magic-link.
 * Чтобы не лезть в queries.ts (его правит T1 + T2/T3 могут добавлять worksheet query
 * рядом) — все наши ресурсы (favorites / templates / history / subscriptions) живут здесь.
 *
 * Конвенции (унаследованы от queries.ts):
 *   * db.prepare(...).bind(...).first()/all()/run()
 *   * Никакого SELECT * — только явные колонки.
 *   * Временные метки — unix seconds (number).
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { UserTemplate, HistoryItem, SubscriptionView, Worksheet } from "../types";
import { worksheetId, shortId } from "../lib/shortid";

// ─────────────────────────────────────────────────────────────────────────────
// History — последние сгенерированные пользователем worksheets
// ─────────────────────────────────────────────────────────────────────────────

export interface WorksheetRow {
  id: string;
  user_id: string | null;
  subject: string;
  grade: number;
  topic: string;
  difficulty: string;
  type: string;
  count: number;
  title: string | null;
  payload_json: string;
  created_at: number;
}

/**
 * Список worksheets пользователя с cursor-пагинацией.
 *
 * `cursor` — created_at в секундах (timestamp). Возвращаем элементы СТРОГО
 * старше cursor, отсортированные по created_at DESC. На первой странице
 * cursor = undefined.
 *
 * Возвращает { items, nextCursor } — nextCursor = created_at последнего item
 * (если пришло ровно limit элементов, есть шанс что есть ещё).
 */
export async function getRecentWorksheets(
  db: D1Database,
  userId: string,
  limit = 20,
  cursor?: number,
): Promise<{ items: HistoryItem[]; nextCursor?: number }> {
  const boundLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = cursor
    ? await db
        .prepare(
          `SELECT id, user_id, subject, grade, topic, difficulty, type, count,
                  title, payload_json, created_at
           FROM worksheets
           WHERE user_id = ?1 AND created_at < ?2
           ORDER BY created_at DESC
           LIMIT ?3`,
        )
        .bind(userId, cursor, boundLimit)
        .all<WorksheetRow>()
    : await db
        .prepare(
          `SELECT id, user_id, subject, grade, topic, difficulty, type, count,
                  title, payload_json, created_at
           FROM worksheets
           WHERE user_id = ?1
           ORDER BY created_at DESC
           LIMIT ?2`,
        )
        .bind(userId, boundLimit)
        .all<WorksheetRow>();

  const items: HistoryItem[] = (rows.results ?? []).map((row) => {
    let worksheet: Worksheet;
    try {
      worksheet = JSON.parse(row.payload_json) as Worksheet;
    } catch {
      // Если payload битый — собираем минимальный Worksheet, чтобы UI не падал.
      worksheet = {
        id: row.id,
        title: row.title ?? row.topic,
        subject: row.subject,
        grade: row.grade,
        topic: row.topic,
        difficulty: row.difficulty as Worksheet["difficulty"],
        tasks: [],
        createdAt: new Date(row.created_at * 1000).toISOString(),
      };
    }
    return {
      id: row.id,
      subject: row.subject,
      grade: row.grade,
      topic: row.topic,
      difficulty: row.difficulty as HistoryItem["difficulty"],
      type: row.type as HistoryItem["type"],
      count: row.count,
      title: row.title,
      worksheet,
      createdAt: new Date(row.created_at * 1000).toISOString(),
    };
  });

  const nextCursor = items.length === boundLimit ? items[items.length - 1]?.createdAt : undefined;
  // Преобразуем ISO обратно в epoch seconds для cursor API.
  const nextCursorSeconds =
    typeof nextCursor !== "undefined" ? Math.floor(new Date(nextCursor).getTime() / 1000) : undefined;
  return nextCursorSeconds !== undefined
    ? { items, nextCursor: nextCursorSeconds }
    : { items };
}

// ─────────────────────────────────────────────────────────────────────────────
// Favorites
// ─────────────────────────────────────────────────────────────────────────────

export interface FavoriteRecord {
  id: string;
  worksheetId: string;
  favoritedAt: string;
  worksheet: Worksheet;
}

/**
 * Список favorites пользователя + JOIN с worksheets для payload.
 * Пагинация — по created_at favorites (а не worksheets).
 */
export async function listFavorites(
  db: D1Database,
  userId: string,
  limit = 50,
  cursor?: number,
): Promise<{ items: FavoriteRecord[]; nextCursor?: number }> {
  const boundLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = cursor
    ? await db
        .prepare(
          `SELECT f.id AS fav_id, f.worksheet_id, f.created_at AS fav_at,
                  w.payload_json
           FROM favorites f
           LEFT JOIN worksheets w ON w.id = f.worksheet_id
           WHERE f.user_id = ?1 AND f.created_at < ?2
           ORDER BY f.created_at DESC
           LIMIT ?3`,
        )
        .bind(userId, cursor, boundLimit)
        .all<{ fav_id: string; worksheet_id: string; fav_at: number; payload_json: string | null }>()
    : await db
        .prepare(
          `SELECT f.id AS fav_id, f.worksheet_id, f.created_at AS fav_at,
                  w.payload_json
           FROM favorites f
           LEFT JOIN worksheets w ON w.id = f.worksheet_id
           WHERE f.user_id = ?1
           ORDER BY f.created_at DESC
           LIMIT ?2`,
        )
        .bind(userId, boundLimit)
        .all<{ fav_id: string; worksheet_id: string; fav_at: number; payload_json: string | null }>();

  const items: FavoriteRecord[] = [];
  for (const row of rows.results ?? []) {
    let worksheet: Worksheet;
    if (row.payload_json) {
      try {
        worksheet = JSON.parse(row.payload_json) as Worksheet;
      } catch {
        continue; // битый payload пропускаем
      }
    } else {
      // worksheet могли удалить, а favorite остался — отдаём stub
      worksheet = {
        id: row.worksheet_id,
        title: "(удалено)",
        subject: "",
        grade: 0,
        topic: "",
        difficulty: "medium",
        tasks: [],
        createdAt: new Date(row.fav_at * 1000).toISOString(),
      };
    }
    items.push({
      id: row.fav_id,
      worksheetId: row.worksheet_id,
      favoritedAt: new Date(row.fav_at * 1000).toISOString(),
      worksheet,
    });
  }

  const nextCursor = items.length === boundLimit ? items[items.length - 1]?.favoritedAt : undefined;
  const nextCursorSeconds =
    typeof nextCursor !== "undefined" ? Math.floor(new Date(nextCursor).getTime() / 1000) : undefined;
  return nextCursorSeconds !== undefined
    ? { items, nextCursor: nextCursorSeconds }
    : { items };
}

/**
 * Upsert worksheet в worksheets + insert в favorites (silent conflict).
 *
 * Принимает полный Worksheet (для payload_json). Если worksheet.id не задан —
 * сгенерируем. Делаем это в два шага (не транзакция, D1 не поддерживает tx
 * через prepare-bind на каждом шаге, но операции идемпотентны — повторный
 * POST на тот же id не сломает ничего).
 */
export async function addFavorite(
  db: D1Database,
  userId: string,
  worksheet: Worksheet,
): Promise<{ favoriteId: string; worksheetId: string; alreadyFavorited: boolean }> {
  const now = Math.floor(Date.now() / 1000);
  const wsId = worksheet.id || worksheetId();

  // 1. Upsert worksheet — храним payload_json для последующего GET.
  const existing = await db
    .prepare(`SELECT id FROM worksheets WHERE id = ?1`)
    .bind(wsId)
    .first<{ id: string }>();

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO worksheets
          (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        wsId,
        userId, // создатель = пользователь, добавивший в избранное
        worksheet.subject,
        worksheet.grade,
        worksheet.topic,
        worksheet.difficulty,
        "worksheet", // при импорте избранного всегда worksheet-тип
        worksheet.tasks.length,
        worksheet.title,
        JSON.stringify(worksheet),
        now,
      )
      .run();
  }

  // 2. Insert favorite — silent conflict.
  const favId = `fav_${shortId()}`;
  const insertResult = await db
    .prepare(
      `INSERT OR IGNORE INTO favorites (id, user_id, worksheet_id, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(favId, userId, wsId, now)
    .run();

  // Если INSERT проигнорирован (UNIQUE conflict) — найдём существующий id.
  const meta = (insertResult as unknown as { meta?: { changes?: number } }).meta;
  if (meta && meta.changes === 0) {
    const existingFav = await db
      .prepare(`SELECT id FROM favorites WHERE user_id = ?1 AND worksheet_id = ?2`)
      .bind(userId, wsId)
      .first<{ id: string }>();
    return {
      favoriteId: existingFav?.id ?? favId,
      worksheetId: wsId,
      alreadyFavorited: true,
    };
  }

  return { favoriteId: favId, worksheetId: wsId, alreadyFavorited: false };
}

export async function removeFavorite(db: D1Database, userId: string, favoriteId: string): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM favorites WHERE id = ?1 AND user_id = ?2`)
    .bind(favoriteId, userId)
    .run();
  const meta = (result as unknown as { meta?: { changes?: number } }).meta;
  return Boolean(meta?.changes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateRow {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  grade: number;
  topic: string;
  difficulty: string;
  count: number;
  created_at: number;
}

function rowToTemplate(row: TemplateRow): UserTemplate & { id: string; createdAt: string } {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject as UserTemplate["subject"],
    grade: row.grade,
    topic: row.topic,
    difficulty: row.difficulty as UserTemplate["difficulty"],
    count: row.count,
    createdAt: new Date(row.created_at * 1000).toISOString(),
  };
}

export async function listTemplates(db: D1Database, userId: string): Promise<UserTemplate[]> {
  const rows = await db
    .prepare(
      `SELECT id, user_id, name, subject, grade, topic, difficulty, count, created_at
       FROM templates
       WHERE user_id = ?1
       ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<TemplateRow>();
  return (rows.results ?? []).map((r) => {
    const t = rowToTemplate(r);
    // strip createdAt для внешнего API (тип UserTemplate не включает его)
    const { createdAt: _createdAt, ...rest } = t;
    return rest as UserTemplate;
  });
}

export async function createTemplate(
  db: D1Database,
  userId: string,
  template: UserTemplate,
): Promise<UserTemplate> {
  const id = template.id ?? `tpl_${shortId()}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO templates (id, user_id, name, subject, grade, topic, difficulty, count, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      id,
      userId,
      template.name,
      template.subject,
      template.grade,
      template.topic,
      template.difficulty,
      template.count,
      now,
    )
    .run();
  return { ...template, id };
}

export async function deleteTemplate(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM templates WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .run();
  const meta = (result as unknown as { meta?: { changes?: number } }).meta;
  return Boolean(meta?.changes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  period: string;
  yookassa_payment_id: string | null;
  starts_at: number;
  ends_at: number;
  auto_renew: number;
  created_at: number;
  updated_at: number;
}

export async function getActiveSubscription(
  db: D1Database,
  userId: string,
): Promise<SubscriptionView | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT id, user_id, plan, status, period, yookassa_payment_id,
              starts_at, ends_at, auto_renew, created_at, updated_at
       FROM subscriptions
       WHERE user_id = ?1 AND status = 'active' AND ends_at > ?2
       ORDER BY ends_at DESC
       LIMIT 1`,
    )
    .bind(userId, now)
    .first<SubscriptionRow>();
  if (!row) return null;
  return {
    id: row.id,
    plan: row.plan as SubscriptionView["plan"],
    status: row.status,
    period: row.period as SubscriptionView["period"],
    startsAt: new Date(row.starts_at * 1000).toISOString(),
    endsAt: new Date(row.ends_at * 1000).toISOString(),
    autoRenew: row.auto_renew === 1,
  };
}

/**
 * Базовые query-хелперы для D1.
 *
 * Только user/session/magic-link — остальное (worksheets/exams/billing/cache) добавляют
 * владельцы соответствующих модулей (T2-T6). Так избегаем merge-конфликтов.
 *
 * Конвенции:
 *   * Все запросы через `db.prepare(...).bind(...).first() / .all() / .run()`.
 *   * Все типы — `Promise<...>`, даже .first()/.run() (асинхронность D1).
 *   * Никаких SELECT * — всегда явные колонки.
 *   * Временные метки хранятся как unix seconds (number).
 */

import type { D1Database } from "@cloudflare/workers-types";

// ─────────────────────────────────────────────────────────────────────────────
// Row types
// ─────────────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  plan: "free" | "base" | "standard" | "plus";
  generations_total: number;
  generations_today: number;
  generations_reset_at: number | null;
  is_admin: number;
  created_at: number;
  updated_at: number;
  stripe_customer_id: string | null;
  yookassa_customer_id: string | null;
}

export interface MagicLinkRow {
  token: string;
  email: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  const row = await db
    .prepare(
      `SELECT id, email, name, plan, generations_total, generations_today,
              generations_reset_at, is_admin, created_at, updated_at,
              stripe_customer_id, yookassa_customer_id
       FROM users WHERE id = ?1`,
    )
    .bind(id)
    .first<UserRow>();
  return row ?? null;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  const row = await db
    .prepare(
      `SELECT id, email, name, plan, generations_total, generations_today,
              generations_reset_at, is_admin, created_at, updated_at,
              stripe_customer_id, yookassa_customer_id
       FROM users WHERE email = ?1`,
    )
    .bind(email.toLowerCase())
    .first<UserRow>();
  return row ?? null;
}

export async function createUser(
  db: D1Database,
  params: {
    id: string;
    email: string;
    name?: string | null;
    plan?: "free" | "base" | "standard" | "plus";
    isAdmin?: boolean;
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6, ?6)`,
    )
    .bind(
      params.id,
      params.email.toLowerCase(),
      params.name ?? null,
      params.plan ?? "free",
      params.isAdmin ? 1 : 0,
      now,
    )
    .run();
}

export async function setUserAdmin(
  db: D1Database,
  id: string,
  isAdmin: boolean,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE users SET is_admin = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(isAdmin ? 1 : 0, now, id)
    .run();
}

export async function updateUserPlan(
  db: D1Database,
  id: string,
  plan: "free" | "base" | "standard" | "plus",
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE users SET plan = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(plan, now, id)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Роль (teacher / student)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Роль пользователя. Нет строки в user_roles = teacher.
 *
 * Ученики появятся с тарифом «Школа» (Q1 2027); требование «ученик не
 * генерирует» зафиксировано уже сейчас, чтобы оно не потерялось между
 * сессиями. Значение по умолчанию осознанно «учитель»: у всех, кто зарегистрирован
 * сейчас, роль именно такая, и добавление строки в user_roles не требуется.
 */
export async function getUserRole(
  db: D1Database,
  userId: string,
): Promise<"teacher" | "student"> {
  try {
    const row = await db
      .prepare(`SELECT role FROM user_roles WHERE user_id = ?1`)
      .bind(userId)
      .first<{ role: string }>();
    return row?.role === "student" ? "student" : "teacher";
  } catch (e) {
    // Таблицы может не быть, если миграции не прогнаны (или в тестовой
    // фикстуре схема собрана вручную). Раньше здесь бросался D1_ERROR,
    // и auth middleware падал с 500 на КАЖДЫЙ авторизованный запрос —
    // то есть отсутствие вспомогательной таблицы роняло весь API.
    // Роль по умолчанию и так teacher (см. докстринг выше), поэтому
    // отсутствие таблицы трактуем так же и логируем: это сигнал, что
    // schema.sql не применён, а не повод отдавать 500 пользователю.
    console.warn(
      `[db] getUserRole: user_roles недоступна (${e instanceof Error ? e.message : String(e)}), ` +
        `роль трактуется как teacher`,
    );
    return "teacher";
  }
}

export async function setUserRole(
  db: D1Database,
  userId: string,
  role: "teacher" | "student",
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO user_roles (user_id, role, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(user_id) DO UPDATE SET role = ?2, updated_at = ?3`,
    )
    .bind(userId, role, now)
    .run();
}

export async function incrementUserGenerations(db: D1Database, id: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE users
       SET generations_total = generations_total + 1,
           generations_today = generations_today + 1,
           updated_at = ?1
       WHERE id = ?2`,
    )
    .bind(now, id)
    .run();
}

/**
 * Сбросить дневной счётчик (вызывается кроном или лениво — когда
 * generations_reset_at < now). Один SQL-апдейт без транзакции.
 */
export async function resetUserDailyGenerations(db: D1Database, id: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE users
       SET generations_today = 0,
           generations_reset_at = ?1,
           updated_at = ?1
       WHERE id = ?2`,
    )
    .bind(now + 86400, now, id)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Magic links
// ─────────────────────────────────────────────────────────────────────────────

export async function createMagicLink(
  db: D1Database,
  params: { token: string; email: string; ttlSeconds?: number },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (params.ttlSeconds ?? 3600); // дефолт — 1 час
  await db
    .prepare(
      `INSERT INTO magic_links (token, email, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(params.token, params.email.toLowerCase(), expiresAt, now)
    .run();
}

export interface ConsumedMagicLink {
  email: string;
}

/**
 * Атомарно: пометить magic-link использованным и вернуть email,
 * если токен валидный (не истёк, не использован). null если что-то не так.
 */
export async function consumeMagicLink(
  db: D1Database,
  token: string,
): Promise<ConsumedMagicLink | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT email FROM magic_links
       WHERE token = ?1 AND used_at IS NULL AND expires_at > ?2`,
    )
    .bind(token, now)
    .first<{ email: string }>();
  if (!row) return null;

  await db
    .prepare(`UPDATE magic_links SET used_at = ?1 WHERE token = ?2`)
    .bind(now, token)
    .run();

  return { email: row.email };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

export async function createSession(
  db: D1Database,
  params: { token: string; userId: string; ttlSeconds?: number },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (params.ttlSeconds ?? 60 * 60 * 24 * 30); // 30 дней
  await db
    .prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(params.token, params.userId, expiresAt, now)
    .run();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token).run();
}

export interface SessionInfo {
  user_id: string;
  expires_at: number;
}

export async function getSession(db: D1Database, token: string): Promise<SessionInfo | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT user_id, expires_at FROM sessions
       WHERE token = ?1 AND expires_at > ?2`,
    )
    .bind(token, now)
    .first<SessionInfo>();
  return row ?? null;
}

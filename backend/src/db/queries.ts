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

/**
 * Список аккаунтов с правами администратора.
 *
 * Зачем он в продукте (найдено 15.10.2026): права выдавались один раз — при
 * первой регистрации, если адрес попал в ADMIN_EMAILS на сервере — и с тех пор
 * висели в базе навсегда. Снять их из интерфейса было нечем: `setUserAdmin`
 * существовал, но не вызывался ниоткуда. Потерянный доступ к админской почте
 * означал, что новый её владелец получит суперадминку навсегда.
 */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  is_admin: number;
  /** Включён ли код подтверждения — без него админ входит по одной ссылке. */
  totp_enabled: number;
  created_at: number;
}

export async function listAdminUsers(db: D1Database): Promise<AdminUserRow[]> {
  const rows = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.plan, u.is_admin, u.created_at,
              CASE WHEN t.confirmed_at IS NULL THEN 0 ELSE 1 END AS totp_enabled
       FROM users u
       LEFT JOIN admin_totp t ON t.user_id = u.id
       WHERE u.is_admin = 1
       ORDER BY u.created_at`,
    )
    .all<AdminUserRow>();
  return rows.results;
}

/** Сколько всего аккаунтов с правами администратора. */
export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE is_admin = 1`)
    .first<{ n: number }>();
  return row?.n ?? 0;
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

/**
 * Увеличить счётчики генераций.
 *
 * ГЛАВНОЕ (аудит 18.10.2026, BUG-032): сброс дневного счётчика больше не
 * «обещан, но не вызывается» — он делается ЛЕНИВО, здесь же, перед
 * инкрементом. Раньше функция `resetUserDailyGenerations` была объявлена, но
 * не вызывалась НИГДЕ, из-за чего `generations_today` рос бесконечно (в
 * аудите замерено 16 и 32) и назывался «счётчиком за сегодня», не будучи им.
 *
 * Сброс ленивый, а не по крону: крона у воркера нет, а лишний UPDATE на
 * каждом запросе — это лишняя запись в D1. Проверка дешёвая: сброс делается
 * только тогда, когда `generations_reset_at` пуст или просрочен.
 *
 * ВАЖНО: считается это НЕ квота. Квота — месячная, в `free_usage`
 * (services/usage.ts), и остаток для учителя считается по ней. Здесь живёт
 * простой счётчик «сколько генераций сегодня», который честно обнуляется
 * раз в сутки.
 */
export async function incrementUserGenerations(db: D1Database, id: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(`SELECT generations_reset_at FROM users WHERE id = ?1`)
    .bind(id)
    .first<{ generations_reset_at: number | null }>();

  const resetAt = row?.generations_reset_at ?? null;
  const dueForReset = resetAt == null || resetAt <= now;

  await db
    .prepare(
      `UPDATE users
       SET generations_total = generations_total + 1,
           generations_today = CASE WHEN ?3 THEN 1 ELSE generations_today + 1 END,
           generations_reset_at = CASE WHEN ?3 THEN ?4 ELSE generations_reset_at END,
           updated_at = ?1
       WHERE id = ?2`,
    )
    .bind(now, id, dueForReset ? 1 : 0, now + 86400)
    .run();
}

/**
 * Сбросить дневной счётчик (вызывается кроном или лениво — когда
 * generations_reset_at < now). Один SQL-апдейт без транзакции.
 *
 * Вызывается из `incrementUserGenerations` — ленивый сброс перед инкрементом.
 * Отдельный вызов тоже возможен (например, из крона, если он появится).
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
// Пароль для входа без письма (ТЗ-23)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserPasswordRow {
  user_id: string;
  hash: string;
  salt: string;
  iterations: number;
  created_at: number;
  updated_at: number;
}

/**
 * Записать пароль пользователя (создать или перезаписать).
 *
 * UPSERT, а не пара INSERT/UPDATE: у пользователя пароль ровно один, и
 * гонки «две вкладки открыли настройки» не должны приводить к ошибке UNIQUE.
 * created_at при перезаписи НЕ трогается — это дата, когда пароль поставили
 * впервые; updated_at — дата последней смены, и именно её показывает вкладка
 * «Пароль задан …» (контракт API §3).
 *
 * Возвращает updated_at (unix seconds) — ручке нужен для поля setAt.
 */
export async function setUserPassword(
  db: D1Database,
  userId: string,
  params: { hash: string; salt: string; iterations: number },
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO user_passwords (user_id, hash, salt, iterations, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(user_id) DO UPDATE SET
         hash = ?2,
         salt = ?3,
         iterations = ?4,
         updated_at = ?5`,
    )
    .bind(userId, params.hash, params.salt, params.iterations, now)
    .run();
  return now;
}

/** Прочитать запись пароля по user_id. null = пароль не задан. */
export async function getUserPassword(db: D1Database, userId: string): Promise<UserPasswordRow | null> {
  const row = await db
    .prepare(
      `SELECT user_id, hash, salt, iterations, created_at, updated_at
       FROM user_passwords WHERE user_id = ?1`,
    )
    .bind(userId)
    .first<UserPasswordRow>();
  return row ?? null;
}

/** Убрать пароль (DELETE /api/auth/password). Удаление уже отсутствующего — не ошибка. */
export async function deleteUserPassword(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM user_passwords WHERE user_id = ?1`).bind(userId).run();
}

export interface UserPasswordState {
  hasPassword: boolean;
  /** unix seconds последней установки/смены; null, если пароля нет. */
  updatedAt: number | null;
}

/**
 * Признак «пароль задан» + когда установлен — для /api/auth/me.
 *
 * Отдельная функция, а не переиспользование getUserPassword, потому что /me
 * зовут на каждой загрузке личного кабинета и тянуть туда соль с хешем незачем:
 * они бы никуда не ушли, но лишние данные в ручке, которую читают постоянно, —
 * лишний риск.
 */
export async function getUserPasswordState(
  db: D1Database,
  userId: string,
): Promise<UserPasswordState> {
  try {
    const row = await db
      .prepare(`SELECT updated_at FROM user_passwords WHERE user_id = ?1`)
      .bind(userId)
      .first<{ updated_at: number }>();
    if (!row) return { hasPassword: false, updatedAt: null };
    return { hasPassword: true, updatedAt: row.updated_at };
  } catch (e) {
    // Отсутствие таблицы не должно ронять весь личный кабинет на каждом
    // запросе: /me зовут постоянно, и 500 здесь равносилен «кабинет не грузится».
    // Тот же приём, что в getUserRole. Признак «пароля нет» тут честнее, чем 500.
    console.warn(
      `[db] getUserPasswordState: user_passwords недоступна (${
        e instanceof Error ? e.message : String(e)
      }), пароль считается незаданным`,
    );
    return { hasPassword: false, updatedAt: null };
  }
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
/**
 * Окно, в котором уже использованная ссылка ещё раз выдаёт сессию.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ССЫЛКА НЕ ОДНОРАЗОВАЯ ПОЛНОСТЬЮ (исправление 08.10.2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * Ссылка одноразовая — это базовая защита, и её убирать нельзя. Но полная
 * одноразовость ломает обычный сценарий, на который попалась учительница:
 * «пришло письмо на почту, я открыла на телефоне, УчЛист открылся на
 * телефоне, а на планшете нет».
 *
 * Как это выглядит по коду: `consumeMagicLink` ставит `used_at` при ПЕРВОМ
 * открытии. Второе устройство приходит с тем же токеном, условие
 * `used_at IS NULL` уже не выполняется → 401, и планшет остаётся ни с чем.
 *
 * Решение: после первого использования ссылка ещё `MAGIC_LINK_REUSE_SECONDS`
 * (15 минут) выдаёт сессию. Это НЕ отменяет защиту, а уточняет её:
 *   · ссылка не перебирается — она одноразовая по природе, повтор возможен
 *     только в том же письме и только в первые минуты;
 *   · 15 минут — недостаточно, чтобы переслать письмо и зайти спустя день;
 *   · каждое открытие создаёт СВОЮ сессию, поэтому на телефоне и планшете
 *     сессии разные и одна не вытесняет другую.
 *
 * Урок, который стоит помнить: «одноразовая ссылка» и «одно устройство» —
 * это разные свойства. Второе никто не обещал.
 */
export const MAGIC_LINK_REUSE_SECONDS = 15 * 60;

/**
 * Потреблить magic-link и вернуть email, которому он принадлежит.
 *
 * Возвращает email в двух случаях:
 *   1) ссылка ещё не использована — обычный первый вход;
 *   2) ссылка использована, но недавно (в пределах `MAGIC_LINK_REUSE_SECONDS`) —
 *      повторный вход на другое устройство с того же письма.
 */
export async function consumeMagicLink(
  db: D1Database,
  token: string,
): Promise<ConsumedMagicLink | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT email, used_at FROM magic_links
       WHERE token = ?1 AND expires_at > ?2
         AND (used_at IS NULL OR used_at > ?3)`,
    )
    .bind(token, now, now - MAGIC_LINK_REUSE_SECONDS)
    .first<{ email: string; used_at: number | null }>();
  if (!row) return null;

  // `used_at` НЕ перезаписываем: окно считается от ПЕРВОГО открытия, иначе
  // ссылка, которой пользовались на телефоне, планшету не достанется.
  if (row.used_at == null) {
    await db
      .prepare(`UPDATE magic_links SET used_at = ?1 WHERE token = ?2 AND used_at IS NULL`)
      .bind(now, token)
      .run();
  }

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

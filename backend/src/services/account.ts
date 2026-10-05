/**
 * Настройки профиля учителя, «Мои классы» и управление сессиями (ТЗ-21, блок 5).
 *
 * Здесь только данные и правила. HTTP — в `routes/account.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ НЕ В `db/queries.ts`
 * ─────────────────────────────────────────────────────────────────────────────
 * `db/queries.ts` — общий файл запросов, и его правит соседний блок ТЗ-21
 * (серверный слой кабинета). Чтобы не делить один файл с параллельной работой,
 * запросы настроек живут здесь. Паттерн (отдельный сервис + типизированные
 * строки) — тот же, что у `services/billing.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ ПРАВИЛО: АНОНИМ — ПОЛНОПРАВНЫЙ УЧИТЕЛЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Входа сейчас нет (`MAGIC_LINK_READY = false`), и это НЕ блокер. Поэтому всё,
 * что здесь живёт, обязано иметь честный анонимный путь на устройстве —
 * и он есть, на фронте (`src/lib/lk/profile-api.ts`): серверный слой здесь
 * УСИЛИВАЕТ (появляются перенос между устройствами и подтверждение почты),
 * но не является условием использования настроек.
 */

import type { D1Database } from "@cloudflare/workers-types";

/** Сколько классов держим у одного учителя. */
export const MAX_CLASSES = 12;
/** Сколько символов в названии класса («5А», «10-Б»). */
const MAX_CLASS_LENGTH = 16;
/** Сколько живёт ссылка подтверждения смены почты. */
export const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60;

export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  classes: string[];
  /** Незавершённый запрос смены почты, если он есть. */
  pendingEmailChange: { newEmail: string; createdAt: number; expiresAt: number } | null;
}

export interface AccountSession {
  /**
   * Идентификатор для отображения и завершения сессии — ПОСЛЕДНИЕ 12 символов
   * токена, а не сам токен.
   *
   * Почему: токен сессии = полный доступ к аккаринту учителя. Отдавать его
   * списком «устройств» нельзя даже самому владельцу — страница с утечкой
   * (снимок экрана, чужая вкладка) становится вектором. Суффикс позволяет
   * однозначно найти сессию (`LIKE '%'||?`) и не даёт ничего, чего не было бы
   * в самой cookie.
   */
  id: string;
  createdAt: number;
  expiresAt: number;
  /** Эта сессия — та, из которой пришёл запрос. */
  current: boolean;
}

export interface EmailChangeRequest {
  id: string;
  newEmail: string;
  expiresAt: number;
}

export type AccountResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "validation" | "not_found" | "conflict" };

/* ────────────────────────────────────────────────────────────────────────────
 * Чистые правила (без БД) — их удобно тестировать и переиспользовать
 * ──────────────────────────────────────────────────────────────────────────── */

/** Проверка почты. Намеренно строгая и без «починим за вас»: адрес нужен для входа. */
export function isValidEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return false;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return false;
  return true;
}

/**
 * Приводит список классов к канону: обрезка, нормализация регистра и букв,
 * уникальность, лимит.
 *
 * «5а» и «5А» — это один и тот же класс, иначе фильтр в кабинете расползётся
 * на «5А / 5а / 5а» и учитель ничего не найдёт. Кириллическую «А» приводим к
 * верхнему регистру, латинскую оставляем как есть (в кабинете бывают «7A»).
 */
export function normalizeClasses(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_CLASS_LENGTH);
    if (!value) continue;
    const key = value.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_CLASSES) break;
  }
  return out;
}

/** Имя: обрезка, схлопывание пробелов, ограничение длины. */
export function normalizeName(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Разбирает classes_json, не роняя всё обучение из-за одной битой строки. */
export function parseClasses(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return normalizeClasses(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Идентификатор сессии для показа и завершения — суффикс токена. */
export function sessionPublicId(token: string): string {
  return token.slice(-12);
}

/** Сколько классов приходит с клиента за раз — защита от тысячи элементов. */
export const MAX_CLASSES_PER_REQUEST = 40;

/* ────────────────────────────────────────────────────────────────────────────
 * Профиль
 * ──────────────────────────────────────────────────────────────────────────── */

export async function getAccountProfile(
  db: D1Database,
  userId: string,
): Promise<AccountProfile | null> {
  const user = await db
    .prepare(`SELECT id, email, name FROM users WHERE id = ?1`)
    .bind(userId)
    .first<{ id: string; email: string; name: string | null }>();
  if (!user) return null;

  const classesRow = await db
    .prepare(`SELECT classes_json FROM teacher_classes WHERE user_id = ?1`)
    .bind(userId)
    .first<{ classes_json: string | null }>();

  const pendingRow = await db
    .prepare(
      `SELECT new_email, created_at, expires_at FROM email_change_requests
       WHERE user_id = ?1 AND status = 'pending' AND expires_at > ?2
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, Math.floor(Date.now() / 1000))
    .first<{ new_email: string; created_at: number; expires_at: number }>();

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? "",
    classes: parseClasses(classesRow?.classes_json),
    pendingEmailChange: pendingRow
      ? {
          newEmail: pendingRow.new_email,
          createdAt: pendingRow.created_at,
          expiresAt: pendingRow.expires_at,
        }
      : null,
  };
}

/** Имя — сразу в `users`: своей копии у настроек нет. */
export async function updateAccountName(
  db: D1Database,
  userId: string,
  name: string,
): Promise<AccountResult<string>> {
  const clean = normalizeName(name);
  if (!clean) return { ok: false, code: "validation" };

  const now = Math.floor(Date.now() / 1000);
  const res = await db
    .prepare(`UPDATE users SET name = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(clean, now, userId)
    .run();
  if (!res.success) return { ok: false, code: "not_found" };
  return { ok: true, value: clean };
}

/** Upsert классов: строки может не быть (учитель ещё ничего не отмечал). */
export async function setTeacherClasses(
  db: D1Database,
  userId: string,
  classes: unknown,
): Promise<AccountResult<string[]>> {
  const clean = normalizeClasses(classes);
  if (!Array.isArray(classes)) return { ok: false, code: "validation" };
  if (Array.isArray(classes) && classes.length > MAX_CLASSES_PER_REQUEST) {
    return { ok: false, code: "validation" };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO teacher_classes (user_id, classes_json, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id) DO UPDATE SET classes_json = ?2, updated_at = ?3`,
    )
    .bind(userId, JSON.stringify(clean), now)
    .run();
  return { ok: true, value: clean };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Сессии
 * ──────────────────────────────────────────────────────────────────────────── */

export async function listAccountSessions(
  db: D1Database,
  userId: string,
  currentToken: string | undefined,
): Promise<AccountSession[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .prepare(
      `SELECT token, created_at, expires_at FROM sessions
       WHERE user_id = ?1 AND expires_at > ?2
       ORDER BY created_at DESC`,
    )
    .bind(userId, now)
    .all<{ token: string; created_at: number; expires_at: number }>();

  return (rows.results ?? []).map((r) => ({
    id: sessionPublicId(r.token),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    current: Boolean(currentToken) && r.token === currentToken,
  }));
}

/**
 * Завершить одну сессию по её короткому id.
 *
 * Возвращает `not_found`, если такой сессии у этого учителя нет: чужой id
 * должен выглядеть так же, как несуществующий, иначе по ответам можно
 * перебором узнать, где человек залогинен.
 */
export async function revokeAccountSession(
  db: D1Database,
  userId: string,
  id: string,
): Promise<AccountResult<true>> {
  const res = await db
    .prepare(`DELETE FROM sessions WHERE user_id = ?1 AND token LIKE '%' || ?2`)
    .bind(userId, id)
    .run();
  if (!res.success) return { ok: false, code: "not_found" };
  return { ok: true, value: true };
}

/**
 * Завершить все сессии, кроме текущей — «выйти на всех остальных устройствах».
 *
 * Текущая не трогается намеренно: учитель нажал кнопку на телефоне и обычно
 * ожидает остаться залогиненным на телефоне. Если нужен полный выход — на
 * устройстве есть отдельная кнопка «Выйти».
 */
export async function revokeOtherSessions(
  db: D1Database,
  userId: string,
  currentToken: string | undefined,
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const res = currentToken
    ? await db
        .prepare(
          `DELETE FROM sessions WHERE user_id = ?1 AND token != ?2 AND expires_at > ?3`,
        )
        .bind(userId, currentToken, now)
        .run()
    : await db
        .prepare(`DELETE FROM sessions WHERE user_id = ?1 AND expires_at > ?2`)
        .bind(userId, now)
        .run();
  return res.meta?.changes ?? 0;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Смена почты — только через подтверждение на НОВЫЙ адрес
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Создать запрос на смену почты. Ничего не применяет: `users.email` меняется
 * только в `applyEmailChange`, то есть после клика по ссылке из письма.
 *
 * Письмо отправляет вызывающий код (routes/account.ts) и только после успешной
 * отправки. Порядок именно такой: если Resend не настроен, мы НЕ создаём
 * запрос и НЕ говорим учителю «мы отправили письмо» — это была бы ложь, за
 * которой стоит тишина в его почтовом ящике.
 */
export async function createEmailChangeRequest(
  db: D1Database,
  params: { userId: string; newEmail: string; id: string; token: string },
): Promise<AccountResult<EmailChangeRequest>> {
  const current = await db
    .prepare(`SELECT email FROM users WHERE id = ?1`)
    .bind(params.userId)
    .first<{ email: string }>();
  if (!current) return { ok: false, code: "not_found" };

  const newEmail = params.newEmail.trim().toLowerCase();
  if (!isValidEmail(newEmail)) return { ok: false, code: "validation" };
  if (newEmail === current.email.toLowerCase()) return { ok: false, code: "validation" };

  // Адрес уже занят другим аккаринтом — сообщаем честно, без утечки, кому он
  // принадлежит: смена с такого адреса всё равно невозможна (UNIQUE).
  const taken = await db
    .prepare(`SELECT id FROM users WHERE email = ?1`)
    .bind(newEmail)
    .first<{ id: string }>();
  if (taken) return { ok: false, code: "conflict" };

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + EMAIL_CHANGE_TTL_SECONDS;

  // Незавершённый запрос заменяем целиком: держать два открытых запроса на
  // одну смену почты незачем, и в настройках показывается ровно один.
  await db
    .prepare(
      `DELETE FROM email_change_requests
       WHERE user_id = ?1 AND status = 'pending'`,
    )
    .bind(params.userId)
    .run();

  await db
    .prepare(
      `INSERT INTO email_change_requests
         (id, user_id, old_email, new_email, token, status, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)`,
    )
    .bind(params.id, params.userId, current.email, newEmail, params.token, now, expiresAt)
    .run();

  return { ok: true, value: { id: params.id, newEmail, expiresAt } };
}

/**
 * Применить смену почты по токену из письма.
 *
 * Токен — единственное подтверждение владения новым адресом, поэтому он и
 * одноразовый: применяем и помечаем applied, повторный клик ничего не делает.
 */
export async function applyEmailChange(
  db: D1Database,
  token: string,
): Promise<AccountResult<{ email: string }>> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT id, user_id, new_email, status, expires_at FROM email_change_requests
       WHERE token = ?1`,
    )
    .bind(token)
    .first<{
      id: string;
      user_id: string;
      new_email: string;
      status: string;
      expires_at: number;
    }>();

  if (!row || row.status !== "pending") return { ok: false, code: "not_found" };
  if (row.expires_at <= now) {
    await db
      .prepare(`UPDATE email_change_requests SET status = 'expired' WHERE id = ?1`)
      .bind(row.id)
      .run();
    return { ok: false, code: "not_found" };
  }

  const taken = await db
    .prepare(`SELECT id FROM users WHERE email = ?1 AND id != ?2`)
    .bind(row.new_email, row.user_id)
    .first<{ id: string }>();
  if (taken) return { ok: false, code: "conflict" };

  const updated = await db
    .prepare(`UPDATE users SET email = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(row.new_email, now, row.user_id)
    .run();
  if (!updated.success) return { ok: false, code: "not_found" };

  await db
    .prepare(
      `UPDATE email_change_requests SET status = 'applied', applied_at = ?1 WHERE id = ?2`,
    )
    .bind(now, row.id)
    .run();

  return { ok: true, value: { email: row.new_email } };
}

/** Отклонить незавершённый запрос (учитель передумал). */
export async function cancelEmailChange(
  db: D1Database,
  userId: string,
): Promise<AccountResult<true>> {
  await db
    .prepare(
      `UPDATE email_change_requests SET status = 'expired'
       WHERE user_id = ?1 AND status = 'pending'`,
    )
    .bind(userId)
    .run();
  return { ok: true, value: true };
}

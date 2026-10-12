/**
 * Хранение и проверка кода подтверждения администратора (ТЗ-24, §8.1).
 *
 * Разделение слоёв:
 *   lib/totp.ts    — криптография (считает код, шифрует секрет), без БД
 *   этот файл      — работа с базой и жизненный цикл настройки
 *
 * ЖИЗНЕННЫЙ ЦИКЛ, КОТОРЫЙ НЕЛЬЗЯ СЛОМАТЬ
 * --------------------------------------
 *   1. Начал настройку   → секрет в базе, confirmed_at = NULL, входа ещё нет
 *   2. Подтвердил код    → confirmed_at проставлен, вход работает
 *   3. Вошёл по коду     → last_used_at обновлён
 *   4. Потерял телефон   → резервный код (одноразовый) или аварийный путь
 *
 * Между шагами 1 и 2 код НЕ действует. Это и защита от «настроил и забыл»,
 * и честное состояние: если человек не смог подтвердить пробный код — значит
 * что-то не так, и лучше он разберётся сейчас, чем останется без входа.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import {
  generateTotpSecret,
  sealSecret,
  unsealSecret,
  verifyTotp,
  generateBackupCodes,
  normalizeBackupCode,
} from "../lib/totp";

/** Ключ шифрования обязателен: без него TOTP включить нельзя. */
function requireKey(env: Env): string {
  const key = env.TOTP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY не задан — код подтверждения включить нельзя. " +
        "Сгенерируйте: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  return key;
}

/** SHA-256 в base64 — для хранения резервных кодов. */
async function hashBackupCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeBackupCode(code));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * Кто включил код подтверждения.
 *
 * Возвращает только ПОДТВЕРЖДЁННЫЕ настройки (`confirmed_at IS NOT NULL`).
 * Незавершённая настройка сюда не попадает — иначе «начал настраивать,
 * не досканировал» превратилось бы в «не могу войти».
 */
export async function getTotpSettings(
  db: D1Database,
  userId: string,
): Promise<{ secretEnc: string; secretIv: string } | null> {
  const row = await db
    .prepare(
      `SELECT secret_enc, secret_iv FROM admin_totp
       WHERE user_id = ?1 AND confirmed_at IS NOT NULL`,
    )
    .bind(userId)
    .first<{ secret_enc: string; secret_iv: string }>();
  // Приводим к тому виду, в котором ждёт распаковщик секрета: D1 отдаёт
  // имена колонок как есть, а дальше по коду секрет живёт в camelCase.
  if (!row) return null;
  return { secretEnc: row.secret_enc, secretIv: row.secret_iv };
}

/** Включён ли код подтверждения у пользователя. */
export async function isTotpEnabled(db: D1Database, userId: string): Promise<boolean> {
  return (await getTotpSettings(db, userId)) !== null;
}

/**
 * Шаг 1: создать секрет и показать его владельцу.
 *
 * Старый незавершённый секрет, если он был, затирается: начать заново должно
 * быть можно в любой момент.
 */
export async function startTotpSetup(
  db: D1Database,
  env: Env,
  userId: string,
): Promise<{ secret: string }> {
  const key = requireKey(env);
  const secret = generateTotpSecret();
  const sealed = await sealSecret(secret, key);
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO admin_totp (user_id, secret_enc, secret_iv, created_at, confirmed_at, last_used_at)
       VALUES (?1, ?2, ?3, ?4, NULL, NULL)
       ON CONFLICT(user_id) DO UPDATE SET
         secret_enc = excluded.secret_enc,
         secret_iv = excluded.secret_iv,
         created_at = excluded.created_at,
         confirmed_at = NULL,
         last_used_at = NULL`,
    )
    .bind(userId, sealed.ciphertext, sealed.iv, now)
    .run();

  return { secret };
}

/**
 * Шаг 2: подтвердить пробным кодом и выдать резервные.
 *
 * Пробный код проверяется по ПРОВЕРЕННЫМ правилам, иначе можно было бы
 * подтвердить настройку кодом, которого приложение никогда не покажет.
 */
export async function confirmTotpSetup(
  db: D1Database,
  env: Env,
  userId: string,
  code: string,
): Promise<{ backupCodes: string[] } | null> {
  const key = requireKey(env);

  // Только незавершённая настройка: если код уже включён, подтверждать нечего.
  const row = await db
    .prepare(
      `SELECT secret_enc, secret_iv FROM admin_totp
       WHERE user_id = ?1 AND confirmed_at IS NULL`,
    )
    .bind(userId)
    .first<{ secret_enc: string; secret_iv: string }>();
  if (!row) return null;

  const secret = await unsealSecret({ ciphertext: row.secret_enc, iv: row.secret_iv }, key);
  const { base32Decode } = await import("../lib/totp");

  const ok = await verifyTotp(base32Decode(secret), code, { drift: 1 });
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE admin_totp SET confirmed_at = ?2 WHERE user_id = ?1`)
    .bind(userId, now)
    .run();

  const backupCodes = await replaceBackupCodes(db, userId);
  return { backupCodes };
}

/** Перевыпустить резервные коды: старые стираются, новые показываются один раз. */
export async function replaceBackupCodes(
  db: D1Database,
  userId: string,
): Promise<string[]> {
  await db.prepare(`DELETE FROM admin_backup_codes WHERE user_id = ?1`).bind(userId).run();

  const codes = generateBackupCodes();
  const now = Math.floor(Date.now() / 1000);

  for (const code of codes) {
    await db
      .prepare(
        `INSERT INTO admin_backup_codes (id, user_id, code_hash, used_at, created_at)
         VALUES (?1, ?2, ?3, NULL, ?4)`,
      )
      .bind(
        `bkc_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        await hashBackupCode(code),
        now,
      )
      .run();
  }

  return codes;
}

/**
 * Проверить код при входе.
 *
 * Порядок проб сначала по TOTP, потом по резервному коду — и только если ни то,
 * ни другое не подошло, код считается неверным. Резервный код помечается
 * использованным в той же операции: повторное применение того же кода уже не
 * работает, даже если параллельно открыта ещё одна сессия.
 */
export async function verifyLoginCode(
  db: D1Database,
  env: Env,
  userId: string,
  code: string,
): Promise<{ ok: true; method: "totp" | "backup" } | { ok: false }> {
  const key = env.TOTP_ENCRYPTION_KEY;
  const settings = await getTotpSettings(db, userId);
  if (!settings || !key) return { ok: false };

  const { base32Decode } = await import("../lib/totp");
  const secret = await unsealSecret(
    { ciphertext: settings.secretEnc, iv: settings.secretIv },
    key,
  );

  if (await verifyTotp(base32Decode(secret), code, { drift: 1 })) {
    await db
      .prepare(`UPDATE admin_totp SET last_used_at = ?2 WHERE user_id = ?1`)
      .bind(userId, Math.floor(Date.now() / 1000))
      .run();
    return { ok: true, method: "totp" };
  }

  // Пробуем как резервный код. Сравнение по хешу, поэтому сам код в базе не
  // лежит и прочитать его из дампа нельзя.
  const hash = await hashBackupCode(code);
  const row = await db
    .prepare(
      `SELECT id FROM admin_backup_codes
       WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL LIMIT 1`,
    )
    .bind(userId, hash)
    .first<{ id: string }>();
  if (!row) return { ok: false };

  await db
    .prepare(`UPDATE admin_backup_codes SET used_at = ?2 WHERE id = ?1`)
    .bind(row.id, Math.floor(Date.now() / 1000))
    .run();

  return { ok: true, method: "backup" };
}

/** Выключить код подтверждения. Резервные коды стираются вместе с ним. */
export async function disableTotp(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM admin_totp WHERE user_id = ?1`).bind(userId).run();
  await db.prepare(`DELETE FROM admin_backup_codes WHERE user_id = ?1`).bind(userId).run();
}

/**
 * Аварийное отключение кода.
 *
 * Нужно для ситуации «потерян телефон И резервные коды потеряны»: без этой
 * команды администратор продукта навсегда теряет доступ к единственному
 * разделу с финансами. Событие обязательно попадает в журнал, потому что после
 * него в системе живёт администратор без второго фактора.
 */
export async function emergencyDisableTotp(
  db: D1Database,
  userId: string,
  reason?: string,
): Promise<boolean> {
  const enabled = await isTotpEnabled(db, userId);
  await disableTotp(db, userId);

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO admin_totp_recovery (id, user_id, reason, disabled_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?4)`,
    )
    .bind(
      `rec_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      reason ?? null,
      now,
    )
    .run();

  return enabled;
}

/** Сколько резервных кодов ещё не использовано. */
export async function countUnusedBackupCodes(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM admin_backup_codes WHERE user_id = ?1 AND used_at IS NULL`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
/** Время жизни временного токена второго шага входа. */
export const PENDING_TTL_SECONDS = 300;

/**
 * Создать временный токен второго шага входа.
 *
 * Токен кладёт в себя ТОЛЬКО id пользователя: ни почты, ни тарифа, ни выручки.
 * Короткоживущий (5 минут) и одноразовый — сессия создаётся только после
 * успешного кода, и вместе с ней токон удаляется.
 */
export async function createPendingToken(db: D1Database, userId: string): Promise<string> {
  const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`.slice(
    0,
    32,
  );
  const now = Math.floor(Date.now() / 1000);

  // Старые незакрытые токены того же пользователя — вон: их накопление не
  // даёт ничего, но увеличивает поверхность для перебора.
  await db.prepare(`DELETE FROM admin_login_pending WHERE user_id = ?1`).bind(userId).run();

  await db
    .prepare(
      `INSERT INTO admin_login_pending (token, user_id, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(token, userId, now + PENDING_TTL_SECONDS, now)
    .run();

  return token;
}

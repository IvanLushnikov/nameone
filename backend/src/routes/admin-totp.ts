/**
 * Код подтверждения администратора: настройка и вход (ТЗ-24 §8.1).
 *
 * ПОТОМУ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ В admin.ts
 * ----------------------------------------
 * Здесь две разные вещи: НАСТРОЙКА (требует сессии админа) и ПРОВЕРКА ПРИ
 * ВХОДЕ (сессии ещё нет — есть только «половина входа»). Если смешать их с
 * админ-эндпоинтами, проверка кода оказалась бы за сессией, а она по смыслу
 * должна быть ДО неё.
 *
 * ЧТО ЗАЩИЩАЕМ
 * -------------
 * Только вход администратора в `/superpower`. Учительский вход не трогаем
 * вообще: решение владельца, см. `docs/tz/23-password-auth.md`.
 */

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/ratelimit";
import { BadRequestError } from "../lib/errors";
import { getUserById } from "../db/queries";
import { FREE_TOTAL_GENERATIONS } from "../services/usage";
import { setSessionCookie, ADMIN_SESSION_MAX_AGE_SECONDS } from "../lib/session-cookie";
import {
  startTotpSetup,
  confirmTotpSetup,
  replaceBackupCodes,
  verifyLoginCode,
  disableTotp,
  isTotpEnabled,
  countUnusedBackupCodes,
} from "../services/admin-totp";
import { logLlmEvent } from "../llm/log";

const totpRouter = new Hono<AppEnv>();

/** Только администратор: настройка второго фактора — не учительская функция. */
function requireAdminUser(c: Parameters<typeof requireAuth>[0]) {
  const user = requireAuth(c);
  if (!user.isAdmin) {
    throw new BadRequestError("Код подтверждения настраивает только администратор");
  }
  return user;
}

/**
 * Перебор кодов: 10 попыток за 10 минут.
 *
 * Отдельный счётчик от пароля и отдельный ключ: одно не должно блокировать
 * другое. Шесть цифр перебираются мгновенно, поэтому лимит здесь жёстче, чем
 * кажется достаточным для «человек ошибся раз-другой».
 */
const codeRateLimit = rateLimitMiddleware({
  limit: 10,
  windowSec: 600,
  bucket: "totp-code",
});

// ─────────────────────────────────────────────────────────────────────────────
// Настройка (нужна сессия администратора)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/admin/totp — текущее состояние: включён ли, сколько кодов осталось. */
totpRouter.get("/totp", async (c) => {
  const admin = requireAdminUser(c);
  const enabled = await isTotpEnabled(c.env.DB, admin.id);
  return c.json({
    ok: true,
    enabled,
    // Количество, а не сами коды: коды показываются один раз — при выдаче.
    unusedBackupCodes: enabled ? await countUnusedBackupCodes(c.env.DB, admin.id) : 0,
    encryptionConfigured: Boolean(c.env.TOTP_ENCRYPTION_KEY),
  });
});

/**
 * POST /api/admin/totp/setup — шаг 1: создать секрет.
 *
 * Ответ содержит секрет в виде base32: его надо показать в виде QR-кода или
 * текстом, чтобы внести в приложение. Тот же приём у Google: человек вводит
 * ключ руками, если камера не справляется.
 */
totpRouter.post(
  "/totp/setup",
  rateLimitMiddleware({ limit: 10, windowSec: 600, bucket: "totp-setup" }),
  async (c) => {
    const admin = requireAdminUser(c);
    if (!c.env.TOTP_ENCRYPTION_KEY) {
      throw new BadRequestError(
        "На сервере не задан TOTP_ENCRYPTION_KEY — код подтверждения включить нельзя",
      );
    }
    const { secret } = await startTotpSetup(c.env.DB, c.env, admin.id);
    return c.json({
      ok: true,
      secret,
      // Что именно человек должен сделать дальше — одной цифры мало.
      next: "Внесите ключ в приложение-аутентификатор и подтвердите кодом из приложения",
    });
  },
);

/** POST /api/admin/totp/confirm — шаг 2: подтвердить пробным кодом, получить резервные. */
totpRouter.post("/totp/confirm", codeRateLimit, async (c) => {
  const admin = requireAdminUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { code?: string };
  const code = (body.code ?? "").trim();
  if (!code) throw new BadRequestError("Нужен код из приложения");

  const result = await confirmTotpSetup(c.env.DB, c.env, admin.id, code);
  if (!result) {
    return c.json(
      { ok: false, error: "Код не подошёл" },
      400,
    );
  }

  // Коды показываются ОДИН РАЗ. В базе их нет — только хеши.
  return c.json({
    ok: true,
    enabled: true,
    backupCodes: result.backupCodes,
    warning: "Сохраните эти коды. Они показываются один раз, а без них потерянный телефон означает потерю доступа.",
  });
});

/** POST /api/admin/totp/backup-codes — перевыпустить резервные коды. */
totpRouter.post("/totp/backup-codes", async (c) => {
  const admin = requireAdminUser(c);
  const enabled = await isTotpEnabled(c.env.DB, admin.id);
  if (!enabled) throw new BadRequestError("Код подтверждения ещё не включён");

  const backupCodes = await replaceBackupCodes(c.env.DB, admin.id);
  return c.json({
    ok: true,
    backupCodes,
    warning: "Старые коды больше не работают. Сохраните новые.",
  });
});

/** DELETE /api/admin/totp — выключить код подтверждения. */
totpRouter.delete("/totp", async (c) => {
  const admin = requireAdminUser(c);
  await disableTotp(c.env.DB, admin.id);
  logLlmEvent("warn", "superpower: код подтверждения выключен владельцем", {
    userId: admin.id,
  });
  return c.json({ ok: true, enabled: false });
});

// ─────────────────────────────────────────────────────────────────────────────
// Второй шаг входа (сессии ещё нет)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/totp/verify — второй шаг входа.
 *
 * Вызывается после того, как вход по паролю ИЛИ по ссылке из письма вернул
 * `mfaRequired` вместо сессии. Первый шаг к этому моменту уже прошёл, а
 * сессия — ещё нет: она создаётся только здесь, и только если код сошёлся.
 *
 * ЧТО БЫЛО НЕ ТАК (15.10.2026)
 * ----------------------------
 * Ручка возвращала токен сессии в теле ответа и НЕ ставила cookie. Фронт после
 * неё просто открывал кабинет — то есть вход администратора по паролю с кодом
 * подтверждения заканчивался без сессии. Это видно и в боевой базе: код
 * подтверждения включён 12.10, ни разу не использован, при этом живая сессия
 * есть — она была получена в обход, входом по ссылке.
 *
 * Теперь cookie ставится здесь же, и токен из тела ответа убран: сессионный
 * токен в JSON — это то, что может утечь через XSS или расширение браузера.
 */
totpRouter.post("/totp/verify", codeRateLimit, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    pendingToken?: string;
  };
  const code = (body.code ?? "").trim();
  const pendingToken = (body.pendingToken ?? "").trim();
  if (!code || !pendingToken) {
    throw new BadRequestError("Нужны код и временный токен второго шага");
  }

  // Временный токен: короткоживущий и одноразовый, выданный первым шагом.
  // Он держит в себе id пользователя, уже проверенного паролем или ссылкой, —
  // и НИЧЕГО больше: почту, тариф и любые данные туда класть нельзя.
  const pending = await decodePendingToken(c.env.DB, pendingToken);
  if (!pending) {
    return c.json({ ok: false, error: "Временный токен истёк, войдите заново" }, 401);
  }

  const result = await verifyLoginCode(c.env.DB, c.env, pending, code);
  if (!result.ok) {
    // Отвечаем одинаково на «не тот код» и «код не включён»: иначе по ответу
    // можно понять, включён ли второй фактор у конкретного аккаунта.
    return c.json({ ok: false, error: "Код не подошёл" }, 400);
  }

  await consumePendingToken(c.env.DB, pendingToken);
  const sessionToken = await createSession(c.env.DB, pending);
  // Сессия администратора кладётся в cookie здесь — иначе «вход с кодом»
  // заканчивается экраном кабинета без входа. Срок — сутки (ADMIN_SESSION_
  // MAX_AGE_SECONDS), он же в самой сессии.
  setSessionCookie(c, sessionToken, ADMIN_SESSION_MAX_AGE_SECONDS);

  logLlmEvent("info", "superpower: вход с кодом подтверждения", {
    userId: pending,
    method: result.method,
  });

  // Тело пользователя нужно фронту, чтобы обновить профиль после входа —
  // иначе в шапке остаётся имя из прошлой сессии.
  const user = await getUserById(c.env.DB, pending);

  return c.json({
    ok: true,
    method: result.method,
    // Токен намеренно НЕ возвращается: сессия живёт в HttpOnly-cookie.
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          plan: user.plan,
          generationsTotal: user.generations_total,
          generationsToday: user.generations_today,
          // Жёсткое `3` расходилось с настоящей квотой в 5 листов.
          generationsLimit: user.plan === "free" ? FREE_TOTAL_GENERATIONS : -1,
          createdAt: new Date(user.created_at * 1000).toISOString(),
        }
      : null,
  });
});

interface PendingRow {
  user_id: string;
}

async function decodePendingToken(db: D1Database, token: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT user_id FROM admin_login_pending
       WHERE token = ?1 AND expires_at > ?2`,
    )
    .bind(token, Math.floor(Date.now() / 1000))
    .first<PendingRow>();
  return row?.user_id ?? null;
}

async function consumePendingToken(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM admin_login_pending WHERE token = ?1`).bind(token).run();
}

/** Создать сессию — тем же способом, что и обычный вход. */
async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`.slice(
    0,
    32,
  );
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`,
    )
    // Сессия суперадминки — сутки (решение владельца), а не 30 дней как у учителя.
    .bind(token, userId, now + 24 * 3600, now)
    .run();
  return token;
}

export { totpRouter };
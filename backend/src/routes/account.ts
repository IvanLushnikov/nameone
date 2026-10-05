/**
 * /api/account/* — настройки профиля учителя, «Мои классы», сессии, смена почты
 * (ТЗ-21, блок 5).
 *
 *   GET    /api/account/profile              — профиль: имя, почта, классы
 *   PATCH  /api/account/profile              — { name?, classes? }
 *   POST   /api/account/email-change        — { newEmail } → письмо на новый адрес
 *   POST   /api/account/email-change/confirm— { token } из письма
 *   POST   /api/account/email-change/cancel — отклонить незавершённый запрос
 *   GET    /api/account/sessions             — активные устройства
 *   DELETE /api/account/sessions/:id         — завершить одну сессию
 *   DELETE /api/account/sessions             — завершить все, кроме текущей
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * АНОНИМ. ЗАЧЕМ ЭТОТ РОУТЕР, ЕСЛИ ВХОДА НЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Вход отключён флагом `MAGIC_LINK_READY` (домен не куплен) — это НЕ блокер
 * работ. Входной код для всего этого эндпоинта пишется и проверяется сейчас,
 * а фронт (`src/lib/lk/profile-api.ts`) отдаёт учителю то же самое локально:
 * классы, имя и фильтр работают без аккаунта. Эти эндпоинты — усилитель
 * (перенос между устройствами, подтверждение почты), а не условие
 * использования настроек. Ответ 401 здесь означает «нет сервера», а не
 * «у тебя нет прав на собственные классы».
 *
 * Сессия читается так же, как в `routes/billing.ts`: заголовок `X-Session-Token`
 * (для тестов и демо-входа) либо cookie `session` (обычный вход по письму).
 */

import { Hono, type Context } from "hono";
import { getSession, getUserById } from "../db/queries";
import {
  getAccountProfile,
  updateAccountName,
  setTeacherClasses,
  listAccountSessions,
  revokeAccountSession,
  revokeOtherSessions,
  createEmailChangeRequest,
  applyEmailChange,
  cancelEmailChange,
  isValidEmail,
  MAX_CLASSES_PER_REQUEST,
} from "../services/account";
import { sendEmailChangeEmail } from "../services/email";
import { magicLinkToken, shortId } from "../lib/shortid";
import { BadRequestError, NotFoundError, ConflictError, UnauthorizedError } from "../lib/errors";
import type { AppEnv } from "../types";

const accountRouter = new Hono<AppEnv>();

/* ────────────────────────────────────────────────────────────────────────────
 * Сессия
 * ──────────────────────────────────────────────────────────────────────────── */

/** Токен текущей сессии: заголовок (тесты/демо) или cookie `session`. */
function currentSessionToken(c: Context<AppEnv>): string | undefined {
  const header = c.req.header("x-session-token") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (header) return header;
  const cookie = c.req.header("cookie");
  if (!cookie) return undefined;
  return /session=([^;]+)/.exec(cookie)?.[1];
}

async function requireUserId(c: Context<AppEnv>): Promise<{ userId: string; token?: string }> {
  const token = currentSessionToken(c);
  if (!token) throw new UnauthorizedError("Missing session token");
  const session = await getSession(c.env.DB, token);
  if (!session) throw new UnauthorizedError("Invalid or expired session");
  const user = await getUserById(c.env.DB, session.user_id);
  if (!user) throw new UnauthorizedError("User not found");
  return { userId: user.id, token };
}

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return (raw ?? {}) as Record<string, unknown>;
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Профиль
 * ──────────────────────────────────────────────────────────────────────────── */

accountRouter.get("/profile", async (c) => {
  const { userId } = await requireUserId(c);
  const profile = await getAccountProfile(c.env.DB, userId);
  if (!profile) throw new NotFoundError("User not found");
  return c.json({ ok: true, profile });
});

/**
 * PATCH /profile — имя и/или классы.
 *
 * Частичное обновление: приходят только те поля, которые учитель правда менял.
 * Одно поле name, одно поле classes — оба в одном теле, потому что интерфейс
 * сохраняет форму целиком и отдельный запрос на «Сохранить» в каждой секции
 * добавил бы учителю лишний шаг без пользы.
 *
 * Почту здесь поменять НЕЛЬЗЯ: она меняется только через подтверждение на
 * новом адресе (`/email-change`). Молчаливая смена почты в профиле — это и
 * способ захватить чужой аккаунт, и «учитель забыл пароль» (а пароля нет).
 */
accountRouter.patch("/profile", async (c) => {
  const { userId } = await requireUserId(c);
  const body = await readJson(c);

  let name: string | undefined;
  if (body.name !== undefined) {
    const result = await updateAccountName(c.env.DB, userId, String(body.name));
    if (!result.ok) throw new BadRequestError("Имя не может быть пустым");
    name = result.value;
  }

  let classes: string[] | undefined;
  if (body.classes !== undefined) {
    if (!Array.isArray(body.classes)) throw new BadRequestError("classes должен быть списком");
    if (body.classes.length > MAX_CLASSES_PER_REQUEST) {
      throw new BadRequestError("Слишком много классов за один раз");
    }
    const result = await setTeacherClasses(c.env.DB, userId, body.classes);
    if (!result.ok) throw new BadRequestError("Не удалось сохранить классы");
    classes = result.value;
  }

  if (name === undefined && classes === undefined) {
    throw new BadRequestError("Нечего сохранять: передайте name или classes");
  }

  const profile = await getAccountProfile(c.env.DB, userId);
  if (!profile) throw new NotFoundError("User not found");
  return c.json({ ok: true, profile });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Смена почты — только через подтверждение на новом адресе
 * ──────────────────────────────────────────────────────────────────────────── */

accountRouter.post("/email-change", async (c) => {
  const { userId } = await requireUserId(c);
  const body = await readJson(c);
  const newEmail = typeof body.newEmail === "string" ? body.newEmail : "";
  if (!isValidEmail(newEmail)) {
    throw new BadRequestError("Похоже, это не почтовый адрес");
  }

  const profile = await getAccountProfile(c.env.DB, userId);
  if (profile && newEmail.trim().toLowerCase() === profile.email.toLowerCase()) {
    throw new BadRequestError("Это уже текущая почта");
  }

  // Токен подтверждения — тот же генератор, что у magic-link (32 символа).
  const request = await createEmailChangeRequest(c.env.DB, {
    userId,
    newEmail,
    id: `ecr_${shortId()}`,
    token: magicLinkToken(),
  });
  if (!request.ok) {
    if (request.code === "conflict") {
      throw new ConflictError("На этот адрес уже есть аккаунт");
    }
    if (request.code === "not_found") throw new NotFoundError("User not found");
    throw new BadRequestError("Похоже, это не почтовый адрес");
  }

  // Ссылка ведёт на страницу настроек: там учитель жмёт «Подтвердить». Отдельная
  // страница не нужна — подтверждение и есть часть настроек почты.
  const base = (c.env.APP_PUBLIC_URL ?? (c.env.FRONTEND_URL ?? "").split(",")[0] ?? "").replace(/\/+$/, "");
  const confirmUrl = `${base}/dashboard/settings?email_confirm=${request.value.id}`;

  const mail = await sendEmailChangeEmail(c.env, request.value.newEmail, confirmUrl);

  if (!mail.sent) {
    // Запрос удаляем: оставлять «ожидающее подтверждение» письма, которого не
    // было, — ровно та ложь, которой этот флоу и призван не быть.
    await cancelEmailChange(c.env.DB, userId);
    // 503 + явный код: фронт покажет честный текст, а не «письмо отправлено».
    return c.json(
      {
        ok: false,
        code: "EMAIL_DELIVERY_UNAVAILABLE",
        error:
          mail.reason === "not_configured"
            ? "Почта не настроена: письмо с подтверждением отправить нечем"
            : "Почтовый сервис не принял письмо",
      },
      503,
    );
  }

  return c.json({ ok: true, expiresAt: request.value.expiresAt, newEmail: request.value.newEmail });
});

/**
 * POST /email-change/confirm — подтверждение по id запроса, который пришёл в
 * ссылке из письма.
 *
 * Токен из письма не передаём: он уже в таблице, а ссылка приходит на НОВЫЙ
 * адрес. Достаточно id запроса + сессии учителя — посторонний, получивший
 * ссылку, не сможет подтвердить смену без входа в тот же аккаунт.
 */
accountRouter.post("/email-change/confirm", async (c) => {
  const { userId } = await requireUserId(c);
  const body = await readJson(c);
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) throw new BadRequestError("Нет идентификатора запроса");

  const profile = await getAccountProfile(c.env.DB, userId);
  if (!profile?.pendingEmailChange) {
    throw new NotFoundError("Запрос на смену почты не найден или уже истёк");
  }

  const token = await dbTokenForRequest(c.env.DB, id, userId);
  if (!token) throw new NotFoundError("Запрос на смену почты не найден или уже истёк");

  const applied = await applyEmailChange(c.env.DB, token);
  if (!applied.ok) {
    if (applied.code === "conflict") throw new ConflictError("На этот адрес уже есть аккаунт");
    throw new NotFoundError("Ссылка недействительна или истекла");
  }
  return c.json({ ok: true, email: applied.value.email });
});

accountRouter.post("/email-change/cancel", async (c) => {
  const { userId } = await requireUserId(c);
  await cancelEmailChange(c.env.DB, userId);
  return c.json({ ok: true });
});

/** Токен подтверждения по id запроса — только для своего, живого запроса. */
async function dbTokenForRequest(
  db: D1Database,
  id: string,
  userId: string,
): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT token FROM email_change_requests
       WHERE id = ?1 AND user_id = ?2 AND status = 'pending' AND expires_at > ?3`,
    )
    .bind(id, userId, now)
    .first<{ token: string }>();
  return row?.token ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Сессии
 * ──────────────────────────────────────────────────────────────────────────── */

accountRouter.get("/sessions", async (c) => {
  const { userId, token } = await requireUserId(c);
  const sessions = await listAccountSessions(c.env.DB, userId, token);
  return c.json({ ok: true, sessions });
});

accountRouter.delete("/sessions/:id", async (c) => {
  const { userId } = await requireUserId(c);
  const id = c.req.param("id");
  if (!id) throw new BadRequestError("Нет идентификатора сессии");
  const result = await revokeAccountSession(c.env.DB, userId, id);
  if (!result.ok) throw new NotFoundError("Сессия не найдена");
  return c.json({ ok: true });
});

accountRouter.delete("/sessions", async (c) => {
  const { userId, token } = await requireUserId(c);
  const revoked = await revokeOtherSessions(c.env.DB, userId, token);
  return c.json({ ok: true, revoked });
});

export { accountRouter };

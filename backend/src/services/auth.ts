/**
 * Magic-link бизнес-логика (T3: auth).
 *
 * Тонкий слой над db/queries.ts (user/session/magic-link) + email-сервисом.
 * Никакого HTTP, никаких Hono-контекстов — чтобы:
 *   * Легко тестировать без mock'а request/response.
 *   * Можно было вызвать из cron-job (TT6: рассылка magic-link руками).
 */

import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import type { Env } from "../env";
import type { UserRow } from "../db/queries";
import {
  consumeMagicLink,
  createMagicLink,
  createSession,
  createUser,
  getUserByEmail,
} from "../db/queries";
import { userId, magicLinkToken, sessionToken } from "../lib/shortid";
import { sendMagicLinkEmail } from "./email";
import { EmailDeliveryError } from "../lib/errors";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60; // 15 минут
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 дней

/**
 * Текст, который видит учитель, когда письмо не ушло.
 *
 * ОДИН на все причины — намеренно (12.10.2026):
 *   * он не должен отличаться для существующего и несуществующего адреса —
 *     иначе ручка входа становится способом проверить, зарегистрирован ли
 *     конкретный email;
 *   * он не должен отличаться для «нет ключа» и «Resend отверг» — состояние
 *     нашей конфигурации клиенту не показываем. Причина всегда в логе.
 *
 * Формулировка отвечает на вопрос учителя «почему я сижу и жду письмо»:
 * виноваты мы, это временно, повторять можно. Раньше здесь был 500 с
 * кодом `INTERNAL`, который выглядел как баг и на экране не показывался.
 */
const MAIL_UNAVAILABLE_MESSAGE =
  "Не удалось отправить письмо для входа. Это временная проблема на нашей стороне — попробуйте ещё раз через пару минут.";

// zod-цепочка: сначала trim+lowercase (preprocess), потом email-валидация.
// Раньше было `.email().transform(trim)`, но trim тогда срабатывал ПОСЛЕ
// валидации — пробелы вокруг email'а отшивались как invalid email.
// На реальных UI пользователь легко вставляет email с пробелами из буфера обмена.
export const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.string().email().max(254),
);

/**
 * Разобрать ADMIN_EMAILS и ADMIN_EMAIL из env в Set email-ов.
 *
 * Используется для bootstrap: при первой регистрации пользователя, чей email
 * попал в этот список, ему выставляется is_admin=1. Дальше флаг живёт в БД
 * и может меняться через админку.
 *
 * Формат ADMIN_EMAILS — comma-separated (пробелы вокруг запятых игнорируются).
 * ADMIN_EMAIL — legacy single, оставлен для обратной совместимости.
 */
export function parseAdminEmails(env: Env): Set<string> {
  const set = new Set<string>();
  if (env.ADMIN_EMAILS) {
    for (const raw of env.ADMIN_EMAILS.split(",")) {
      const trimmed = raw.trim().toLowerCase();
      if (trimmed) set.add(trimmed);
    }
  }
  if (env.ADMIN_EMAIL) {
    set.add(env.ADMIN_EMAIL.trim().toLowerCase());
  }
  return set;
}

export interface RequestMagicLinkResult {
  ok: true;
  /** Сама операция прошла успешно. Email мог НЕ отправиться — см. token. */
  sent: boolean;
  /**
   * Только если RESEND_API_KEY отсутствует (dev) — содержит сгенерированный URL.
   * Позволяет разработчику не лезть в логи — фронт может его показать.
   * В прода не возвращается.
   */
  devMagicUrl?: string;
}

/**
 * Запросить magic-link для email. Находит или создаёт пользователя,
 * генерирует токен, пишет magic_link, отправляет email (или логирует).
 *
 * Никогда не раскрывает, существует ли такой email — это политика
 * безопасности против user-enumeration (см. /api/auth/magic-link handler).
 */
export async function requestMagicLink(
  db: D1Database,
  rawEmail: string,
  env: Env,
): Promise<RequestMagicLinkResult> {
  const email = emailSchema.parse(rawEmail);

  // ── Безопасность: fail-closed на неверной конфигурации ────────────────────
  // Если почта не настроена, отправить письмо нечем, и единственный честный
  // ответ — ошибка (503), а не «мы отправили письмо». Исключение одно и только
  // явное: ALLOW_DEV_MAGIC_URL=true, тогда ссылка возвращается в ответе вместо
  // письма (удобно для локальной разработки).
  // Опасные режимы включаются ТОЛЬКО явным флагом, а не отсутствием
  // какого-либо признака. Причина конкретная: 2 октября 2026 выяснилось, что
  // боевой воркер задеплоен с настройками разработки (APP_ENV=development,
  // FRONTEND_URL=http://localhost:3000). Проверка вида «в проде — не выдавать»
  // опиралась на APP_ENV, который на проде был неверным, и молча выключилась
  // бы вместе с защитой.
  //
  // Принцип: «выдать ссылку для входа» — привилегированное поведение,
  // поэтому включается только положительным ответом владельца
  // (ALLOW_DEV_MAGIC_URL=true). Нет флага — нет и выдачи, независимо от того,
  // что написано в APP_ENV, FRONTEND_URL или ещё где-либо.
  const devMagicAllowed = env.ALLOW_DEV_MAGIC_URL === "true";

  if (!env.RESEND_API_KEY && !devMagicAllowed) {
    logMailFailure({
      reason: "not_configured",
      email,
      hint: "RESEND_API_KEY не задан, ALLOW_DEV_MAGIC_URL не включён. Задать ключ: npx wrangler secret put RESEND_API_KEY --name rabochielisty-api",
    });
    throw new EmailDeliveryError(MAIL_UNAVAILABLE_MESSAGE);
  }

  // 1. user upsert (find-or-create).
  let user = await getUserByEmail(db, email);
  let createdHere = false;
  if (!user) {
    const id = userId();
    const adminEmails = parseAdminEmails(env);
    const isAdmin = adminEmails.has(email);
    await createUser(db, {
      id,
      email,
      name: deriveName(email),
      plan: "free",
      isAdmin,
    });
    createdHere = true;
    user = await getUserByEmail(db, email);
  }
  if (!user) {
    // Теоретически невозможно после успешного INSERT.
    throw new Error("user not found after upsert");
  }
  // Suppress lint — createdHere может понадобиться в будущем для телеметрии/аналитики.
  void createdHere;

  // 2. Сгенерировать токен и записать в magic_links.
  const token = magicLinkToken();
  await createMagicLink(db, { token, email, ttlSeconds: MAGIC_LINK_TTL_SECONDS });

  // 3. Собрать URL и попытаться отправить email.
  const url = buildMagicLinkUrl(env, token);
  const sendResult = await sendMagicLinkEmail(env, email, url);

  if (!sendResult.sent) {
    // Пишем в логи — это наш единственный шанс восстановить ссылку, если
    // Resend упал. В проде мониторинг должен алертить на такие записи.
    //
    // Причину пишем ПОЛНОСТЬЮ: «send failed» без текста от Resend бесполезно
    // при разборе, потому что отказов у провайдера три разных вида (неверный
    // ключ / не верифицирован домен / исчерпан лимит аккаунта) и лечатся они
    // по-разному.
    logMailFailure({
      reason: sendResult.reason ?? "provider_error",
      email,
      error: sendResult.error,
    });

    // Раньше здесь бросался InternalError → HTTP 500 с кодом `INTERNAL`.
    // Для учителя это был молчаливый обрыв («ничего не нажимается»), а для
    // мониторинга — неотличим от бага в коде. Теперь это 503 с понятным
    // кодом EMAIL_DELIVERY_FAILED и текстом, который объясняет ситуацию.
    //
    // Ничего не отправленный magic-link не восстановить: токен уже создан,
    // и без письма человек просто не войдёт. Поэтому «успех» здесь означал бы
    // прямую ложь на экране — честная ошибка правильнее.
    throw new EmailDeliveryError(MAIL_UNAVAILABLE_MESSAGE);
  }

  // Ссылка для входа уходит клиенту ТОЛЬКО при явном ALLOW_DEV_MAGIC_URL=true.
  // В остальных случаях ответ одинаковый — { ok, sent } — независимо от того,
  // есть ли ссылка под рукой.
  if (!devMagicAllowed || !sendResult.url) return { ok: true, sent: true };
  return { ok: true, sent: true, devMagicUrl: sendResult.url };
}

export interface ConsumeMagicLinkResult {
  user: UserRow;
  sessionToken: string;
  sessionExpiresAt: number;
}

/**
 * "Обменять" magic-link токен на session-токен.
 *
 * Атомарность: consumeMagicLink в db/queries.ts уже делает
 *   SELECT WHERE expires_at > now AND used_at IS NULL
 *   UPDATE SET used_at = now
 *   RETURNING email
 * Если токен уже использован или истёк — возвращаем null.
 */
export async function consumeMagicLinkAndCreateSession(
  db: D1Database,
  token: string,
): Promise<ConsumeMagicLinkResult | null> {
  const consumed = await consumeMagicLink(db, token);
  if (!consumed) return null;

  // user должен существовать (createUser выше). Иначе — race condition /
  // ручная очистка БД. Возвращаем null, чтобы роут ответил 401.
  const { getUserByEmail } = await import("../db/queries");
  const user = await getUserByEmail(db, consumed.email);
  if (!user) return null;

  const sessToken = sessionToken();
  await createSession(db, { token: sessToken, userId: user.id, ttlSeconds: SESSION_TTL_SECONDS });
  const sessionExpiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  return { user, sessionToken: sessToken, sessionExpiresAt };
}

function buildMagicLinkUrl(env: Env, token: string): string {
  // APP_PUBLIC_URL — один origin фронта, специально для ссылок, которые видит
  // человек. FRONTEND_URL в проде содержит список через запятую (он нужен CORS,
  // который список разбирает), и вставлять его целиком в ссылку нельзя:
  // получилось бы «https://a.ru,https://b.ru/auth/callback?token=…».
  // Fallback на первый элемент списка нужен только для старых конфигураций,
  // где APP_PUBLIC_URL ещё не задали.
  const raw = env.APP_PUBLIC_URL ?? env.FRONTEND_URL.split(",")[0] ?? "";
  const base = raw.trim().replace(/\/+$/, "");

  // Ссылка с localhost бесполезна учителю: письмо уйдёт, а открыть его будет
  // негде. На проде такая конфигурация означает, что воркер задеплоен из
  // секции [vars] вместо [env.production.vars]. Лучше явная ошибка в лог, чем
  // письмо с адресом, который не существует, — и чем обманчивое «мы отправили
  // ссылку, не работает».
  if (!base || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(base) || !/^https?:\/\//.test(base)) {
    // eslint-disable-next-line no-console
    console.error(
      `[auth] КРИТИЧНО: не удалось собрать ссылку для входа (APP_PUBLIC_URL="${env.APP_PUBLIC_URL ?? "—"}", ` +
        `FRONTEND_URL="${env.FRONTEND_URL ?? "—"}"). Похоже, воркер задеплоен с настройками разработки. ` +
        `Укажите APP_PUBLIC_URL в [env.production.vars], например "https://<домен>".`,
    );
    // Для учителя это то же самое, что «письмо не ушло»: он не сможет войти.
    // Раньше уходил InternalError → 500 `INTERNAL`, то есть та же самая
    // невнятная точка отказа. Отличается только текст в логе выше.
    throw new EmailDeliveryError(MAIL_UNAVAILABLE_MESSAGE);
  }

  return `${base}/auth/callback?token=${token}`;
}

/**
 * Единая запись об отказе почты.
 *
 * Пишется ОДИН раз на любой отказ и всегда одним объектом: метка времени,
 * адрес (без него разбор «кому не дошло письмо» невозможен), машиночитаемый
 * `reason` и текст ошибки провайдера. По `reason` записи считаются в
 * мониторинге — разные причины требуют разных действий владельца:
 *   not_configured — задать RESEND_API_KEY;
 *   provider_error — ключ есть, отказ у Resend (смотреть его текст).
 */
function logMailFailure(entry: { reason: string; email: string; error?: string; hint?: string }): void {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "magic-link email not sent",
      ...entry,
    }),
  );
}

function deriveName(email: string): string {
  // До @ — fallback-имя. Локальная часть email часто человекочитаема.
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  // Заменяем недружественные символы на точку-разделитель, trim.
  const cleaned = local.replace(/[._+-]+/g, " ").trim();
  return cleaned || email;
}

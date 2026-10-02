/**
 * /api/users/* — личный кабинет: профиль, история, избранное, шаблоны, подписка.
 *
 *   GET  /api/users/me             — текущий пользователь (полные поля из БД)
 *   GET  /api/users/usage          — счётчик генераций для UI (light payload)
 *   GET  /api/users/history        — последние worksheets пользователя
 *   GET  /api/users/favorites      — избранные листы
 *   POST /api/users/favorites      — добавить в избранное
 *   DELETE /api/users/favorites/:id — убрать из избранного
 *   GET  /api/users/templates      — шаблоны пользователя
 *   POST /api/users/templates      — создать шаблон
 *   DELETE /api/users/templates/:id — удалить шаблон
 *   GET  /api/users/subscription   — текущая активная подписка
 *
 * Все routes требуют user (auth-middleware ставит c.get('user')).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv } from "../types";
import { requireAuth as _requireAuth } from "../middleware/auth";
void _requireAuth;
import { UnauthorizedError, BadRequestError, NotFoundError } from "../lib/errors";
import { getUserById, incrementUserGenerations } from "../db/queries";
import {
  getUsageStatus,
  checkFreeQuota,
  tokensToWorksheets,
  FREE_TOTAL_GENERATIONS,
} from "../services/usage";
import {
  fingerprintHash,
  recordVisit,
  decideFraud,
  generationsInLastHour,
  type CfObject,
} from "../lib/antifraud";
import {
  addFavorite,
  createTemplate,
  deleteTemplate,
  getActiveSubscription,
  getRecentWorksheets,
  listFavorites,
  listTemplates,
  removeFavorite,
} from "../db/userResources";
import type { Worksheet, UserTemplate } from "../types";

const usersRouter = new Hono<AppEnv>();

/**
 * Требуется ли капча — БЕЗ блокировки.
 *
 * Отдельная мягкая проверка для /usage: она ничего не бросает и ничего не
 * меняет, а только отвечает фронту «показать виджет заранее», чтобы генерация
 * не упиралась в 409 TURNSTILE_REQUIRED на середине. Сам 409 ставит
 * `guardGeneration` на пути генерации.
 */
async function evaluateChallenge(
  db: D1Database,
  input: {
    userId: string | null;
    ip: string;
    userAgent: string;
    cf?: CfObject;
    salt: string;
  },
): Promise<{ requiresChallenge: boolean; reason: string }> {
  // Секрета Turnstile нет → капчу нечем проверять. Лучше не просить её вовсе,
  // чем отрезать учителя из-за ненастроенного стороннего сервиса.
  const fingerprint = await fingerprintHash(
    { ip: input.ip, userAgent: input.userAgent, cf: input.cf },
    input.salt,
  );
  const signals = await recordVisit(db, fingerprint, input.userId, input.cf);
  const burst = await generationsInLastHour(db, fingerprint);
  const verdict = decideFraud(signals, { cf: input.cf, burstGenerationsInHour: burst });
  return { requiresChallenge: verdict.decision === "challenge", reason: verdict.reason };
}

// Helper — throws Unauthorized если нет user
function userOr401(c: import("hono").Context<AppEnv>) {
  const user = c.get("user");
  if (!user) throw new UnauthorizedError("Требуется вход в аккаунт");
  return user;
}

usersRouter.get("/me", async (c) => {
  const auth = userOr401(c);
  const user = await getUserById(c.env.DB, auth.id);
  if (!user) throw new NotFoundError("User not found");
  return c.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      generationsTotal: user.generations_total,
      generationsToday: user.generations_today,
      generationsLimit: user.plan === "plus" || user.plan === "base" ? -1 : 3,
      createdAt: new Date(user.created_at * 1000).toISOString(),
    },
  });
});

usersRouter.get("/history", async (c) => {
  const auth = userOr401(c);
  const url = new URL(c.req.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "20")));
  const cursor = url.searchParams.get("cursor");
  const cursorNum = cursor ? Math.floor(new Date(cursor).getTime() / 1000) : undefined;

  const result = await getRecentWorksheets(c.env.DB, auth.id, limit, cursorNum);
  return c.json({
    ok: true,
    items: result.items.map((it) => ({
      id: it.id,
      type: "worksheet" as const,
      title: it.title ?? it.topic,
      subject: it.subject,
      grade: it.grade,
      createdAt: it.createdAt,
      isFavorite: false,
    })),
    nextCursor: result.nextCursor,
  });
});

usersRouter.get("/favorites", async (c) => {
  const auth = userOr401(c);
  const result = await listFavorites(c.env.DB, auth.id);
  return c.json({ ok: true, items: result.items, nextCursor: result.nextCursor });
});

usersRouter.post("/favorites", async (c) => {
  const auth = userOr401(c);
  let body: { worksheet: Worksheet };
  try {
    body = (await c.req.json()) as { worksheet: Worksheet };
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  if (!body.worksheet) throw new BadRequestError("Missing worksheet");

  const result = await addFavorite(c.env.DB, auth.id, body.worksheet);
  return c.json({ ok: true, ...result });
});

usersRouter.delete("/favorites/:id", async (c) => {
  const auth = userOr401(c);
  const id = c.req.param("id");
  const removed = await removeFavorite(c.env.DB, auth.id, id);
  if (!removed) throw new NotFoundError("Favorite not found");
  return c.json({ ok: true });
});

usersRouter.get("/templates", async (c) => {
  const auth = userOr401(c);
  const templates = await listTemplates(c.env.DB, auth.id);
  return c.json({ ok: true, templates });
});

const templateSchema = z.object({
  name: z.string().min(1).max(80),
  subject: z.string().min(1),
  grade: z.number().int().min(1).max(11),
  topic: z.string().min(1).max(200),
  difficulty: z.enum(["easy", "medium", "hard"]),
  count: z.number().int().min(1).max(50),
});

usersRouter.post("/templates", async (c) => {
  const auth = userOr401(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const parsed = templateSchema.parse(body);
  const template: UserTemplate = {
    ...parsed,
    subject: parsed.subject as UserTemplate["subject"],
  };
  const created = await createTemplate(c.env.DB, auth.id, template);
  return c.json({ ok: true, template: created });
});

usersRouter.delete("/templates/:id", async (c) => {
  const auth = userOr401(c);
  const id = c.req.param("id");
  const removed = await deleteTemplate(c.env.DB, auth.id, id);
  if (!removed) throw new NotFoundError("Template not found");
  return c.json({ ok: true });
});

usersRouter.get("/subscription", async (c) => {
  const auth = userOr401(c);
  const sub = await getActiveSubscription(c.env.DB, auth.id);
  if (!sub) return c.json({ ok: true, subscription: null });
  return c.json({ ok: true, subscription: sub });
});

/**
 * Light-payload endpoint для UI счётчика потребления.
 *
 * В отличие от /me (который возвращает полный профиль) — здесь только то,
 * что нужно фронту для рендера остатка. Удобно дёргать часто (на каждый
 * action после генерации) без переплаты за JSON-байты.
 *
 * ЧТО ЗДЕСЬ И ЧЕГО НЕТ.
 *   norm / weightedTokensUsed / over — норма тарифа в ВЗВЕШЕННЫХ ТОКЕНАХ
 *     (services/usage.ts). `over: true` означает «норма превышена», но НЕ
 *     «генерация заблокирована»: порог мягкий, UI на этом флаге показывает
 *     предложение докупить, а не отказ.
 *   generationsLimit — остаток бесплатной квоты (3 генерации всего).
 *     null у платных тарифов, потому что там квота не в штуках.
 *   requiresChallenge — попросить ли невидимый Turnstile. Фронт грузит виджет
 *     ТОЛЬКО в этом случае, так что обычный пользователь не грузит ни одного
 *     стороннего скрипта.
 *
 * Старые поля (generationsToday, generationsResetAt) сохранены: их читает
 * текущий UI, и выкидывать их без нужды — значит сломать профиль раньше,
 * чем фронт переедет на новую схему.
 */
usersRouter.get("/usage", async (c) => {
  const auth = userOr401(c);
  const user = await getUserById(c.env.DB, auth.id);
  if (!user) throw new NotFoundError("User not found");

  const plan = user.plan as "free" | "base" | "plus";
  const status = await getUsageStatus(c.env.DB, user.id, plan);

  // Бесплатная квота — в штуках генераций, а не в токенах.
  let freeRemaining: number | null = null;
  if (plan === "free") {
    const quota = await checkFreeQuota(c.env.DB, user.id);
    freeRemaining = quota.remaining;
  }

  // Требуется ли капча: считаем отпечаток, смотрим сигналы. Проверка здесь
  // ничего не блокирует — она лишь заранее говорит фронту, показать ли виджет,
  // чтобы генерация не упиралась в 409 на середине.
  const verdict = await evaluateChallenge(c.env.DB, {
    userId: user.id,
    ip: c.get("ip") ?? "0.0.0.0",
    userAgent: c.get("userAgent") ?? "",
    cf: (c.req.raw as Request & { cf?: CfObject }).cf,
    salt: c.env.FINGERPRINT_SALT ?? "dev-fingerprint-salt",
  });

  return c.json({
    ok: true,
    // ── новое: норма в токенах ──
    plan,
    norm: status.norm,
    weightedTokensUsed: status.used,
    over: status.over,
    remaining: status.remaining,
    periodEndsAt: status.window.windowEndsAt
      ? new Date(status.window.windowEndsAt * 1000).toISOString()
      : null,
    // Сколько это в понятных учителю листах. Токены сами по себе абстрактны,
    // а «≈ 80 листов» читается сразу — см. риск 1 в docs/04-pricing-economics-v2.md.
    worksheetsEquivalent: tokensToWorksheets(status.used),
    freeRemaining,
    requiresChallenge: verdict.requiresChallenge,
    // ── старое, оставлено для совместимости текущего UI ──
    generationsToday: user.generations_today,
    generationsLimit: plan === "free" ? FREE_TOTAL_GENERATIONS : -1,
    generationsResetAt:
      user.generations_reset_at != null
        ? new Date(user.generations_reset_at * 1000).toISOString()
        : null,
  });
});

// Suppress lint — incrementUserGenerations не используется пока, оставлен для будущего
void incrementUserGenerations;

export { usersRouter };

/**
 * /api/users/* — личный кабинет: профиль, история, избранное, шаблоны, подписка.
 *
 *   GET  /api/users/me             — текущий пользователь (полные поля из БД)
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
import type { AppEnv } from "../types";
import { requireAuth as _requireAuth } from "../middleware/auth";
void _requireAuth;
import { UnauthorizedError, BadRequestError, NotFoundError } from "../lib/errors";
import { getUserById, incrementUserGenerations } from "../db/queries";
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

// Suppress lint — incrementUserGenerations не используется пока, оставлен для будущего
void incrementUserGenerations;

export { usersRouter };

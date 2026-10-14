/**
 * Материалы: генерация комплекта и авторские публикации учителей.
 *
 * ═══ 1. ГЕНЕРАЦИЯ КОМПЛЕКТА (было и осталось) ═══════════════════════════════
 *   POST /api/materials/generate
 *
 * Клиент (`src/lib/client/llm.ts`) ждёт:
 *   { ok: true, materialBundle: MaterialBundle, meta: {...}, usage: {...} }
 *
 * Форма `MaterialBundleContent` совпадает с тем, что фронт кладёт в ZIP: файлы
 * со `kind` и `format` из `MaterialFile`. Как и карточки, комплект фронт через
 * `/api/worksheets/save` НЕ сохраняет — он живёт в браузере учителя.
 *
 * Тариф: доступен всем (материалы идут задачей worksheet-gen — это дешёвый
 * класс документа, отдельной GenerationKind для них нет; см. ARTIFACT_TASK).
 *
 * ═══ 2. АВТОРСКИЕ ПУБЛИКАЦИИ (лист 5.1.1) ═════════════════════════════════
 *   Открытый банк (БЕЗ входа — как и сам каталог `/materials`):
 *     GET    /api/materials/user              — опубликованные материалы
 *     GET    /api/materials/user/:id          — один опубликованный
 *     POST   /api/materials/user/:id/download — отметить скачивание
 *
 *   Учитель (с входом):
 *     GET    /api/materials/user/mine         — мои материалы со статусами
 *     POST   /api/materials/user              — сдать на публикацию
 *     PATCH  /api/materials/user/:id          — поправить своё (не опубликованное)
 *     POST   /api/materials/user/:id/withdraw — снять своё с публикации
 *     DELETE /api/materials/user/:id          — удалить своё (не опубликованное)
 *
 *   Владелец (модерация, ручной проход):
 *     GET    /api/materials/moderation/queue           — что ждёт решения
 *     POST   /api/materials/moderation/:id/approve     — опубликовать
 *     POST   /api/materials/moderation/:id/reject      — отклонить с причиной
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ, РАДИ ЧЕГО ЭТОТ ФАЙЛ СУЩЕСТВУЕТ: МАТЕРИАЛ НЕ ПОЯВЛЯЕТСЯ СРАЗУ ────
 * Материал учителя — это чужая работа, которую увидят другие. Поэтому путь
 * строго трёхшаговый: сдал → `pending` (никто не видит) → человек посмотрел →
 * `published`. Автопубликации нет, и «код решил, что нормально» здесь быть не
 * может: решение принимает владелец лично.
 *
 * Первая версия модерации — РУЧНОЙ ПРОХОД ВЛАДЕЛЬЦЕМ, и это осознанно:
 *   * очередь маленькая, смотреть некому и некогда;
 *   * автоматический фильтр по словам отсекал бы нормальные работы и пропускал
 *     мусор — то есть врал бы в обе стороны;
 *   * у учителя перед глазами живой человек, а не «алгоритм запретил».
 * Что делаем, когда очередь перестанет помещаться в один вечер, — отдельный
 * лист; здесь же лежит только очередь и честный отказ с причиной.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЩИТА ЧУЖОГО — ГДЕ ИМЕННО ────────────────────────────────────────────────
 * Правило владения живёт в `db/materials.ts`, а не здесь: каждый UPDATE и
 * DELETE отдаёт `WHERE id = ? AND user_id = ?`, а владелец проверяется ДО
 * чтения содержимого. В этом файле задача простая — взять `user.id` из
 * сессии и НИКОГДА не брать идентификатор учителя из тела запроса.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { generateMaterials } from "../llm";
import {
  ArtifactEnvelope,
  assertArtifactAllowed,
  consumeFreeQuota,
  prepareArtifactGeneration,
} from "./artifact-generate";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/ratelimit";
import { throwApiError } from "../lib/errors";
import {
  MAX_REJECT_REASON,
  MAX_USER_MATERIALS_PER_TEACHER,
  MAX_USER_MATERIALS_PUBLIC_LIST,
  approveUserMaterial,
  deleteOwnUserMaterial,
  getPublishedUserMaterial,
  listModerationQueue,
  listOwnUserMaterials,
  listPublishedUserMaterials,
  recordUserMaterialDownload,
  rejectUserMaterial,
  submitUserMaterial,
  updateOwnUserMaterial,
  withdrawOwnUserMaterial,
  type UserMaterialContent,
  type UserMaterialInput,
  type UserMaterialResult,
  type UserMaterialRow,
} from "../db/materials";

export const materialsRouter = new Hono<AppEnv>();

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. ГЕНЕРАЦИЯ КОМПЛЕКТА
 * ═══════════════════════════════════════════════════════════════════════════ */

materialsRouter.post("/generate", async (c) => {
  assertArtifactAllowed(c, "materials");

  const prepared = await prepareArtifactGeneration(c, ArtifactEnvelope);

  const result = await generateMaterials(
    {
      request: prepared.request,
      plan: prepared.plan,
      bypassCache: prepared.bypassCache,
      userId: prepared.userId,
      ip: prepared.ip,
    },
    c.env,
    c.env.DB,
  );

  await consumeFreeQuota(c, prepared);

  return c.json({
    ok: true as const,
    materialBundle: result.artifact,
    meta: result.meta,
    usage: result.usage,
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. АВТОРСКИЕ ПУБЛИКАЦИИ — общий банк (без входа)
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Тело материала. Битый JSON не роняет страницу: отдаём пустой список. */
function readContent(row: UserMaterialRow): UserMaterialContent {
  try {
    const parsed = JSON.parse(row.content_json) as UserMaterialContent;
    if (parsed && Array.isArray(parsed.tasks)) return { tasks: parsed.tasks };
  } catch {
    // Падение здесь означало бы 500 на публичной странице из-за одной плохой строки.
  }
  return { tasks: [] };
}

/**
 * Вид материала для открытого банка.
 *
 * Видно ОДНО: кто принёс (подпись автора), что это за работа и сколько раз её
 * скачали. НЕ видно: почты автора, его id, статуса и причины отказа — в
 * открытом банке таких полей просто нет.
 */
function toPublicView(row: UserMaterialRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    subject: row.subject,
    grade: row.grade,
    kind: row.kind,
    tasks: readContent(row).tasks,
    authorName: row.author_name,
    downloads: row.downloads,
    createdAt: new Date(row.created_at * 1000).toISOString(),
  };
}

/**
 * Вид материала для СОБСТВЕННИКА — с честным ответом «что с ним происходит».
 *
 * Флаги `canEdit` / `canWithdraw` / `canDelete` считает СЕРВЕР: интерфейс
 * рисует кнопки по ним, и если бы он решал сам, то правило «опубликованное не
 * правится молча» разъехалось бы с бэкендом при первом же переименовании.
 */
function toOwnView(row: UserMaterialRow) {
  const published = row.status === "published";
  return {
    ...toPublicView(row),
    status: row.status,
    rejectReason: row.reject_reason,
    moderatedAt: row.moderated_at ? new Date(row.moderated_at * 1000).toISOString() : null,
    canEdit: !published,
    canWithdraw: row.status !== "withdrawn",
    canDelete: !published,
  };
}

/**
 * Ошибка из слоя данных → HTTP-статус и код.
 *
 * Каждый код отказа отдаёт СВОЙ текст: «это материал другого учителя» и «такого
 * материала нет» — разные вещи, и учитель должен понимать, какая именно.
 */
function fail(result: { code: Exclude<UserMaterialResult<never>, { ok: true }>["code"] }): never {
  switch (result.code) {
    case "validation":
      throwApiError(400, "MATERIAL_VALIDATION", "Проверьте материал: нужны название, описание и хотя бы одно задание");
    case "reason_required":
      throwApiError(400, "MATERIAL_REASON_REQUIRED", "Напишите причину отказа — учитель должен знать, что исправить");
    case "forbidden":
      // Ключевой случай листа: чужой материал — ОТКАЗ, а не «не найдено».
      throwApiError(403, "MATERIAL_FORBIDDEN", "Это материал другого учителя");
    case "not_found":
      throwApiError(404, "MATERIAL_NOT_FOUND", "Материала нет — возможно, его удалили");
    case "published_locked":
      throwApiError(
        409,
        "MATERIAL_PUBLISHED",
        "Материал уже опубликован: сначала снимите его с публикации, потом правьте или удаляйте",
      );
    case "not_pending":
      throwApiError(409, "MATERIAL_NOT_PENDING", "По этому материалу решение уже принято");
    case "limit":
      throwApiError(409, "MATERIAL_LIMIT", `Достигнут предел в ${MAX_USER_MATERIALS_PER_TEACHER} материалов`);
    default:
      throwApiError(400, "MATERIAL_BAD_REQUEST", "Не удалось разобрать запрос");
  }
}

/** Тело запроса сдачи/правки. Потолки — те же, что в db/materials.ts. */
const MaterialBody = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  subject: z.string().min(1).max(60),
  grade: z.number().int().min(1).max(11),
  kind: z.enum(["worksheet", "cards", "bundle"]),
  tasks: z.array(z.object({ text: z.string().min(1).max(2000) })).min(1).max(40),
});

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throwApiError(400, "BAD_REQUEST", "Не удалось прочитать запрос");
  }
}

function toInput(raw: unknown): UserMaterialInput {
  const body = MaterialBody.parse(raw);
  return {
    title: body.title,
    description: body.description,
    subject: body.subject,
    grade: body.grade,
    kind: body.kind,
    content: { tasks: body.tasks.map((t) => ({ number: 0, text: t.text })) },
  };
}

/**
 * Лимит на отдачу материалов учителей: 120/мин на «учителя + IP».
 *
 * Бакет свой — он не должен отнимать бюджет у форм и генерации, иначе лимит
 * публикаций лёг бы на обычного учителя, который открыл страницу каталога.
 */
const userMaterialsReadLimit = rateLimitMiddleware({
  limit: 120,
  windowSec: 60,
  bucket: "user-materials-read",
});

/** Публичный банк материалов учителей. Без входа — как сам каталог `/materials`. */
materialsRouter.get("/user", userMaterialsReadLimit, async (c) => {
  const rows = await listPublishedUserMaterials(c.env.DB, MAX_USER_MATERIALS_PUBLIC_LIST);
  return c.json({ ok: true, materials: rows.map(toPublicView) });
});

/**
 * Мои материалы со статусами.
 *
 * Объявлен ДО `/user/:id` сознательно: «mine» — это про «мои», а не про материал
 * с id «mine». Порядок регистрации не должен решать, чей это маршрут.
 */
materialsRouter.get("/user/mine", userMaterialsReadLimit, async (c) => {
  const user = requireAuth(c);
  const rows = await listOwnUserMaterials(c.env.DB, user.id);
  return c.json({ ok: true, materials: rows.map(toOwnView) });
});

/**
 * Один опубликованный материал.
 *
 * Отдаёт ТОЛЬКО опубликованный: черновик или отклонённый материал по этой
 * ссылке не откроется никому, даже автору (автор смотрит свой список).
 */
materialsRouter.get("/user/:id", userMaterialsReadLimit, async (c) => {
  const row = await getPublishedUserMaterial(c.env.DB, c.req.param("id"));
  if (!row) throwApiError(404, "MATERIAL_NOT_FOUND", "Материала нет — возможно, его удалили");
  return c.json({ ok: true, material: toPublicView(row) });
});

/**
 * Отметить скачивание.
 *
 * Счётчик растёт здесь и только здесь, поэтому он честный: он равен числу
 * нажатий «Скачать». Кто нажал — не записывается: аудитории у нас нет, а чужие
 * следы без нужны хранить нельзя.
 */
materialsRouter.post("/user/:id/download", userMaterialsReadLimit, async (c) => {
  const result = await recordUserMaterialDownload(c.env.DB, c.req.param("id"));
  if (!result.ok) fail(result);
  return c.json({ ok: true, downloads: result.value.downloads });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. МОИ МАТЕРИАЛЫ — учитель с входом
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Сдать материал на публикацию.
 *
 * Ответ содержит статус `pending` — учитель сразу видит, что материал ЖДЁТ
 * решения, а не уже лежит в банке. Обещать охват здесь нельзя: сколько
 * учителей смотрят каталог, мы не считали и не собираемся выдумывать.
 */
materialsRouter.post("/user", async (c) => {
  const user = requireAuth(c);
  const input = toInput(await readJson(c));
  const result = await submitUserMaterial(c.env.DB, user.id, user.name, input);
  if (!result.ok) fail(result);

  return c.json({ ok: true, material: toOwnView(result.value) }, 201);
});

/** Поправить своё. Чужой материал — 403, опубликованное — 409 (сначала снять). */
materialsRouter.patch("/user/:id", async (c) => {
  const user = requireAuth(c);
  const input = toInput(await readJson(c));
  const result = await updateOwnUserMaterial(c.env.DB, user.id, c.req.param("id"), input);
  if (!result.ok) fail(result);
  return c.json({ ok: true, material: toOwnView(result.value) });
});

/** Снять своё с публикации: материал перестаёт быть виден всем, но остаётся у учителя. */
materialsRouter.post("/user/:id/withdraw", async (c) => {
  const user = requireAuth(c);
  const result = await withdrawOwnUserMaterial(c.env.DB, user.id, c.req.param("id"));
  if (!result.ok) fail(result);
  return c.json({ ok: true, material: toOwnView(result.value) });
});

/** Удалить своё неопубликованное. Опубликованное удалить нельзя — сначала снять. */
materialsRouter.delete("/user/:id", async (c) => {
  const user = requireAuth(c);
  const result = await deleteOwnUserMaterial(c.env.DB, user.id, c.req.param("id"));
  if (!result.ok) fail(result);
  return c.json({ ok: true, deleted: true });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. МОДЕРАЦИЯ — ручной проход владельца
 *
 * Здесь НИКОГДА нет `user_id` из тела запроса: решение принимает администратор,
 * и это единственное место, где статус меняет не автор.
 * ═══════════════════════════════════════════════════════════════════════════ */

function requireAdmin(c: Parameters<typeof requireAuth>[0]) {
  const user = requireAuth(c);
  if (!user.isAdmin) {
    throwApiError(403, "ADMIN_ONLY", "Решение по материалу принимает владелец сайта");
  }
  return user;
}

/** Очередь: что прислали и ждёт. Порядок — сначала сданные раньше. */
materialsRouter.get("/moderation/queue", async (c) => {
  requireAdmin(c);
  const rows = await listModerationQueue(c.env.DB);
  return c.json({
    ok: true,
    queue: rows.map((row) => ({
      ...toOwnView(row),
      authorId: row.user_id,
    })),
  });
});

materialsRouter.post("/moderation/:id/approve", async (c) => {
  const admin = requireAdmin(c);
  const result = await approveUserMaterial(c.env.DB, admin.id, c.req.param("id"));
  if (!result.ok) fail(result);
  return c.json({ ok: true, material: toOwnView(result.value) });
});

const RejectBody = z.object({ reason: z.string().min(1).max(MAX_REJECT_REASON) });

materialsRouter.post("/moderation/:id/reject", async (c) => {
  const admin = requireAdmin(c);
  const body = RejectBody.parse(await readJson(c));
  const result = await rejectUserMaterial(c.env.DB, admin.id, c.req.param("id"), body.reason);
  if (!result.ok) fail(result);
  return c.json({ ok: true, material: toOwnView(result.value) });
});

export default materialsRouter;
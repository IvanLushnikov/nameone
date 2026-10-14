/**
 * Слой данных для материалов учителей — авторские публикации (лист 5.1.1).
 *
 * Здесь вся работа с таблицами `user_materials` / `user_material_downloads`.
 * Роуты (`routes/materials.ts`) SQL не пишут: правило «учитель видит и правит
 * только своё» обязано выполняться одинаково в каждом обработчике, а не
 * повторяться по памяти разных авторов.
 *
 * ─── ГЛАВНОЕ ПРАВИЛО ФАЙЛА ──────────────────────────────────────────────────
 * Любая запись (правка, снятие, удаление, скачивание) идёт С ФИЛЬТРОМ ПО
 * `user_id` или по `status = 'published'`. Фильтра «по id» без проверки хозяина
 * в этом файле нет вообще, и добавлять его нельзя: одна забытая строка — и
 * учитель снимает чужую работу.
 *
 * ─── ЧУЖОЙ МАТЕРИАЛ — ЭТО 403, А НЕ «НЕ НАЙДЕН» ────────────────────────────
 * Как и с классами (db/classes.ts): если отфильтровать молча, «нет такого» и
 * «не твоё» станут одним и тем же ответом, и учитель решит, что выдумал.
 * Поэтому `loadOwnUserMaterial` сначала смотрит владельца и только потом решает
 * код отказа.
 *
 * ─── СТАТУСЫ РЕШАЮТ ВИДИМОСТЬ, А НЕ ФЛАГИ ───────────────────────────────────
 * `pending` / `rejected` / `withdrawn` не видны НИКОМУ, кроме автора. В общий
 * список попадает ровно `published`. Список учителя отдаёт все статусы, но
 * автору — с причиной отказа: «модерация отказала молча» хуже, чем отказ.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { shortId } from "../lib/shortid";

/* ───────────────────────────────────────────────────────────────────────────
 * Пределы
 *
 * Числа не «на всякий случай», а по смыслу. Учитель кладёт в банк свои работы,
 * а не склад: 200 материалов на человека — это уже не авторская подборка, а
 * попытка занять чужое место в общем каталоге. Отказ здесь понятнее, чем тихая
 * обрезка: молча выкинутая работа учителя выглядит как ошибка.
 * ─────────────────────────────────────────────────────────────────────────── */

export const MAX_USER_MATERIAL_TITLE = 120;
export const MAX_USER_MATERIAL_DESCRIPTION = 2000;
export const MAX_USER_MATERIAL_TASKS = 40;
export const MAX_USER_MATERIAL_TASK_TEXT = 2000;
export const MAX_USER_MATERIALS_PER_TEACHER = 200;
/**
 * Сколько материалов отдаём за один запрос открытого банка.
 *
 * Это потолок страницы, а не «сколько у нас всего»: счётчик общего числа мы не
 * считаем, потому что не считаем его честно. Лучше отдать первые 100 и сказать
 * «показаны первые 100», чем показать число, которое мы выдумали.
 */
export const MAX_USER_MATERIALS_PUBLIC_LIST = 100;
/** Длина причины отказа. Короче — не объяснение, длиннее — пересказ работы. */
export const MAX_REJECT_REASON = 500;

/** Подпись автора, если учитель не назвал себя. Честная и без выдумки. */
export const ANONYMOUS_AUTHOR = "Учитель УчЛист";

/* ───────────────────────────────────────────────────────────────────────────
 * Идентификаторы
 * ─────────────────────────────────────────────────────────────────────────── */

export function userMaterialId(): string {
  return `umt_${shortId()}`;
}

function userMaterialDownloadId(): string {
  return `umd_${shortId()}`;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Типы
 * ─────────────────────────────────────────────────────────────────────────── */

/** Статус материала. Порядок — жизненный цикл, а не алфавит. */
export type UserMaterialStatus = "pending" | "published" | "rejected" | "withdrawn";

/** Вид материала: ровно три, столько учитель реально приносит. */
export type UserMaterialKind = "worksheet" | "cards" | "bundle";

/** Одно задание материала. Текст — всё, что учитель принёс. */
export interface UserMaterialTask {
  number: number;
  text: string;
}

/** Тело материала в том виде, в каком его читает фронт. */
export interface UserMaterialContent {
  tasks: UserMaterialTask[];
}

/** Что учитель отдал на публикацию. */
export interface UserMaterialInput {
  title: string;
  description: string;
  subject: string;
  grade: number;
  kind: UserMaterialKind;
  content: UserMaterialContent;
}

export interface UserMaterialRow {
  id: string;
  user_id: string;
  author_name: string;
  title: string;
  description: string;
  subject: string;
  grade: number;
  kind: string;
  content_json: string;
  status: string;
  reject_reason: string | null;
  moderated_by: string | null;
  moderated_at: number | null;
  downloads: number;
  created_at: number;
  updated_at: number;
}

/**
 * Код отказа. Роуты превращают его в HTTP-статус и слово для учителя, поэтому
 * кодов ровно столько, сколько РАЗНЫХ ситуаций, а не сколько обработчиков.
 */
export type UserMaterialCode =
  | "validation"
  | "reason_required"
  | "forbidden"
  | "not_found"
  | "published_locked"
  | "not_pending"
  | "limit";

export type UserMaterialResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: UserMaterialCode };

function fail(code: UserMaterialCode): { ok: false; code: UserMaterialCode } {
  return { ok: false, code };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Нормализация входа
 * ─────────────────────────────────────────────────────────────────────────── */

/** Пробелы схлопываются: «  Рабочий   лист » → «Рабочий лист». */
function tidy(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Привести тело материала к виду, который можно хранить и показывать.
 *
 * Задания нумеруются ЗДЕСЬ, а не берутся из тела запроса: иначе учитель прислал
 * бы «1, 2, 17» — и в публикации были бы дыры в нумерации, которые читатель
 * увидит как «лист потерялся».
 */
function normalizeContent(input: UserMaterialInput): UserMaterialResult<UserMaterialContent> {
  const raw = Array.isArray(input.content?.tasks) ? input.content.tasks : [];
  const tasks: UserMaterialTask[] = [];

  for (const item of raw.slice(0, MAX_USER_MATERIAL_TASKS)) {
    const text = tidy(String(item?.text ?? ""), MAX_USER_MATERIAL_TASK_TEXT);
    if (!text) continue; // пустое задание — не задание
    tasks.push({ number: tasks.length + 1, text });
  }

  if (tasks.length === 0) {
    return fail("validation");
  }
  return { ok: true, value: { tasks } };
}

/** Подпись автора: имя из профиля, иначе честное «Учитель УчЛист». */
export function authorLabel(name: string | null | undefined): string {
  const trimmed = (name ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return ANONYMOUS_AUTHOR;
  return trimmed.slice(0, 80);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Чтение
 * ─────────────────────────────────────────────────────────────────────────── */

const SELECT_COLUMNS = `id, user_id, author_name, title, description, subject, grade,
  kind, content_json, status, reject_reason, moderated_by, moderated_at, downloads,
  created_at, updated_at`;

/**
 * Общий банк: только опубликованные материалы учителей.
 *
 * Фильтр `status = 'published'` стоит В САМОМ SQL, а не в разборе ответа: иначе
 * черновик одного учителя уехал бы в чужой список наравне с опубликованным —
 * ровно та дыра, ради которой лист и заведён.
 *
 * Подпись автора едет из колонки `author_name` (снимок), а не из users.name:
 * переименование учителя не переписывает подпись под уже опубликованной работой.
 */
export async function listPublishedUserMaterials(
  db: D1Database,
  limit = 50,
): Promise<UserMaterialRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM user_materials
       WHERE status = 'published'
       ORDER BY created_at DESC
       LIMIT ?1`,
    )
    .bind(Math.max(1, Math.min(100, Math.floor(limit))))
    .all<UserMaterialRow>();
  return rows.results ?? [];
}

/** Материал учителя для чтения. Отдаём ТОЛЬКО опубликованный. */
export async function getPublishedUserMaterial(
  db: D1Database,
  id: string,
): Promise<UserMaterialRow | null> {
  return db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1 AND status = 'published'`)
    .bind(id)
    .first<UserMaterialRow>();
}

/**
 * Мои материалы: все статусы, включая отказ с причиной.
 *
 * Запрос уже отфильтрован по `user_id`, поэтому чужой материал сюда не попадёт
 * даже при опечатке в идентификаторе на клиенте.
 */
export async function listOwnUserMaterials(db: D1Database, userId: string): Promise<UserMaterialRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM user_materials
       WHERE user_id = ?1
       ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<UserMaterialRow>();
  return rows.results ?? [];
}

/**
 * Свой материал по id — С ПРОВЕРКОЙ ХОЗЯИНА.
 *
 * Порядок обязателен: сначала читаем строку как есть, потом решаем «не твоё» или
 * «нет такого». Обратный порядок сделал бы «чужой» неотличимым от «несуществующего».
 */
export async function loadOwnUserMaterial(
  db: D1Database,
  userId: string,
  id: string,
): Promise<UserMaterialResult<UserMaterialRow>> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1`)
    .bind(id)
    .first<UserMaterialRow>();
  if (!row) return fail("not_found");
  if (row.user_id !== userId) return fail("forbidden");
  return { ok: true, value: row };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Запись
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Сдать материал на публикацию.
 *
 * Статус в SQL-литерале `pending`, а не в поле запроса: клиент не может ни
 * прислать `published`, ни выбрать статус — решение принимает человек позже.
 */
export async function submitUserMaterial(
  db: D1Database,
  userId: string,
  authorName: string | null,
  input: UserMaterialInput,
): Promise<UserMaterialResult<UserMaterialRow>> {
  const title = tidy(input.title ?? "", MAX_USER_MATERIAL_TITLE);
  const description = tidy(input.description ?? "", MAX_USER_MATERIAL_DESCRIPTION);
  const subject = tidy(input.subject ?? "", 60);
  const grade = Math.floor(Number(input.grade));

  if (!title || !description || !subject) return fail("validation");
  if (!Number.isFinite(grade) || grade < 1 || grade > 11) return fail("validation");
  if (!["worksheet", "cards", "bundle"].includes(input.kind)) return fail("validation");

  const content = normalizeContent(input);
  if (!content.ok) return content;

  const count = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM user_materials WHERE user_id = ?1`)
    .bind(userId)
    .first<{ cnt: number }>();
  if ((count?.cnt ?? 0) >= MAX_USER_MATERIALS_PER_TEACHER) return fail("limit");

  const id = userMaterialId();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO user_materials
         (id, user_id, author_name, title, description, subject, grade, kind,
          content_json, status, reject_reason, moderated_by, moderated_at,
          downloads, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', NULL, NULL, NULL, 0, ?10, ?10)`,
    )
    .bind(
      id,
      userId,
      authorLabel(authorName),
      title,
      description,
      subject,
      grade,
      input.kind,
      JSON.stringify(content.value),
      now,
    )
    .run();

  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1`)
    .bind(id)
    .first<UserMaterialRow>();
  if (!row) return fail("not_found");
  return { ok: true, value: row };
}

/**
 * Править СВОЙ материал.
 *
 * Править можно только то, что ещё не опубликовано: опубликованная работа уже
 * видна другим, и молчаливая правка на чтении была бы враньём. Путь честный —
 * снять с публикации, поправить, отдать заново.
 *
 * Правка отклонённого материала возвращает его в `pending`: учитель поправил —
 * значит его снова надо посмотреть, а не считать отказ навсегда.
 */
export async function updateOwnUserMaterial(
  db: D1Database,
  userId: string,
  id: string,
  input: UserMaterialInput,
): Promise<UserMaterialResult<UserMaterialRow>> {
  const owned = await loadOwnUserMaterial(db, userId, id);
  if (!owned.ok) return owned;
  if (owned.value.status === "published") return fail("published_locked");

  const title = tidy(input.title ?? "", MAX_USER_MATERIAL_TITLE);
  const description = tidy(input.description ?? "", MAX_USER_MATERIAL_DESCRIPTION);
  const subject = tidy(input.subject ?? "", 60);
  const grade = Math.floor(Number(input.grade));

  if (!title || !description || !subject) return fail("validation");
  if (!Number.isFinite(grade) || grade < 1 || grade > 11) return fail("validation");
  if (!["worksheet", "cards", "bundle"].includes(input.kind)) return fail("validation");

  const content = normalizeContent(input);
  if (!content.ok) return content;

  const now = Math.floor(Date.now() / 1000);
  // Отказ больше не актуален: материал опять ждёт решения, и старая причина
  // была бы враньём («вам отказали» при материате, который снова на модерации).
  await db
    .prepare(
      `UPDATE user_materials
          SET title = ?3, description = ?4, subject = ?5, grade = ?6, kind = ?7,
              content_json = ?8, status = 'pending', reject_reason = NULL,
              moderated_by = NULL, moderated_at = NULL, updated_at = ?9
        WHERE id = ?1 AND user_id = ?2`,
    )
    .bind(id, userId, title, description, subject, grade, input.kind, JSON.stringify(content.value), now)
    .run();

  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .first<UserMaterialRow>();
  if (!row) return fail("not_found");
  return { ok: true, value: row };
}

/**
 * Снять свой материал с публикации.
 *
 * Снятый материал не удаляется — учитель его видит и может переписать и сдать
 * заново. Это не «удалить», поэтому отдельная кнопка «Удалить» и не просит
 * подтверждения «навсегда».
 */
export async function withdrawOwnUserMaterial(
  db: D1Database,
  userId: string,
  id: string,
): Promise<UserMaterialResult<UserMaterialRow>> {
  const owned = await loadOwnUserMaterial(db, userId, id);
  if (!owned.ok) return owned;
  if (owned.value.status === "withdrawn") return fail("published_locked");

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE user_materials
          SET status = 'withdrawn', updated_at = ?3
        WHERE id = ?1 AND user_id = ?2`,
    )
    .bind(id, userId, now)
    .run();

  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .first<UserMaterialRow>();
  if (!row) return fail("not_found");
  return { ok: true, value: row };
}

/** Удалить свой материал. Только неопубликованный — опубликованный сначала снимают. */
export async function deleteOwnUserMaterial(
  db: D1Database,
  userId: string,
  id: string,
): Promise<UserMaterialResult<true>> {
  const owned = await loadOwnUserMaterial(db, userId, id);
  if (!owned.ok) return owned;
  if (owned.value.status === "published") return fail("published_locked");

  await db.prepare(`DELETE FROM user_materials WHERE id = ?1 AND user_id = ?2`).bind(id, userId).run();
  return { ok: true, value: true };
}

/**
 * Скачать опубликованный материал.
 *
 * Счётчик растёт здесь и только здесь. Кто скачал — не пишется: аудитории у нас
 * нет, а хранить чужие следы без нужды нельзя.
 */
export async function recordUserMaterialDownload(
  db: D1Database,
  id: string,
): Promise<UserMaterialResult<UserMaterialRow>> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1 AND status = 'published'`)
    .bind(id)
    .first<UserMaterialRow>();
  if (!row) return fail("not_found");

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`INSERT INTO user_material_downloads (id, material_id, created_at) VALUES (?1, ?2, ?3)`)
    .bind(userMaterialDownloadId(), id, now)
    .run();
  await db.prepare(`UPDATE user_materials SET downloads = downloads + 1 WHERE id = ?1`).bind(id).run();

  return { ok: true, value: { ...row, downloads: row.downloads + 1 } };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Модерация — ручной проход владельца
 *
 * Решение принимает человек, поэтому здесь нет ни автопубликации, ни «умного»
 * фильтра: очередь, просмотр, и либо публикация, либо отказ с причиной.
 * Кто именно решил — пишется в `moderated_by`, и учитель может это увидеть.
 * ─────────────────────────────────────────────────────────────────────────── */

export async function listModerationQueue(db: D1Database): Promise<UserMaterialRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM user_materials
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
    )
    .all<UserMaterialRow>();
  return rows.results ?? [];
}

/** Опубликовать материал из очереди. Повторное решение — 409, а не «успех». */
export async function approveUserMaterial(
  db: D1Database,
  moderatorId: string,
  id: string,
): Promise<UserMaterialResult<UserMaterialRow>> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1`)
    .bind(id)
    .first<UserMaterialRow>();
  if (!row) return fail("not_found");
  if (row.status !== "pending") return fail("not_pending");

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE user_materials
          SET status = 'published', reject_reason = NULL,
              moderated_by = ?2, moderated_at = ?3, updated_at = ?3
        WHERE id = ?1`,
    )
    .bind(id, moderatorId, now)
    .run();

  return { ok: true, value: { ...row, status: "published", moderated_by: moderatorId, moderated_at: now } };
}

/**
 * Отклонить материал. Причина обязательна.
 *
 * «Отказ без причины» — худший вариант из возможных: учитель не знает, что
 * чинить, и сдаёт то же самое ещё раз. Поэтому пустая причина — 400.
 */
export async function rejectUserMaterial(
  db: D1Database,
  moderatorId: string,
  id: string,
  reason: string,
): Promise<UserMaterialResult<UserMaterialRow>> {
  const clean = tidy(reason ?? "", MAX_REJECT_REASON);
  if (!clean) return fail("reason_required");

  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_materials WHERE id = ?1`)
    .bind(id)
    .first<UserMaterialRow>();
  if (!row) return fail("not_found");
  if (row.status !== "pending") return fail("not_pending");

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE user_materials
          SET status = 'rejected', reject_reason = ?2,
              moderated_by = ?3, moderated_at = ?4, updated_at = ?4
        WHERE id = ?1`,
    )
    .bind(id, clean, moderatorId, now)
    .run();

  return {
    ok: true,
    value: { ...row, status: "rejected", reject_reason: clean, moderated_by: moderatorId, moderated_at: now },
  };
}
"use client";

/**
 * Клиент авторских публикаций — материалы учителей (лист 5.1.1).
 *
 * Образец — соседние клиенты (`src/lib/lk/classes-api.ts`, `src/lib/journal/types.ts`):
 * типизированный union результата, `credentials: "include"` + `cache: "no-store"`,
 * разбор статусов по веткам и НИКАКИХ исключений наружу — вызывающий код сужает
 * тип по `ok`.
 *
 * ─── ГЛАВНОЕ, РАДИ ЧЕГО ФАЙЛ СУЩЕСТВУЕТ: СТАТУС СЛОВАМИ ────────────────────
 * У учителя должен быть ответ на вопрос «что с моим материалом» — не код
 * (`pending`) и не цвет плашки, а обычные слова. Поэтому подписи статусов живут
 * здесь, рядом с типом статуса, и используются обоими экранами: и списком своих
 * материалов, и модалкой сдачи. Разъехаться они не могут.
 *
 * ─── ЧЕГО ЗДЕСЬ НЕТ, И ПОЧЕМУ ───────────────────────────────────────────────
 * Нет обещаний охвата. Счётчик скачиваний — настоящий (он растёт ровно нажатием
 * «Скачать»), а сколько учителей вообще заходит в каталог, мы не считали.
 * Поэтому в подписях нигде нет слов «вас увидят» или «популярно».
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Префикс совпадает с монтированием в `backend/src/index.ts`. */
const BASE = "/api/materials";

/* ────────────────────────────────────────────────────────────────────────────
 * Статусы и слова к ним
 * ──────────────────────────────────────────────────────────────────────────── */

/** Статус приходит с сервера и в словах не нуждается — но нуждается экрану. */
export type UserMaterialStatus = "pending" | "published" | "rejected" | "withdrawn";

/**
 * Подпись статуса — то, что учитель читает вместо служебного кода.
 *
 * `pending` — «на модерации», а не «в очереди» и не «принято»: материал ещё не
 * виден другим, и сказать «принято» было бы враньём.
 */
export const STATUS_WORDS: Record<UserMaterialStatus, string> = {
  pending: "На модерации",
  published: "Опубликован",
  rejected: "Отклонён",
  withdrawn: "Снят с публикации",
};

/**
 * Пояснение под статусом — что это значит для учителя и что делать дальше.
 *
 * Отдельно от подписи, потому что подпись отвечает на «что сейчас», а
 * пояснение — на «и что мне делать».
 */
export const STATUS_HINT: Record<UserMaterialStatus, string> = {
  pending: "Материал ждёт, пока его посмотрит владелец сайта. В общем каталоге его пока нет.",
  published: "Материал в общем каталоге. Видно, кто его принёс, и сколько раз его скачали.",
  rejected: "Материал не опубликован. Посмотрите причину и сдайте исправленную версию.",
  withdrawn: "Материал убран из общего каталога и виден только вам. Можно поправить и сдать заново.",
};

/** Тон плашки. Успех и отказ различаются не только словами. */
export const STATUS_TONE: Record<UserMaterialStatus, "info" | "success" | "danger" | "neutral"> = {
  pending: "info",
  published: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

/**
 * Статус в словах. Неизвестный код показываем как «На модерации»: незнакомый
 * статус — это «мы ещё не решили», и врать «опубликовано» тут нельзя.
 */
export function statusWords(status: string | null | undefined): string {
  if (status === "published") return STATUS_WORDS.published;
  if (status === "rejected") return STATUS_WORDS.rejected;
  if (status === "withdrawn") return STATUS_WORDS.withdrawn;
  return STATUS_WORDS.pending;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Типы
 * ──────────────────────────────────────────────────────────────────────────── */

/** Вид материала: ровно три — столько учитель реально приносит. */
export type UserMaterialKind = "worksheet" | "cards" | "bundle";

export const KIND_WORDS: Record<UserMaterialKind, string> = {
  worksheet: "Рабочий лист",
  cards: "Карточки",
  bundle: "Комплект материалов",
};

export interface UserMaterialTask {
  number: number;
  text: string;
}

/** Материал в общем банке: виден всем, кто открыл каталог. */
export interface PublicUserMaterial {
  id: string;
  title: string;
  description: string;
  subject: string;
  grade: number;
  kind: string;
  tasks: UserMaterialTask[];
  /** Подпись автора. Почты здесь нет и не будет. */
  authorName: string;
  downloads: number;
  createdAt: string;
}

/** Свой материал: то же самое плюс ответ «что с ним происходит». */
export interface OwnUserMaterial extends PublicUserMaterial {
  status: string;
  rejectReason: string | null;
  moderatedAt: string | null;
  canEdit: boolean;
  canWithdraw: boolean;
  canDelete: boolean;
}

/** То, что учитель заполняет в форме сдачи. */
export interface UserMaterialDraft {
  title: string;
  description: string;
  subject: string;
  grade: number;
  kind: UserMaterialKind;
  tasks: string[];
}

export type UserMaterialApiError =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "internal";

export type UserMaterialResult<T> = { ok: true; value: T } | { ok: false; error: UserMaterialApiError };

/* ────────────────────────────────────────────────────────────────────────────
 * Пределы — зеркалят backend/src/db/materials.ts
 *
 * Их здесь знаем не для красоты: без них учитель напечатал бы 300 символов в
 * название, потратил минуту на ожидание и получил «сервер не ответил как надо».
 * Считаем на устройстве и говорим заранее.
 * ──────────────────────────────────────────────────────────────────────────── */

export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 2000;
export const MAX_TASK_TEXT = 2000;
export const MAX_TASKS = 40;

/* ────────────────────────────────────────────────────────────────────────────
 * Запрос
 * ──────────────────────────────────────────────────────────────────────────── */

async function request<T>(
  path: string,
  init: { method: string; body?: string } = { method: "GET" },
): Promise<UserMaterialResult<T>> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: init.body,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown> | null;
  } catch {
    body = null;
  }

  // 403 — отдельная ветка, а не «internal»: чужой материал и «нет такого» —
  // разные вещи, и учитель должен понимать, какая именно.
  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 403) return { ok: false, error: "forbidden" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 409) return { ok: false, error: "conflict" };
  if (res.status === 400) return { ok: false, error: "validation" };
  if (!res.ok) return { ok: false, error: "internal" };
  return { ok: true, value: (body ?? {}) as T };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Общий банк
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Опубликованные материалы учителей.
 *
 * Ответ разбирается снисходительно: сервер может прислать незнакомый статус или
 * незнакомый вид материала, и каталог от этого рассыпаться не должен.
 */
export async function loadUserMaterials(): Promise<UserMaterialResult<PublicUserMaterial[]>> {
  const res = await request<{ materials?: unknown }>(`${BASE}/user`);
  if (!res.ok) return res;
  if (!Array.isArray(res.value.materials)) return { ok: false, error: "internal" };
  return { ok: true, value: res.value.materials.flatMap(readPublicMaterial) };
}

function readPublicMaterial(raw: unknown): PublicUserMaterial[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return [];
  return [
    {
      id: o.id,
      title: o.title,
      description: typeof o.description === "string" ? o.description : "",
      subject: typeof o.subject === "string" ? o.subject : "",
      grade: typeof o.grade === "number" ? o.grade : 0,
      kind: typeof o.kind === "string" ? o.kind : "worksheet",
      tasks: readTasks(o.tasks),
      authorName: typeof o.authorName === "string" && o.authorName ? o.authorName : "Учитель УчЛист",
      downloads: typeof o.downloads === "number" && o.downloads > 0 ? o.downloads : 0,
      createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    },
  ];
}

function readTasks(raw: unknown): UserMaterialTask[] {
  if (!Array.isArray(raw)) return [];
  const tasks: UserMaterialTask[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.text !== "string" || !o.text) continue;
    tasks.push({ number: tasks.length + 1, text: o.text });
  }
  return tasks;
}

/**
 * Отметить скачивание.
 *
 * Возвращает НОВОЕ значение счётчика. Число показываем честное: сколько раз
 * нажали «Скачать», а не «сколько учителей это используют» — второго мы не
 * знаем и знать не будем.
 */
export async function countUserMaterialDownload(id: string): Promise<UserMaterialResult<number>> {
  const res = await request<{ downloads?: unknown }>(
    `${BASE}/user/${encodeURIComponent(id)}/download`,
    { method: "POST" },
  );
  if (!res.ok) return res;
  const value = res.value.downloads;
  return { ok: true, value: typeof value === "number" ? value : 0 };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Свои материалы
 * ──────────────────────────────────────────────────────────────────────────── */

export async function loadOwnMaterials(): Promise<UserMaterialResult<OwnUserMaterial[]>> {
  const res = await request<{ materials?: unknown }>(`${BASE}/user/mine`);
  if (!res.ok) return res;
  if (!Array.isArray(res.value.materials)) return { ok: false, error: "internal" };

  const materials: OwnUserMaterial[] = [];
  for (const raw of res.value.materials) {
    const base = readPublicMaterial(raw);
    if (base.length === 0) continue;
    const o = raw as Record<string, unknown>;
    materials.push({
      ...base[0]!,
      status: typeof o.status === "string" ? o.status : "pending",
      rejectReason: typeof o.rejectReason === "string" ? o.rejectReason : null,
      moderatedAt: typeof o.moderatedAt === "string" ? o.moderatedAt : null,
      canEdit: o.canEdit !== false,
      canWithdraw: o.canWithdraw === true,
      canDelete: o.canDelete !== false,
    });
  }
  return { ok: true, value: materials };
}

function draftToBody(draft: UserMaterialDraft): string {
  return JSON.stringify({
    title: draft.title,
    description: draft.description,
    subject: draft.subject,
    grade: draft.grade,
    kind: draft.kind,
    // Нумерацию заданий проставляет сервер: прислать свою — значит нарисовать
    // в листе дыры вида «1, 2, 17», которые читатель увидит как «лист потерялся».
    tasks: draft.tasks.map((text) => ({ text })),
  });
}

/**
 * Сдать материал на публикацию.
 *
 * Ответ — материал со статусом «На модерации». Сразу после сдачи мы НЕ говорим
 * учителю, что материал увидят другие: сначала его посмотрит человек.
 */
export async function submitUserMaterial(
  draft: UserMaterialDraft,
): Promise<UserMaterialResult<OwnUserMaterial>> {
  const res = await request<{ material?: unknown }>(`${BASE}/user`, {
    method: "POST",
    body: draftToBody(draft),
  });
  if (!res.ok) return res;
  const parsed = readPublicMaterial(res.value.material);
  if (parsed.length === 0) return { ok: false, error: "internal" };
  return { ok: true, value: { ...parsed[0]!, status: "pending", rejectReason: null, moderatedAt: null, canEdit: true, canWithdraw: true, canDelete: true } };
}

export async function withdrawUserMaterial(id: string): Promise<UserMaterialResult<true>> {
  const res = await request(`${BASE}/user/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
  return res.ok ? { ok: true, value: true } : res;
}

export async function deleteUserMaterial(id: string): Promise<UserMaterialResult<true>> {
  const res = await request(`${BASE}/user/${encodeURIComponent(id)}`, { method: "DELETE" });
  return res.ok ? { ok: true, value: true } : res;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Понятная причина отказа — по одному месту в интерфейсе
 * ──────────────────────────────────────────────────────────────────────────── */

export function explainError(error: UserMaterialApiError): string {
  switch (error) {
    case "unauthorized":
      return "Нужен вход в аккаунт: свои материалы хранятся на сервере, а не в браузере";
    case "forbidden":
      return "Это материал другого учителя";
    case "not_found":
      return "Материала нет — возможно, его удалили";
    case "conflict":
      return "Сначала снимите материал с публикации: опубликованное не правят молча";
    case "validation":
      return "Проверьте материал: нужны название, описание и хотя бы одно задание";
    case "network":
      return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз";
    default:
      return "Сервер не ответил как надо. Попробуйте ещё раз";
  }
}
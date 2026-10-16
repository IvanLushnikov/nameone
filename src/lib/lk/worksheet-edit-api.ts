/**
 * Клиент правки рабочего листа (ТЗ-30, работа 2).
 *
 * ─── ЧТО ЭТО ЗА РУЧКА ──────────────────────────────────────────────────────
 * `PATCH /api/worksheets/:id/edit` — правка текста заданий учителем. Лист
 * пересобирается из сохранённой структуры БЕЗ вызова ИИ и БЕЗ списания квоты:
 * учитель уже заплатил за этот лист, и повторный клик за опечатку не должен
 * стоить генерации (см. AD-2 в ТЗ-30).
 *
 * ─── ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ СТРОЧКА В materials-api.ts ───────────────
 * В `materials-api.ts` лежит чтение кабинета (история, избранное, шаблоны).
 * Здесь — ЗАПИСЬ, которая меняет артефакт, и у неё своя семантика отказа:
 * `locked` (409) — это не ошибка сети и не «нет листа», а понятное объяснение
 * «по этому листу уже проверена работа». Если смешать это с общим списком
 * ошибок кабинета, причина потеряется, и фронт покажет учителю «что-то пошло
 * не так» вместо объяснения, которое бэк уже подготовил.
 *
 * ─── ГРАНИЦА ОТВЕТСТВЕННОСТИ ──────────────────────────────────────────────
 * Пустые поля здесь НЕ вычищаются: учитель может нарочно стереть ответ, и это
 * осознанное «убери», а не «не прислал». Валидацию пустого задания делает
 * сервер (он же возвращает 400 с номером поля) — клиент не дублирует правила
 * сервера, потому что тогда они разойдутся при первом же изменении.
 */

import type { WorksheetTask } from "@/lib/types";
import type { MaterialsApiResult } from "./materials-api";

/**
 * Причина отказа. `locked` — правка закрыта проверкой работы (AD-3),
 * `validation` — сервер не принял содержимое (пустое задание и т. п.).
 */
export type EditWorksheetError =
  | "unauthorized"
  | "not_found"
  | "locked"
  | "validation"
  | "network"
  | "internal";

export interface EditWorksheetResult {
  worksheet: unknown;
  /** Сервер честно сообщает, что квота не списана (AD-2). */
  quotaCharged: false;
}

export interface EditCheck {
  editable: boolean;
  /** null = правка разрешена. Непустая строка — причина, её показывают учителю. */
  reason: string | null;
}

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "";
}

/**
 * Можно ли править этот лист и почему.
 *
 * Отдельный GET нужен для одного решения: показывать кнопку «Редактировать»
 * активной или с объяснением. Без него кнопка либо всегда активна (и учитель
 * упирается в отказ уже после правки), либо всегда неактивна.
 */
export async function fetchEditCheck(
  id: string,
): Promise<MaterialsApiResult<EditCheck>> {
  const base = apiUrl();
  if (!base) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${base}/api/worksheets/${encodeURIComponent(id)}/edit`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, error: "network" };
  }

  // 401 и 404 — разные причины: «войдите» против «это не ваш лист».
  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 404) return { ok: false, error: "not_found" };

  const body = (await res.json().catch(() => null)) as
    | { editable?: unknown; reason?: unknown }
    | null;
  if (!res.ok || !body) return { ok: false, error: "internal" };

  return {
    ok: true,
    data: {
      editable: body.editable === true,
      reason: typeof body.reason === "string" ? body.reason : null,
    },
  };
}

/**
 * Сохранить правку листа.
 *
 * Возвращает наружу только успех и разобранную причину отказа: учителю
 * показывается текст, а не код ответа.
 */
export async function patchWorksheet(
  id: string,
  tasks: Array<Partial<WorksheetTask> & { text: string }>,
): Promise<{ ok: true; data: EditWorksheetResult } | { ok: false; error: EditWorksheetError; message?: string }> {
  const base = apiUrl();
  if (!base) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${base}/api/worksheets/${encodeURIComponent(id)}/edit`, {
      method: "PATCH",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ tasks }),
    });
  } catch {
    return { ok: false, error: "network" };
  }

  const body = (await res.json().catch(() => null)) as
    | { worksheet?: unknown; error?: unknown }
    | null;

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 409) {
    // Причину 409 бэк уже сформулировал словами и положил в поле `error`
    // (см. middleware/error.ts) — показываем её учителю дословно, а не
    // пересказываем своим текстом.
    const message = typeof body?.error === "string" ? body.error : undefined;
    return { ok: false, error: "locked", message };
  }
  if (res.status === 400) return { ok: false, error: "validation" };
  if (!res.ok || !body?.worksheet) return { ok: false, error: "internal" };

  return {
    ok: true,
    data: { worksheet: body.worksheet, quotaCharged: false },
  };
}
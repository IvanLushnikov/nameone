/**
 * Клиент журнала проверок (ТЗ-19 §5.1).
 *
 * Отдельный файл от `./api`, потому что это ДРУГАЯ фича и другой префикс:
 * проверка живёт под `/api/assignments/photo-checks`, журнал — под `/api/journal`
 * (роут `backend/src/routes/journal.ts`). Смешивать их в одном модуле значило бы
 * потом искать, где какой BASE стоит.
 *
 * Ошибки отдаются тем же union-типом, что и у проверки, — учитель не должен
 * различать «сеть отвалилась» и «журнала нет» по типу, а по тексту.
 */

import { ERROR_TEXT, type PhotoCheckApiError, type PhotoCheckApiErrorCode } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const BASE = "/api/journal";

/** Откуда взялась отметка в журнале. */
export type JournalSource = "machine" | "teacher" | "mixed";

export interface JournalEntry {
  id: string;
  checkId: string;
  subject: string | null;
  grade: number | null;
  /** null = разбор неполный. Это НЕ «двойка» и не «ноль». */
  mark: string | null;
  percentage: number | null;
  earnedPoints: number;
  totalPoints: number;
  source: JournalSource;
  /** Сколько заданий ещё ждут учителя. */
  pendingTasks: number;
  occurredAt: number;
}

/** Человеческие подписи бейджа источника. Слова — из опыта учителя, не из API. */
export const SOURCE_LABEL: Record<JournalSource, string> = {
  machine: "проверил ИИ",
  teacher: "вы правили вручную",
  mixed: "частично вручную",
};

/** Что бейдж значит на словах — одной строкой под списком, один раз. */
export const SOURCE_HINT: Record<JournalSource, string> = {
  machine: "Отметку поставила модель, вы не смотрели",
  teacher: "Все спорные задания вы решили сами",
  mixed: "Часть поправили вы, часть осталась за моделью",
};

function fail(error: PhotoCheckApiErrorCode, message?: string, status?: number): PhotoCheckApiError {
  return { ok: false, error, message: message || ERROR_TEXT[error], status };
}

/**
 * GET /api/journal — лента проверок.
 *
 * Пустой список — валидный ответ, а не ошибка: «проверок ещё не было» учителю
 * нужно показать словами, а не пустым экраном.
 */
export async function loadJournal(
  limit = 20,
): Promise<
  { ok: true; entries: JournalEntry[]; nextCursor: number | null } | PhotoCheckApiError
> {
  if (!API_URL) return fail("no_api_url");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}?limit=${limit}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    return fail("network");
  }

  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; entries?: JournalEntry[]; nextCursor?: number | null }
    | null;

  if (!res.ok) {
    const err = (json as { error?: string } | null) ?? {};
    if (res.status === 401) return fail("unauthorized", err.error, res.status);
    if (res.status === 404) return fail("not_found", err.error, res.status);
    return fail("http", err.error, res.status);
  }

  return {
    ok: true,
    entries: json?.entries ?? [],
    nextCursor: json?.nextCursor ?? null,
  };
}

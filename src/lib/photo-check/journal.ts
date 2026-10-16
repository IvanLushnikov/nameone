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
import { plural } from "./confidence";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const BASE = "/api/journal";

/** Откуда взялась отметка в журнале. */
export type JournalSource = "machine" | "teacher" | "mixed";

/**
 * Метка работы в журнале.
 *
 * `pending` — НЕ источник: отметки ещё нет, ждать нужно учителя. Источник при
 * этом остаётся тем же, поэтому в бейдже показывается «ждёт вас», а не
 * «проверил ИИ» — по разобранной наполовину работе учитель ждёт себя.
 */
export type JournalBadge = JournalSource | "pending";

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
  /**
   * Сколько страниц в работе. null — НЕ ноль и не единица: фото уже удалены
   * (семидневный retention) либо у строки нет живой проверки, и число
   * восстановить нельзя.
   *
   * Показывается прямо в строке: учителю это нужно ДО открытия работы —
   * работа на двух страницах и на четырёх оценивается совсем по-разному.
   *
   * Необязательное ТОЛЬКО ради типов: сервер присылает поле всегда
   * (`pages: …` в `GET /api/journal`), и строка рисует его только когда оно
   * пришло. Так правка контракта не ломает чужие фикстуры, а в рантайме
   * отсутствие поля — не повод показать правдоподобную единицу.
   */
  pages?: number | null;
  occurredAt: number;
}

/**
 * Как сказать про число страниц в строке журнала.
 *
 * При `pages === null` вместо правдоподобной единицы пишется ПРИЧИНА: молчаливая
 * «1» после удаления фотографий читалась бы как «проверили только первую
 * страницу» — то есть как правда, которой нет.
 */
export function journalPagesText(pages: number | null): string {
  // null — фото удалено по сроку хранения, 0 — бакет не ответил при загрузке и
  // число просто неизвестно. Настоящих нулевых страниц не бывает, поэтому 0
  // свободен под маркер. Раньше оба случая выглядели одинаково, и строка
  // молчала вместо честного объяснения.
  if (pages === null) return "фото удалено — страниц не видно";
  if (pages === 0) return "число страниц определить не удалось";
  return `${pages} ${plural(pages, "страница", "страницы", "страниц")}`;
}

/** Человеческие подписи бейджа источника. Слова — из опыта учителя, не из API. */
export const SOURCE_LABEL: Record<JournalBadge, string> = {
  machine: "проверил ИИ",
  teacher: "вы правили вручную",
  mixed: "частично вручную",
  pending: "ждёт вас",
};

/**
 * Что бейдж значит на словах — одной строкой под списком, один раз.
 *
 * Формулировки короткие и без заглавной буквы: в легенде они идут в один ряд
 * с меткой и читаются как продолжение, а не как отдельное предложение.
 */
export const SOURCE_HINT: Record<JournalBadge, string> = {
  machine: "вы не смотрели",
  teacher: "спорное решили сами",
  mixed: "часть поправили вы",
  pending: "отметки ещё нет",
};

/**
 * Какой бейдж показать у работы.
 *
 * Пока учитель не закрыл спорные задания, отметки нет — и главный вопрос в
 * журнале не «кто поставил», а «кого ждём». Поэтому незакрытая работа
 * получает «ждёт вас» независимо от источника.
 */
export function journalBadge(entry: { source: JournalSource; pendingTasks: number }): JournalBadge {
  return entry.pendingTasks > 0 ? "pending" : entry.source;
}

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

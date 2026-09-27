/**
 * Клиент /api/worksheets/save для ЛК учителя.
 *
 * Типизированный union результата:
 *   - `{ ok: true, worksheetId, generationsToday, generationsLimit }` — успех.
 *   - `{ ok: false, error: "unauthorized" }`                       — 401: юзер не залогинен,
 *                                                                    для анонимных flow это
 *                                                                    норма (silent skip).
 *   - `{ ok: false, error: "validation", details }`                — 400: zod-валидация.
 *   - `{ ok: false, error: "network" }`                            — fetch упал (offline).
 *   - `{ ok: false, error: "internal" }`                           — 500: сервер упал.
 *
 * Используется из `src/app/constructor/page.tsx` после успешной генерации —
 * параллельно с addToHistory(), в фоне (не блокирует UI).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface SaveWorksheetInput {
  subject: string;
  grade: number;
  topic: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  tasks: Array<{
    number: number;
    text: string;
    type: "computation" | "multiple-choice" | "short-answer" | "essay" | "fill-blank";
    options?: string[];
    answer?: string;
    explanation?: string;
    points: number;
    verified?: boolean | null;
    verifiedExplanation?: string;
  }>;
  /** Тип артефакта — фронтовая нотация; см. src/lib/types.ts TaskType. */
  type?:
    | "worksheet"
    | "test"
    | "cards"
    | "control"
    | "lesson-plan"
    | "presentation"
    | "ktp"
    | "oge"
    | "ege";
  /** Откуда пришёл контент — для будущей аналитики. */
  source?: "mock" | "llm";
}

export interface SaveWorksheetOk {
  ok: true;
  worksheetId: string;
  generationsToday: number;
  /** -1 для base/plus (безлимит), 3 для free. */
  generationsLimit: number;
}

export type SaveWorksheetError =
  | { ok: false; error: "unauthorized" } // 401 — юзер не залогинен, для анонимного flow это silent skip
  | { ok: false; error: "validation"; details: unknown } // 400 — zod-валидация, details приходят от бэка
  | { ok: false; error: "network" } // fetch упал (offline / DNS / CORS preflight)
  | { ok: false; error: "internal" }; // 500 / unhandled

/**
 * POST /api/worksheets/save — сохранить сгенерированный (mock или LLM) лист в БД
 * и атомарно инкрементнуть счётчик `users.generations_today`.
 *
 * Не бросает наружу: всегда возвращает union, вызывающий код делает
 * discriminated narrowing.
 */
export async function saveWorksheet(
  input: SaveWorksheetInput,
): Promise<SaveWorksheetOk | SaveWorksheetError> {
  if (!API_URL) {
    // NEXT_PUBLIC_API_URL не задан — для анонимного flow это ок (silent skip),
    // но всё равно возвращаем typed error для единообразия.
    return { ok: false, error: "network" };
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/worksheets/save`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    });
  } catch {
    // Сетевая ошибка: оффлайн, CORS, DNS и т.п.
    return { ok: false, error: "network" };
  }

  // Парсим тело — даже при ошибке бэк может вернуть details для дебага.
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 200/201 без тела? Теоретически бэк всегда отвечает JSON, но на всякий случай.
    body = null;
  }

  if (res.status === 401) {
    return { ok: false, error: "unauthorized" };
  }
  if (res.status === 400) {
    const obj = (body ?? {}) as { details?: unknown; error?: unknown };
    return { ok: false, error: "validation", details: obj.details ?? body };
  }
  if (res.status >= 500) {
    return { ok: false, error: "internal" };
  }
  if (!res.ok) {
    // 4xx кроме 400/401 — считаем internal (например 429 — лимит, можно потом
    // выделить отдельный branch, но для MVP достаточно).
    return { ok: false, error: "internal" };
  }

  // 2xx — норма.
  const obj = body as Partial<SaveWorksheetOk> | null;
  if (
    !obj ||
    obj.ok !== true ||
    typeof obj.worksheetId !== "string" ||
    typeof obj.generationsToday !== "number" ||
    typeof obj.generationsLimit !== "number"
  ) {
    return { ok: false, error: "internal" };
  }

  return {
    ok: true,
    worksheetId: obj.worksheetId,
    generationsToday: obj.generationsToday,
    generationsLimit: obj.generationsLimit,
  };
}

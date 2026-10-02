/**
 * Клиент API онлайн-форм (TZ-12).
 *
 * Структура 1-в-1 по образцу `src/lib/worksheets/api.ts`:
 *   - типизированный union результата `{ ok: true, ... } | FormApiError`;
 *   - `cache: "no-store"` + `credentials: "include"` на каждом запросе;
 *   - разбор 401 / 400 / 5xx по отдельным веткам;
 *   - silent-skip при пустом `NEXT_PUBLIC_API_URL` (возвращаем `{ok:false,
 *     error:"network"}`, наружу не бросаем).
 *
 * Два разных пространства эндпоинтов, как в ТЗ §4.3:
 *   - учительские `/api/assignments/forms*` — требуют cookie, `credentials:"include"`;
 *   - публичные `/api/public/forms/:token*` — без авторизации, но с
 *     `credentials:"include"`, потому что куки на том же домене отправлять
 *     безвредно, а при вынесении API на поддомен это снимет вопрос CORS.
 *
 * Наружу функции НЕ бросают: вызывающий код делает narrowing по `ok`.
 */

import type {
  CreateFormInput,
  CreateFormOk,
  FormApiError,
  FormListItem,
  FormRecord,
  FormResponse,
  FormTask,
  PublicForm,
  SubmitFormInput,
  SubmitFormOk,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Префикс учительских форм (совпадает с `backend/src/index.ts:83`). */
const TEACHER_BASE = "/api/assignments/forms";

/* ─── Публичная часть: ученик ────────────────────────────────────────────── */

export type LoadPublicFormResult =
  | { ok: true; form: PublicForm }
  | FormApiError;

/**
 * GET /api/public/forms/:token — снимок заданий для ученика.
 *
 * В ответе **нет** `answer` / `explanation`: бэк отдаёт whitelist полей,
 * и фронт эти поля даже не запрашивает (нет таких ключей в `FormTask`).
 */
export async function loadPublicForm(
  token: string,
): Promise<LoadPublicFormResult> {
  const res = await request<{ form?: unknown }>(
    `/api/public/forms/${encodeURIComponent(token)}`,
    { method: "GET" },
  );
  if (!res.ok) return res;

  const form = parsePublicForm(res.body?.form);
  if (!form) return { ok: false, error: "internal" };
  return { ok: true, form };
}

/**
 * POST /api/public/forms/:token/submit — одна отправка = одна попытка.
 * 403 `FORM_CODE_REQUIRED` возвращается отдельной веткой: экран с кодом класса
 * должен показать поле ввода, а не «что-то сломалось».
 */
export async function submitPublicForm(
  token: string,
  input: SubmitFormInput,
): Promise<SubmitFormOk | FormApiError> {
  const res = await request<Record<string, unknown>>(
    `/api/public/forms/${encodeURIComponent(token)}/submit`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!res.ok) return res;

  const obj = res.body ?? {};
  if (
    obj.ok !== true ||
    typeof obj.scoreTotal !== "number" ||
    typeof obj.scoreMax !== "number" ||
    !Array.isArray(obj.perTask)
  ) {
    return { ok: false, error: "internal" };
  }

  return {
    ok: true,
    scoreTotal: obj.scoreTotal,
    scoreMax: obj.scoreMax,
    perTask: obj.perTask as SubmitFormOk["perTask"],
    answers: Array.isArray(obj.answers)
      ? (obj.answers as SubmitFormOk["answers"])
      : undefined,
  };
}

/* ─── Учительская часть ──────────────────────────────────────────────────── */

export async function createForm(
  input: CreateFormInput,
): Promise<CreateFormOk | FormApiError> {
  const res = await request<Record<string, unknown>>(TEACHER_BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) return res;

  const obj = res.body ?? {};
  if (
    obj.ok !== true ||
    typeof obj.formId !== "string" ||
    typeof obj.token !== "string" ||
    typeof obj.url !== "string"
  ) {
    return { ok: false, error: "internal" };
  }
  return {
    ok: true,
    formId: obj.formId,
    token: obj.token,
    url: obj.url,
    responsesCount: typeof obj.responsesCount === "number" ? obj.responsesCount : 0,
  };
}

export type ListFormsResult =
  | { ok: true; forms: FormListItem[] }
  | FormApiError;

/** GET /api/assignments/forms — список «Выданное». */
export async function listForms(): Promise<ListFormsResult> {
  const res = await request<{ forms?: unknown }>(TEACHER_BASE, { method: "GET" });
  if (!res.ok) return res;
  const forms = Array.isArray(res.body?.forms)
    ? (res.body?.forms as FormListItem[])
    : [];
  return { ok: true, forms };
}

export type GetFormResult =
  | { ok: true; form: FormRecord; responses: FormResponse[] }
  | FormApiError;

/** GET /api/assignments/forms/:id — форма + все ответы учеников. */
export async function getForm(formId: string): Promise<GetFormResult> {
  const res = await request<{ form?: unknown; responses?: unknown }>(
    `${TEACHER_BASE}/${encodeURIComponent(formId)}`,
    { method: "GET" },
  );
  if (!res.ok) return res;

  const form = res.body?.form as FormRecord | undefined;
  if (!form || typeof form.id !== "string") {
    return { ok: false, error: "internal" };
  }
  return {
    ok: true,
    form,
    responses: Array.isArray(res.body?.responses)
      ? (res.body?.responses as FormResponse[])
      : [],
  };
}

export type PatchFormResult =
  | { ok: true; token?: string; url?: string }
  | FormApiError;

/** PATCH /api/assignments/forms/:id — `close` / `reopen` / `extend` / `rotate-token`. */
export async function patchForm(
  formId: string,
  action: "close" | "reopen" | "extend" | "rotate-token",
  extra?: { days?: number },
): Promise<PatchFormResult> {
  const res = await request<Record<string, unknown>>(
    `${TEACHER_BASE}/${encodeURIComponent(formId)}`,
    { method: "PATCH", body: JSON.stringify({ action, ...(extra ?? {}) }) },
  );
  if (!res.ok) return res;
  const obj = res.body ?? {};
  if (obj.ok !== true) return { ok: false, error: "internal" };
  return {
    ok: true,
    token: typeof obj.token === "string" ? obj.token : undefined,
    url: typeof obj.url === "string" ? obj.url : undefined,
  };
}

export type FormCsvResult = { ok: true; text: string; filename: string } | FormApiError;

/**
 * GET /api/assignments/forms/:id/export.csv — выгрузка для Excel/ЭЖД.
 *
 * Файл тянем через `fetch` (а не ссылкой), потому что эндпоинт требует
 * session-cookie: обычный `<a href>` на другой домен cookie не приложит.
 * Бэк отдаёт UTF-8 **с BOM** и разделителем `;` — это гарантия «без
 * кракозябр в русском Excel», поэтому текст не перекодируем.
 */
export async function fetchFormCsv(formId: string): Promise<FormCsvResult> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}${TEACHER_BASE}/${encodeURIComponent(formId)}/export.csv`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "text/csv" },
      },
    );
  } catch {
    return { ok: false, error: "network" };
  }

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status >= 500) return { ok: false, error: "internal" };
  if (!res.ok) return { ok: false, error: "internal" };

  const text = await res.text();
  return { ok: true, text, filename: csvFilename(res.headers.get("Content-Disposition")) };
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

type RequestOk<T> = { ok: true; body: T };
type RequestResult<T> = RequestOk<T> | FormApiError;

/**
 * Общий каркас запроса: silent-skip при пустом API_URL → `network`,
 * try/catch на fetch → `network`, парсинг тела «мягкий» (бэк всегда JSON,
 * но 5xx-под прокси может вернуть HTML).
 */
async function request<T>(
  path: string,
  init: { method: string; body?: string },
): Promise<RequestResult<T>> {
  if (!API_URL) {
    // NEXT_PUBLIC_API_URL не задан. Для учительских форм это не «молчаливый
    // пропуск» — вызывающий покажет понятный экран ошибки (ТЗ §4.4, последняя
    // строка таблицы проблем статики). Сама функция не бросает наружу.
    return { ok: false, error: "network" };
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body,
    });
  } catch {
    // Оффлайн, DNS, CORS preflight.
    return { ok: false, error: "network" };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown> | null;
  } catch {
    body = null;
  }

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 403) {
    // Публичный эндпоинт: 403 = FORM_CODE_REQUIRED. Учительский 403 может быть
    // «нет прав» — трактуем его так же, отдельного кода прав у нас нет.
    return { ok: false, error: "code_required" };
  }
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (res.status === 410) {
    return { ok: false, error: closedOrExpired(body) };
  }
  if (res.status === 400) {
    return { ok: false, error: "validation", details: body?.details ?? body };
  }
  if (res.status >= 500) return { ok: false, error: "internal" };
  if (!res.ok) return { ok: false, error: "internal" };

  return { ok: true, body: (body ?? {}) as T };
}

/** 410 бывает двух видов — различаем по коду из тела ответа. */
function closedOrExpired(body: Record<string, unknown> | null): "closed" | "expired" {
  const code = typeof body?.error === "string" ? body.error : body?.code;
  return code === "FORM_EXPIRED" ? "expired" : "closed";
}

/**
 * Валидация ответа публичного эндпоинта. Сделано строго: `FormTask` — это
 * whitelist, и если бэк вдруг начнёт отдавать `answer` (или мусор вместо
 * `tasks`), мы предпочтём «не удалось загрузить», а не отрисовать мусор.
 */
function parsePublicForm(raw: unknown): PublicForm | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.title !== "string" || !Array.isArray(o.tasks)) return null;

  const tasks: FormTask[] = [];
  for (const item of o.tasks as unknown[]) {
    const t = (item ?? {}) as Record<string, unknown>;
    if (typeof t.number !== "number" || typeof t.text !== "string") return null;
    if (typeof t.type !== "string") return null;
    tasks.push({
      number: t.number,
      text: t.text,
      type: t.type as FormTask["type"],
      options: Array.isArray(t.options) ? (t.options as string[]) : undefined,
      points: typeof t.points === "number" ? t.points : 0,
    });
  }

  return {
    title: o.title,
    subject: typeof o.subject === "string" ? o.subject : "",
    grade: typeof o.grade === "number" ? o.grade : 0,
    teacherLabel: typeof o.teacherLabel === "string" ? o.teacherLabel : undefined,
    tasks,
    expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : 0,
    needsCode: o.needsCode === true,
  };
}

/** Достаём имя файла из Content-Disposition, иначе — дефолт. */
function csvFilename(header: string | null): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "otchet.csv";
}

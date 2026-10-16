/**
 * Клиент API страницы ученика по короткому коду (TZ-28).
 *
 * Почему НЕ в `src/lib/`: этот эндпоинт появился вместе с ТЗ-28, а `lib/` на
 * этой странице принадлежит соседним листам. Держать клиент здесь — значит
 * владеть им целиком: при следующем изменении никто не сломает его правкой
 * чужого файла.
 *
 * Каркас запросов повторяет `src/lib/forms/api.ts` намеренно: типизированный
 * union `{ ok: true, … } | { ok: false, error }`, `credentials: "include"`
 * (cookie ученика ставит сервер на логине по коду) и silent-skip при пустом
 * `NEXT_PUBLIC_API_URL`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export type StudentApiError =
  | "network"
  | "not_found"
  | "ambiguous"
  | "validation"
  | "rate_limited"
  | "closed"
  | "photo_too_large"
  | "internal";

export interface ClassTaskItem {
  token: string;
  title: string;
  subject: string;
  grade: number;
  open: boolean;
  answered: boolean;
  answeredAt: number | null;
  scoreTotal: number | null;
  scoreMax: number | null;
}

export type LoadClassResult =
  | { ok: true; needName: true }
  | { ok: true; needName: false; className: string; studentName: string; tasks: ClassTaskItem[] }
  | { ok: false; error: StudentApiError };

/**
 * GET /api/classes/code/:code/tasks — задания класса.
 *
 * Сервер сам решает, знаем ли мы ученика: cookie с его токеном ставится при
 * входе по фамилии. Поэтому клиент ничего не передаёт и не может «попросить»
 * чужие задания.
 */
export async function loadClass(code: string): Promise<LoadClassResult> {
  const res = await request<Record<string, unknown>>(`/api/classes/code/${encodeURIComponent(code)}/tasks`);
  if (!res.ok) return res;
  const body = res.body;
  if (body.needName === true) return { ok: true, needName: true };

  const tasks = Array.isArray(body.tasks) ? (body.tasks as ClassTaskItem[]) : [];
  return {
    ok: true,
    needName: false,
    className: typeof body.className === "string" ? body.className : "",
    studentName: typeof body.studentName === "string" ? body.studentName : "",
    tasks: tasks.filter((t) => typeof t?.token === "string"),
  };
}

export type LoginResult =
  | { ok: true; studentName: string; className: string }
  | { ok: false; error: StudentApiError };

/** POST /api/classes/code/:code/login — «кто я» по фамилии. Регион: cookie. */
export async function loginByName(code: string, name: string): Promise<LoginResult> {
  const res = await request<Record<string, unknown>>(`/api/classes/code/${encodeURIComponent(code)}/login`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return res;
  return {
    ok: true,
    studentName: typeof res.body.studentName === "string" ? res.body.studentName : name,
    className: typeof res.body.className === "string" ? res.body.className : "",
  };
}

/** Задание по коду класса: те же поля, что у общей ссылки. */
export interface LinkFormSnapshot {
  title: string;
  subject: string;
  grade: number;
  tasks: Array<{
    number: number;
    text: string;
    type: string;
    options?: string[];
    points: number;
  }>;
}

export type LoadCodeFormResult =
  | { ok: true; form: LinkFormSnapshot }
  | { ok: false; error: StudentApiError };

export async function loadCodeForm(
  code: string,
  formToken: string,
): Promise<LoadCodeFormResult> {
  const res = await request<Record<string, unknown>>(
    `/api/classes/code/${encodeURIComponent(code)}/forms/${encodeURIComponent(formToken)}`,
  );
  if (!res.ok) return res;
  const form = (res.body.form ?? {}) as Record<string, unknown>;
  if (typeof form.title !== "string" || !Array.isArray(form.tasks)) {
    return { ok: false, error: "internal" };
  }
  const tasks = (form.tasks as Array<Record<string, unknown>>)
    .filter((t) => typeof t.number === "number" && typeof t.text === "string")
    .map((t) => ({
      number: Number(t.number),
      text: String(t.text),
      type: typeof t.type === "string" ? t.type : "text",
      options: Array.isArray(t.options) ? (t.options as string[]) : undefined,
      points: typeof t.points === "number" ? t.points : 0,
    }));
  return {
    ok: true,
    form: {
      title: form.title,
      subject: typeof form.subject === "string" ? form.subject : "",
      grade: typeof form.grade === "number" ? form.grade : 0,
      tasks,
    },
  };
}

export interface SubmitLinkOk {
  ok: true;
  scoreTotal: number;
  scoreMax: number;
  photosSaved: number;
  perTask: Array<{ taskNumber: number; status: "correct" | "wrong" | "unreviewed" }>;
}

export type SubmitLinkResult = SubmitLinkOk | { ok: false; error: StudentApiError };

/**
 * POST .../submit по коду класса.
 *
 * Имя ученика здесь не передаётся СОВСЕ: его подставляет сервер по cookie.
 * Так ученик не может случайно сдать работу под чужим именем, а «Иванова» и
 * «иванова» не порождают двух разных учеников в ведомости.
 */
export async function submitCodeForm(
  code: string,
  formToken: string,
  input: { answers: Array<{ taskNumber: number; value: string; photoR2Key?: string }> },
): Promise<SubmitLinkResult> {
  const res = await request<Record<string, unknown>>(
    `/api/classes/code/${encodeURIComponent(code)}/forms/${encodeURIComponent(formToken)}/submit`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!res.ok) return res;
  const body = res.body;
  if (body.ok !== true || typeof body.scoreTotal !== "number" || !Array.isArray(body.perTask)) {
    return { ok: false, error: "internal" };
  }
  return {
    ok: true,
    scoreTotal: body.scoreTotal,
    scoreMax: typeof body.scoreMax === "number" ? body.scoreMax : 0,
    photosSaved: typeof body.photosSaved === "number" ? body.photosSaved : 0,
    perTask: body.perTask as SubmitLinkOk["perTask"],
  };
}

/**
 * POST .../photo — сфотографировать задание тетради.
 *
 * Отдельный запрос до отправки работы, а не поле внутри неё: фото 2–5 МБ нельзя
 * держать в теле JSON, и при обрыве связи повторная отправка работы не должна
 * тащить фото заново.
 */
export async function uploadTaskPhoto(
  code: string,
  formToken: string,
  blob: Blob,
): Promise<{ ok: true; photoR2Key: string } | { ok: false; error: StudentApiError }> {
  if (!API_URL) return { ok: false, error: "network" };

  const body = new FormData();
  body.append("photo", blob, "photo.jpg");

  try {
    const res = await fetch(
      `${API_URL}/api/classes/code/${encodeURIComponent(code)}/forms/${encodeURIComponent(formToken)}/photo`,
      { method: "POST", credentials: "include", body },
    );
    if (res.status === 404) return { ok: false, error: "not_found" };
    if (res.status === 413) return { ok: false, error: "photo_too_large" };
    if (res.status === 415) return { ok: false, error: "validation" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) return { ok: false, error: "internal" };
    const parsed = (await res.json()) as { photoR2Key?: unknown };
    if (typeof parsed.photoR2Key !== "string") return { ok: false, error: "internal" };
    return { ok: true, photoR2Key: parsed.photoR2Key };
  } catch {
    return { ok: false, error: "network" };
  }
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

type RequestOk<T> = { ok: true; body: T };
type RequestResult<T> = RequestOk<T> | { ok: false; error: StudentApiError };

/**
 * Тело ошибки — код из `{"error": "…"}` бэкенда: по нему страница различает
 * «не нашли» и «спросите ещё и имя», не разбирая текст сообщения.
 */
async function request<T>(
  path: string,
  init?: { method?: string; body?: string },
): Promise<RequestResult<T>> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init?.body,
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

  if (res.status === 404) return { ok: false, error: codeOf(body) ?? "not_found" };
  if (res.status === 410) return { ok: false, error: "closed" };
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (res.status === 400 || res.status === 415) return { ok: false, error: "validation" };
  if (res.status >= 500) return { ok: false, error: "internal" };
  if (!res.ok) return { ok: false, error: "internal" };

  return { ok: true, body: (body ?? {}) as T };
}

function codeOf(body: Record<string, unknown> | null): StudentApiError | null {
  const code = body?.error ?? body?.code;
  if (code === "STUDENT_NAME_AMBIGUOUS") return "ambiguous";
  if (code === "CLASS_CODE_NOT_FOUND") return "not_found";
  return null;
}
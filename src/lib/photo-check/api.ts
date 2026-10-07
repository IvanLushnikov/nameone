/**
 * Клиент проверки работ по фото (TZ-11 §4.5).
 *
 * Структура 1-в-1 по образцу `src/lib/forms/api.ts`:
 *   - типизированный union `{ ok: true, ... } | PhotoCheckApiError`;
 *   - `cache: "no-store"` + `credentials: "include"` на каждом запросе;
 *   - наружу функции НЕ бросают — вызывающий делает narrowing по `ok`.
 *
 * Отличие от форм: запрос — multipart (фото бинарное), поэтому Content-Type
 * НЕ выставляем вручную — его проставит браузер вместе с boundary.
 */

import {
  CONSENT_VERSION,
  type PhotoCheckHistoryItem,
  type PhotoCheckResult,
  type PhotoCheckTask,
  type Quota,
} from "./types";
import type { InterviewQuestionsResult } from "./interview";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Префикс совпадает с монтированием в backend/src/index.ts. */
const BASE = "/api/assignments/photo-checks";

export type PhotoCheckApiErrorCode =
  | "unauthorized"
  | "quota"
  | "network"
  | "no_api_url"
  | "too_large"
  | "bad_request"
  | "llm_unavailable"
  | "not_found"
  | "http";

export type PhotoCheckApiError = {
  ok: false;
  error: PhotoCheckApiErrorCode;
  /** Текст для показа учителю. Если пусто — берём дефолт по error. */
  message?: string;
  status?: number;
};

export const ERROR_TEXT: Record<PhotoCheckApiErrorCode, string> = {
  no_api_url: "Сервер проверки не настроен. Попробуйте позже.",
  unauthorized: "Войдите в аккаунт, чтобы проверять работы по фото.",
  quota: "Месячный лимит проверок исчерпан. Обновится 1-го числа.",
  too_large: "Фото больше 8 МБ. Снимите в меньшем разрешении.",
  bad_request: "Не удалось прочитать фото. Попробуйте переснять.",
  llm_unavailable: "Проверка временно недоступна, попробуйте через минуту.",
  not_found: "Проверка не найдена.",
  network: "Сеть недоступна. Проверьте соединение.",
  http: "Что-то пошло не так. Попробуйте ещё раз.",
};

function fail(error: PhotoCheckApiErrorCode, message?: string, status?: number): PhotoCheckApiError {
  return { ok: false, error, message: message || ERROR_TEXT[error], status };
}

/**
 * Человеческий текст ошибки из тела ответа.
 *
 * Бэк отдаёт `{ ok: false, error: <текст>, code: <CODE> }`
 * (`backend/src/middleware/error.ts`), но шлюзы и прокси перед ним любят
 * присылать `message`/`detail`, а иногда — только код. Учителю 45+ нужен текст
 * («нужен тариф», «до 3 фото за раз»), поэтому берём первое непустое из трёх
 * полей. Код вида `TOO_MANY_FILES` текстом НЕ считаем: это машинная метка, и на
 * экране она читалась бы хуже, чем внятный текст по типу ошибки из ERROR_TEXT.
 */
function serverText(json: unknown): string | undefined {
  const body = (json ?? {}) as { error?: unknown; message?: unknown; detail?: unknown };
  for (const value of [body.error, body.message, body.detail]) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (/^[A-Z][A-Z0-9_]*$/.test(text)) continue;
    return text;
  }
  return undefined;
}

/** Разбор ответа бэка в наш union. Никогда не бросает. */
function parseResult(res: Response, json: unknown): PhotoCheckApiError | null {
  if (res.ok) return null;
  const err = (json as { code?: string } | null) ?? {};
  const code = (err.code ?? "").toUpperCase();
  const text = serverText(json);

  if (res.status === 401) return fail("unauthorized", text);
  if (res.status === 402) return fail("quota", text, res.status);
  if (res.status === 413) return fail("too_large", text, res.status);
  if (res.status === 404) return fail("not_found", text, res.status);
  if (res.status === 503 || code === "LLM_UNAVAILABLE") {
    return fail("llm_unavailable", text, res.status);
  }
  if (res.status === 400) return fail("bad_request", text, res.status);
  return fail("http", text, res.status);
}

/**
 * POST /photo-checks — отправить фото работы на проверку.
 *
 * `blobs` — от одной до трёх страниц, ПОРЯДОК ЗНАЧИТ: он равен порядку страниц
 * в тетради, и модель читает их именно так. Поэтому файлы кладутся в FormData
 * под одним именем `image` по очереди — `getAll("image")` на бэке отдаёт их в
 * том же порядке.
 *
 * `detail` выбирает режим распознавания: `low` — обычная проверка (экономит
 * токены картинки в разы), `high` — финальная выверка. По умолчанию `low`.
 */
export async function runPhotoCheck(args: {
  blobs: Blob[];
  tasks: PhotoCheckTask[];
  worksheetId?: string | null;
  subject?: string | null;
  grade?: number | null;
  detail?: "low" | "high";
}): Promise<PhotoCheckResult | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");

  const fd = new FormData();
  args.blobs.forEach((blob, i) => fd.append("image", blob, `page-${i + 1}.jpg`));
  fd.append("tasks", JSON.stringify(args.tasks));
  // Согласие на обработку ПДн (В-2.2). Чекбокс в UI → true здесь.
  // Это фиксация ТЕХНИЧЕСКОГО факта, а не юридическое основание (В-2.1 — открыто).
  fd.append("consent", "true");
  fd.append("consentVersion", String(CONSENT_VERSION));
  fd.append("detail", args.detail ?? "low");
  if (args.worksheetId) fd.append("worksheetId", args.worksheetId);
  if (args.subject) fd.append("subject", args.subject);
  if (args.grade != null) fd.append("grade", String(args.grade));

  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}`, {
      method: "POST",
      body: fd,
      credentials: "include",
      cache: "no-store",
      // Content-Type намеренно НЕ задаём — браузер сам проставит boundary.
    });
  } catch {
    return fail("network");
  }

  const json = (await res.json().catch(() => null)) as PhotoCheckResult | null;
  const err = parseResult(res, json);
  if (err) return err;
  if (!json || json.ok !== true) return fail("http");
  return json;
}

/** GET /photo-checks — история проверок пользователя. */
export async function loadPhotoChecks(
  limit = 20,
): Promise<{ ok: true; checks: PhotoCheckHistoryItem[] } | PhotoCheckApiError> {
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
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    checks?: PhotoCheckHistoryItem[];
  } | null;
  const err = parseResult(res, json);
  if (err) return err;
  return { ok: true, checks: json?.checks ?? [] };
}

/** GET /photo-checks/:id — открыть сохранённую проверку. */
export async function loadPhotoCheck(
  id: string,
): Promise<PhotoCheckResult | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}/${encodeURIComponent(id)}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    return fail("network");
  }
  const json = (await res.json().catch(() => null)) as PhotoCheckResult | null;
  const err = parseResult(res, json);
  if (err) return err;
  if (!json || json.ok !== true) return fail("http");
  return json;
}

/**
 * POST /photo-checks/:id/manual-marks — сохранить ручные отметки учителя.
 *
 * Вызывается ТОЛЬКО по явному нажатию кнопки. Автосейва на каждый чекбокс здесь
 * быть не должно: клик мимоходом не должен означать согласие с чужой оценкой.
 *
 * Ответ — тот же DTO проверки, что у GET, но уже с пересчитанным итогом:
 * учитель сразу видит отметку и то, кто её поставил.
 */
export async function saveManualMarks(
  checkId: string,
  marks: Array<{ taskNumber: number; accepted: boolean; points: number }>,
): Promise<PhotoCheckResult | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}${BASE}/${encodeURIComponent(checkId)}/manual-marks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ marks }),
      },
    );
  } catch {
    return fail("network");
  }

  const json = (await res.json().catch(() => null)) as PhotoCheckResult | null;
  const err = parseResult(res, json);
  if (err) return err;
  if (!json || json.ok !== true) return fail("http");
  return json;
}

/** GET /photo-checks/usage — остаток месячной квоты. */
export async function loadPhotoCheckQuota(): Promise<
  { ok: true; quota: Quota } | PhotoCheckApiError
> {
  if (!API_URL) return fail("no_api_url");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}/usage`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    return fail("network");
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; quota?: Quota } | null;
  const err = parseResult(res, json);
  if (err) return err;
  if (!json?.quota) return fail("http");
  return { ok: true, quota: json.quota };
}

/**
 * DELETE /photo-checks/:id — удалить фото одной кнопкой (В-2.3).
 * Результаты проверки остаются, исходный снимок стирается безвозвратно.
 */
export async function deletePhotoCheck(
  id: string,
): Promise<{ ok: true; alreadyDeleted?: boolean } | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    return fail("network");
  }
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; alreadyDeleted?: boolean }
    | null;
  const err = parseResult(res, json);
  if (err) return err;
  return { ok: true, alreadyDeleted: json?.alreadyDeleted };
}

// ─────────────────────────────────────────────────────────────────────────────
// F-06.1 «Вопросы для беседы» (TZ-17)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /photo-checks/:id/interview-questions — задать вопросы к работе.
 *
 * Текстовый вызов: фото повторно НЕ отправляется, берутся уже распознанные
 * ответы ученика из D1. Поэтому работает и после того, как снимок тетради уже
 * удалён по семидневному retention.
 *
 * `taskNumbers` — что спросить. Если не передавать, бэк берёт дефолт: задания,
 * которые он не разобрал или где ответ неверный. Это ДЕФОЛТ, а не запрет —
 * учитель вправе спросить про любое задание, включая то, где ответ верный.
 */
export async function generateInterviewQuestions(args: {
  checkId: string;
  taskNumbers?: number[];
  regenerate?: boolean;
}): Promise<InterviewQuestionsResult | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}${BASE}/${encodeURIComponent(args.checkId)}/interview-questions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          ...(args.taskNumbers?.length ? { taskNumbers: args.taskNumbers } : {}),
          regenerate: args.regenerate ?? false,
        }),
      },
    );
  } catch {
    return fail("network");
  }

  const json = (await res.json().catch(() => null)) as InterviewQuestionsResult | null;
  const err = parseResult(res, json);
  if (err) return err;
  if (!json || json.ok !== true) return fail("http");
  return json;
}

/**
 * GET /photo-checks/:id/interview-questions — прочитать уже сохранённые
 * вопросы, если набор для этой проверки уже генерировали.
 *
 * Отдельная точка входа для сценария «вернулся к старой домашке спросить ещё».
 * Пустой список — это не ошибка, а «вопросов ещё не составляли».
 */
export async function loadInterviewQuestions(
  checkId: string,
): Promise<
  | { ok: true; questions: InterviewQuestionsResult["questions"]; disclaimer?: string }
  | PhotoCheckApiError
> {
  if (!API_URL) return fail("no_api_url");
  let res: Response;
  try {
    res = await fetch(
      `${API_URL}${BASE}/${encodeURIComponent(checkId)}/interview-questions`,
      { method: "GET", credentials: "include", cache: "no-store" },
    );
  } catch {
    return fail("network");
  }
  const json = (await res.json().catch(() => null)) as
    | { questions?: InterviewQuestionsResult["questions"]; disclaimer?: string }
    | null;
  const err = parseResult(res, json);
  if (err) return err;
  return { ok: true, questions: json?.questions ?? [], disclaimer: json?.disclaimer };
}

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

/** Разбор ответа бэка в наш union. Никогда не бросает. */
function parseResult(res: Response, json: unknown): PhotoCheckApiError | null {
  if (res.ok) return null;
  const err = (json as { error?: string; code?: string } | null) ?? {};
  const code = (err.code ?? "").toUpperCase();

  if (res.status === 401) return fail("unauthorized", err.error);
  if (res.status === 402) return fail("quota", err.error, res.status);
  if (res.status === 413) return fail("too_large", err.error, res.status);
  if (res.status === 404) return fail("not_found", err.error, res.status);
  if (res.status === 503 || code === "LLM_UNAVAILABLE") {
    return fail("llm_unavailable", err.error, res.status);
  }
  if (res.status === 400) return fail("bad_request", err.error, res.status);
  return fail("http", err.error, res.status);
}

/**
 * POST /photo-checks — отправить фото на проверку.
 *
 * `detail` выбирает режим распознавания: `low` — обычная проверка (экономит
 * токены картинки в разы), `high` — финальная выверка. По умолчанию `low`.
 */
export async function runPhotoCheck(args: {
  blob: Blob;
  tasks: PhotoCheckTask[];
  worksheetId?: string | null;
  subject?: string | null;
  grade?: number | null;
  detail?: "low" | "high";
}): Promise<PhotoCheckResult | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");

  const fd = new FormData();
  fd.append("image", args.blob, "page.jpg");
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

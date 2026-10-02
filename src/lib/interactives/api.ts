/**
 * Клиент API интерактивов (TZ-13 §4.5).
 *
 * Структура 1-в-1 по образцу `src/lib/forms/api.ts` (TZ-12):
 *   - типизированный union результата `{ ok: true, ... } | InteractiveApiError`;
 *   - `cache: "no-store"` + `credentials: "include"` на каждом запросе;
 *   - разбор 401 / 404 / 410 / 429 / 5xx по отдельным веткам;
 *   - silent-skip при пустом `NEXT_PUBLIC_API_URL` (возвращаем `{ok:false,
 *     error:"network"}`, наружу не бросаем).
 *
 * Два пространства эндпоинтов — так же, как у TZ-12:
 *   - учительские `/api/interactives*` — требуют cookie;
 *   - публичные `/api/public/interactives/:token*` — без авторизации, но с
 *     `credentials:"include"`: куки на том же домене отправлять безвредно, а
 *     при вынесении API на поддомен это снимет вопрос CORS.
 *
 * ⚠️ Публичный ответ РАЗБИРАЕТСЯ WHITELIST'ОМ (см. `parsePublicInteractive`):
 * бэк не должен отдавать `user_id` / email учителя (ТЗ §7), но даже если
 * отдаст — фронт такое поле не подхватит и в `config` оно не попадёт.
 */

import type {
  AttemptRow,
  ClientAttemptAnswer,
  InteractiveApiError,
  InteractiveListItem,
  InteractiveOptions,
  InteractiveRecord,
  ItemStat,
  PublicInteractive,
  StartAttemptOk,
  SubmitAttemptInput,
  SubmitAttemptOk,
} from "./types";
import { INTERACTIVE_FORMATS, type InteractiveFormat, type InteractiveItem } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Префикс учительских интерактивов (ТЗ §4.5). */
const TEACHER_BASE = "/api/interactives";
/** Префикс публичной части — тот же, что у TZ-12 для форм. */
const PUBLIC_BASE = "/api/public/interactives";

/* ─── Публичная часть: ученик ────────────────────────────────────────────── */

export type LoadPublicInteractiveResult =
  | { ok: true; interactive: PublicInteractive }
  | InteractiveApiError;

/**
 * GET /api/public/interactives/:token — конфиг интерактива для ученика.
 *
 * Возвращает ровно `InteractiveConfig` + шапка. Всё, чего нет в
 * `PublicInteractive`, игнорируется: «мусор в ответе» должен приводить к
 * аккуратной ошибке, а не к отрисовке чужеродного объекта в плеере.
 */
export async function loadPublicInteractive(
  token: string,
): Promise<LoadPublicInteractiveResult> {
  const res = await request<{ interactive?: unknown }>(
    `${PUBLIC_BASE}/${encodeURIComponent(token)}`,
    { method: "GET" },
  );
  if (!res.ok) return res;

  const interactive = parsePublicInteractive(res.body?.interactive);
  if (!interactive) return { ok: false, error: "internal" };
  return { ok: true, interactive };
}

/**
 * POST /api/public/interactives/:token/attempts — начать или продолжить попытку.
 *
 * Возвращает `attemptToken`, по которому ученик может закрыть вкладку и вернуться
 * (ТЗ сценарий B, шаг 6). Если сервер уже видел этот токен — попытка та же самая,
 * счёт не обнуляется.
 */
export async function startAttempt(
  token: string,
  input: { attemptToken?: string; studentName: string; studentClass?: string },
): Promise<StartAttemptOk | InteractiveApiError> {
  const res = await request<Record<string, unknown>>(
    `${PUBLIC_BASE}/${encodeURIComponent(token)}/attempts`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!res.ok) return res;

  const obj = res.body ?? {};
  if (obj.ok !== true || typeof obj.attemptToken !== "string") {
    return { ok: false, error: "internal" };
  }
  return {
    ok: true,
    attemptToken: obj.attemptToken,
    resumed: obj.resumed === true,
  };
}

/**
 * POST /api/public/interactives/:token/attempts/:attemptToken/submit.
 *
 * Клиент присылает СВОЙ счёт (чтобы показать ученику итог сразу и не зависеть от
 * сети), но сервер пересчитывает его из `config_json` и не доверяет присланному
 * (ТЗ §4.7). Поэтому ответ читаем как источник истины и показываем именно его.
 */
export async function submitAttempt(
  token: string,
  attemptToken: string,
  input: Omit<SubmitAttemptInput, "answers"> & { answers: ClientAttemptAnswer[] },
): Promise<SubmitAttemptOk | InteractiveApiError> {
  const res = await request<Record<string, unknown>>(
    `${PUBLIC_BASE}/${encodeURIComponent(token)}/attempts/${encodeURIComponent(attemptToken)}/submit`,
    { method: "POST", body: JSON.stringify(input) },
  );
  if (!res.ok) return res;

  const obj = res.body ?? {};
  if (
    obj.ok !== true ||
    typeof obj.score !== "number" ||
    typeof obj.maxScore !== "number" ||
    typeof obj.percent !== "number" ||
    typeof obj.stars !== "number"
  ) {
    return { ok: false, error: "internal" };
  }
  return {
    ok: true,
    score: obj.score,
    maxScore: obj.maxScore,
    percent: obj.percent,
    stars: obj.stars,
    attemptsCount: typeof obj.attemptsCount === "number" ? obj.attemptsCount : undefined,
  };
}

/* ─── Учительская часть ──────────────────────────────────────────────────── */

export type ListInteractivesResult =
  | { ok: true; interactives: InteractiveListItem[] }
  | InteractiveApiError;

/**
 * GET /api/interactives — список «Интерактивы» в ЛК (сценарий C, шаг 1).
 *
 * ⚠️ Эндпоинта списка нет в таблице ТЗ §4.5 (там только `:id`, `:id/attempts`,
 * `:id/attempts.csv` и `PATCH`). Без него экран учителя не собрать, поэтому
 * используем `GET /api/interactives` и просим бэкенд-воркера его добавить —
 * блокер Б-10 в отчёте. Форма ответа повторяет `GET /api/assignments/forms`.
 */
export async function listInteractives(): Promise<ListInteractivesResult> {
  const res = await request<{ interactives?: unknown }>(TEACHER_BASE, { method: "GET" });
  if (!res.ok) return res;
  const interactives = Array.isArray(res.body?.interactives)
    ? (res.body?.interactives as InteractiveListItem[])
    : [];
  return { ok: true, interactives };
}

export type GetInteractiveResult =
  | { ok: true; record: InteractiveRecord }
  | InteractiveApiError;

/** GET /api/interactives/:id — конфиг + счётчики для сводки учителя. */
export async function getInteractive(id: string): Promise<GetInteractiveResult> {
  const res = await request<{ interactive?: unknown }>(
    `${TEACHER_BASE}/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
  if (!res.ok) return res;

  const raw = res.body?.interactive as InteractiveRecord | undefined;
  if (!raw || typeof raw.id !== "string" || !raw.config) {
    return { ok: false, error: "internal" };
  }
  return { ok: true, record: raw };
}

export type GetInteractiveAttemptsResult =
  | { ok: true; attempts: AttemptRow[]; hardestItems: ItemStat[] }
  | InteractiveApiError;

/**
 * GET /api/interactives/:id/attempts — все попытки + топ проваленных вопросов
 * (сценарий C, шаг 2: «какой вопрос все провалили»).
 */
export async function getInteractiveAttempts(
  id: string,
): Promise<GetInteractiveAttemptsResult> {
  const res = await request<{ attempts?: unknown; hardestItems?: unknown }>(
    `${TEACHER_BASE}/${encodeURIComponent(id)}/attempts`,
    { method: "GET" },
  );
  if (!res.ok) return res;
  return {
    ok: true,
    attempts: Array.isArray(res.body?.attempts)
      ? (res.body?.attempts as AttemptRow[])
      : [],
    hardestItems: Array.isArray(res.body?.hardestItems)
      ? (res.body?.hardestItems as ItemStat[])
      : [],
  };
}

export type InteractiveCsvResult =
  | { ok: true; text: string; filename: string }
  | InteractiveApiError;

/**
 * GET /api/interactives/:id/attempts.csv — CSV для журнала (сценарий C, шаг 3).
 *
 * Тянем через `fetch`, а не ссылкой: эндпоинт требует session-cookie, обычный
 * `<a href>` на другой домен cookie не приложит. Текст не перекодируем — бэк
 * кладёт UTF-8 BOM и разделитель `;` ради русского Excel.
 */
export async function fetchInteractiveCsv(id: string): Promise<InteractiveCsvResult> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}${TEACHER_BASE}/${encodeURIComponent(id)}/attempts.csv`,
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

export type PatchInteractiveResult = { ok: true } | InteractiveApiError;

/**
 * PATCH /api/interactives/:id — `archive` / `reopen` / `rename` / `expected`.
 *
 * `expected` с `expectedStudents` — это «сколько учеников в классе», из которого
 * сводка «14 из 28» берёт вторую цифру. Список класса мы не собираем (ТЗ §7),
 * поэтому это единственный способ её узнать: учитель называет число сам.
 * ⚠️ Эндпоинта с таким action в таблице ТЗ §4.5 нет — бэкенд-воркер должен его
 * добавить (см. блокеры в отчёте).
 */
/* ─── Создание ───────────────────────────────────────────────────────────── */

/** Ответ `POST /api/interactives` — всё, что нужно учителю для выдачи. */
export interface CreateInteractiveOk {
  id: string;
  shareToken: string;
  /** Ссылка, которую открывает ученик (ТЗ §3, сценарий A, шаг 8). */
  url: string;
  /** То же самое для QR — отдельное поле, чтобы фронт не собирал URL сам. */
  qrPayload: string;
}

export type CreateInteractiveResult =
  | { ok: true; interactive: CreateInteractiveOk }
  | InteractiveApiError;

/**
 * POST /api/interactives — создать интерактив из готового листа (ТЗ §4.5).
 *
 * Сервер достаёт `payload_json` листа, зовёт LLM-ранклер с валидатором и
 * возвращает ссылку + QR. Клиент счёт не присылает и не «договаривается» —
 * это единственная точка, где интерактив вообще появляется, поэтому до неё
 * фича была недостижима из интерфейса.
 *
 * `worksheetId` — id листа В БАЗЕ (тот, что вернул `POST /api/worksheets/save`),
 * а не клиентский id из localStorage: бэк берёт по нему `payload_json`.
 */
export async function createInteractive(input: {
  worksheetId: string;
  format: InteractiveFormat;
  options?: Record<string, unknown>;
}): Promise<CreateInteractiveResult> {
  const res = await request<Record<string, unknown>>(TEACHER_BASE, {
    method: "POST",
    body: JSON.stringify({
      worksheetId: input.worksheetId,
      format: input.format,
      options: input.options ?? {},
    }),
  });
  if (!res.ok) return res;
  const b = res.body;
  if (b?.ok !== true) return { ok: false, error: "internal" };

  const id = typeof b.id === "string" ? b.id : null;
  const shareToken = typeof b.shareToken === "string" ? b.shareToken : null;
  if (!id || !shareToken) return { ok: false, error: "internal" };

  // Ссылку собираем на клиенте только если бэк её не прислал: адрес фронта
  // клиенту известен из NEXT_PUBLIC_API_URL/окна, а бэк про него не знает.
  const url =
    typeof b.url === "string" && b.url
      ? b.url
      : `${typeof window !== "undefined" ? window.location.origin : ""}/play/?t=${shareToken}`;

  return {
    ok: true,
    interactive: {
      id,
      shareToken,
      url,
      qrPayload: typeof b.qrPayload === "string" && b.qrPayload ? b.qrPayload : url,
    },
  };
}

export async function patchInteractive(
  id: string,
  action: "archive" | "reopen" | "rename" | "expected",
  extra?: { title?: string; expectedStudents?: number },
): Promise<PatchInteractiveResult> {
  const res = await request<Record<string, unknown>>(
    `${TEACHER_BASE}/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ action, ...(extra ?? {}) }) },
  );
  if (!res.ok) return res;
  if (res.body?.ok !== true) return { ok: false, error: "internal" };
  return { ok: true };
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

/**
 * Успешный ответ, уже приведённый к типу вызывающего.
 *
 * Раньше сигнатура была `RequestResult & { body?: T }` — пересечение, в
 * котором `body` должен был быть одновременно `Record<string, unknown>` и `T`,
 * то есть успешная ветка не собиралась. Union честнее: в `ok: true` тело
 * заявлено нужным типом, в ошибке его нет.
 */
type RequestResultAs<T> = { ok: true; body: T } | InteractiveApiError;

/**
 * Общий каркас запроса: silent-skip при пустом API_URL → `network`,
 * try/catch на fetch → `network`, «мягкий» парсинг тела (5xx под прокси
 * может вернуть HTML), ветки 401 / 404 / 410 / 429 / 400 / 5xx.
 */
async function request<T>(
  path: string,
  init: { method: string; body?: string },
): Promise<RequestResultAs<T>> {
  if (!API_URL) return { ok: false, error: "network" };

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
  // 410 бывает двух видов — различаем по коду из тела ответа.
  if (res.status === 410) return { ok: false, error: closedOrExpired(body) };
  if (res.status === 403) return { ok: false, error: "closed" };
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  if (res.status === 400) {
    return { ok: false, error: "validation", details: body?.details ?? body };
  }
  if (res.status >= 500) return { ok: false, error: "internal" };
  if (!res.ok) return { ok: false, error: "internal" };

  // Тело приходит с сервера как `unknown` по своей природе: конкретную форму
  // гарантирует zod-схема бэка, а здесь мы уже в ветке `res.ok`. Приводим к
  // `T` один раз, чтобы вызывающий не кастовал каждое поле ответа руками.
  return { ok: true, body: (body ?? {}) as T };
}

function closedOrExpired(body: Record<string, unknown> | null): "closed" | "expired" {
  const code = typeof body?.error === "string" ? body.error : body?.code;
  return code === "INTERACTIVE_EXPIRED" ? "expired" : "closed";
}

/**
 * Whitelist-разбор публичного ответа.
 *
 * Сделано строго: без `format` из известных шести или без непустого `items`
 * показываем «не удалось загрузить», а не рисуем полупустой плеер (ТЗ Р-3).
 * Поля, которых нет в `PublicInteractive`, просто не читаются.
 */
export function parsePublicInteractive(raw: unknown): PublicInteractive | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.format !== "string") return null;
  if (!(INTERACTIVE_FORMATS as readonly string[]).includes(o.format)) return null;
  if (!Array.isArray(o.items)) return null;

  const items: InteractiveItem[] = [];
  for (const rawItem of o.items as unknown[]) {
    const item = parseItem(rawItem);
    if (!item) return null;
    items.push(item);
  }

  return {
    format: o.format as InteractiveFormat,
    title: typeof o.title === "string" && o.title ? o.title : "Интерактив",
    items,
    options: parseOptions(o.options),
    schemaVersion: typeof o.schemaVersion === "number" ? o.schemaVersion : 1,
    subject: typeof o.subject === "string" ? o.subject : undefined,
    grade: typeof o.grade === "number" ? o.grade : undefined,
    teacherLabel: typeof o.teacherLabel === "string" ? o.teacherLabel : undefined,
    expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : undefined,
  };
}

function parseItem(raw: unknown): InteractiveItem | null {
  const i = (raw ?? {}) as Record<string, unknown>;
  if (typeof i.id !== "string" || !i.id) return null;
  if (typeof i.prompt !== "string") return null;

  const item: InteractiveItem = { id: i.id, prompt: i.prompt };

  if (Array.isArray(i.options)) {
    item.options = i.options.filter((v): v is string => typeof v === "string");
  }
  if (typeof i.correctIndex === "number") item.correctIndex = i.correctIndex;
  if (typeof i.isTrue === "boolean") item.isTrue = i.isTrue;
  if (typeof i.svg === "string") item.svg = i.svg;
  if (typeof i.bucket === "string") item.bucket = i.bucket;
  if (typeof i.points === "number") item.points = i.points;
  if (typeof i.orderIndex === "number") item.orderIndex = i.orderIndex;
  if (typeof i.isTrap === "boolean") item.isTrap = i.isTrap;
  if (typeof i.correctBucket === "string") item.correctBucket = i.correctBucket;
  return item;
}

/** Опции приходят как произвольный JSON — приводим к типу, дальше их чистит `normalizeOptions`. */
function parseOptions(raw: unknown): InteractiveOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) } as InteractiveOptions;
}

/** Достаём имя файла из Content-Disposition, иначе — дефолт. */
function csvFilename(header: string | null): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "interactives.csv";
}

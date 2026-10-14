/**
 * Типы и клиент журнала работ, сданных через форму (лист 3.1.6).
 *
 * Отдельный файл от `lib/photo-check/journal.ts`, потому что это ДРУГАЯ лента:
 * там — проверки по фото, здесь — работы, которые ученики сдали по ссылке.
 * Смешать их в одном модуле значило бы потом искать, где чей BASE.
 *
 * ГЛАВНОЕ, РАДИ ЧЕГО ФАЙЛ СУЩЕСТВУЕТ: в журнале должны быть РАЗНЫЕ подписи.
 * «Верно» от модели, «верно» от учителя и «мы не уверены» — три разных
 * события. Если подписи совпадут, журнал начнёт врать, а учитель не сможет
 * понять, какие работы он уже смотрел глазами.
 *
 * Честность важнее приятности: подпись «проверил ИИ» ставится ТОЛЬКО когда
 * машина дала уверенный вердикт. На «не уверена» подпись — «проверьте сами».
 */

import { ERROR_TEXT, type PhotoCheckApiError, type PhotoCheckApiErrorCode } from "@/lib/photo-check/api";
import type { ClassesApiError } from "@/lib/lk/classes-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const BASE = "/api/journal";

/**
 * Ведомость по классу живёт под своим префиксом (`/api/classes`), а не под
 * журналом: сводка — это чтение класса, а не чтение журнала проверок. Константа
 * продублирована намеренно — `classes-api.ts` в этом листе не наш, и тянуть
 * ведомость в чужой файл значило бы расширить работу соседнего листа.
 */
const CLASSES_BASE = "/api/classes";

// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Состояние одного ответа. Приходит с бэкенда — `describeAnswerState`.
 *
 * `auto_*` — посчитали без модели (число, вариант, пропуск): там нет вопроса
 * «кто поставил», и прятать это под «проверил ИИ» было бы враньём.
 */
export type AnswerState =
  | "model_correct"
  | "model_incorrect"
  | "needs_review"
  | "teacher_correct"
  | "teacher_incorrect"
  | "auto_correct"
  | "auto_incorrect";

export interface FormJournalAnswer {
  id: string;
  taskNumber: number;
  taskType: string;
  studentAnswer: string | null;
  isCorrect: boolean | null;
  pointsAwarded: number;
  pointsMax: number;
  needsReview: boolean;
  checkMethod: "auto" | "llm" | "manual";
  state: AnswerState;
  decidedBy: "model" | "teacher" | null;
  modelVerdict: "correct" | "incorrect" | "uncertain" | null;
  confidence: number | null;
  comment: string | null;
  reason: string | null;
  /** Сверку короткого ответа запускали. false — галочка была снята. */
  llmChecked: boolean;
  /** Unix seconds: когда это решение приняли (не когда сдали работу). */
  decidedAt: number | null;
}

export interface FormJournalResponse {
  id: string;
  studentName: string;
  studentLabel: string | null;
  scoreTotal: number;
  scoreMax: number;
  submittedAt: number;
  answers: FormJournalAnswer[];
}

export interface FormJournalForm {
  id: string;
  title: string;
  subject: string;
  grade: number;
  status: string;
  expiresAt: number;
  createdAt: number;
  responsesCount: number;
  /** Галочка «сверять короткие ответы ИИ». По умолчанию false. */
  shortAnswerLlmEnabled: boolean;
  shortAnswerLlmEnabledAt: number | null;
  /** Есть ли в форме короткие ответы вообще. Нет — галочка не нужна. */
  hasShortAnswers: boolean;
}

export interface FormJournalDetail {
  form: Pick<
    FormJournalForm,
    "id" | "title" | "subject" | "grade" | "status" | "shortAnswerLlmEnabled"
  >;
  responses: FormJournalResponse[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Подписи (G5: что именно сказал ИИ, а что осталось за учителем)
// ─────────────────────────────────────────────────────────────────────────────

/** Короткая подпись бейджа. Одинаковые состояния — одинаковые слова. */
export const ANSWER_STATE_LABEL: Record<AnswerState, string> = {
  model_correct: "верно — проверил ИИ",
  model_incorrect: "неверно — проверил ИИ",
  needs_review: "не уверен — проверьте сами",
  teacher_correct: "верно — поставил учитель",
  teacher_incorrect: "неверно — поставил учитель",
  auto_correct: "верно — посчитали сами",
  auto_incorrect: "неверно — посчитали сами",
};

/** Тон бейджа. «Ждёт учителя» обязан выглядеть иначе, чем готовый вердикт. */
export const ANSWER_STATE_TONE: Record<
  AnswerState,
  "neutral" | "brand" | "accent" | "warm" | "info" | "success" | "danger"
> = {
  model_correct: "success",
  model_incorrect: "danger",
  needs_review: "warm",
  teacher_correct: "brand",
  teacher_incorrect: "accent",
  auto_correct: "neutral",
  auto_incorrect: "neutral",
};

/** Дата решения словами: «14 октября». Год учителю не нужен. */
function decidedOn(decidedAt: number | null): string | null {
  if (decidedAt === null) return null;
  return new Date(decidedAt * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

/**
 * Пояснение под ответом — по одной строке, только там, где есть что объяснить.
 *
 * Уверенность модели в процентах показываем только когда она решает: при
 * «не уверена» число 0,2 в интерфейсе учителя выглядит как «почти правильно»,
 * а это ровно тот смысл, который мы старались убрать.
 */
export function answerStateHint(answer: FormJournalAnswer): string | null {
  if (answer.state === "needs_review") {
    if (answer.modelVerdict === "uncertain") {
      return answer.confidence !== null
        ? `ИИ ответил «не уверен» (уверенность ${Math.round(answer.confidence * 100)}%)`
        : "ИИ ответил «не уверен»";
    }
    return answer.reason ?? "Ответ ждёт вас";
  }
  if (answer.comment) return `ИИ: ${answer.comment}`;
  if (answer.state.startsWith("model_") && answer.confidence !== null) {
    return `Уверенность ИИ ${Math.round(answer.confidence * 100)}%`;
  }
  if (answer.state.startsWith("teacher_")) {
    const day = decidedOn(answer.decidedAt);
    // Дата решения — не дата сдачи: именно ей видно, что учитель смотрел позже.
    return day ? `Вы поправили оценку ${day}` : "Вы посмотрели работу и поправили оценку";
  }
  return null;
}

/** Текст под галочкой. Рядом с переключателем, а не в справке. */
export const SHORT_ANSWER_LLM_COST_HINT =
  "Каждый короткий ответ сверяется отдельным запросом к модели — это тратит деньги. " +
  "Лист из 10 вопросов на класс из 30 человек — примерно 2 ₽ за все работы.";

// ─────────────────────────────────────────────────────────────────────────────
// Клиент
// ─────────────────────────────────────────────────────────────────────────────

function fail(error: PhotoCheckApiErrorCode, message?: string, status?: number): PhotoCheckApiError {
  return { ok: false, error, message: message || ERROR_TEXT[error], status };
}

async function readError(res: Response): Promise<PhotoCheckApiError> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) return fail("unauthorized", json?.error, res.status);
  if (res.status === 404) return fail("not_found", json?.error, res.status);
  return fail("http", json?.error, res.status);
}

/** GET /api/journal/forms — формы учителя и состояние галочки. */
export async function loadFormJournal(): Promise<
  { ok: true; forms: FormJournalForm[] } | PhotoCheckApiError
> {
  if (!API_URL) return fail("no_api_url");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}/forms`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    return fail("network");
  }

  if (!res.ok) return readError(res);
  const json = (await res.json()) as { forms?: FormJournalForm[] };
  return { ok: true, forms: json.forms ?? [] };
}

/** GET /api/journal/forms/:id/responses — последние работы по форме. */
export async function loadFormResponses(formId: string): Promise<
  { ok: true; detail: FormJournalDetail } | PhotoCheckApiError
> {
  if (!API_URL) return fail("no_api_url");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}/forms/${encodeURIComponent(formId)}/responses`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    return fail("network");
  }

  if (!res.ok) return readError(res);
  const json = (await res.json()) as FormJournalDetail;
  return { ok: true, detail: json };
}

/**
 * POST /api/journal/forms/:id/short-answer-llm — включить или выключить сверку.
 *
 * Решение о расходах принимает учитель, поэтому выключение идёт тем же запросом,
 * что и включение: снять галочку должно быть не сложнее, чем поставить.
 */
export async function setShortAnswerLlm(
  formId: string,
  enabled: boolean,
): Promise<{ ok: true; enabled: boolean } | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}${BASE}/forms/${encodeURIComponent(formId)}/short-answer-llm`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    );
  } catch {
    return fail("network");
  }

  if (!res.ok) return readError(res);
  const json = (await res.json()) as { shortAnswerLlmEnabled?: boolean };
  return { ok: true, enabled: json.shortAnswerLlmEnabled === true };
}

/** POST /api/journal/answers/:id/override — учитель исправляет оценку машины. */
export async function overrideAnswer(
  answerId: string,
  decision: { accepted: boolean; points?: number | null },
): Promise<{ ok: true; answer: FormJournalAnswer } | PhotoCheckApiError> {
  if (!API_URL) return fail("no_api_url");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${BASE}/answers/${encodeURIComponent(answerId)}/override`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    });
  } catch {
    return fail("network");
  }

  if (!res.ok) return readError(res);
  const json = (await res.json()) as { answer: FormJournalAnswer };
  return { ok: true, answer: json.answer };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ведомость по классу (лист 3.1.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Кто поставил отметку по работе.
 *
 * `model` и `teacher` — разные значения намеренно. Слить их в одно «верно»
 * значило бы через месяц не суметь ответить учителю на вопрос «это я поставил
 * или машина». `teacher_with_model` — учитель посмотрел работу и поправил часть
 * ответов; называть это «отметка учителя» было бы полуправдой.
 */
export type ClassReportSource = "teacher" | "teacher_with_model" | "model" | "auto" | "none";

/** Почему ведомость пустая. null — ведомость не пустая. */
export type ClassReportEmptyReason = "no_students" | "no_works" | "no_answers";

/** Работа — колонка ведомости. */
export interface ClassReportWork {
  id: string;
  title: string;
  subject: string;
  grade: number;
  /**
   * Работу ещё можно сдать (статус открыт И срок не вышел).
   *
   * Отдельного `status` здесь нет намеренно: «открыт» и «можно сдать» — разные
   * вещи, срок ссылки истекает сам, а учителю важно второе. По истёкшей работе
   * «не сдал» — окончательный приговор, по открытой ещё нет.
   */
  isOpen: boolean;
  createdAt: number;
}

/** Одна сданная работа в ячейке. */
export interface ClassReportCell {
  formId: string;
  responseId: string;
  score: number;
  max: number;
  submittedAt: number;
  source: ClassReportSource;
  /** Сколько заданий по этой работе ждут учителя. */
  pendingTasks: number;
  modelTasks: number;
  teacherTasks: number;
  autoTasks: number;
  /** Машина оценила, учитель не подтвердил. Отметкой учителя это не считаем. */
  unconfirmedByTeacher: boolean;
}

export interface ClassReportStudent {
  id: string;
  name: string;
  /**
   * Только сданные работы. У кого пусто — тот «не сдал».
   *
   * Отдельного поля «номер в списке» нет намеренно: порядок массива и есть
   * порядок в списке учителя, а второе поле рано или поздно разошлось бы с ним.
   */
  works: ClassReportCell[];
}

export interface ClassReportSummary {
  studentsTotal: number;
  studentsSubmitted: number;
  studentsNotSubmitted: number;
  submittedWorks: number;
  pendingWorks: number;
  unconfirmedWorks: number;
  /** null — сдавать было нечего. 0 был бы другим утверждением. */
  averagePercent: number | null;
  bySource: Record<ClassReportSource, number>;
  /** Работы по общей ссылке: отнести их к ученику нельзя, сервер считает отдельно. */
  unlinkedAnswers: number;
}

export interface ClassReport {
  class: { id: string; name: string };
  works: ClassReportWork[];
  students: ClassReportStudent[];
  summary: ClassReportSummary;
  /** Сколько работ учителя подошло под класс всего — показываем, если обрезали. */
  worksTotal: number;
  worksTruncated: boolean;
  emptyReason: ClassReportEmptyReason | null;
}

/**
 * Ответ клиента ведомости: та же лента ошибок, что у списка классов.
 *
 * `forbidden` тут означает ровно одно — «это класс другого учителя», и текст
 * берётся из `explainError`, чтобы слова про чужой класс совпадали с теми же
 * словами на странице настроек.
 */
export type ClassReportResult =
  | { ok: true; report: ClassReport }
  | { ok: false; error: ClassesApiError };

function reportFail(error: ClassesApiError): ClassReportResult {
  return { ok: false, error };
}

/** GET /api/classes/:id/report — сводка считается на сервере, не в браузере. */
export async function loadClassReport(classId: string): Promise<ClassReportResult> {
  if (!API_URL) return reportFail("network");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${CLASSES_BASE}/${encodeURIComponent(classId)}/report`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return reportFail("network");
  }

  if (res.status === 401) return reportFail("unauthorized");
  if (res.status === 403) return reportFail("forbidden");
  if (res.status === 404) return reportFail("not_found");
  if (!res.ok) return reportFail("internal");

  const json = (await res.json()) as { report?: ClassReport };
  if (!json.report || !Array.isArray(json.report.students)) return reportFail("internal");
  return { ok: true, report: json.report };
}

export type ClassReportCsvResult =
  | { ok: true; text: string; filename: string }
  | { ok: false; error: ClassesApiError };

/** Имя файла из Content-Disposition. Без него скачается «report». */
function csvFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  // RFC 5987: filename*=UTF-8''Ведомость%205А.csv — читаем именно эту часть,
  // ASCII-дубль рядом учителя не читает.
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // битое percent-encoding — берём ASCII-дубль, файл всё равно откроется
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain?.[1] ?? fallback;
}

/**
 * GET /api/classes/:id/report.csv — готовый файл ведомости.
 *
 * Отдаём ТЕКСТ, а не строим CSV в браузере: русский Excel открывает файл
 * таблицей только с BOM и разделителем `;`, и это должен обеспечивать сервер
 * один раз, а не каждый клиент по-своему.
 */
export async function fetchClassReportCsv(classId: string): Promise<ClassReportCsvResult> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${CLASSES_BASE}/${encodeURIComponent(classId)}/report.csv`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "text/csv" },
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 403) return { ok: false, error: "forbidden" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (!res.ok) return { ok: false, error: "internal" };

  return {
    ok: true,
    text: await res.text(),
    filename: csvFilename(res.headers.get("Content-Disposition"), "vedomost.csv"),
  };
}
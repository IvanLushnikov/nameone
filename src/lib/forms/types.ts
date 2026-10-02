/**
 * Типы онлайн-форм (TZ-12, этапы 3–5).
 *
 * ЖИВУТ ОТДЕЛЬНО от `src/lib/types.ts` — по ТЗ §4.4 строка «не трогаем»:
 * `WorksheetTask` и общий `TaskType` не расширяем. Причина продуктовая:
 * `TaskType` описывает 13 типов артефактов конструктора (ТЗ-16), а форме нужны
 * ровно 5 типов задания и никаких `cards` / `ktp` / `image`.
 *
 * Два разных набора типов заданий:
 *   - `FormSourceTask` — то, что УЧИТЕЛЬ отдаёт при создании формы (с эталоном
 *     `answer`, который живёт только на сервере и в публичный API не уходит).
 *   - `FormTask` — то, что ВИДИТ УЧЕНИК (whitelist-поля, без `answer`).
 */

import type { WorksheetTask } from "@/lib/types";

/**
 * Тип задания внутри формы. Ровно 5 значений — те же, что у
 * `WorksheetTask["type"]` в `src/lib/types.ts:117`, но объявлены здесь
 * независимо, чтобы ТЗ-16 не мог случайно расширить форму до 13 типов.
 */
export type FormTaskType =
  | "computation"
  | "multiple-choice"
  | "short-answer"
  | "essay"
  | "fill-blank";

/** Как сверялся ответ. `manual` = учитель смотрит сам (short-answer, essay). */
export type FormCheckMethod = "auto" | "llm" | "manual";

/** Жизненный цикл формы на стороне учителя. */
export type FormStatus = "open" | "closed";

/* ─── Учительская сторона ─────────────────────────────────────────────────── */

/**
 * Задание в том виде, в каком его кладёт в форму учитель.
 * `answer` и `explanation` — эталон, он остаётся в `forms.payload_json` на
 * сервере и **никогда** не уходит ученику (ТЗ §4.3, правило безопасности).
 */
export interface FormSourceTask {
  number: number;
  text: string;
  type: FormTaskType;
  options?: string[];
  answer?: string;
  explanation?: string;
  points: number;
}

/**
 * Тело POST /api/assignments/forms.
 *
 * Два взаимозаменяемых способа задать задания (ТЗ §4.3):
 *   - `worksheetId` — бэк берёт `payload_json` листа и снимает снимок;
 *   - `payload`     — для листов, созданных в браузере до логина (аноним).
 */
export interface CreateFormInput {
  worksheetId?: string;
  title: string;
  subject: string;
  grade: number;
  /** Срок жизни ссылки в днях. Учительский дефолт — 14 (ТЗ сценарий А, шаг 3). */
  expiresInDays?: number;
  /** Необязательный код класса, который учитель пишет на доске («5А»). */
  accessCode?: string;
  /** Показывать правильные ответы ПОСЛЕ отправки. Дефолт на бэке — 0 (ВЫКЛ). */
  showAnswers?: boolean;
  payload?: { tasks: FormSourceTask[] };
}

export interface CreateFormOk {
  ok: true;
  formId: string;
  token: string;
  /** Готовая публичная ссылка `/form/?t=<token>` — её и кладём в QR. */
  url: string;
  responsesCount: number;
}

/** Краткая карточка формы в списке «Выданное». */
export interface FormListItem {
  id: string;
  token: string;
  title: string;
  subject: string;
  grade: number;
  status: FormStatus;
  /** unix seconds. */
  createdAt: number;
  /** unix seconds. */
  expiresAt: number;
  responsesCount: number;
  /** null, если ответов ещё нет. */
  scoreAvg: number | null;
  /** null, если ответов ещё нет. */
  scoreMaxAvg: number | null;
}

/** Полная карточка формы (GET /forms/:id). */
export interface FormRecord extends FormListItem {
  accessCode: string | null;
  showAnswers: boolean;
  checkMode: string;
  closedAt: number | null;
}

export interface FormResponseAnswer {
  taskNumber: number;
  studentAnswer: string | null;
  /** null = автосверка не смогла решить, ждёт учителя (ТЗ Решение 1). */
  isCorrect: boolean | null;
  pointsAwarded: number;
  pointsMax: number;
  needsReview: boolean;
  checkMethod: FormCheckMethod;
}

/** Один ученик в сводке. */
export interface FormResponse {
  id: string;
  studentName: string;
  /** Код класса, если учитель его задал. */
  studentLabel: string | null;
  scoreTotal: number;
  scoreMax: number;
  /** null, если ученик не отправлял started_at. */
  durationSec: number | null;
  /** unix seconds. */
  submittedAt: number;
  answers: FormResponseAnswer[];
}

/* ─── Публичная сторона (ученик) ──────────────────────────────────────────── */

/**
 * Задание так, как его видит ученик. Эталона здесь нет by design:
 * бэк маппит whitelist'ом полей на выход.
 */
export interface FormTask {
  number: number;
  text: string;
  type: FormTaskType;
  options?: string[];
  points: number;
}

/** GET /api/public/forms/:token. */
export interface PublicForm {
  title: string;
  subject: string;
  grade: number;
  teacherLabel?: string;
  tasks: FormTask[];
  /** unix seconds. */
  expiresAt: number;
  /** true = учитель задал код класса, спросим его перед именем. */
  needsCode: boolean;
}

export interface SubmitFormInput {
  studentName: string;
  studentCode?: string;
  answers: Array<{ taskNumber: number; value: string }>;
}

/** Итог сверки по одному заданию — без эталонного ответа. */
export type SubmitTaskStatus = "correct" | "wrong" | "unreviewed";

/**
 * POST /api/public/forms/:token/submit.
 * `answers` приходит только если учитель разрешил показ правильных ответов.
 */
export interface SubmitFormOk {
  ok: true;
  scoreTotal: number;
  scoreMax: number;
  perTask: Array<{ taskNumber: number; status: SubmitTaskStatus }>;
  answers?: Array<{
    taskNumber: number;
    status: SubmitTaskStatus;
    answer?: string;
    explanation?: string;
  }>;
}

/* ─── Ошибки ─────────────────────────────────────────────────────────────── */

/**
 * Единый union ошибок клиента форм. Ветки повторяют `src/lib/worksheets/api.ts`,
 * плюс коды из ТЗ §4.3 (таблица «Ошибки для ученика»).
 */
export type FormApiError =
  | { ok: false; error: "unauthorized" } // 401 — учитель не залогинен
  | { ok: false; error: "validation"; details?: unknown } // 400 — zod-валидация
  | { ok: false; error: "not_found" } // 404 FORM_NOT_FOUND
  | { ok: false; error: "closed" } // 410 FORM_CLOSED
  | { ok: false; error: "expired" } // 410 FORM_EXPIRED
  | { ok: false; error: "code_required" } // 403 FORM_CODE_REQUIRED
  | { ok: false; error: "rate_limited" } // 429 RATE_LIMITED
  | { ok: false; error: "network" } // fetch упал: оффлайн / CORS / нет API_URL
  | { ok: false; error: "internal" }; // 5xx и прочие неожиданные

/**
 * Человекочитаемые тексты для ученика — **дословно из ТЗ §4.3**, чтобы фронт и
 * бэк не разъехались. Учительские ошибки («network», «internal») тут же
 * переводятся в тексты для учителя.
 */
export const FORM_ERROR_MESSAGE: Record<
  FormApiError["error"],
  string
> = {
  unauthorized: "Войдите, чтобы увидеть выданные формы",
  validation: "Не получилось сохранить форму. Проверьте настройки и попробуйте ещё раз",
  not_found: "Ссылка неправильная. Попросите учителя прислать её ещё раз",
  closed: "Форма закрыта учителем",
  expired: "Срок ссылки истёк",
  code_required: "Введите код, который написал учитель на доске",
  rate_limited: "Слишком много отправок. Подождите немного",
  network: "Не удалось загрузить форму. Проверьте интернет и попробуйте ещё раз",
  internal: "Что-то сломалось на нашей стороне. Попробуйте ещё раз чуть позже",
};

/**
 * `WorksheetTask` → `FormSourceTask`. Единственное место, где фронт знает
 * про `WorksheetTask`: эталон нужен только для снимка на сервере.
 */
export function toFormSourceTask(task: WorksheetTask): FormSourceTask {
  return {
    number: task.number,
    text: task.text,
    type: task.type,
    options: task.options,
    answer: task.answer,
    explanation: task.explanation,
    points: task.points,
  };
}

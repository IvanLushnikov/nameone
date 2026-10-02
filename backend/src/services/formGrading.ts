/**
 * Автосверка ответов ученика (TZ-12, Решение 1).
 *
 * Модуль чистый: ни D1, ни env, ни HTTP. Принимает задание + то, что ввёл
 * ученик, и отдаёт вердикт. Это делает сверку тривиально тестируемой и даёт
 * возможность подключить LLM-этап (этап 6) без изменения вызывающего кода.
 *
 * ── Правило честности ────────────────────────────────────────────────────────
 * Если сверка НЕ МОЖЕТ решить (число не распарсилось, эталон пустой, ученик
 * ответил частично на fill-blank) — мы НЕ ГАДАЕМ: `needsReview = true`,
 * `isCorrect = null`, балл 0. Ложное «зачёт» хуже лишней ручной проверки.
 *
 * ── Что сверяется автоматически ──────────────────────────────────────────────
 *   multiple-choice — сравнение индекса варианта (~100% точность)
 *   computation     — нормализация числа + допуск 1e-6 (~90%)
 *   fill-blank      — эталон делится по разделителям, сравниваются множества (~85%)
 *   short-answer    — LLM (этап 6) → пока manual
 *   essay           — только учитель, всегда manual
 */

import type { WorksheetTask } from "../types";

/** Способ сверки, который реально выполнили. */
export type CheckMethod = "auto" | "llm" | "manual";

/** Вердикт по одному заданию. */
export interface GradedAnswer {
  /** true — верно, false — неверно, null — сверка не смогла решить. */
  isCorrect: boolean | null;
  /** Начислено баллов. 0, если isCorrect !== true. */
  pointsAwarded: number;
  /** Учитель должен посмотреть этот ответ глазами. */
  needsReview: boolean;
  /** Чем сверяли. */
  checkMethod: CheckMethod;
  /** Человекочитаемая причина needsReview — попадает в check_meta_json. */
  reason?: string;
}

/** Что ученик ввёл — фронт может прислать строку, число или массив строк. */
export type StudentValue = string | number | string[] | null | undefined;

/** Допуск при сравнении чисел. Ровно как в ТЗ. */
const NUMERIC_TOLERANCE = 1e-6;

/**
 * Единицы измерения, которые вырезаем перед разбором числа.
 *
 * Список — из ТЗ §4.3. Порядок важен только внутри регулярки: длинные варианты
 * (`рублей`) идут раньше коротких, иначе `рублей` превратится в `я в е л` → NaN.
 */
const UNITS_PATTERN =
  /(рублей|рубля|руб\.?|р\.?|км|см|м|кг|г|мин|ч|с|%)/giu;

/** Неразрывные пробелы — их телефон может прислать вместо обычных. */
const INVISIBLE_SPACES_PATTERN = /[\s\u00a0\u202f]+/gu;

// ─────────────────────────────────────────────────────────────────────────────
// Нормализация
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Привести «сырое» значение ученика/эталона к строке для сравнения.
 * null/undefined → "" (пустой ответ), массив склеивается через ";".
 */
function rawToString(value: StudentValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => String(v ?? "")).join(";");
  return String(value);
}

/**
 * Нормализовать строку перед попыткой разобрать её как число.
 * Запятая → точка, убираем пробелы, вырезаем единицы измерения.
 */
function normalizeForNumber(input: string): string {
  return input
    .trim()
    .replace(/,/gu, ".")
    .replace(INVISIBLE_SPACES_PATTERN, "")
    .replace(UNITS_PATTERN, "")
    .trim();
}

/**
 * Попытка разобрать значение как число. Возвращает null, если это не число.
 *
 * Number("") === 0, поэтому пустую строку отсекаем явно — иначе пустой ответ
 * ученика «совпал» бы с нулём в эталоне.
 */
function toNumber(input: string): number | null {
  const normalized = normalizeForNumber(input);
  if (normalized === "") return null;
  // Не даём Number() съесть мусор: "12abc" после вырезания единиц может
  // остаться нечисловым хвостом, который Number() превратит в NaN — это ок.
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

/** Ключ для сравнения множеств в fill-blank: число как есть, текст — lowercase. */
function comparableKey(part: string): string {
  const num = toNumber(part);
  if (num !== null) return `#${num}`;
  return part.trim().replace(INVISIBLE_SPACES_PATTERN, " ").toLowerCase();
}

/**
 * Похоже ли значение ровно на ОДНО число (а не на список значений).
 *
 * Внутренние пробелы — признак списка: «3, 5» это два значения, а не 3.5.
 * Поэтому здесь, в отличие от `toNumber`, пробелы НЕ вырезаются: сначала
 * схлопываем их в один и проверяем, что внутри пробелов нет.
 */
function isSingleNumberString(input: string): boolean {
  const collapsed = input.trim().replace(INVISIBLE_SPACES_PATTERN, " ");
  if (collapsed.includes(" ")) return false;
  const normalized = collapsed.replace(/,/gu, ".").replace(UNITS_PATTERN, "").trim();
  return /^[-+]?\d+(?:\.\d+)?$/u.test(normalized);
}

/**
 * Разбить эталон fill-blank на части.
 *
 * Сначала проверяем, не является ли строка ОДНИМ числом (тогда запятая — это
 * десятичный разделитель: «3,5» → одна часть, а не две). Иначе делим по `;`
 * и `,`, как в ТЗ.
 */
function splitExpectedParts(expected: string): string[] {
  const trimmed = expected.trim();
  if (trimmed === "") return [];
  if (isSingleNumberString(trimmed)) return [trimmed];
  return trimmed
    .split(/[;,]/u)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Разбить ответ ученика на части для fill-blank. Массив приходит как есть. */
function splitStudentParts(value: StudentValue): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter((p) => p !== "");
  }
  return splitExpectedParts(rawToString(value));
}

// ─────────────────────────────────────────────────────────────────────────────
// Сверка по типам заданий
// ─────────────────────────────────────────────────────────────────────────────

/** Приведение к индексу варианта. null/undefined → unreviewed (как в ТЗ). */
function gradeMultipleChoice(expected: string, value: StudentValue): GradedAnswer {
  const raw = rawToString(value).trim();
  if (raw === "") {
    return {
      isCorrect: null,
      pointsAwarded: 0,
      needsReview: true,
      checkMethod: "auto",
      reason: "Ученик не выбрал вариант",
    };
  }

  const expectedIndex = Number.parseInt(expected.trim(), 10);
  const studentIndex = Number.parseInt(raw, 10);

  if (Number.isNaN(expectedIndex) || Number.isNaN(studentIndex)) {
    // Индекс не распознался — не гадаем, отдаём учителю.
    return {
      isCorrect: null,
      pointsAwarded: 0,
      needsReview: true,
      checkMethod: "auto",
      reason: "Не удалось разобрать индекс варианта",
    };
  }

  const isCorrect = expectedIndex === studentIndex;
  return {
    isCorrect,
    pointsAwarded: isCorrect ? 1 : 0,
    needsReview: false,
    checkMethod: "auto",
  };
}

/**
 * Computation: нормализация числа + допуск 1e-6.
 *
 * Если оба значения не числа — точное строковое сравнение. Если эталон пустой
 * или распознать его как число не вышло — needs_review.
 */
function gradeComputation(expected: string, value: StudentValue, points: number): GradedAnswer {
  const expectedRaw = expected.trim();
  if (expectedRaw === "") {
    return {
      isCorrect: null,
      pointsAwarded: 0,
      needsReview: true,
      checkMethod: "auto",
      reason: "Пустой эталон — сверять не с чем",
    };
  }

  const studentRaw = rawToString(value).trim();
  if (studentRaw === "") {
    // Пустой ответ при непустом эталоне — это не «не решили», это «не ответил».
    return {
      isCorrect: false,
      pointsAwarded: 0,
      needsReview: false,
      checkMethod: "auto",
      reason: "Ответ не заполнен",
    };
  }

  const expectedNum = toNumber(expectedRaw);
  const studentNum = toNumber(studentRaw);

  // Ветка 1: оба значения — числа → сравниваем с допуском.
  if (expectedNum !== null && studentNum !== null) {
    const isCorrect = Math.abs(expectedNum - studentNum) <= NUMERIC_TOLERANCE;
    return {
      isCorrect,
      pointsAwarded: isCorrect ? points : 0,
      needsReview: false,
      checkMethod: "auto",
    };
  }

  // Ветка 2: оба значения — не числа → точное строковое сравнение.
  if (expectedNum === null && studentNum === null) {
    const isCorrect = expectedRaw.trim() === studentRaw;
    return {
      isCorrect,
      pointsAwarded: isCorrect ? points : 0,
      needsReview: false,
      checkMethod: "auto",
    };
  }

  // Ветка 3: одно — число, другое нет. Сравнить не с чем и нечем →
  // не гадаем (ТЗ: «иначе needs_review»).
  return {
    isCorrect: null,
    pointsAwarded: 0,
    needsReview: true,
    checkMethod: "auto",
    reason: "Ответ и эталон разного типа (число и текст) — нужна проверка учителя",
  };
}

/**
 * Fill-blank: эталон делится по `;`/`,`, каждая часть нормализуется.
 *   все части верны → верно
 *   ни одной не верно → неверно
 *   частично        → needs_review
 */
function gradeFillBlank(expected: string, value: StudentValue, points: number): GradedAnswer {
  const expectedParts = splitExpectedParts(expected);
  if (expectedParts.length === 0) {
    return {
      isCorrect: null,
      pointsAwarded: 0,
      needsReview: true,
      checkMethod: "auto",
      reason: "Пустой эталон для fill-blank",
    };
  }

  const studentParts = splitStudentParts(value);
  if (studentParts.length === 0) {
    return {
      isCorrect: false,
      pointsAwarded: 0,
      needsReview: false,
      checkMethod: "auto",
      reason: "Ответ не заполнен",
    };
  }

  const expectedKeys = expectedParts.map(comparableKey);
  const studentKeys = studentParts.map(comparableKey);

  const matched = studentKeys.filter((k) => expectedKeys.includes(k)).length;

  if (matched === expectedKeys.length && studentKeys.length === expectedKeys.length) {
    return {
      isCorrect: true,
      pointsAwarded: points,
      needsReview: false,
      checkMethod: "auto",
    };
  }

  if (matched === 0) {
    return {
      isCorrect: false,
      pointsAwarded: 0,
      needsReview: false,
      checkMethod: "auto",
    };
  }

  return {
    isCorrect: null,
    pointsAwarded: 0,
    needsReview: true,
    checkMethod: "auto",
    reason: `Совпало ${matched} из ${expectedKeys.length} значений — нужна проверка учителя`,
  };
}

/** Short-answer / essay — всегда ручная проверка. */
function gradeManual(type: string): GradedAnswer {
  return {
    isCorrect: null,
    pointsAwarded: 0,
    needsReview: true,
    checkMethod: "manual",
    reason:
      type === "essay"
        ? "Эссе проверяет учитель — автоматическая сверка ненадёжна"
        : "Короткий ответ проверяет учитель (LLM-сверка — этап 6)",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Публичный API модуля
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Сверить один ответ ученика с эталоном задания.
 *
 * @param task   задание из снимка формы (`payload_json.tasks[]`)
 * @param value  то, что ввёл ученик (строка / число / массив строк)
 */
export function gradeAnswer(task: WorksheetTask, value: StudentValue): GradedAnswer {
  const expected = task.answer ?? "";
  const points = Number.isFinite(task.points) ? Math.max(0, Math.trunc(task.points)) : 0;

  switch (task.type) {
    case "multiple-choice":
      // Балл всегда 1: у варианта ровно один правильный, «частично верного» не бывает.
      return gradeMultipleChoice(expected, value);
    case "computation":
      return gradeComputation(expected, value, points);
    case "fill-blank":
      return gradeFillBlank(expected, value, points);
    case "short-answer":
    case "essay":
      return gradeManual(task.type);
    default:
      // Неизвестный тип задания — не гадаем, отдаём учителю.
      return {
        isCorrect: null,
        pointsAwarded: 0,
        needsReview: true,
        checkMethod: "manual",
        reason: `Неизвестный тип задания: ${String(task.type)}`,
      };
  }
}

/** Вердикт по всем заданиям формы + общий балл. */
export interface GradedSubmission {
  /** Вердикты в том же порядке, что и задания. */
  perTask: Array<GradedAnswer & { taskNumber: number; taskType: string; pointsMax: number; studentValue: StudentValue }>;
  scoreTotal: number;
  scoreMax: number;
  /** Сколько ответов ждут учителя. */
  needsReviewCount: number;
}

/**
 * Сверить весь ответ ученика по форме.
 *
 * Задания, на которые ученик не отвечал, всё равно попадают в `perTask` —
 * учитель в сводке должен видеть «пропущено», а не пустоту.
 */
export function gradeSubmission(
  tasks: WorksheetTask[],
  answersByNumber: Map<number, StudentValue>,
): GradedSubmission {
  const perTask: GradedSubmission["perTask"] = [];
  let scoreTotal = 0;
  let scoreMax = 0;
  let needsReviewCount = 0;

  for (const task of tasks) {
    const value = answersByNumber.get(task.number);
    const verdict = gradeAnswer(task, value);
    const pointsMax = Number.isFinite(task.points) ? Math.max(0, Math.trunc(task.points)) : 0;

    scoreMax += pointsMax;
    scoreTotal += verdict.pointsAwarded;
    if (verdict.needsReview) needsReviewCount += 1;

    perTask.push({
      taskNumber: task.number,
      taskType: task.type,
      pointsMax,
      studentValue: value ?? null,
      isCorrect: verdict.isCorrect,
      pointsAwarded: verdict.pointsAwarded,
      needsReview: verdict.needsReview,
      checkMethod: verdict.checkMethod,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
    });
  }

  return { perTask, scoreTotal, scoreMax, needsReviewCount };
}

/**
 * Определить `check_mode` формы по составу заданий (колонка forms.check_mode).
 *
 * Есть short-answer → «llm» (на этапе 6 пойдёт в LLM), иначе «auto».
 * Эссе всё равно уходит учителю, но режим формы от него не зависит —
 * эссе не меняет способ сверки остальных заданий.
 */
export function detectCheckMode(tasks: WorksheetTask[]): "auto" | "llm" {
  const hasShortAnswer = tasks.some((t) => t.type === "short-answer");
  return hasShortAnswer ? "llm" : "auto";
}

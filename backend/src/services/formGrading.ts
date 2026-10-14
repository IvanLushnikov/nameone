/**
 * Автосверка ответов ученика (TZ-12, Решение 1; короткий ответ — лист 3.1.2).
 *
 * Модуль чистый: ни D1, ни env, ни HTTP. Принимает задание + то, что ввёл
 * ученик, и отдаёт вердикт. Это делает сверку тривиально тестируемой.
 *
 * С 14.10.2026 (лист 3.1.2) короткий ответ сверяет модель — см. раздел
 * «Сверка короткого ответа моделью» в конце файла. Синхронная часть при этом
 * осталась чистой: её зовёт роут отправки формы, и смена сигнатуры сломала бы
 * чужой код.
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
 *   short-answer    — модель сверяет смысл, низкая уверенность → учителю
 *   essay           — только учитель, всегда manual
 *
 * ── Два слоя: сервис и сеть ──────────────────────────────────────────────────
 * `gradeAnswer`/`gradeSubmission` остаются СИНХРОННЫМИ и чистыми: их зовёт роут
 * отправки формы (`routes/publicForms.ts`), и менять их сигнатуру нельзя —
 * это ломает чужой код.
 *
 * Модуль НЕ ИМПОРТИРУЕТ провайдеров (лист 3.1.6). Обращение к модели живёт в
 * `src/llm/shortAnswerCheck.ts`, а сюда модель не заходит даже ленивым
 * `await import`: сборник поднимает динамический импорт обратно в статический
 * граф, и тестовый пул начинал падать с «No such module» ровно на этом импорте.
 * Здесь остаётся разбор ответа модели, решение учителя и правила режима; сеть
 * приходит снаружи через переданную функцию `check`.
 *
 * `gradeAnswer` для short-answer остаётся ручным НЕ как заглушка, а как штатный
 * откат: нет ключа, нет сети, модель ответила мусором — ответ уходит учителю тем же
 * самым путём, каким шёл до подключения модели.
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
/** Что ввёл ученик, приведённое к строке. Экспортируется для LLM-слоя. */
export function rawToString(value: StudentValue): string {
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

/**
 * Ручной откат — то, что видит учитель, когда машина не смогла решить.
 *
 * Одна функция на ВСЕ причины отказа (нет ключа / нет сети / 5xx / мусор вместо
 * JSON / низкая уверенность), потому что учителю важно одно: «это ждёт тебя».
 * Причину он видит в `reason`, и она должна быть живой («модель ответила
 * неуверенно»), а не служебной («сверка появится позже»), которая через месяц
 * ничего не объясняет.
 */
export function gradeManual(reason: string): GradedAnswer {
  return {
    isCorrect: null,
    pointsAwarded: 0,
    needsReview: true,
    checkMethod: "manual",
    reason,
  };
}

/**
 * Эссе и short-answer без модели.
 *
 * Экспортируется для `llm/shortAnswerCheck.ts`: отказ «это эссе, его проверяет
 * учитель» должен звучать одинаково, где бы он ни был вынесен.
 */
export function gradeManualByType(type: string): GradedAnswer {
  return gradeManual(
    type === "essay"
      ? "Эссе проверяет учитель — автоматическая сверка ненадёжна"
      : "Короткий ответ проверяет учитель: модель не дала вердикта",
  );
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
      return gradeManualByType(task.type);
    default:
      // Неизвестный тип задания — не гадаем, отдаём учителю.
      return gradeManual(`Неизвестный тип задания: ${String(task.type)}`);
  }
}

/** Вердикт по всем заданиям формы + общий балл. */
export interface GradedSubmission {
  /** Вердикты в том же порядке, что и задания. */
  perTask: Array<
    GradedAnswer & {
      taskNumber: number;
      taskType: string;
      pointsMax: number;
      studentValue: StudentValue;
      /**
       * Есть только у коротких ответов, которые прошли через сверку моделью.
       * Отсутствует = движок не запускался (галочка снята или бюджет исчерпан),
       * и вердикт целиком ручной.
       */
      shortAnswer?: ShortAnswerGrade;
    }
  >;
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

// ─────────────────────────────────────────────────────────────────────────────
// Сверка короткого ответа моделью (лист 3.1.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Порог уверенности, ниже которого вердикт модели не попадает в журнал.
 *
 * НИЖЕ ЭТОГО ЧИСЛА НЕТ НИКАКОГО АВТОМАТИЧЕСКОГО ВЕРДИКТА — только ручная
 * проверка учителем. Это ровно то правило, ради которого существует модуль:
 * «не уверен» и «неправильно» — разные вещи.
 *
 * Отдельно от `CONFIDENCE_THRESHOLD` из photoCheckGrading.ts (0.85), и это НЕ
 * опечатка. Там модель ЧИТАЕТ почерк по фотографии — распознавание физически
 * ошибается. Здесь ответ ученика уже пришёл текстом и сверяется по смыслу —
 * другая задача с другой ценой ошибки. Оба порога обязаны быть зафиксированы
 * явно, иначе «универсальный 0.85» незаметно отправит половину нормальных
 * ответов учителю, а «универсальный 0.5» — половину ошибок в журнал.
 */
export const SHORT_ANSWER_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Оценка «потратим на один ответ», для планового лимита и для G5.
 *
 * Считается по gpt-6-luna ($0.07/$0.35 за 1M): system ~700 токенов (кэшируется
 * между ответами одного учителя), задание+эталон+ответ ~200, ответ модели ~60.
 *
 *   ≈ 900 in × $0.07/1M + 60 out × $0.35/1M ≈ $0.000084 ≈ 0,007 ₽ за ответ
 *
 * Лист из 10 коротких ответов — около 0.07 ₽, класс из 30 человек — около 2 ₽
 * на разбор, и это НА ВСЕ работы, а не на одну. Учитель на 500 ₽/мес платит за
 * сверку меньше двух десятых процента своего тарифа.
 *
 * Число намеренно консервативное: system-промпт крупный, а ответ модели может
 * быть длиннее 60 токенов, если она решит расписать комментарий. Лучше
 * заложить с запасом, чем уйти в минус на нормах.
 */
export const LLM_ANSWER_GRADING_ESTIMATE_TOKENS_IN = 900;
export const LLM_ANSWER_GRADING_ESTIMATE_TOKENS_OUT = 60;

/** Что сказала модель. `uncertain` — честный отказ, а не «неправильно». */
export type ShortAnswerVerdict = "correct" | "incorrect" | "uncertain";

/** Вердикт с пояснением — то, что возвращает наружу. */
export interface ShortAnswerGrade extends GradedAnswer {
  /** Что сказала машина. null — модель не вызывалась (откат до ручного). */
  modelVerdict: ShortAnswerVerdict | null;
  /** Уверенность модели 0..1. null — модель не дала или не вызывалась. */
  confidence: number | null;
  /** Короткий комментарий модели для учителя, одна строка. */
  comment: string | null;
  /** Кто поставил оценку: модель или человек. */
  decidedBy: "model" | "teacher";
}

/** Обёртка, которая срабатывает даже когда модель обернула JSON в ```json. */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf("{");
  if (start === -1) return null;
  const end = body.lastIndexOf("}");
  if (end <= start) return null;
  return body.slice(start, end + 1);
}

/** Разобрать ответ модели. null — вместо JSON пришёл мусор. */
function parseModelJson(raw: string): Record<string, unknown> | null {
  const json = extractJson(raw);
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Уверенность 0..1. Модель шлёт то «85», то «0.85», то строку — приводим.
 */
function toConfidence(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  // Значение >1 читаем как проценты: 85 → 0.85. Иначе 85 превратится в 1.0,
  // то есть в «максимальная уверенность», которой модель не выражала.
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.max(0, Math.min(1, scaled));
}

/** Комментарий модели — строка или null. Чужие типы игнорируем. */
function toComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "") return null;
  // Комментарий учитель читает в списке ответов — одна строка, не простыня.
  return s.length > 240 ? `${s.slice(0, 237)}...` : s;
}

/**
 * Привести ответ модели к одному из трёх состояний.
 *
 * ПОРЯДОК ПРОВЕРОК ЗДЕСЬ ВАЖЕН, и это не стилистика:
 *
 *   1) сначала «не уверен» из самого вердикта (uncertain / unsure / ...);
 *   2) потом ГЕЙТЫ, где мы не имеем права решать (пустой ответ, низкая
 *      уверенность);
 *   3) и только потом разбор «correct/incorrect».
 *
 * Обратный порядок — это ровно тот баг, который чинили в photoCheckGrading.ts:
 * явный `verdict: "correct"` от модели обходил гейт неуверенности, и в журнал
 * ученика попадало «верно» при confidence 0.2. Гейты ДО разбора вердикта.
 */
export function normalizeShortAnswerVerdict(
  raw: unknown,
  confidence: number | null,
): ShortAnswerVerdict {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  // 1. Модель сама сказала «не уверен» — это её законное право, не сбой.
  if (
    v === "uncertain" ||
    v === "unsure" ||
    v === "unknown" ||
    v === "unclear" ||
    v === "not_sure" ||
    v === " unsure"
  ) {
    return "uncertain";
  }

  // 2. Гейты, где вердикт ставить нельзя в принципе.
  //    Ответ не прочитан → читать нечего, даже если модель уверена на 1.0.
  //    Проверка именно на null/undefined/NaN, а не только на null: при
  //    `undefined` сравнение `undefined < 0.7` даёт false, то есть гейт
  //    ПРОПУСКАЛ бы модель, которая вообще не сказала про свою уверенность.
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) {
    return "uncertain";
  }
  if (confidence < SHORT_ANSWER_CONFIDENCE_THRESHOLD) return "uncertain";

  // 3. Разбор вердикта. Всё остальное (мусор, пустая строка, «maybe»)
  //    остаётся uncertain — мы не угадываем.
  if (v === "correct" || v === "right" || v === "true" || v === "match") return "correct";
  if (v === "incorrect" || v === "wrong" || v === "false" || v === "mismatch") return "incorrect";
  return "uncertain";
}

/** Причина needsReview для каждого состояния — живым языком, для учителя. */
function reasonFor(verdict: ShortAnswerVerdict, comment: string | null): string {
  if (verdict === "correct") return "Модель: ответ совпадает с эталоном по смыслу";
  if (verdict === "incorrect") {
    return comment ? `Модель: ${comment}` : "Модель: ответ не совпадает с эталоном";
  }
  return "Модель не уверена в ответе — проверьте сами";
}

/**
 * Собрать вердикт из разобранного ответа модели.
 *
 * `needsReview` = модель НЕ уверена. Уверенный «incorrect» учителю не
 * показывается: это единственный случай, когда решение принимается без
 * человека, и поэтому он обязан быть максимально осторожным.
 */
export function gradeFromModel(rawModelOutput: string, points: number): ShortAnswerGrade {
  const parsed = parseModelJson(rawModelOutput);

  // Мусор вместо JSON. Это НЕ «всё неправильно» — сверка просто не состоялась,
  // и единственный честный исход здесь — учитель.
  if (!parsed) {
    return {
      ...gradeManual("Модель ответила нечитаемо — проверьте ответ сами"),
      modelVerdict: null,
      confidence: null,
      comment: null,
      decidedBy: "model",
    };
  }

  const confidence = toConfidence(parsed.confidence);
  const comment = toComment(parsed.comment);
  const verdict = normalizeShortAnswerVerdict(parsed.verdict, confidence);

  if (verdict === "uncertain") {
    return {
      ...gradeManual("Модель не уверена в ответе — проверьте сами"),
      modelVerdict: "uncertain",
      confidence,
      comment,
      decidedBy: "model",
    };
  }

  const isCorrect = verdict === "correct";
  return {
    isCorrect,
    pointsAwarded: isCorrect ? points : 0,
    needsReview: false,
    checkMethod: "llm",
    reason: reasonFor(verdict, comment),
    modelVerdict: verdict,
    confidence,
    comment,
    decidedBy: "model",
  };
}

/**
 * Переопределение учителем поверх решения машины.
 *
 * Оценка машины и оценка учителя — РАЗНЫЕ ВЕЩИ, и журнал обязан это показывать:
 * `decidedBy` говорит, чьё это решение, а `modelVerdict`/`confidence`
 * остаются снимком того, что сказала машина. Через месяц по журналу должно
 * оставаться видно, что именно человек поправил — иначе выправленная ошибка
 * модели выглядит как ошибка учителя.
 *
 * Отметка учителя побеждает: он видит работу, модель — только текст.
 *
 * @param maxPoints максимум за задание. Обязателен НЕ просто для удобства, а
 *                  потому, что балл из браузера приходит как «пользователь
 *                  нажал», и без потолка 999 баллов за задание в 2 балла
 *                  раздули бы журнал. Раньше (в photoCheckGrading) ту же
 *                  работу делает normalizeTeacherPoints(raw, maxPoints).
 */
export function applyTeacherOverride(
  grade: ShortAnswerGrade,
  decision: { accepted: boolean; points?: number | null },
  maxPoints: number,
): ShortAnswerGrade {
  const max = Number.isFinite(maxPoints) && maxPoints > 0 ? Math.trunc(maxPoints) : 0;
  // Балл учителя — в пределах задания. `accepted:false` даёт 0 вне зависимости
  // от присланного числа: «не засчитано, но 2 балла» противоречит самому себе.
  const requested =
    typeof decision.points === "number" && Number.isFinite(decision.points)
      ? Math.round(decision.points)
      : max;
  const points = decision.accepted ? Math.max(0, Math.min(max, requested)) : 0;

  return {
    isCorrect: decision.accepted,
    pointsAwarded: points,
    // Учитель посмотрел — задание больше не ждёт, даже если ответил «неверно».
    needsReview: false,
    checkMethod: "manual",
    reason: decision.accepted
      ? "Оценку поставил учитель"
      : "Учитель не засчитал ответ",
    modelVerdict: grade.modelVerdict,
    confidence: grade.confidence,
    comment: grade.comment,
    decidedBy: "teacher",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Поток отправки формы (лист 3.1.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ключ, под которым решение учителя лежит в снимке заданий формы.
 *
 * ПОЧЕМУ НЕ `forms.check_mode`. Эта колонка заполняется `detectCheckMode` при
 * СОЗДАНИИ формы по составу заданий: появилось хоть одно short-answer — и
 * check_mode уже «llm». Если бы решение о деньгах читалось оттуда, сверка
 * включалась бы сама, без единого клика учителя. Согласие учителя — это
 * отдельное решение и отдельное место хранения.
 *
 * Почему снимок заданий, а не новая колонка: колонки в `forms` запрещено
 * добавлять, а `payload_json` читают как `{tasks: [...]}` все трое потребителя
 * (publicForms, f07, classes) — лишний ключ им не мешает, потому что никто не
 * разворачивает объект целиком. Присутствие ключа = согласие учителя; отсутствие
 * = согласия нет.
 */
export const SHORT_ANSWER_LLM_KEY = "shortAnswerLlm";

/** Что учитель решил по сверке коротких ответов. */
export interface ShortAnswerLlmSettings {
  /** true — учитель включил сверку руками. Всё остальное выводится из этого. */
  enabled: boolean;
  /** Unix seconds. Когда включил — для честного текста «включено 12 октября». */
  enabledAt: number | null;
}

/** Выключено. Значение по умолчанию продукта, а не заглушка. */
export const SHORT_ANSWER_LLM_DISABLED: ShortAnswerLlmSettings = { enabled: false, enabledAt: null };

/**
 * Прочитать решение учителя из снимка заданий.
 *
 * ВСЕГДА возвращает объект и НИКОГДА не бросает: битый payload_json — это
 * отсутствие согласия, то есть «не тратить деньги». Обратный порядок здесь
 * был бы дорогим: любой сбой разбора превращался бы в молчаливый расход.
 */
export function readShortAnswerLlmSettings(payloadJson: string | null | undefined): ShortAnswerLlmSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson ?? "");
  } catch {
    return SHORT_ANSWER_LLM_DISABLED;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return SHORT_ANSWER_LLM_DISABLED;
  }
  const raw = (parsed as Record<string, unknown>)[SHORT_ANSWER_LLM_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return SHORT_ANSWER_LLM_DISABLED;
  }
  const flag = raw as Record<string, unknown>;
  if (flag.enabled !== true) return SHORT_ANSWER_LLM_DISABLED;

  const at = flag.enabledAt;
  return {
    enabled: true,
    enabledAt: typeof at === "number" && Number.isFinite(at) ? Math.trunc(at) : null,
  };
}

/**
 * Записать решение учителя обратно в снимок заданий.
 *
 * Возвращает новый JSON. Если разобрать не удалось — падаем на `{tasks: []}`:
 * лучше потерять снимок заданий у битой формы (её всё равно нельзя выдать),
 * чем уронить сохранение настройки и оставить учителя с неработающей галочкой.
 */
export function writeShortAnswerLlmSettings(
  payloadJson: string | null | undefined,
  settings: ShortAnswerLlmSettings,
): string {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(payloadJson ?? "");
  } catch {
    parsed = null;
  }
  const base: Record<string, unknown> =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { tasks: [] };

  if (settings.enabled) {
    base[SHORT_ANSWER_LLM_KEY] = { enabled: true, enabledAt: settings.enabledAt };
  } else {
    // Ключ удаляем, а не пишем `enabled: false`: выключенное состояние должно
    // выглядеть ровно так же, как форма, которую учитель никогда не трогал.
    delete base[SHORT_ANSWER_LLM_KEY];
  }
  return JSON.stringify(base);
}

/** Есть ли в форме задания, которым вообще может помочь модель. */
export function hasShortAnswerTasks(tasks: WorksheetTask[]): boolean {
  return tasks.some((t) => t.type === "short-answer");
}

/**
 * Разобрать снимок заданий формы.
 *
 * Копия одноимённой функции из роутов, и это осознанно: `publicForms.ts` и
 * `f07.ts` принадлежат другим листам, а журналу нужно то же самое — узнать,
 * есть ли в форме короткие ответы. Битый payload → пустой список, а не 500:
 * форму, которую не разобрали, всё равно нельзя выдать.
 */
export function parseTasks(payloadJson: string | null | undefined): WorksheetTask[] {
  try {
    const parsed = JSON.parse(payloadJson ?? "") as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return [];
    return parsed.tasks.filter((t): t is WorksheetTask => typeof t === "object" && t !== null);
  } catch {
    return [];
  }
}

/** Что движок сделал с одним коротким ответом. */
export interface ShortAnswerCheckResult {
  grade: ShortAnswerGrade;
  /** Движок реально запускался. false — сверка не запускалась вовсе. */
  checked: boolean;
}

/**
 * Сверка одного короткого ответа. Сеть приходит СЮДА, снаружи модуля.
 *
 * Тип, а не конкретная реализация: сервис не должен знать про провайдеров,
 * иначе он снова начнёт тянуть весь LLM-стек в тестовый пул. Роут отдаёт сюда
 * функцию из `src/llm/shortAnswerCheck.ts`.
 */
export type ShortAnswerChecker = (
  task: WorksheetTask,
  value: StudentValue,
) => Promise<ShortAnswerGrade>;

export interface GradeSubmissionWithLlmArgs {
  tasks: WorksheetTask[];
  answersByNumber: Map<number, StudentValue>;
  /** Решение учителя. Выключено → возвращается обычная синхронная сверка. */
  settings: ShortAnswerLlmSettings;
  /** Обращение к модели. Не зовётся вообще, пока сверка выключена. */
  check: ShortAnswerChecker;
}

/** Сколько коротких ответов сверяем одновременно. */
const SHORT_ANSWER_CONCURRENCY = 4;

/**
 * Общий потолок на сверку всей работы.
 *
 * Ученик нажал «Отправить» и смотрит на телефон. Двадцать ответов по 12 секунд
 * подряд — это четыре минуты ожидания, после которых он решит, что сайт
 * завис, и нажмёт ещё раз. Лучше часть коротких ответов честно уйдёт учителю
 * («не успели проверить»), чем ученик вообще не дождётся подтверждения.
 */
const SHORT_ANSWER_TOTAL_BUDGET_MS = 25_000;

/**
 * Сверить работу целиком: детерминированные задания — как раньше, короткие
 * ответы — моделью, ЕСЛИ УЧИТЕЛЬ ЭТО ВКЛЮЧИЛ.
 *
 * ГЛАВНОЕ ПРАВИЛО ФУНКЦИИ: она не бросает никогда. Отправка формы не должна
 * ломаться из-за провайдера, поэтому любой сбой здесь — это обычный ручной
 * ответ учителю, а не 500 ученику.
 */
export async function gradeSubmissionWithShortAnswerLlm(
  args: GradeSubmissionWithLlmArgs,
): Promise<GradedSubmission> {
  const graded = gradeSubmission(args.tasks, args.answersByNumber);

  // Выключено — ни одного вызова модели. Это и есть поведение по умолчанию.
  if (!args.settings.enabled) return graded;
  if (!hasShortAnswerTasks(args.tasks)) return graded;

  const targets = args.tasks.filter((t) => t.type === "short-answer");
  const deadline = Date.now() + SHORT_ANSWER_TOTAL_BUDGET_MS;

  const results = await runWithLimit(targets, SHORT_ANSWER_CONCURRENCY, async (task) => {
    // Бюджет исчерпан — дальше ответы уходят учителю как есть.
    if (Date.now() >= deadline) return null;
    try {
      const grade = await args.check(task, args.answersByNumber.get(task.number));
      return { number: task.number, grade };
    } catch {
      // Страховка от будущих правок движка: любой сбой = ручная проверка.
      return null;
    }
  });

  const byNumber = new Map<number, ShortAnswerCheckResult>();
  for (const r of results) {
    if (r) byNumber.set(r.number, { grade: r.grade, checked: true });
  }

  let scoreTotal = 0;
  let needsReviewCount = 0;
  const perTask = graded.perTask.map((entry) => {
    const checked = byNumber.get(entry.taskNumber);
    if (!checked) {
      scoreTotal += entry.pointsAwarded;
      if (entry.needsReview) needsReviewCount += 1;
      return entry;
    }

    const grade = checked.grade;
    scoreTotal += grade.pointsAwarded;
    if (grade.needsReview) needsReviewCount += 1;
    return {
      ...entry,
      isCorrect: grade.isCorrect,
      pointsAwarded: grade.pointsAwarded,
      needsReview: grade.needsReview,
      checkMethod: grade.checkMethod,
      ...(grade.reason ? { reason: grade.reason } : {}),
      shortAnswer: grade,
    };
  });

  graded.perTask = perTask;
  graded.scoreTotal = scoreTotal;
  graded.needsReviewCount = needsReviewCount;
  return graded;
}

/**
 * Пул с ограничением по числу одновременных задач.
 *
 * `Promise.all` на двадцати коротких ответах — это двадцать одновременных
 * запросов провайдеру: почти гарантированный 429, а каждый 429 — ручная
 * проверка вместо вердикта. Очередь дешевле и предсказуемее.
 */
async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;

  const runner = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index] as T);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => runner()),
  );
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// check_meta_json: чужое решение нельзя выдать за своё
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Снимок решения по одному ответу.
 *
 * Поле `decidedBy` — то, ради которого снимок и существует: «верно» от модели и
 * «верно» от учителя выглядят в журнале одинаково, если не сказать, чьё это
 * решение. `modelVerdict`/`confidence` — что именно сказала машина, даже если
 * учитель потом поправил.
 */
export interface CheckMeta {
  reason?: string;
  /** Сверку короткого ответа запускали. false — не запускали (галочка снята). */
  llmChecked?: boolean;
  decidedBy?: "model" | "teacher";
  modelVerdict?: ShortAnswerVerdict | null;
  confidence?: number | null;
  comment?: string | null;
  /** Unix seconds: когда это решение приняли. Не то же, что created_at ответа. */
  decidedAt?: number;
}

/**
 * Собрать `check_meta_json` из вердикта. Одна функция на всех писателей.
 *
 * `shortAnswer` — вложенный вердикт машины из `gradeSubmissionWithShortAnswerLlm`.
 * Именно он, а не обёртка задания: чей-то привычный `buildCheckMeta(entry)`
 * без второго аргумента записал бы снимок БЕЗ `decidedBy`, и через месяц в
 * журнале выглядело бы так, будто отметку поставил человек.
 */
export function buildCheckMeta(
  grade: GradedAnswer,
  opts: { llmChecked: boolean; decidedAt: number; shortAnswer?: ShortAnswerGrade },
): string {
  const short = opts.shortAnswer ?? (grade as Partial<ShortAnswerGrade>);
  const meta: CheckMeta = {
    ...(grade.reason ? { reason: grade.reason } : {}),
    llmChecked: opts.llmChecked,
  };
  if (short.decidedBy) meta.decidedBy = short.decidedBy;
  if ("modelVerdict" in short) meta.modelVerdict = short.modelVerdict ?? null;
  if ("confidence" in short) meta.confidence = short.confidence ?? null;
  if ("comment" in short) meta.comment = short.comment ?? null;

  return JSON.stringify({ ...meta, decidedAt: opts.decidedAt });
}

/** Прочитать `check_meta_json`. Битая строка — пустой снимок, а не исключение. */
export function parseCheckMeta(raw: string | null | undefined): CheckMeta {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const m = parsed as Record<string, unknown>;
  const meta: CheckMeta = {};
  if (typeof m.reason === "string") meta.reason = m.reason;
  if (typeof m.llmChecked === "boolean") meta.llmChecked = m.llmChecked;
  if (m.decidedBy === "model" || m.decidedBy === "teacher") meta.decidedBy = m.decidedBy;
  if (
    m.modelVerdict === "correct" ||
    m.modelVerdict === "incorrect" ||
    m.modelVerdict === "uncertain"
  ) {
    meta.modelVerdict = m.modelVerdict;
  }
  if (typeof m.confidence === "number" && Number.isFinite(m.confidence)) meta.confidence = m.confidence;
  if (typeof m.comment === "string") meta.comment = m.comment;
  if (typeof m.decidedAt === "number" && Number.isFinite(m.decidedAt)) meta.decidedAt = m.decidedAt;
  return meta;
}

/**
 * Состояние ответа для журнала.
 *
 * Состояния должны быть ВИДНЫ РАЗНЫМИ, иначе журнал врёт: «верно» от машины,
 * «верно» от учителя и «мы не уверены» — это три разных события. Здесь они
 * становятся машинно-читаемыми, слова учителю собирает фронт.
 */
export type AnswerState =
  /** Уверенный вердикт модели — учитель работу не открывал. */
  | "model_correct"
  | "model_incorrect"
  /** Модель не уверена / не ответила / сверка выключена — ждёт учителя. */
  | "needs_review"
  /** Решение принял человек. Побеждает всегда, даже если машина была права. */
  | "teacher_correct"
  | "teacher_incorrect"
  /** Посчитали без модели: число, вариант, пропуск. Ничьё решение не нужно. */
  | "auto_correct"
  | "auto_incorrect";

export interface AnswerStateInput {
  isCorrect: boolean | null;
  needsReview: boolean;
  checkMethod: CheckMethod;
  meta: CheckMeta;
}

/**
 * Разложить вердикт по состояниям журнала.
 *
 * Порядок проверок значим, и это не стилистика:
 *   1) решение учителя — оно перебивает всё остальное, иначе выправленная
 *      учителем ошибка модели через месяц выглядела бы как ошибка машины;
 *   2) needs_review — раньше вердикта модели, потому что модель могла назвать
 *      «incorrect», а уверенности не хватило: учителю такой ответ всё равно
 *      показывается как «не уверен», а не как «неверно»;
 *   3) вердикт модели — только если сверка реально её запускала;
 *   4) всё остальное без needsReview — детерминированная сверка.
 */
export function describeAnswerState(input: AnswerStateInput): AnswerState {
  const { meta } = input;
  if (meta.decidedBy === "teacher") {
    return input.isCorrect === true ? "teacher_correct" : "teacher_incorrect";
  }
  // Решения нет — значит, ждёт учителя. Такой ответ нельзя называть «неверно»:
  // «мы не знаем» и «ответ неверный» — разные вещи, и путать их нельзя даже
  // при испорченных данных.
  if (input.needsReview || input.isCorrect === null) return "needs_review";
  if (meta.decidedBy === "model" && input.checkMethod === "llm") {
    return input.isCorrect ? "model_correct" : "model_incorrect";
  }
  return input.isCorrect ? "auto_correct" : "auto_incorrect";
}

/**
 * Разбор и подсчёт результатов проверки фото (TZ-11).
 *
 * Модуль ЧИСТЫЙ: ни D1, ни R2, ни env, ни HTTP. На вход — «что ответил
 * распознающий LLM» (сырой текст его JSON) + эталонные задания. На выходе —
 * типизированный вердикт по каждому заданию и итоговый балл.
 *
 * ── Правило честности ───────────────────────────────────────────────────────
 * Если модель НЕ УВЕРЕНА — это НЕ «неправильно». Три отдельных состояния:
 *
 *   correct   — ответ засчитан, балл полный
 *   incorrect — ответ разобран, но не совпал с эталоном, балл 0
 *   unclear   — разобрать не удалось (почерк не читается, задание не найдено)
 *
 * «Непонятно» никогда не превращается в «неправильно»: ложный ноль в журнале
 * учителя хуже, чем лишняя ручная перепроверка. Строки `unclear` всегда
 * помечаются needsReview и выводятся учителю отдельным списком.
 *
 * Если LLM вернул нечитаемый JSON — это НЕ «всё неправильно». Мы НЕ ГАДАЕМ:
 * все задания получают `unclear` + needsReview, а вызывающий роут отдаёт
 * 503 и не списывает квоту (проверка не состоялась).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

/** Что сделал с заданием распознающий LLM. */
export type PhotoVerdict = "correct" | "incorrect" | "unclear";

/** Эталонное задание — приходит из тела запроса фронта. */
export interface ExpectedTask {
  number: number;
  taskText: string;
  correctAnswer: string;
  maxPoints: number;
}

/** Вердикт по одному заданию — то, что показываем учителю. */
export interface GradedPhotoItem {
  number: number;
  taskText: string;
  expected: string;
  studentAnswer: string | null;
  verdict: PhotoVerdict;
  /** Балл за задание. correct → maxPoints, остальное → 0. */
  pointsAwarded: number;
  maxPoints: number;
  /** Уверенность распознавания 0..1. null — модель не дала. */
  confidence: number | null;
  /** Учитель должен посмотреть глазами. */
  needsReview: boolean;
  /** Короткое объяснение ИИ, одна строка. */
  comment: string | null;
}

/** Порог уверенности, ниже которого учитель перепроверяет сам (ТЗ §11 DoD). */
export const CONFIDENCE_THRESHOLD = 0.6;

/** Отметка по проценту (ТЗ §7.3). Пороги в одном объекте, не размазаны. */
export const GRADE_THRESHOLDS: ReadonlyArray<{ minPercent: number; mark: "5" | "4" | "3" | "2" }> = [
  { minPercent: 85, mark: "5" },
  { minPercent: 70, mark: "4" },
  { minPercent: 50, mark: "3" },
  { minPercent: 0, mark: "2" },
];

/** Итог по всей проверке. */
export interface PhotoCheckSummary {
  items: GradedPhotoItem[];
  totalPoints: number;
  earnedPoints: number;
  /** 0..100, null если totalPoints === 0 (делить на ноль нельзя). */
  percentage: number | null;
  gradeMark: "5" | "4" | "3" | "2" | null;
  needsReview: boolean;
  /** Сколько заданий ждут учителя. */
  reviewCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Пороги отметки и retention
// ─────────────────────────────────────────────────────────────────────────────

/** Процент выполнения → отметка. null, если процент неизвестен. */
export function gradeFromPercentage(percentage: number | null): "5" | "4" | "3" | "2" | null {
  if (percentage === null || !Number.isFinite(percentage)) return null;
  for (const t of GRADE_THRESHOLDS) {
    if (percentage >= t.minPercent) return t.mark;
  }
  return "2";
}

/**
 * Срок хранения фото — 7 дней с момента проверки (ТЗ §5.2, В-2.3).
 *
 * Фото нужно учителю на разбор и на случай «учитель увидел не то»;
 * дольше хранить фото чужой тетради мы не имеем права. Метаданные проверки
 * при этом живут до удаления аккаунта — стираем только изображение.
 */
export const PHOTO_RETENTION_DAYS = 7;
export const PHOTO_RETENTION_SECONDS = PHOTO_RETENTION_DAYS * 24 * 60 * 60;

/**
 * Unix-seconds, когда фото этой проверки обязано быть удалено из R2.
 * null, если фото уже удалено (deletedAt) — тогда срок не считаем заново.
 */
export function photoDeleteAt(createdAtUnixSec: number, deletedAtUnixSec: number | null = null): number | null {
  if (deletedAtUnixSec !== null) return deletedAtUnixSec;
  return createdAtUnixSec + PHOTO_RETENTION_SECONDS;
}

/** Фото просрочено? Сравнение `>` — на ровно границе секунды ещё не просрочено. */
export function isPhotoExpired(
  createdAtUnixSec: number,
  deletedAtUnixSec: number | null = null,
  nowUnixSec: number = Math.floor(Date.now() / 1000),
): boolean {
  const due = photoDeleteAt(createdAtUnixSec, deletedAtUnixSec);
  if (due === null) return false;
  return nowUnixSec > due;
}

// ─────────────────────────────────────────────────────────────────────────────
// Разбор ответа модели
// ─────────────────────────────────────────────────────────────────────────────

/** Обёртка, которая всегда срабатывает, даже если LLM обернул JSON в ```json. */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Убираем markdown-обёртку — модели часто её лепят, даже когда просят JSON.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf("{");
  if (start === -1) return null;
  // Идём до последней закрывающей скобки, чтобы срезать хвост после JSON.
  const end = body.lastIndexOf("}");
  if (end <= start) return null;
  return body.slice(start, end + 1);
}

/** Модель могла вернуть элемент как объект или как строку — приводим к строке. */
function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const s = value.trim();
    return s === "" ? null : s;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Уверенность: число 0..1. Модель иногда шлёт 85 вместо 0.85 — чиним. */
function toConfidence(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

/**
 * Привести сырой вердикт модели к одному из трёх состояний.
 *
 * Ключевое требование ТЗ: «непонятно» — ОТДЕЛЬНОЕ значение, а не «неправильно».
 * Всё, что модель не смогла уверенно разобрать, становится `unclear`.
 */
export function normalizeVerdict(value: unknown, studentAnswer: string | null, confidence: number | null): PhotoVerdict {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";

  // Явные «не разобрали» — сначала, чтобы модель не переименовала их в wrong.
  if (
    v === "unclear" ||
    v === "unknown" ||
    v === "illegible" ||
    v === "not_found" ||
    v === "missing" ||
    v === "unreadable"
  ) {
    return "unclear";
  }

  // Гейты «не имеем права решать» стоят ДО разбора вердикта модели.
  // Раньше они были ниже, и явный `verdict: "correct"` от модели их обходил:
  // при confidence 0.2 в журнал ученика попадал «верно», хотя ответ не
  // разобран. Это ровно тот ложный ноль/единица, которого требовала избежать
  // спецификация «непонятно ≠ неправильно».
  //
  // 1) Нет распознанного ответа — мы не читали работу, решать нельзя
  //    независимо от того, насколько уверенно ответила модель.
  if (studentAnswer === null) return "unclear";
  // 2) Низкая уверенность — модель сомневается в РАСПОЗНАВАНИИ. Сомнение
  //    относится к тому, что мы прочитали, а не к правильности ответа,
  //    поэтому «верно/неверно» тут ставить нельзя.
  if (confidence !== null && confidence < CONFIDENCE_THRESHOLD) return "unclear";

  if (v === "correct" || v === "right" || v === "true") return "correct";
  if (v === "incorrect" || v === "wrong" || v === "false") return "incorrect";

  // Есть разобранный ответ и высокая уверенность, но вердикта нет —
  // модель не справилась с форматом. Честнее отдать это учителю.
  return "unclear";
}

/**
 * Разобрать ответ модели и посчитать баллы по эталонам.
 *
 * @param rawModelOutput сырой `content` от vision-модели (ожидаем JSON-строку).
 * @param tasks         эталоны из тела запроса. Задания, которых модель не
 *                      упомянула, всё равно попадут в результат как `unclear` —
 *                      учитель увидит, что по ним ответа нет.
 */
export function gradePhotoCheck(rawModelOutput: string, tasks: ExpectedTask[]): PhotoCheckSummary {
  const byNumber = new Map<number, GradedPhotoItem>();

  const parsed = safeParse(rawModelOutput);
  const modelItems: unknown[] = Array.isArray(parsed?.items) ? parsed.items : [];

  // 1. Идём по ЭТАЛОНАМ, а не по ответу модели: так пропущенные задания
  //    не исчезают из результата молча.
  for (const task of tasks) {
    const raw = findModelItem(modelItems, task.number);
    const studentAnswer = toText(raw?.studentAnswer);
    const confidence = toConfidence(raw?.confidence);
    const verdict = normalizeVerdict(raw?.verdict, studentAnswer, confidence);
    const maxPoints = Number.isFinite(task.maxPoints) && task.maxPoints > 0 ? task.maxPoints : 1;

    byNumber.set(task.number, {
      number: task.number,
      taskText: task.taskText,
      expected: task.correctAnswer,
      studentAnswer,
      verdict,
      pointsAwarded: verdict === "correct" ? maxPoints : 0,
      maxPoints,
      confidence,
      // Назначаемое задание без ответа — это не «ноль», это «посмотри сам».
      needsReview: verdict !== "correct",
      comment: toText(raw?.comment),
    });
  }

  const items = [...byNumber.values()].sort((a, b) => a.number - b.number);

  const totalPoints = items.reduce((s, i) => s + i.maxPoints, 0);
  const earnedPoints = items.reduce((s, i) => s + i.pointsAwarded, 0);
  const percentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : null;
  const reviewCount = items.filter((i) => i.needsReview).length;

  return {
    items,
    totalPoints,
    earnedPoints,
    percentage,
    gradeMark: gradeFromPercentage(percentage),
    needsReview: reviewCount > 0,
    reviewCount,
  };
}

function safeParse(raw: string): { items?: unknown[] } | null {
  const json = extractJson(raw);
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as { items?: unknown[] }) : null;
  } catch {
    return null;
  }
}

/** Найти элемент по номеру задания. Номер может прийти строкой. */
function findModelItem(items: unknown[], taskNumber: number): Record<string, unknown> | null {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const n = rec.number ?? rec.taskNumber;
    const parsedN = typeof n === "number" ? n : Number(n);
    if (Number.isFinite(parsedN) && parsedN === taskNumber) return rec;
  }
  return null;
}

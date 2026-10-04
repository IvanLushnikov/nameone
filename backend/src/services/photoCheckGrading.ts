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

/**
 * Порог уверенности, ниже которого учитель перепроверяет сам (ТЗ §11 DoD).
 *
 * ВАЖНО: это число обязано совпадать с `CONFIDENCE_THRESHOLD` во фронте
 * (`src/lib/photo-check/confidence.ts`). Решение владельца 2026-10-03 — 0,85
 * (docs/tz/18-money-and-trust.md §7). Расхождение опасно конкретно: при 0,6 бэк
 * назвал бы «Верно» ответ, прочитанный с уверенностью 0,7, начислил балл и
 * включил его в итоговый процент, а фронт такую строку прятал бы в блок
 * «Проверьте сами» и итоговую отметку не показывал бы вовсе. Учитель увидел бы
 * в базе одно, на экране — другое. Меняешь здесь — поменяй и там.
 */
export const CONFIDENCE_THRESHOLD = 0.85;

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

// ─────────────────────────────────────────────────────────────────────────────
// Слияние машинного результата с ручными отметками учителя (ТЗ-19 §2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Задание проверки в том виде, в каком оно лежит в `photo_check_items` —
 * то есть РЕШЕНИЕ МАШИНЫ. Ручные отметки учителя в эту таблицу не пишутся
 * никогда (прямое требование ТЗ-19 §3), поэтому исходный вердикт всегда цел.
 */
export interface StoredCheckItem {
  number: number;
  verdict: PhotoVerdict;
  pointsAwarded: number;
  maxPoints: number;
  needsReview: boolean;
}

/** Отметка учителя по одному заданию — как её прислали с фронта. */
export interface ManualMarkInput {
  taskNumber: number;
  accepted: boolean;
  /** Может прийти мусором (строка, NaN) — чистит `normalizeTeacherPoints`. */
  points: number | null;
}

/** Чьё решение лежит в строке. Обязательное поле выгрузки (ТЗ-19 §2). */
export type MarkSource = "model" | "teacher";

/** Строка результата после слияния: итог + снимок того, что было до него. */
export interface MergedItem extends StoredCheckItem {
  /** Итоговый вердикт: отметка учителя ПОБЕЖДАЕТ вердикт модели. */
  verdict: PhotoVerdict;
  /** Итоговый балл. */
  pointsAwarded: number;
  /** Задание всё ещё ждёт учителя (модель не разобрала, отметки нет). */
  needsReview: boolean;
  decidedBy: MarkSource;
  /** Снимок машины. Через месяц по нему видно, что именно исправил человек. */
  modelVerdict: PhotoVerdict;
  modelPoints: number;
  /** Отметка учителя, если она была. null = учитель не смотрел. */
  teacherAccepted: boolean | null;
  teacherPoints: number | null;
}

export interface MergedCheck {
  items: MergedItem[];
  /** Всегда полный: неразобранные задания в него входят. */
  totalPoints: number;
  /** По объединённым данным. */
  earnedPoints: number;
  /** null, пока есть неразобранные задания (тот же гейт, что CONFIDENCE_THRESHOLD). */
  percentage: number | null;
  gradeMark: "5" | "4" | "3" | "2" | null;
  /** Сколько сомнительных заданий ещё без ручного решения. */
  pendingReview: number;
  /** true, если учителю есть что смотреть. */
  needsReview: boolean;
}

/**
 * Привести балл учителя к целому числу в диапазоне 0..maxPoints.
 *
 * Мусор на входе (строка, NaN, null, объект) — это 0, а НЕ исключение наружу:
 * интерфейс учителя не должен падать из-за одного кривого поля. `accepted:false`
 * даёт 0 вне зависимости от присланного балла — иначе «не засчитано, но 2 балла»
 * противоречило бы самому себе.
 */
export function normalizeTeacherPoints(raw: unknown, maxPoints: number): number {
  const max = Number.isFinite(maxPoints) && maxPoints > 0 ? Math.max(1, Math.trunc(maxPoints)) : 1;
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  else n = NaN;
  if (!Number.isFinite(n)) return 0;
  // Дробный балл округляем, а не отбрасываем: половинный балл в школьном
  // листе — обычное дело, и колонка INTEGER его всё равно примет только целым.
  return Math.max(0, Math.min(max, Math.round(n)));
}

/**
 * Наложить ручные отметки учителя на машинный результат.
 *
 * Правила, из-за которых функция отдельная, а не флаг в существующей:
 *   1) отметка учителя ПОБЕЖДАЕТ, но не затирает машину молча — в ответе остаётся
 *      `decidedBy` и снимок `modelVerdict`/`modelPoints`;
 *   2) неразобранное задание без отметки учителя НЕ ТЯНЕТ ИТОГ ВНИЗ и не
 *      превращается в «неправильно»: пока такие есть, `percentage` и `gradeMark`
 *      равны null. Итог появляется только когда учитель закрыл все сомнительные;
 *   3) `totalPoints` всегда полный — включая неразобранные, иначе процент
 *      прыгал бы вверх по мере разбора и учитель видел бы рост балла из-за
 *      того, что модель что-то не прочитала.
 */
export function mergeManualMarks(items: StoredCheckItem[], marks: ManualMarkInput[]): MergedCheck {
  const byNumber = new Map<number, ManualMarkInput>();
  for (const m of marks) {
    if (!byNumber.has(m.taskNumber)) byNumber.set(m.taskNumber, m);
  }

  const merged: MergedItem[] = items.map((item) => {
    const mark = byNumber.get(item.number);
    const modelVerdict = item.verdict;
    const modelPoints = item.pointsAwarded;

    if (!mark) {
      // Учитель сюда не вступился: показываем машинное решение как есть.
      return {
        ...item,
        decidedBy: "model",
        modelVerdict,
        modelPoints,
        teacherAccepted: null,
        teacherPoints: null,
      };
    }

    const points = mark.accepted ? normalizeTeacherPoints(mark.points, item.maxPoints) : 0;
    return {
      ...item,
      verdict: mark.accepted ? ("correct" as PhotoVerdict) : ("incorrect" as PhotoVerdict),
      pointsAwarded: points,
      // Учитель посмотрел — задание больше не ждёт. Даже если ответил «неверно».
      needsReview: false,
      decidedBy: "teacher",
      modelVerdict,
      modelPoints,
      teacherAccepted: mark.accepted,
      teacherPoints: points,
    };
  });

  const totalPoints = merged.reduce((s, i) => s + i.maxPoints, 0);
  const earnedPoints = merged.reduce((s, i) => s + i.pointsAwarded, 0);
  const pendingReview = merged.filter((i) => i.needsReview).length;

  const rawPercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : null;
  // Неполный разбор — это не ноль и не тройка. Молчаливый ноль в журнале учителя
  // хуже, чем отсутствие отметки, поэтому отметки просто нет.
  const complete = pendingReview === 0;
  const percentage = complete ? rawPercentage : null;

  return {
    items: merged,
    totalPoints,
    earnedPoints,
    percentage,
    gradeMark: complete ? gradeFromPercentage(percentage) : null,
    pendingReview,
    needsReview: pendingReview > 0,
  };
}

/**
 * Итог, который дала МАШИНА, до ручных правок.
 *
 * Считается из `photo_check_items` на лету, а не хранится отдельной колонкой:
 * строки items никогда не переписываются ручными отметками, поэтому машинный
 * результат восстанавливается из них всегда и не может «поехать» от того, что
 * учитель что-то поправил.
 *
 * ВНИМАНИЕ, здесь процент и отметка считаются ДАЖЕ при неразобранных заданиях —
 * в отличие от `mergeManualMarks`. Это не противоречие: `modelResult` —
 * буквально «что предложила машина», то есть ровно то, что она сказала сразу
 * после распознавания. Итог для учителя жив в mergeManualMarks.
 */
export function machineResultOf(items: StoredCheckItem[]): {
  totalPoints: number;
  earnedPoints: number;
  percentage: number | null;
  gradeMark: "5" | "4" | "3" | "2" | null;
} {
  const totalPoints = items.reduce((s, i) => s + i.maxPoints, 0);
  const earnedPoints = items.reduce((s, i) => s + i.pointsAwarded, 0);
  const percentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : null;
  return { totalPoints, earnedPoints, percentage, gradeMark: gradeFromPercentage(percentage) };
}

/**
 * Источник решения для журнала.
 *
 * machine — учитель не смотрел ни одного задания;
 * teacher — смотрел и закрыл все сомнительные;
 * mixed  — правил, но часть сомнительных ещё ждёт.
 */
export function journalSourceFor(manualCount: number, pendingReview: number): "machine" | "teacher" | "mixed" {
  if (manualCount === 0) return "machine";
  return pendingReview === 0 ? "teacher" : "mixed";
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

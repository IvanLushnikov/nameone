/**
 * Q1-2027: мок-генератор КТП (календарно-тематическое планирование).
 *
 * Контракт:
 *   Вход:  GenerationRequest { subject, grade, topic, schoolYear? }
 *   Выход: Ktp — { id, title, weeks: [{ weekNum, entries: KtpEntry[] }], totalHours, ... }
 *
 * Логика распределения часов:
 *   - 68 ч/год  = 34 недели × 2 ч/нед → 1 запись/нед (2 часа)
 *   - 102 ч/год = 34 недели × 3 ч/нед → 2 записи/нед (2 ч + 1 ч)
 *   - 34 ч/год  = 17 недель × 2 ч/нед → 1 запись/нед (fallback)
 *
 * Даты недель считаются от 1 сентября года начала уч. года,
 * диапазон Mon-Sat (6 дней), формат "DD.MM–DD.MM".
 *
 * Темы берутся из `getGrade(subject, grade)?.topics[]` циклически;
 * для entry `num` индекс = `(num - 1) % topics.length`.
 *
 * TZ: docs/tz/03-ktp.md
 */
import type {
  GenerationRequest,
  Ktp,
  KtpEntry,
  KtpLessonKind,
  Topic,
  SubjectSlug,
} from "@/lib/types";
import { getSubject, getGrade } from "@/lib/content/subjects";
import { shortId } from "@/lib/utils/cn";

// =============== Матрица часов ===============

interface KtpHoursRule {
  /** Суммарно часов в учебном году. */
  total: number;
  /** Количество учебных недель. */
  weeks: number;
  /** Часов в неделю (1 | 2 | 3). */
  hoursPerWeek: number;
}

/**
 * Иностранные языки — 102 ч/год для 2–11 кл. (По ТЗ строго.)
 */
const FOREIGN_LANGS: ReadonlySet<SubjectSlug> = new Set<SubjectSlug>([
  "english",
  "german",
]);

/**
 * Возвращает правило распределения часов по предмету и классу.
 * Если предмет/класс не описан — fallback по grade:
 *   ≥ 10 класс → 102 ч (3 ч/нед)
 *   иначе      → 68 ч (2 ч/нед)
 */
function resolveHoursRule(subject: SubjectSlug, grade: number): KtpHoursRule {
  if (FOREIGN_LANGS.has(subject) && grade >= 2 && grade <= 11) {
    return { total: 102, weeks: 34, hoursPerWeek: 3 };
  }

  // Русский / литература: 5–9 = 68 (2 ч/нед), 10–11 = 102 (3 ч/нед),
  // начальная школа (2–4 кл.) — 68 ч/год.
  if (subject === "russian" || subject === "literature") {
    if (grade >= 10) return { total: 102, weeks: 34, hoursPerWeek: 3 };
    if (grade >= 2) return { total: 68, weeks: 34, hoursPerWeek: 2 };
  }

  // Математика (1–6) — 68 ч (2 ч/нед).
  if (subject === "math") {
    if (grade >= 10) return { total: 102, weeks: 34, hoursPerWeek: 3 };
    if (grade >= 1) return { total: 68, weeks: 34, hoursPerWeek: 2 };
  }

  // Алгебра / геометрия: 7–9 = 68, 10–11 = 102.
  if (subject === "algebra" || subject === "geometry") {
    if (grade >= 10) return { total: 102, weeks: 34, hoursPerWeek: 3 };
    if (grade >= 7) return { total: 68, weeks: 34, hoursPerWeek: 2 };
  }

  // Прочие предметы: ≥ 10 → 102, иначе 68.
  if (grade >= 10) return { total: 102, weeks: 34, hoursPerWeek: 3 };
  return { total: 68, weeks: 34, hoursPerWeek: 2 };
}

// =============== Темы и типы ===============

/**
 * Достаём массив тем для (subject, grade). Возвращаем пустой массив, если ничего не нашли.
 * Это позволяет генератору не падать на отсутствующей таксономии.
 */
function getTopicsForGrade(subject: SubjectSlug, grade: number): Topic[] {
  const g = getGrade(subject, grade);
  return g?.topics ?? [];
}

/**
 * Циклический обход тем: entry `num` → topics[(num - 1) % topics.length].
 * Если тем нет — используем переданный fallback (req.topic) как строку-заглушку.
 */
function pickTopicForEntry(
  num: number,
  topics: Topic[],
  fallbackTopicTitle: string
): { title: string; fgosRef?: string } {
  if (topics.length === 0) {
    return { title: fallbackTopicTitle || "Свободная тема" };
  }
  const idx = (num - 1) % topics.length;
  const t = topics[idx];
  return { title: t.title, fgosRef: t.fgosRef };
}

/**
 * Детерминированное распределение типа урока по номеру записи.
 *
 * Эмпирика на 68 записях:
 *   n % 20 === 0 → test          (≈ 5 %)
 *   n % 10 === 0 → control       (≈ 5–10 %)
 *   n % 13 === 0 → project       (≈ 7 %)
 *   n % 17 === 0 → reserve       (≈ 6 %)
 *   n % 7 === 0  → review        (≈ 13 %, пересечения отсекаются выше)
 *   иначе        → lesson        (≈ 50–60 %)
 */
function kindForEntry(num: number): KtpLessonKind {
  if (num % 20 === 0) return "test";
  if (num % 10 === 0) return "control";
  if (num % 13 === 0) return "project";
  if (num % 17 === 0) return "reserve";
  if (num % 7 === 0) return "review";
  return "lesson";
}

// =============== Даты ===============

/** Разделитель диапазона дат — en-dash (как в ТЗ: «08.09–13.09»). */
const DATE_RANGE_SEP = "\u2013";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatKtpDay(date: Date): string {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
}

/**
 * Вычисляет диапазон дат для недели `weekNum` (1..N).
 * Неделя N начинается на (Sept 1 + (N-1)*7) день и длится 6 дней (Mon–Sat).
 * Пример: weekNum=2, schoolYear="2026/2027" → "08.09–13.09".
 */
export function computeWeekDates(weekNum: number, schoolYear: string): string {
  const startYear =
    parseInt(schoolYear.split("/")[0] ?? "", 10) || new Date().getFullYear();
  // Sept 1 года начала уч. года (месяцы 0-index: 8 = сентябрь).
  const baseMs = new Date(startYear, 8, 1).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(baseMs + (weekNum - 1) * 7 * dayMs);
  const end = new Date(start.getTime() + 5 * dayMs);
  return `${formatKtpDay(start)}${DATE_RANGE_SEP}${formatKtpDay(end)}`;
}

// =============== Сборка entries / weeks ===============

function makeEntry(
  num: number,
  dates: string,
  topic: { title: string; fgosRef?: string },
  hours: 1 | 2
): KtpEntry {
  return {
    num,
    dates,
    topic: topic.title,
    kind: kindForEntry(num),
    hours,
    fgosRef: topic.fgosRef,
  };
}

/**
 * Раскладывает записи по неделям. Возвращает массив weeks в порядке возрастания номера.
 *
 * Распределение:
 *   rule.hoursPerWeek === 2 → 1 запись × 2 ч в каждой неделе
 *   rule.hoursPerWeek === 3 → 2 записи: первая 2 ч, вторая 1 ч
 *   rule.hoursPerWeek === 1 → 1 запись × 1 ч (fallback)
 */
function buildWeeks(
  rule: KtpHoursRule,
  topics: Topic[],
  fallbackTopicTitle: string,
  schoolYear: string
): Array<{ weekNum: number; entries: KtpEntry[] }> {
  const weeks: Array<{ weekNum: number; entries: KtpEntry[] }> = [];
  let entryNum = 1;
  for (let w = 1; w <= rule.weeks; w++) {
    const dates = computeWeekDates(w, schoolYear);
    const entries: KtpEntry[] = [];
    if (rule.hoursPerWeek >= 3) {
      const t1 = pickTopicForEntry(entryNum, topics, fallbackTopicTitle);
      entries.push(makeEntry(entryNum, dates, t1, 2));
      entryNum++;
      const t2 = pickTopicForEntry(entryNum, topics, fallbackTopicTitle);
      entries.push(makeEntry(entryNum, dates, t2, 1));
      entryNum++;
    } else {
      // 1 за 2 часа или 1 за 1 час.
      const t = pickTopicForEntry(entryNum, topics, fallbackTopicTitle);
      const hours: 1 | 2 = rule.hoursPerWeek >= 2 ? 2 : 1;
      entries.push(makeEntry(entryNum, dates, t, hours));
      entryNum++;
    }
    weeks.push({ weekNum: w, entries });
  }
  return weeks;
}

// =============== Публичный API ===============

/**
 * Генерирует КТП для (subject, grade, topic, schoolYear).
 *
 * Signalatura фиксирована manifest'ом (TZ-00): контракт НЕ меняется,
 * родительский smart-генератор рассчитывает на неё.
 */
export async function generateKtp(req: GenerationRequest): Promise<Ktp> {
  const subject = getSubject(req.subject);
  const schoolYear = req.schoolYear ?? "2026/2027";
  const rule = resolveHoursRule(req.subject, req.grade);
  const topics = getTopicsForGrade(req.subject, req.grade);
  const fallbackTopicTitle = topics[0]?.title ?? req.topic ?? "Тема";

  const startedAt = Date.now();
  const weeks = buildWeeks(rule, topics, fallbackTopicTitle, schoolYear);

  return {
    id: shortId(),
    title: `КТП · ${subject?.title ?? req.subject} · ${req.grade} класс · ${schoolYear}`,
    subject: req.subject,
    grade: req.grade,
    schoolYear,
    totalHours: rule.total,
    weeks,
    createdAt: new Date().toISOString(),
    generationMs: Date.now() - startedAt,
  };
}

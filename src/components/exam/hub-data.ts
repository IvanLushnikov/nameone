/**
 * Данные хабов экзаменов: `/exam/` и `/exam/[exam]`.
 *
 * Зачем отдельный файл: обе страницы хабов должны одинаково называть экзамен,
 * предмет и количество заданий. Если развести эти подписи по двум файлам,
 * через месяц на `/exam/oge/` будет «ОГЭ», а на `/exam/ege/` — «ЕГЭ» с
 * другой подписью, и это разъедутся молча.
 *
 * Источник чисел — только `EXAM_SUBJECTS`: ни одной цифры, которую нельзя
 * посчитать из таксономии.
 */

import { EXAM_SUBJECTS, type ExamKind, type ExamSubject } from "@/lib/content/exam-taxonomy";

/** Все экзамены, которые есть в таксономии. По одному параметру на каждый. */
export const EXAM_KINDS: ExamKind[] = Array.from(
  new Set(EXAM_SUBJECTS.map((s) => s.exam)),
);

export interface ExamHubInfo {
  kind: ExamKind;
  /** Короткое имя экзамена: «ОГЭ», «ЕГЭ». */
  full: string;
  /** Класс, который сдаёт этот экзамен. */
  grade: string;
  /**
   * Страница с тренажёром, где генерируется вариант целиком.
   * Старый адрес `/oge` не переименовываем: на нём накоплен вес,
   * и хабы ходят туда и обратно.
   */
  trainerUrl: string;
}

export const EXAM_HUBS: Record<ExamKind, ExamHubInfo> = {
  oge: { kind: "oge", full: "ОГЭ", grade: "9 класс", trainerUrl: "/oge" },
  ege: { kind: "ege", full: "ЕГЭ", grade: "11 класс", trainerUrl: "/oge" },
};

/**
 * Названия предметов экзамена.
 *
 * Ключи — это `subject` из таксономии, а не слаг из `content/subjects`:
 * в экзамене есть `math-p`/`math-b` (две математики ЕГЭ) и `social`
 * (обществознание ОГЭ, в школьной таксономии оно называется `obzh`).
 * Поэтому словарь свой, а не общий с темами.
 */
const SUBJECT_LABELS: Record<string, string> = {
  math: "Математика",
  "math-p": "Математика, профильный уровень",
  "math-b": "Математика, базовый уровень",
  russian: "Русский язык",
  physics: "Физика",
  chemistry: "Химия",
  biology: "Биология",
  history: "История",
  social: "Обществознание",
  english: "Английский язык",
  informatics: "Информатика",
  literature: "Литература",
};

/** Название предмета для заголовка. Запасной вариант — `title` из таксономии. */
export function subjectLabel(subject: ExamSubject): string {
  return SUBJECT_LABELS[subject.subject] ?? subject.title;
}

/** Все предметы одного экзамена, в порядке таксономии. */
export function subjectsOfExam(exam: string): ExamSubject[] {
  return EXAM_SUBJECTS.filter((s) => s.exam === exam);
}

/**
 * Пара (экзамен, предмет) из таксономии — источник данных для хаба
 * `/exam/[exam]/[subject]`. Для незнакомой пары — `null`, и страница отдаёт 404.
 */
export function getExamSubject(exam: string, subject: string): ExamSubject | null {
  return (
    EXAM_SUBJECTS.find((s) => s.exam === exam && s.subject === subject) ?? null
  );
}

/** Сколько всего номеров заданий в списке предметов. */
export function countNumbers(subjects: ExamSubject[]): number {
  return subjects.reduce((sum, s) => sum + s.numbers.length, 0);
}

/** Первая буква строчная: «Математика» → «математика» для текста после двоеточия. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Предметы одной строкой — для `description`.
 *
 * Зачем отдельная функция: число предметов и их список в описании раньше
 * жили в одной строке руками, и они разошлись — на `/exam/oge/` было
 * «по 5 предметам», а перечислено четыре (обществознание с 24 страницами
 * выпало). Теперь и число, и список считаются из одного массива
 * `subjects`, поэтому разойтись они не могут.
 */
export function subjectListText(subjects: ExamSubject[]): string {
  return subjects.map((s) => lowerFirst(subjectLabel(s))).join("; ");
}

/** Описание экзамена по строке. Для незнакомого `exam` — `null`. */
export function getExamHub(exam: string): ExamHubInfo | null {
  return exam === "oge" || exam === "ege" ? EXAM_HUBS[exam] : null;
}
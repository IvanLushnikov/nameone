/**
 * F-04-C: Адаптер для wizard-конструктора.
 *
 * Импортирует из `exam-taxonomy.ts` и адаптирует данные к упрощённому формату,
 * который нужен только wizard'у (5–6 предметов на экзамен + список номеров).
 *
 * Хранится отдельно, чтобы не тащить тяжёлую таксономию (218 номеров)
 * в типы wizard-логики и не ломать существующий код.
 *
 * @see exam-taxonomy.ts — полная таксономия ФИПИ (10 предметов / 218 номеров).
 */

import { EXAM_SUBJECTS, type ExamKind, type ExamNumber, type ExamSubject } from "./exam-taxonomy";

export type ExamSlug = ExamKind;

export interface ExamSubjectStub {
  slug: string;   // короткий subject ("math" | "math-p" | "math-b" | "russian" | ...)
  title: string;
  emoji: string;
}

export interface ExamNumberStub {
  exam: ExamSlug;
  subject: string;   // короткий subject (как в ExamSubjectStub.slug)
  number: number;
  title: string;
}

/**
 * 5–6 предметов на каждый экзамен (берём из полной таксономии).
 * Для ЕГЭ математики возвращаем обе: профильную и базовую.
 */
function pickSubjects(exam: ExamKind): ExamSubjectStub[] {
  return EXAM_SUBJECTS
    .filter((s) => s.exam === exam)
    .map((s) => ({ slug: s.subject, title: s.title, emoji: s.emoji }));
}

export const OGE_SUBJECTS: ExamSubjectStub[] = pickSubjects("oge");
export const EGE_SUBJECTS: ExamSubjectStub[] = pickSubjects("ege");

/** Все предметы по экзамену. */
export function getExamSubjects(exam: ExamSlug): ExamSubjectStub[] {
  return exam === "oge" ? OGE_SUBJECTS : EGE_SUBJECTS;
}

/** Полный список номеров из таксономии в упрощённом формате. */
export const EXAM_NUMBERS_STUB: ExamNumberStub[] = EXAM_SUBJECTS.flatMap((s) =>
  s.numbers.map((n) => ({
    exam: s.exam,
    subject: s.subject,
    number: n.number,
    title: n.title,
  })),
);

/** Все номера для конкретного (exam, subject). */
export function getExamNumbers(exam: ExamSlug, subject: string): ExamNumberStub[] {
  return EXAM_NUMBERS_STUB.filter((e) => e.exam === exam && e.subject === subject);
}

/** Проверить, существует ли такой номер в таксономии. */
export function examNumberExists(exam: ExamSlug, subject: string, number: number): boolean {
  return EXAM_NUMBERS_STUB.some((e) => e.exam === exam && e.subject === subject && e.number === number);
}

/** Реэкспорт полного типа для тех, кому нужны поля fgosRef/description. */
export type { ExamNumber, ExamSubject };

/**
 * Разбивка заданий на «машина справилась» и «это смотрит учитель» (ТЗ-19).
 *
 * Правило то же, что в бэке (`CONFIDENCE_THRESHOLD`), но на клиенте: интерфейс
 * решает, ЧТО показать учителю как «перепроверьте сами». Если бы он считал это
 * иначе, чем сервер, учитель видел бы в списке на проверку задания, которых
 * сервер не ждёт, — и его ручная отметка по ним молча улетела бы в никуда.
 *
 * Отдельный файл, а не функция в `api.ts`: им пользуются и панель, и страница
 * открытой проверки, и правило одно — значит, и место одно.
 */

import type { PhotoCheckItem, PhotoCheckManualMark } from "./types";

/** Задания, где учителю нужно принять решение. */
export interface ReviewPartition {
  /** Модель уверенно разобрала — учителю смотреть не на что. */
  settled: PhotoCheckItem[];
  /** Модель не уверена, и ручной отметки ещё нет. */
  needsDecision: PhotoCheckItem[];
  /** Учитель уже посмотрел это задание. */
  decided: PhotoCheckItem[];
}

/** Номера заданий, по которым учитель уже сохранил отметку. */
export function decidedTaskNumbers(marks: PhotoCheckManualMark[]): Set<number> {
  return new Set(marks.map((m) => m.taskNumber));
}

/**
 * Разложить задания по трём корзинам.
 *
 * `needsReview` здесь — итоговое поле с сервера: после сохранения ручных
 * отметок оно уже false у закрытых заданий, поэтому «ждать учителя» и
 * «модель не уверена» — не одно и то же. Именно поэтому разделение делает
 * серверный флаг, а не локальная проверка verdict.
 */
export function partitionByDecision(
  items: PhotoCheckItem[],
  marks: PhotoCheckManualMark[],
): ReviewPartition {
  const decided = decidedTaskNumbers(marks);
  return {
    settled: items.filter((i) => !i.needsReview && !decided.has(i.number)),
    needsDecision: items.filter((i) => i.needsReview && !decided.has(i.number)),
    decided: items.filter((i) => decided.has(i.number)),
  };
}

/** Русская плюрализация: 1 задание / 2 задания / 5 заданий. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

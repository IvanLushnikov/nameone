/**
 * Календарь учебного года 2026/2027 для «темы недели».
 * Жёстко закодированные границы четвертей и каникул.
 */

export type Season =
  | 'autumn-1'
  | 'autumn-break'
  | 'autumn-2'
  | 'winter-break'
  | 'spring-1'
  | 'spring-break'
  | 'spring-2'
  | 'summer';

export function getCurrentSeason(date: Date = new Date()): Season {
  const m = date.getMonth() + 1; // 1-12
  const d = date.getDate();

  // Каникулы
  if ((m === 10 && d >= 28) || (m === 11 && d <= 4)) return 'autumn-break';
  if ((m === 12 && d >= 28) || (m === 1 && d <= 11)) return 'winter-break';
  if (m === 3 && d >= 23) return 'spring-break';

  // Четверти (2026/2027)
  if (m === 9 || (m === 10 && d <= 25)) return 'autumn-1';
  if (m === 11 || (m === 12 && d <= 27)) return 'autumn-2';
  if (m === 1 || m === 2 || (m === 3 && d <= 22)) return 'spring-1';
  if (m === 4 || (m === 5 && d <= 25)) return 'spring-2';

  // Июнь–август = лето
  return 'summer';
}

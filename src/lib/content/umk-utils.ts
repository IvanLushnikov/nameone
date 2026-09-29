/**
 * TZ-08: тонкие обёртки над каталогом УМК для будущих расширений
 * (SEO-карта, LLM-prompt, A/B «выбрать учебник»).
 *
 * В UI продолжаем использовать `getUMK()` из `./umk` — она та же,
 * просто короче. Эти функции добавлены для семантической ясности
 * в местах, где явно нужно «УМК для предмета+класса».
 */

import { umk, getUMK, getUMKById, type UMKEntry } from "./umk";

/**
 * Алиас для getUMK с фиксированной семантикой: вернуть УМК,
 * доступные для данного предмета И класса (с учётом `grades`).
 *
 * Используется в местах, где явно нужен «список УМК для пары
 * (предмет, класс)», например, в SEO-карте или в LLM-prompt.
 *
 * @example
 * getUMKFor("math", 5)    // → [Моро, Виленкин, Мерзляк, Никольский, Петерсон]
 * getUMKFor("physics", 7) // → [Перышкин]
 */
export function getUMKFor(subjectId: string, gradeNum: number): UMKEntry[] {
  return getUMK(subjectId, gradeNum);
}

/**
 * Полный список УМК по предмету, без фильтра по классу.
 *
 * Используется для построения каталога УМК (например, на
 * /subject/<s>/ странице или в LLM-prompt как справочник).
 *
 * @example
 * getAllUMKFor("math") // → все УМК математики (5 шт)
 */
export function getAllUMKFor(subjectId: string): UMKEntry[] {
  return umk[subjectId] ?? [];
}

/**
 * Получить `UMKEntry` по `id` для конкретного предмета.
 *
 * Обёртка над `getUMKById` для будущей валидации (если id
 * окажется вне предмета — вернём `undefined`).
 *
 * @example
 * getUMKEntry("math", "vilenkin") // → { id: "vilenkin", name: "Виленкин Н.Я.", ... }
 * getUMKEntry("math", "fake")    // → undefined
 */
export function getUMKEntry(subjectId: string, umkId: string): UMKEntry | undefined {
  return getUMKById(subjectId, umkId);
}

/**
 * Получить отображаемое имя УМК (для LLM-prompt или для meta).
 *
 * Если id невалиден — возвращает сам id (best-effort, чтобы
 * LLM-prompt не падал с ошибкой).
 *
 * @example
 * getUMKName("math", "vilenkin") // → "Виленкин Н.Я."
 * getUMKName("math", "fake")     // → "fake"
 */
export function getUMKName(subjectId: string, umkId: string): string {
  return getUMKById(subjectId, umkId)?.name ?? umkId;
}

/**
 * Получить короткое имя УМК (для UI-чипов и meta).
 *
 * Если id невалиден — возвращает сам id.
 *
 * @example
 * getUMKShort("math", "vilenkin") // → "Виленкин"
 */
export function getUMKShort(subjectId: string, umkId: string): string {
  return getUMKById(subjectId, umkId)?.short ?? umkId;
}
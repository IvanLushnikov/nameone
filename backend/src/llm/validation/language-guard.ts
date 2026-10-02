/**
 * TZ-13: post-validation language guard.
 *
 * Проверяет, что в сгенерированном LLM тексте соблюдён language constraint:
 *   - subject ∈ {english, german} → допускается иноязычный текст
 *   - всё остальное                → требуется русский (по умолчанию)
 *
 * Эвристика дешёвая: считаем долю ASCII-латиницы и кириллицы в значимых
 * символах (буквы). Если в русскоязычном предмете доля латиницы > 30% и
 * доля кириллицы < 30% — считаем это языковым сбоем и возвращаем false.
 * Это не строгая детекция языка (для строгой нужен langid), но достаточно
 * для отлова явного «Open the brackets …» в задании по физике.
 *
 * Не смотрим на цифры/пунктуацию/формулы — только на буквы.
 */

import type { ExamVariant, SubjectSlug } from "../../types";

/** Языки, для которых разрешён иноязычный текст в формулировках. */
const FOREIGN_LANG_SUBJECTS = new Set<SubjectSlug>(["english", "german"]);

/** Доля ASCII-латиницы от всех букв (после ASCII >= 30% и кириллица < 30%) — считаем языковым сбоем. */
const LATIN_RATIO_REJECT = 30; // %
const CYRILLIC_RATIO_MIN = 30; // %

/**
 * Подсчитать доли латиницы и кириллицы в тексте (только буквы).
 *
 * @returns { latin: 0..100, cyrillic: 0..100, totalLetters }
 */
export function letterRatios(text: string): {
  latin: number;
  cyrillic: number;
  totalLetters: number;
} {
  if (!text) return { latin: 0, cyrillic: 0, totalLetters: 0 };
  let latin = 0;
  let cyrillic = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // ASCII латиница: A-Z, a-z
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      latin++;
      continue;
    }
    // Кириллица: U+0400..U+04FF (основной диапазон) + ё/Ё отдельно.
    if (
      (code >= 0x0400 && code <= 0x04ff) ||
      code === 0x0401 || // Ё
      code === 0x0451 // ё
    ) {
      cyrillic++;
      continue;
    }
  }
  const totalLetters = latin + cyrillic;
  if (totalLetters === 0) return { latin: 0, cyrillic: 0, totalLetters: 0 };
  return {
    latin: (latin / totalLetters) * 100,
    cyrillic: (cyrillic / totalLetters) * 100,
    totalLetters,
  };
}

/**
 * Решить, нарушает ли сгенерированный текст language constraint.
 *
 * @param text текст задания (или весь конкатенированный JSON варианта)
 * @param subject код предмета из SubjectSlug
 * @returns true если язык НЕ нарушен (текст проходит guard)
 */
export function passesLanguageGuard(text: string, subject: SubjectSlug): boolean {
  if (FOREIGN_LANG_SUBJECTS.has(subject)) {
    // Для иностранных языков не валидируем — LLM должна писать на целевом языке,
    // а у нас нет строгого детектора англ./нем. vs кириллица-в-перемешку.
    return true;
  }

  const { latin, cyrillic, totalLetters } = letterRatios(text);
  // Слишком короткий текст — пропускаем, иначе детектор нестабилен.
  if (totalLetters < 20) return true;

  // Для русскоязычного предмета:
  //  - много латиницы + мало кириллицы → отказ
  //  - очень мало кириллицы при наличии латиницы → отказ
  if (latin >= LATIN_RATIO_REJECT && cyrillic < CYRILLIC_RATIO_MIN) return false;

  return true;
}

/**
 * Проверить весь ExamVariant целиком (text + options + explanation).
 *
 * @returns null если всё ок, иначе строка-причина (для логов/ретраев)
 */
export function findLanguageViolation(
  variant: ExamVariant,
  subject: SubjectSlug,
): string | null {
  for (const p of variant.problems) {
    const concat = [
      p.text ?? "",
      ...(Array.isArray(p.options) ? p.options : []),
      p.explanation ?? "",
      p.answer ?? "",
    ].join(" ");
    if (!passesLanguageGuard(concat, subject)) {
      return `language_guard: problem #${p.number} для subject=${subject} содержит >${LATIN_RATIO_REJECT}% латиницы и <${CYRILLIC_RATIO_MIN}% кириллицы`;
    }
  }
  return null;
}
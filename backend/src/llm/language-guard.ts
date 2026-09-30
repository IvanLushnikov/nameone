/**
 * TZ-13: дешёвая локальная проверка языка сгенерированного контента (без LLM).
 *
 * Симптом: для не-языковых предметов (физика, математика, химия, …) LLM
 * периодически возвращает английские грамматические упражнения вида
 * «Open the brackets: She (read) a book now.» Это критично — учитель видит
 * задание не по своему предмету и на чужом языке.
 *
 * Промпт теперь содержит явный language-constraint (см. prompts/exam-gen.ts),
 * но LLM-инструкции недостаточно: нужен детерминированный guard на фронте.
 *
 * Логика: если предмет НЕ языковой и в тексте заданий почти нет кириллицы,
 * но есть ASCII-буквы (латиница) — контент считается сломанным.
 */

/** Предметы, для которых задания пишутся НЕ по-русски. */
const FOREIGN_LANG_SUBJECTS = new Set(["english", "german", "french", "spanish"]);

/** Кириллица: U+0400–U+04FF. */
const CYRILLIC = /[\u0400-\u04FF]/g;
/** Латиница: A–Z, a–z. */
const LATIN_WORDS = /[A-Za-z]{2,}/g;

export interface LanguageCheckResult {
  ok: boolean;
  reason?: string;
  cyrillicRatio: number;
  latinWordCount: number;
}

export function checkContentLanguage(
  texts: string[],
  subject: string,
): LanguageCheckResult {
  const joined = texts.filter(Boolean).join(" ");
  const cyrillicCount = (joined.match(CYRILLIC) ?? []).length;
  const latinWords = joined.match(LATIN_WORDS) ?? [];

  // Считаем по буквам, а не по общей длине — иначе пробелы и цифры искажают ratio.
  const letters = joined.replace(/[^A-Za-z\u0400-\u04FF]/g, "");
  const cyrillicRatio = letters.length === 0 ? 1 : cyrillicCount / letters.length;

  if (FOREIGN_LANG_SUBJECTS.has(subject)) {
    return { ok: true, cyrillicRatio, latinWordCount: latinWords.length };
  }

  // Мало кириллицы + есть латинские слова = контент не на русском.
  if (cyrillicRatio < 0.15 && latinWords.length >= 4) {
    return {
      ok: false,
      reason:
        `Предмет «${subject}» не языковой, но текст сгенерирован преимущественно на иностранном языке ` +
        `(кириллица ${(cyrillicRatio * 100).toFixed(0)}%, латинских слов ${latinWords.length}).`,
      cyrillicRatio,
      latinWordCount: latinWords.length,
    };
  }

  return { ok: true, cyrillicRatio, latinWordCount: latinWords.length };
}

/** Достать текстовые поля задания/варианта для проверки. */
export function collectExamTexts(problems: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const p of problems) {
    if (typeof p.text === "string") out.push(p.text);
    if (Array.isArray(p.options)) {
      for (const o of p.options) if (typeof o === "string") out.push(o);
    }
    if (typeof p.explanation === "string") out.push(p.explanation);
  }
  return out;
}

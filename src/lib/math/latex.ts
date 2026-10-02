/**
 * Разбор текста задания на сегменты: обычный текст и формулы.
 *
 * ЗАЧЕМ. Учительница: «Может будет лучше сделать как дети и учителя пишут в
 * привычном формате… Мне тут будто надо сначала расшифровать что за вечные /+/».
 * То есть дроби должны быть вертикальными, как в тетради, а не «8/12».
 *
 * КЛЮЧЕВОЕ ПРАВИЛО (не нарушать).
 * У задания два поля:
 *   `text`       — обычный текст. ЭТО ИСТОЧНИК ПРАВДЫ: по нему работает
 *                  self-verification (`src/lib/llm/self-verify.ts`) и по нему же
 *                  сверяются ответы. Модуль его НЕ МЕНЯЕТ и не подменяет.
 *   `text_latex` — новое ОПЦИОНАЛЬНОЕ поле, формулы обёрнуты в `$...$`.
 *                  Используется ТОЛЬКО для отрисовки.
 * Если потерять `text` или гонять проверку по LaTeX — сломается сверка ответов.
 *
 * РЕЖИМЫ.
 *   1) Есть `text_latex` → режем строку по `$...$`, содержимое `$` — LaTeX.
 *   2) `text_latex` НЕ задан → LEGACY-режим: ловим дроби `a/b` регуляркой и
 *      превращаем в `\frac{a}{b}`. Нужно, потому что весь существующий контент
 *      (`src/lib/content/subjects.ts`, `Hero.tsx`, `Comparison.tsx`, мок-генератор)
 *      написан в старом формате и тоже должен отображаться вертикально.
 */

/**
 * Сегмент разобранного текста.
 * `fallback` — читаемая версия формулы обычным текстом. Показывается, пока
 * KaTeX грузится, и вместо падения, если KaTeX не смог разобрать формулу.
 */
export type MathSegment =
  | { type: "text"; value: string }
  | { type: "math"; latex: string; fallback: string };

/**
 * Санитайзер: `$...$` блоки длиннее этого — мусор от модели (залипание на длинной
 * математике), рендерить их нельзя. Длинный блок выкидывается целиком и
 * заменяется читаемым текстом. Значение — из плана, продублировано в бэкенд-промптах.
 */
export const MAX_LATEX_BLOCK_LENGTH = 200;

/* -------------------------------------------------------------------------- */
/*  Служебное: сборка сегментов                                                 */
/* -------------------------------------------------------------------------- */

function pushText(segments: MathSegment[], value: string): void {
  if (!value) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") last.value += value;
  else segments.push({ type: "text", value });
}

function pushMath(segments: MathSegment[], latex: string): void {
  if (!latex) return;
  segments.push({ type: "math", latex, fallback: latexToPlain(latex) });
}

/* -------------------------------------------------------------------------- */
/*  1. Явный LaTeX: `$...$`                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Режет строку по `$...$`. Парная проверка не нужна: непарный `$` просто не
 * найдёт закрывающего и останется обычным текстом.
 */
export function splitLatexBlocks(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(input)) !== null) {
    const latex = m[1].trim();
    // Пустой `$$` и залипший длинный блок — не формула, а обычный текст.
    const isFormula = latex.length > 0 && latex.length <= MAX_LATEX_BLOCK_LENGTH;
    if (!isFormula) continue;

    pushText(segments, input.slice(last, m.index));
    pushMath(segments, latex);
    last = m.index + m[0].length;
  }

  pushText(segments, input.slice(last));
  return segments;
}

/**
 * Убрать из `text_latex` блоки длиннее `MAX_LATEX_BLOCK_LENGTH`.
 * Отдельная функция (а не побочный эффект разбора), чтобы её можно было
 * прогнать на ответе модели ДО сохранения в задание.
 */
export function sanitizeLatexBlocks(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/\$([^$]+)\$/g, (whole, body: string) =>
    body.trim().length > MAX_LATEX_BLOCK_LENGTH ? "" : whole
  );
  return cleaned.trim() ? cleaned : undefined;
}

/* -------------------------------------------------------------------------- */
/*  2. LEGACY: дроби и степени в обычном тексте                                */
/* -------------------------------------------------------------------------- */

/** Одна буква (латиница/кириллица) или число — то, из чего бывает дробь. */
const ATOM = String.raw`-?\d+(?:[.,]\d+)?|[A-Za-zА-Яа-яЁё]`;

/** Верхние индексы в юникоде — оставляем как есть (они читаемы), но структуру ловим. */
const SUPERSCRIPT = String.raw`[\u207B\u207A]?[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]+`;

/**
 * Порядок альтернатив ВАЖЕН — regex берёт самую левую позицию, а при равной
 * позиции первую подходящую альтернативу:
 *   1) `(1/3)⁻²`  — скобка с юникод-степенью (скобка = однозначный признак дроби),
 *      раньше дроби, иначе степень осталась бы обычным текстом;
 *   2) `8^(1/3)`, `(1/3)^(-2)` — степень в скобках;
 *   3) `8/12`, `3/4 = x/12`, `2/5 + 1/5` — дробь.
 */
const LEGACY_TOKEN_RE = new RegExp(
  [
    String.raw`(\([^()]*\))(${SUPERSCRIPT})`,
    String.raw`((?:\([^()]*\)|[A-Za-zА-Яа-яЁё]|\d+|[)\]]))\^\(([^()]*)\)`,
    String.raw`(${ATOM})\/(${ATOM})`,
  ].join("|"),
  "g"
);

/**
 * Заменяет дроби внутри куска (аргумента степени / скобок) на `\frac{}{}`.
 * Без рекурсии: вложенные степени не разбираем, для школьных задач хватает
 * одного уровня, а лишняя сложность тут только вредит.
 */
function fractionsToLatex(input: string): string {
  const re = new RegExp(String.raw`(${ATOM})\/(${ATOM})`, "g");
  return input.replace(re, (whole, num: string, den: string) => {
    // «катет / гипотенуза», «км/ч» — буквы с обеих сторон, это не дробь.
    if (!/^-?\d/.test(num) && !/^\d/.test(den)) return whole;
    return `\\frac{${num}}{${den}}`;
  });
}

/** `8^(1/3)` / `(1/3)^(-2)` → `8^{\frac{1}{3}}` / `(\frac{1}{3})^{(-2)}`. */
function powerToLatex(base: string, exponent: string): string {
  const baseLatex = base.startsWith("(") ? `(${fractionsToLatex(base.slice(1, -1))})` : base;
  return `${baseLatex}^{${fractionsToLatex(exponent)}}`;
}

/**
 * LEGACY-режим: превращает дроби и степени обычного текста в LaTeX-сегменты.
 *
 * Что НЕ трогаем (специально):
 *   * «противолежащий катет / гипотенуза» — буквы с обеих сторон + пробелы;
 *   * «июль/август», «км/ч» — буквы с обеих сторон;
 *   * `5⁻²`, `sin 30°`, `3,4 · 10⁻³` — юникод-символы уже читаемы;
 *   * `sin² α + cos² α` — степень внутри слова: если завернём `n²` в формулу,
 *     слово разорвётся на обычный текст + курсивный `n` и станет выглядеть хуже.
 */
export function parseLegacyMath(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  LEGACY_TOKEN_RE.lastIndex = 0;
  while ((m = LEGACY_TOKEN_RE.exec(input)) !== null) {
    const [whole, paren, sup, base, exponent, num, den] = m;
    let latex: string | null = null;

    if (paren !== undefined) {
      // `(1/3)⁻²` → `(\frac{1}{3})⁻²` (юникод-символы не переписываем).
      latex = `(${fractionsToLatex(paren.slice(1, -1))})${sup}`;
    } else if (base !== undefined) {
      latex = powerToLatex(base, exponent);
    } else if (num !== undefined && den !== undefined) {
      // Обе стороны — буквы: это не дробь, оставляем как есть.
      if (/^-?\d/.test(num) || /^\d/.test(den)) latex = `\\frac{${num}}{${den}}`;
    }

    if (latex === null) continue;

    pushText(segments, input.slice(last, m.index));
    pushMath(segments, latex);
    last = m.index + whole.length;
  }

  pushText(segments, input.slice(last));
  return segments;
}

/* -------------------------------------------------------------------------- */
/*  Точка входа                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Основная функция модуля.
 *
 * @param text       обычный текст задания (источник правды, не меняется);
 * @param textLatex  опциональный LaTeX-вариант для отрисовки.
 */
export function parseMathText(text: string, textLatex?: string | null): MathSegment[] {
  if (textLatex && textLatex.trim()) return splitLatexBlocks(textLatex);
  return parseLegacyMath(text);
}

/** Есть ли в разобранном тексте хоть одна формула (нужно для ленивой загрузки KaTeX). */
export function hasMathSegment(segments: readonly MathSegment[]): boolean {
  return segments.some((s) => s.type === "math");
}

/* -------------------------------------------------------------------------- */
/*  Читаемый фолбэк                                                             */
/* -------------------------------------------------------------------------- */

/**
 * LaTeX → читаемый обычный текст. Используется:
 *   * пока KaTeX грузится (чтобы лист не мигал и не был пустым);
 *   * если KaTeX упал на битой формуле (лист обязан остаться читаемым).
 *
 * Порядок замен важен: сначала `\frac{}{}` → `a/b`, потом степени → `^(...)`.
 */
export function latexToPlain(latex: string): string {
  return latex
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\^\s*\{([^{}]*)\}/g, "^($1)")
    .replace(/_\s*\{([^{}]*)\}/g, "_($1)")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\left|\\right/g, "")
    .replace(/\\/g, "");
}

/**
 * Разбор текста задания на сегменты (text / math) — `src/lib/math/latex.ts`.
 *
 * ЗАЧЕМ ТЕСТ. Модуль решает две разные задачи, и обе легко ломаются:
 *   1) дроби и степени в обычном тексте («8/12», «8^(1/3)») превращаются в
 *      LaTeX-сегменты, чтобы учительница видела вертикальную дробь;
 *   2) обычный текст НЕ должен превращаться в формулы — «катет / гипотенуза»
 *      и «км/ч» это перечисление, а не дробь. Регексп ловит `/` слишком легко,
 *      и без проверки второй пункт тихо ломает весь текст заданий.
 *
 * Инвариант, который тут и защищаем: `text` — источник правды, разбор его не
 * меняет и не теряет. Проверяем это через склейку всех сегментов обратно.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_LATEX_BLOCK_LENGTH,
  hasMathSegment,
  latexToPlain,
  parseLegacyMath,
  parseMathText,
  sanitizeLatexBlocks,
  splitLatexBlocks,
  type MathSegment,
} from "@/lib/math/latex";

/** Склеивает сегменты обратно в строку — так проверяем, что текст не потерян. */
function join(segments: readonly MathSegment[]): string {
  return segments.map((s) => (s.type === "text" ? s.value : s.fallback)).join("");
}

function mathOf(segments: readonly MathSegment[]): string[] {
  return segments.flatMap((s) => (s.type === "math" ? [s.latex] : []));
}

describe("parseMathText — LEGACY-режим: дроби становятся формулами", () => {
  it("«Сократите дробь: 8/12 = __» → есть сегмент-дробь", () => {
    const segments = parseMathText("Сократите дробь: 8/12 = __");

    expect(mathOf(segments)).toEqual(["\\frac{8}{12}"]);
    expect(hasMathSegment(segments)).toBe(true);
    // Исходный текст не потерян: склейка сегментов даёт то же самое.
    expect(join(segments)).toBe("Сократите дробь: 8/12 = __");
  });

  it("у сегмента-дроби есть читаемый fallback для случая, когда KaTeX не загрузился", () => {
    const segments = parseMathText("Сократите дробь: 8/12 = __");
    const math = segments.find((s) => s.type === "math");

    expect(math).toBeDefined();
    expect(math && math.type === "math" ? math.fallback : null).toBe("8/12");
  });

  it("две дроби в одном задании распознаются обе", () => {
    const segments = parseMathText("3/4 = x/12");
    expect(mathOf(segments)).toEqual(["\\frac{3}{4}", "\\frac{x}{12}"]);
    expect(join(segments)).toBe("3/4 = x/12");
  });

  it("дробь в сумме не съедает разделитель", () => {
    const segments = parseMathText("2/5 + 1/5");
    expect(mathOf(segments)).toEqual(["\\frac{2}{5}", "\\frac{1}{5}"]);
    expect(join(segments)).toBe("2/5 + 1/5");
  });
});

describe("parseMathText — LEGACY-режим: степени", () => {
  it("8^(1/3) → 8^{\\frac{1}{3}}", () => {
    const segments = parseMathText("Найдите 8^(1/3)");
    expect(mathOf(segments)).toEqual(["8^{\\frac{1}{3}}"]);
    expect(join(segments)).toBe("Найдите 8^(1/3)");
  });

  it("(1/3)⁻² → (\\frac{1}{3})⁻², степень в скобках распознаётся раньше дроби", () => {
    const segments = parseMathText("Значение (1/3)⁻²");
    expect(mathOf(segments)).toEqual(["(\\frac{1}{3})⁻²"]);
    expect(join(segments)).toBe("Значение (1/3)⁻²");
  });
});

describe("parseMathText — что НЕ должно ломаться", () => {
  it("«катет / гипотенуза» остаётся текстом", () => {
    const segments = parseMathText("катет / гипотенуза");
    expect(hasMathSegment(segments)).toBe(false);
    expect(segments).toEqual([{ type: "text", value: "катет / гипотенуза" }]);
  });

  it("«км/ч» остаётся текстом, несмотря на слеш", () => {
    const segments = parseMathText("скорость 60 км/ч");
    expect(hasMathSegment(segments)).toBe(false);
    expect(join(segments)).toBe("скорость 60 км/ч");
  });

  it("«июль/август» (буквы с обеих сторон) остаётся текстом", () => {
    const segments = parseMathText("каникулы: июль/август");
    expect(hasMathSegment(segments)).toBe(false);
    expect(join(segments)).toBe("каникулы: июль/август");
  });

  it("«sin² α + cos² α» — степень внутри слова не выносится в формулу", () => {
    const segments = parseMathText("sin² α + cos² α");
    expect(hasMathSegment(segments)).toBe(false);
    expect(join(segments)).toBe("sin² α + cos² α");
  });

  it("обычный текст без дробей не трогается вообще", () => {
    const segments = parseMathText("Сколько будет 2 + 2?");
    expect(segments).toEqual([{ type: "text", value: "Сколько будет 2 + 2?" }]);
  });
});

describe("parseMathText — режим text_latex ($...$) важнее legacy", () => {
  it("при заполненном text_latex дроби берутся только из $...$", () => {
    const segments = parseMathText("Сократите 8/12", "Сократите $\\frac{8}{12}$");
    expect(mathOf(segments)).toEqual(["\\frac{8}{12}"]);
    expect(segments[0]).toEqual({ type: "text", value: "Сократите " });
  });

  it("текст без $...$ в text_latex не превращается в формулу", () => {
    const segments = parseMathText("Сократите 8/12", "Сократите 8/12");
    expect(hasMathSegment(segments)).toBe(false);
    expect(join(segments)).toBe("Сократите 8/12");
  });

  it("непарный $ оставляет строку обычным текстом, а не роняет разбор", () => {
    const segments = parseMathText("цена 5$", "цена 5$");
    expect(hasMathSegment(segments)).toBe(false);
    expect(join(segments)).toBe("цена 5$");
  });

  it("пустой text_latex откатывается в legacy-режим", () => {
    const segments = parseMathText("8/12", "   ");
    expect(mathOf(segments)).toEqual(["\\frac{8}{12}"]);
  });
});

describe("splitLatexBlocks — санитайзер залипших блоков", () => {
  // Блок склеивается конкатенацией, а не шаблонной строкой: в `` `$${...}$$` ``
  // хвостовые `$$` — это два литеральных доллара, и блок получается «битым».
  const tooLongBody = "x".repeat(MAX_LATEX_BLOCK_LENGTH + 1);
  const tooLongBlock = "$" + tooLongBody + "$";

  it("блок длиннее MAX_LATEX_BLOCK_LENGTH не рендерится, а остаётся текстом", () => {
    const segments = splitLatexBlocks(tooLongBlock);

    expect(hasMathSegment(segments)).toBe(false);
    expect(join(segments)).toBe(tooLongBlock);
  });

  it("блок ровно в лимит рендерится", () => {
    const atLimit = "$" + "x".repeat(MAX_LATEX_BLOCK_LENGTH) + "$";
    const segments = splitLatexBlocks(atLimit);

    expect(mathOf(segments)).toEqual(["x".repeat(MAX_LATEX_BLOCK_LENGTH)]);
  });

  it("sanitizeLatexBlocks выкидывает длинный блок, короткий оставляет", () => {
    expect(sanitizeLatexBlocks(tooLongBlock)).toBeUndefined();
    expect(sanitizeLatexBlocks("чисто $\\frac{8}{12}$")).toBe("чисто $\\frac{8}{12}$");
    expect(sanitizeLatexBlocks("")).toBeUndefined();
  });
});

describe("latexToPlain — читаемый фолбэк", () => {
  it("дробь, корень и степень читаются обычным текстом", () => {
    expect(latexToPlain("\\frac{8}{12}")).toBe("8/12");
    expect(latexToPlain("\\sqrt{12}")).toBe("√(12)");
    expect(latexToPlain("8^{\\frac{1}{3}}")).toBe("8^(1/3)");
  });

  it("операторы заменяются на юникод, служебные команды убираются", () => {
    expect(latexToPlain("\\left(\\frac{1}{2}\\right)")).toBe("(1/2)");
    expect(latexToPlain("3 \\times 4")).toBe("3 × 4");
    expect(latexToPlain("3 \\cdot 4")).toBe("3 · 4");
  });
});

describe("parseLegacyMath — экспорт напрямую ведёт себя так же", () => {
  it("тот же результат, что и parseMathText без text_latex", () => {
    expect(parseLegacyMath("8/12")).toEqual(parseMathText("8/12"));
  });
});

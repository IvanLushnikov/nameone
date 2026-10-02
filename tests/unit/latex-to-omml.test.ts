/**
 * LaTeX → OMML для выгрузки в DOCX — `src/lib/math/latex-to-omml.ts`.
 *
 * ЗАЧЕМ ТЕСТ. В браузере формулу рисует KaTeX, но в DOCX KaTeX не едет —
 * нужен OMML. Главное правило модуля: при ЛЮБОЙ неудаче возвращается юникод,
 * а не бросается исключение. Исключение здесь = упавшая выгрузка документа
 * целиком, файл учителю не отдаётся вообще. Поэтому «неизвестная команда»
 * и «битые скобки» — это ожидаемый путь `null`, а не ошибка.
 *
 * Проверяем не только «что вернулось», но и ЧТО ИМЕННО: классы docx
 * (MathFraction / MathSuperScript / MathSubScript / MathSubSuperScript /
 * MathRadical), а не просто «массив непустой».
 */

import { describe, it, expect } from "vitest";
import {
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
} from "docx";
import { latexToOmml, latexToUnicode } from "@/lib/math/latex-to-omml";

/** Имена классов компонентов — компактно и читаемо в ассертах. */
function classNames(latex: string): string[] | null {
  const components = latexToOmml(latex);
  return components === null ? null : components.map((c) => c.constructor.name);
}

describe("latexToOmml — поддерживаемое подмножество", () => {
  it("\\frac превращается в MathFraction", () => {
    expect(classNames("\\frac{8}{12}")).toEqual(["MathFraction"]);
  });

  it("^ превращается в MathSuperScript", () => {
    expect(classNames("x^2")).toEqual(["MathSuperScript"]);
  });

  it("_ превращается в MathSubScript", () => {
    expect(classNames("x_1")).toEqual(["MathSubScript"]);
  });

  it("x_1^2 собирается в один MathSubSuperScript, а не в две вложенные конструкции", () => {
    expect(classNames("x_1^2")).toEqual(["MathSubSuperScript"]);
  });

  it("\\sqrt превращается в MathRadical", () => {
    expect(classNames("\\sqrt{12}")).toEqual(["MathRadical"]);
  });

  it("операторы переводятся в текстовые команды", () => {
    expect(classNames("3 \\times 4")).toEqual(["MathRun"]);
  });

  it("смешанное выражение даёт последовательность компонентов", () => {
    expect(classNames("\\frac{8}{12} + \\frac{1}{3}")).toEqual([
      "MathFraction",
      "MathRun",
      "MathFraction",
    ]);
  });

  it("компоненты — настоящие классы docx, а не заглушки", () => {
    // `\frac{8}{12} + x^2` → дробь и «3 + x» с верхним индексом: текст « + x»
    // приклеивается к основанию степени, визуально это «8/12 + x²».
    const components = latexToOmml("\\frac{8}{12} + x^2");
    expect(components).not.toBeNull();

    const [fraction, superscript] = components ?? [];
    expect(fraction).toBeInstanceOf(MathFraction);
    expect(superscript).toBeInstanceOf(MathSuperScript);
  });
});

describe("latexToOmml — неподдерживаемое уходит в фолбэк, а не падает", () => {
  it("неизвестная команда даёт null и НЕ бросает исключение", () => {
    expect(() => latexToOmml("\\unknowncmd{x}")).not.toThrow();
    expect(latexToOmml("\\unknowncmd{x}")).toBeNull();
  });

  it("незакрытая скобка в дроби даёт null", () => {
    expect(() => latexToOmml("\\frac{1}{")).not.toThrow();
    expect(latexToOmml("\\frac{1}{")).toBeNull();
  });

  it("незакрытая группа даёт null", () => {
    expect(latexToOmml("\\sqrt{12")).toBeNull();
  });

  it("лишняя закрывающая скобка даёт null", () => {
    expect(latexToOmml("x}")).toBeNull();
  });

  it("степень без основания даёт null", () => {
    expect(latexToOmml("^2")).toBeNull();
  });

  it("пустая строка даёт null", () => {
    expect(latexToOmml("")).toBeNull();
    expect(latexToOmml("   ")).toBeNull();
  });
});

describe("latexToUnicode — читаемый фолбэк для документа", () => {
  it("обыкновенные дроби становятся одним символом", () => {
    expect(latexToUnicode("\\frac{1}{2}")).toBe("½");
    expect(latexToUnicode("\\frac{1}{3}")).toBe("⅓");
    expect(latexToUnicode("\\frac{8}{12}")).toBe("8/12");
  });

  it("корень и степени читаются, служебные команды убираются", () => {
    expect(latexToUnicode("\\sqrt{12}")).toBe("√(12)");
    expect(latexToUnicode("3 \\times 4")).toBe("3 × 4");
    expect(latexToUnicode("\\left(\\frac{1}{2}\\right)")).toBe("(½)");
  });

  it("на неподдерживаемой команде фолбэк всё равно читаем, а не пустой", () => {
    const fallback = latexToUnicode("\\unknowncmd{x}");
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback).not.toContain("\\");
  });
});

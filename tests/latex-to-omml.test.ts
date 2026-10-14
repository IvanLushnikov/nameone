/**
 * Лист 2.1.6: степень внутри дроби — НАСТОЯЩИМ надстрочным индексом.
 *
 * ЧТО БЫЛО. `parseArgument` в `src/lib/math/latex-to-omml.ts` для `{...}`
 * возвращал `slots.map((slot) => slot.node)` — то есть вместе со скриптами.
 * Из-за этого `\frac{x^{2}}{y}` собирался в дробь с «x» вместо «x²», и в
 * `word/document.xml` уезжала НЕВЕРНАЯ формула. Пока это чинили, `docx.ts`
 * держал обходной путь `keepScriptsInsideFrac`: он переписывал `^{}`/`_{}` внутри
 * `\frac` юникодом ДО конвертера. Степень не терялась, но приходила символом
 * «²», который в Word не поднимается над базовой линией.
 *
 * ПОЧЕМУ ПРОВЕРКА ИМЕННО ТАКАЯ. Тест обязан ловить ОБЕ поломки, поэтому мы
 * смотрим не на текст «x²» (он был зелёным и до починки), а на УЗЕЛ OMML:
 *   • есть `m:sSup` вместе с `m:e` и `m:sup` — настоящий надстрочный индекс;
 *   • нет символа «²» — степень не подменена юникодом.
 * Текст «x²» и ПУСТОЙ `m:sSup` были бы зелёными и с обходным путём, и с
 * пропажей степени. Пустой `<m:sup/>` — тоже зелёный наивный тест: он
 * получается, если скрипт типизировать как `OmmlNode[]`, а не как `Slot[]`.
 *
 * ТИПЫ ПРОВЕРЯЕМ ПО `rootKey`, а не по имени класса: `rootKey` — это тот самый
 * тег, который в итоге попадает в `word/document.xml`. Тест защищает и от
 * подмены объекта, и от подмены разметки.
 */

import { describe, it, expect } from "vitest";
import { latexToOmml, latexToUnicode } from "@/lib/math/latex-to-omml";
import { ommlXml, splitFormulaText } from "@/lib/utils/docx";

/** Узел разобранного OMML-дерева: `rootKey` = тег, `root` = дети. */
type OmmlNodeView = { rootKey?: string; root?: unknown };

/** Дети узла. У `m:degHide` в `root` лежит объект атрибутов, а не массив. */
function kidsOf(component: unknown): unknown[] {
  const root = (component ?? {}) as OmmlNodeView;
  return Array.isArray(root.root) ? root.root : [];
}

/** Теги узла и всех потомков: по ним видно структуру формулы. */
function treeTags(component: unknown): string[] {
  const node = component as OmmlNodeView;
  return [...(node?.rootKey ? [node.rootKey] : []), ...kidsOf(component).flatMap(treeTags)];
}

/** Весь текст дерева по порядку: «x2y» вместо «x²y» = степень не как индекс. */
function treeText(component: unknown): string {
  const node = component as OmmlNodeView;
  if (node?.rootKey === "m:t") {
    const text = (node.root as unknown[]) ?? [];
    return text.map(String).join("");
  }
  return kidsOf(component).map(treeText).join("");
}

/** Первый компонент разбора — либо падение, если конвертер ушёл в фолбэк. */
function first(latex: string): unknown {
  const components = latexToOmml(latex);
  expect(components, `«${latex}» должен разбираться в OMML`).not.toBeNull();
  return components?.[0];
}

/** Числитель и знаменатель дроби (`m:num` / `m:den` вместе с содержимым). */
function partsOf(latex: string): { numerator: unknown; denominator: unknown } {
  const [numerator, denominator] = kidsOf(first(latex));
  return { numerator, denominator };
}

/** Один узел индекса целиком: обёртка + основание + сам скрипт. */
const SUP_TAGS = ["m:sSup", "m:sSupPr", "m:e", "m:r", "m:t", "m:sup", "m:r", "m:t"];
const SUB_TAGS = ["m:sSub", "m:sSubPr", "m:e", "m:r", "m:t", "m:sub", "m:r", "m:t"];

/* -------------------------------------------------------------------------- */
/*  Главное: `\frac{x^{2}}{y}`                                                  */
/* -------------------------------------------------------------------------- */

describe("степень внутри дроби — настоящий надстрочный индекс", () => {
  it("\\frac{x^{2}}{y}: в числителе узел m:sSup, а не пропавший и не юникодный «²»", () => {
    const frac = first("\\frac{x^{2}}{y}");
    const { numerator, denominator } = partsOf("\\frac{x^{2}}{y}");

    // Три тега индекса: сам узел, основание и степень — плюс обёртка `m:num`.
    expect(treeTags(numerator)).toEqual(["m:num", ...SUP_TAGS]);
    // Основание — «x», степень — «2», знаменатель не тронут.
    expect(treeText(numerator)).toBe("x2");
    expect(treeTags(denominator)).toEqual(["m:den", "m:r", "m:t"]);
    // Юникодной подмены нет: символа «²» в формуле быть не должно.
    expect(treeText(frac)).toBe("x2y");
  });

  it("то же самое в том виде, в котором это уходит в word/document.xml", () => {
    const xml = ommlXml("\\frac{x^{2}}{y}");

    expect(xml).not.toBeNull();
    // Степень стоит ВНУТРИ числителя, а не после дроби и не юникодом.
    expect(xml).toContain("<m:num><m:sSup>");
    expect(xml).toContain("<m:sup><m:r><m:t>2</m:t></m:r></m:sup>");
    expect(xml).toContain("<m:den><m:r><m:t>y</m:t></m:r></m:den>");
    expect(xml).not.toContain("²");
  });

  it("степень в знаменателе — тоже индекс, а не «y2» текстом", () => {
    const { numerator, denominator } = partsOf("\\frac{x}{y^{2}}");

    expect(treeTags(numerator)).toEqual(["m:num", "m:r", "m:t"]);
    expect(treeTags(denominator)).toEqual(["m:den", ...SUP_TAGS]);
    expect(treeText(first("\\frac{x}{y^{2}}"))).toBe("xy2");
  });

  it("нижний индекс x_{i} — узел m:sSub, не потерян и не в скобках", () => {
    const { numerator } = partsOf("\\frac{x_{i}}{y}");

    expect(treeTags(numerator)).toEqual(["m:num", ...SUB_TAGS]);
    expect(treeText(first("\\frac{x_{i}}{y}"))).toBe("xiy");
    expect(ommlXml("\\frac{x_{i}}{y}")).toContain("<m:sub><m:r><m:t>i</m:t></m:r></m:sub>");
  });

  it("двойной индекс x_1^2 остаётся ОДНИМ узлом m:sSubSup", () => {
    const tags = treeTags(first("\\frac{x_1^2}{y}"));

    // Одна конструкция, а не вложенная пара sSub + sSup: так её рисует Word.
    expect(tags.filter((tag) => tag === "m:sSubSup")).toHaveLength(1);
    expect(tags).not.toContain("m:sSup");
    expect(tags).not.toContain("m:sSub");
    expect(treeText(first("\\frac{x_1^2}{y}"))).toBe("x12y");
  });

  it("вложенная степень \\frac{a^{b^{c}}}{d} не схлопывается", () => {
    const { numerator } = partsOf("\\frac{a^{b^{c}}}{d}");
    // Внутри `m:num` лежит `m:sSup`; в нём [свойства, `m:e`, `m:sup`].
    const [, base, sup] = kidsOf(kidsOf(numerator)[0]);

    // `m:e` — основание «a», `m:sup` — внутри него ещё один `m:sSup` («b» над «c»).
    expect(treeTags(base)).toEqual(["m:e", "m:r", "m:t"]);
    expect(treeTags(sup)).toEqual(["m:sup", ...SUP_TAGS]);
    expect(treeText(first("\\frac{a^{b^{c}}}{d}"))).toBe("abcd");
  });

  it("вложенная дробь \\frac{\\frac{a}{b}}{c} по-прежнему разбирается", () => {
    expect(treeTags(first("\\frac{\\frac{a}{b}}{c}")).filter((tag) => tag === "m:f")).toHaveLength(2);
    expect(treeText(first("\\frac{\\frac{a}{b}}{c}"))).toBe("abc");
  });

  it("корень со степенью \\sqrt{x^{2}} — индекс внутри радикала", () => {
    expect(treeTags(first("\\sqrt{x^{2}}"))[0]).toBe("m:rad");
    expect(treeTags(first("\\sqrt{x^{2}}"))).toContain("m:sSup");
    expect(treeText(first("\\sqrt{x^{2}}"))).toBe("x2");
  });
});

/* -------------------------------------------------------------------------- */
/*  Краевые случаи                                                             */
/* -------------------------------------------------------------------------- */

describe("краевые случаи скриптов", () => {
  it("пустой скрипт x^{} не рождает пустой <m:sup/>", () => {
    const frac = first("\\frac{x^{}}{y}");

    // `m:sup` без содержимого Word рисует непредсказуемо — считаем скрипт
    // отсутствующим и оставляем простое «x».
    expect(treeTags(frac)).not.toContain("m:sSup");
    expect(treeTags(frac)).not.toContain("m:sSub");
    expect(treeText(frac)).toBe("xy");
  });

  it("скрипт без основания уходит в фолбэк, а не рисует мусор", () => {
    expect(latexToOmml("^{2}")).toBeNull();
    expect(latexToOmml("\\frac{^{2}}{y}")).toBeNull();
    expect(latexToOmml("\\frac{a}{_{b}}")).toBeNull();
  });

  it("битые скобки по-прежнему дают null, а не исключение", () => {
    expect(() => latexToOmml("\\frac{x^{2}{y")).not.toThrow();
    expect(latexToOmml("\\frac{x^{2}{y")).toBeNull();
    expect(latexToOmml("\\sqrt{x^{2}")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Регресс: то, что работало, работает                                        */
/* -------------------------------------------------------------------------- */

describe("разбор не сломан (регресс-гейт)", () => {
  it("простая дробь, корень и операторы — как раньше", () => {
    expect(treeTags(first("\\frac{8}{12}"))).toEqual([
      "m:f",
      "m:num",
      "m:r",
      "m:t",
      "m:den",
      "m:r",
      "m:t",
    ]);
    expect(treeText(first("\\frac{8}{12}"))).toBe("812");
    expect(treeTags(first("\\sqrt{12}"))[0]).toBe("m:rad");
    expect(treeText(first("\\sqrt{12}"))).toBe("12");

    expect(treeText(first("3 \\times 4"))).toBe("3 × 4");
    expect(treeText(first("2a \\cdot b"))).toBe("2a · b");
    expect(treeText(first("6 \\div 3 \\pm 1"))).toBe("6 ÷ 3 ± 1");
  });

  it("простые буквы и пробелы доезжают в OMML как есть", () => {
    expect(treeText(first("a"))).toBe("a");
    expect(treeText(first("x = 2y"))).toBe("x = 2y");
    // Серия пробелов схлопывается в один — формула не рассыпается.
    expect(treeText(first("a   b"))).toBe("a b");
  });

  it("«км/ч» и другие слова с чертой не превращаются в формулу", () => {
    // Разбор текста живёт в docx.ts и не должен трогать русские слова.
    for (const text of ["Скорость 60 км/ч", "Каникулы в июле/августе"]) {
      expect(splitFormulaText(text).filter((segment) => segment.type === "math")).toHaveLength(0);
    }
  });

  it("юникод-фолбэк не тронут: дробь, корень и степень читаются", () => {
    // Фолбэк — отдельная функция, правка индекса её не трогала. Степень внутри
    // дроби в фолбэке остаётся читаемой (потеря черты при скобках в степени —
    // известное ограничение `latexToUnicode`, это не наш лист).
    expect(latexToUnicode("\\frac{1}{2}")).toBe("½");
    expect(latexToUnicode("\\sqrt{12}")).toBe("√(12)");
    expect(latexToUnicode("x^{2}")).toBe("x²");
    expect(latexToUnicode("\\frac{x^{2}}{y}")).toContain("²");
  });
});
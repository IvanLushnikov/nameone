/**
 * Рендер формул в задании — `src/components/math/MathText.tsx`.
 *
 * Требования, которые тут проверяются (жалоба учительницы: «надо сначала
 * расшифровать, что за вечные /+/»):
 *   1) `\frac{8}{12}` рисуется ВЕРТИКАЛЬНОЙ дробью (KaTeX, а не «8/12»);
 *   2) обычный текст без `$...$` не трогается;
 *   3) битый LaTeX НЕ роняет страницу: компонент целиком откатывается на
 *      исходный `text`.
 *
 * Проверяем по DOM, а не по скриншоту: вертикальная дробь = элементы
 * `.katex` (контейнер KaTeX) и `.mfrac` (fraction — с вертикальной чертой).
 *
 * ДВА ВАЖНЫХ МОМЕНТА.
 *
 * 1) Экранирование. `textLatex` задаётся ВЫРАЖЕНИЕМ в фигурных скобках
 *    (`textLatex={"$\\frac{8}{12}$"}`), а не строковым атрибутом JSX. В
 *    строковом атрибуте `\\` не превращается в `\`, и KaTeX получает
 *    `\\frac` — то есть перевод строки + буквы «frac» вместо дроби. На
 *    прошлой версии этого теста так и было: `.katex` появлялся, `.mfrac` — нет.
 *
 * 2) Тайминг. KaTeX (~300 КБ) грузится лениво через `import("katex")`,
 *    поэтому `.katex` появляется не сразу. Проверки «должно появиться»
 *    сделаны через `waitFor` — это ожидание ПРИБЫТИЯ элемента, а не гонка с
 *    таймером, поэтому тест не флаки. Для «битого» LaTeX ждём, наоборот,
 *    конечного состояния отката (waitFor с ожиданием текста), а не «просто
 *    подождали N миллисекунд».
 */

import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MathText } from "@/components/math/MathText";

/** Ждём появления KaTeX-разметки, затем отдаём контейнер. */
async function renderAndWaitForKatex(ui: React.ReactElement): Promise<HTMLElement> {
  const { container } = render(ui);
  await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull(), {
    timeout: 5_000,
  });
  return container;
}

const FRACTION_LATEX = "Сократите дробь: $\\frac{8}{12}$ = __";
const FRACTION_TEXT = "Сократите дробь: 8/12 = __";

describe("MathText — формулы рисуются", () => {
  it("\\frac{8}{12} рендерится вертикальной дробью (.katex + .mfrac)", async () => {
    const container = await renderAndWaitForKatex(
      <MathText text={FRACTION_TEXT} textLatex={FRACTION_LATEX} />
    );

    // `.mfrac` — именно ВЕРТИКАЛЬНАЯ дробь KaTeX (горизонтальная была бы `.frac`).
    expect(container.querySelector(".katex")).not.toBeNull();
    const mfrac = container.querySelector(".mfrac");
    expect(mfrac).not.toBeNull();
    // `.frac-line` — вертикальная черта между числителем и знаменателем.
    expect(mfrac?.querySelector(".frac-line")).not.toBeNull();
    // Числитель 8 и знаменатель 12 — именно в этой дроби, а не где-то ещё.
    expect(mfrac?.textContent).toContain("8");
    expect(mfrac?.textContent).toContain("12");
  });

  it("обычный текст вокруг формулы сохраняется", async () => {
    const container = await renderAndWaitForKatex(
      <MathText text={FRACTION_TEXT} textLatex={FRACTION_LATEX} />
    );

    expect(container.textContent).toContain("Сократите дробь:");
    expect(container.textContent).toContain("= __");
  });

  it("LEGACY-режим (без text_latex) тоже рисует дробь вертикально", async () => {
    const container = await renderAndWaitForKatex(<MathText text={FRACTION_TEXT} />);

    expect(container.querySelector(".mfrac")).not.toBeNull();
    expect(container.querySelector(".mfrac")?.textContent).toContain("12");
  });

  it("класс math-inline навешен на отрисованную формулу", async () => {
    const container = await renderAndWaitForKatex(<MathText text="8/12" textLatex={"$\\frac{8}{12}$"} />);

    expect(container.querySelector(".math-inline .katex")).not.toBeNull();
  });
});

describe("MathText — текст без формул не трогается", () => {
  it("текст без дробей остаётся текстом: ни .katex, ни изменения символов", () => {
    const { container } = render(<MathText text="Сколько будет 2 + 2?" />);

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe("Сколько будет 2 + 2?");
  });

  it("текст с одиночным $ не превращается в KaTeX", () => {
    const { container } = render(<MathText text={"Цена 5$"} textLatex={"Цена 5$"} />);

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe("Цена 5$");
  });

  it("переданный className попадает на корневой span", () => {
    const { container } = render(<MathText text="Обычный текст" className="text-sm" />);

    expect(container.firstElementChild?.className).toContain("text-sm");
    expect(container.textContent).toBe("Обычный текст");
  });
});

describe("MathText — битый LaTeX не роняет страницу", () => {
  it("незакрытая скобка в дроби → откат на исходный text", async () => {
    // Блок закрыт долларом (иначе это просто текст), но внутри — битая дробь:
    // `{` без пары. KaTeX на этом бросает ParseError.
    const { container } = render(
      <MathText text={FRACTION_TEXT} textLatex={"Сократите дробь: $\\frac{1}{ 2$ = __"} />
    );

    // Компонент не бросает исключение и в итоге показывает исходный `text`.
    await waitFor(() => expect(container.textContent).toBe(FRACTION_TEXT), { timeout: 5_000 });

    expect(container.querySelector(".katex")).toBeNull();
  });

  it("неизвестная команда → откат на исходный text", async () => {
    const text = "Решите уравнение и запишите ответ";
    const { container } = render(
      <MathText text={text} textLatex={"Решите уравнение $\\unknowncmd{x}$ и запишите ответ"} />
    );

    await waitFor(() => expect(container.textContent).toBe(text), { timeout: 5_000 });

    // Никакого мусора от LaTeX в тексте не осталось.
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).not.toContain("unknowncmd");
  });

  it("битая окружение (\\begin{matrix}) → откат на исходный text", async () => {
    const text = "Задача про дроби";
    const { container } = render(<MathText text={text} textLatex={"Задача $\\begin{matrix}$"} />);

    await waitFor(() => expect(container.textContent).toBe(text), { timeout: 5_000 });

    expect(container.querySelector(".katex")).toBeNull();
  });

  it("одна битая формула откатывает весь текст, а не только свой сегмент", async () => {
    const text = "Первая дробь 1/2 и вторая 3/4";
    const { container } = render(
      <MathText text={text} textLatex={"Первая дробь $\\frac{1}{2}$ и вторая $\\frac{3}{4$"} />
    );

    await waitFor(() => expect(container.textContent).toBe(text), { timeout: 5_000 });

    // Даже валидная первая дробь не рисуется: частично отрисованный лист
    // показывать нельзя (по нему потом сверяют ответы).
    expect(container.querySelector(".katex")).toBeNull();
  });
});

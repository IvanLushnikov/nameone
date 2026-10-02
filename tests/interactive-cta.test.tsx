/**
 * Рендер-тесты блока «Оживить урок» (TZ-13 §4.9, сценарий A).
 *
 * Зачем отдельный файл: компонент клиентский и использует `useRouter`,
 * поэтому нужен jsdom и мок роутера. Основные тесты интерактивов
 * (`src/lib/interactives/__tests__/`) гоняются с `--environment node`.
 *
 * Что здесь защищаем — не «красиво отрисовалось», а то, что вход в фичу
 * вообще работает:
 *   1. Блок показывает все 6 форматов ТЗ §2.1, а не два-три «на потом».
 *   2. Выбор формата уходит в конструктор с параметром `interactiveFormat` —
 *      без него учитель кликает «Колесо фортуны» и попадает в обычную форму
 *      листа, то есть выбор молча теряется.
 *   3. `no-print` — блок не попадает в печать раздаточного материала.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { InteractiveCta } from "@/components/worksheet/InteractiveCta";
import { INTERACTIVE_FORMATS } from "@/lib/interactives/types";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockClear();
});

describe("InteractiveCta — вход в фичу с экрана листа", () => {
  it("показывает все шесть форматов из ТЗ", () => {
    const { container } = render(
      <InteractiveCta worksheetId="t1" worksheetTitle="Дроби, 5 класс" subject="math" grade={5} />,
    );
    // Читаем атрибут напрямую: у кнопок формата нет `data-testid`, только
    // `data-interactive-format-option` — это и есть селектор для Playwright
    // из DoD ТЗ-13.
    const found = Array.from(
      container.querySelectorAll("[data-interactive-format-option]"),
    ).map((el) => el.getAttribute("data-interactive-format-option"));
    expect(new Set(found)).toEqual(new Set(INTERACTIVE_FORMATS));
    expect(found).toHaveLength(6);
  });

  it("выбор формата уходит в конструктор с interactiveFormat — выбор не теряется", () => {
    const { container } = render(
      <InteractiveCta worksheetId="t1" worksheetTitle="Дроби, 5 класс" subject="math" grade={5} />,
    );
    const button = container.querySelector('[data-interactive-format-option="jeopardy"]');
    expect(button).not.toBeNull();
    (button as HTMLElement).click();

    expect(push).toHaveBeenCalledTimes(1);
    const target = push.mock.calls[0][0] as string;
    const url = new URL(target, "http://localhost");
    expect(url.pathname).toBe("/constructor");
    // Ключевое: формат доезжает до конструктора.
    expect(url.searchParams.get("interactiveFormat")).toBe("jeopardy");
    // И контекст листа, чтобы ранклеру было что раскладывать по секторам.
    expect(url.searchParams.get("sheet")).toBe("t1");
    expect(url.searchParams.get("subject")).toBe("math");
    expect(url.searchParams.get("grade")).toBe("5");
  });

  it("блок помечен no-print — в раздаточный лист не печатается", () => {
    const { container } = render(
      <InteractiveCta worksheetId="t1" worksheetTitle="Дроби" subject="math" grade={5} />,
    );
    const cta = container.querySelector("[data-interactive-cta]");
    expect(cta).not.toBeNull();
    expect(cta!.className).toContain("no-print");
  });
});

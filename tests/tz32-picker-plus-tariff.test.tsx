/**
 * ТЗ-32 часть 3 + D2 — ArtifactTypePicker.
 *
 * Часть 3 / AD-7: текст про тариф нарисован НА КНОПКЕ, а не живёт в `title`.
 * Раньше стоял оранжевый «+», который без наведения мышью ничего не объяснял,
 * а на телефоне (основной вход учителя в конструктор) не появлялся вообще.
 *
 * D2 (ТЗ-32 §7): группы «К уроку» и «На период» раскрыты по умолчанию —
 * задача была показать учителю, что бывает. Проверяем, что сменилось ТОЛЬКО
 * значение по умолчанию: клик по заголовку по-прежнему сворачивает и разворачивает.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ArtifactTypePicker } from "@/components/constructor/ArtifactTypePicker";

// jsdom не даёт переписать window.location.href напрямую — через defineProperty.
beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, href: "" },
    writable: true,
    configurable: true,
  });
});

/** Текст кнопки целиком, как его читает учитель на экране. */
function buttonText(name: RegExp): string {
  return screen.getByRole("radio", { name }).textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("ТЗ-32 часть 3: тариф написан на кнопке (AD-7)", () => {
  it.each([
    ["План урока", /План урока/],
    ["Презентация", /Презентация/],
    ["КТП", /КТП/],
  ])("%s: слово «Плюс» видно в тексте кнопки без наведения мышью", (label, matcher) => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    const text = buttonText(matcher);
    expect(text).toContain("Плюс");
    expect(text).toContain(label);
    // Старый оранжевый «+» больше не единственное, что говорит про тариф.
    expect(text).not.toMatch(/\+$/);
  });

  it("доступное имя кнопки тоже содержит «Плюс» — то есть это текст, а не картинка", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    const btn = screen.getByRole("radio", { name: /План урока/ });
    expect(btn).toHaveAccessibleName(expect.stringContaining("Плюс"));
    expect(btn.textContent).toContain("Плюс");
  });

  it("title остался дублем для мыши", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    const btn = screen.getByRole("radio", { name: /План урока/ });
    expect(btn.getAttribute("title")).toContain("Плюс");
  });

  it("у пользователя с тарифом «Плюс» подпись тоже на месте — формат остаётся форматом «Плюс»", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={true} />);

    expect(buttonText(/План урока/)).toContain("Плюс");
    expect(screen.getByRole("radio", { name: /План урока/ })).toHaveAttribute(
      "aria-disabled",
      "false"
    );
  });

  it("у бесплатных типов слова «Плюс» нет — подпись не приклеена ко всем подряд", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    expect(buttonText(/^Лист/)).not.toContain("Плюс");
    expect(buttonText(/^Тест/)).not.toContain("Плюс");
    expect(buttonText(/Карточки/)).not.toContain("Плюс");
    expect(buttonText(/Контрольная/)).not.toContain("Плюс");
  });
});

describe("ТЗ-32 D2: группы раскрыты по умолчанию, механика не сломана", () => {
  it("«К уроку» и «На период» открыты сразу — все типы видны без клика", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    const lesson = screen.getByTestId("artifact-group-lesson");
    const period = screen.getByTestId("artifact-group-period");

    // Все кнопки группы видны и не спрятаны классом `hidden`.
    for (const name of [/План урока/, /Презентация/]) {
      const btn = within(lesson).getByRole("radio", { name });
      expect(btn.closest(".hidden")).toBeNull();
    }
    expect(within(period).getByRole("radio", { name: /КТП/ }).closest(".hidden")).toBeNull();

    expect(screen.getByRole("button", { name: /К уроку/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("button", { name: /На период/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("клик по заголовку «К уроку» сворачивает группу, повторный — разворачивает", async () => {
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    const header = screen.getByRole("button", { name: /К уроку/ });

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    // Свёрнутая группа оставляет только топ-1 тип, остальные уходят в контейнер `hidden`
    // (текст в DOM остаётся — поэтому проверяем видимость, а не наличие).
    const lesson = screen.getByTestId("artifact-group-lesson");
    expect(within(lesson).getByRole("radio", { name: /План урока/ }).closest(".hidden")).toBeNull();
    expect(within(lesson).getByRole("radio", { name: /Презентация/ }).closest(".hidden")).not.toBeNull();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      within(screen.getByTestId("artifact-group-lesson")).getByRole("radio", { name: /Презентация/ })
        .closest(".hidden")
    ).toBeNull();
  });

  it("клик по заголовку «На период» работает так же", async () => {
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    const header = screen.getByRole("button", { name: /На период/ });

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("группа «Каждый день» осталась нераскрываемой кнопкой — там сворачивать нечего", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);

    expect(screen.queryByRole("button", { name: /Каждый день/ })).toBeNull();
    expect(screen.getByTestId("artifact-group-daily").textContent).toContain("Карточки");
  });

  it("свёрнутая по клику группа не мешает выбору: клик по видимому типу работает", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={true} />);

    await user.click(screen.getByRole("button", { name: /К уроку/ }));
    await user.click(screen.getByRole("radio", { name: /План урока/ }));

    expect(onChange).toHaveBeenCalledWith("lesson-plan");
  });
});
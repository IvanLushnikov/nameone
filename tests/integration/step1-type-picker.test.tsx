/**
 * Правка 15.10.2026: выбор типа материала виден на первом шаге.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО СЛОМАНО
 *
 * Тип материала (лист, тест, карточки, план урока, презентация, КТП…) был
 * виден только на шаге 3 — «Параметры». На первом шаге стояли три значения
 * (Лист/Тест/Карточки) и те — только за переключателем «Свой вариант».
 *
 * Итог: учитель, которому нужен план урока или КТП, физически не мог узнать,
 * что такие форматы есть. Он обязан был пройти путь рабочего листа до конца.
 * Про наличие плана урока и презентации можно было узнать только с главной —
 * а это страница для тех, кто ещё не зарегистрирован.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 *
 *  1. Блок «Что делаем» есть на первом шаге ДО выбора предмета — иначе правка
 *     не даёт ничего: до предмета тоже нужно понимать, что бывает.
 *  2. Ежедневные форматы и интерактив доступны сразу, без раскрытия групп.
 *  3. Форматы «К уроку» (план урока, презентация, КТП) достижимы — именно их
 *     и не было видно.
 *  4. Выбранный тип переживает выбор предмета и класса: смена предмета не
 *     должна молча возвращать «Лист».
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { mockApi, setDevice } from "./helpers/constructor-flow";

beforeEach(() => {
  mockApi();
  setDevice({ coarse: false, touchPoints: 0, width: 1440 });
});

afterEach(() => {
  window.history.replaceState({}, "", "/constructor/");
});

/** Рендерит конструктор и ждёт первый шаг. */
async function openStep1() {
  const userEvent = (await import("@testing-library/user-event")).default;
  const { render } = await import("@testing-library/react");
  const { createElement } = await import("react");
  const { default: ConstructorPage } = await import("@/app/constructor/page");

  const user = userEvent.setup();
  render(createElement(ConstructorPage as never));
  await screen.findByText("Что делаем");
  return user;
}

describe("шаг 1 · что можно сделать", () => {
  it("блок с типами виден до выбора предмета", async () => {
    await openStep1();
    // Предмет ещё не выбран — форма выбора на месте, типы тоже.
    expect(screen.getByText("Что и для кого")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Тип материала" })).toBeTruthy();
  });

  it("ежедневные форматы и интерактив доступны сразу", async () => {
    await openStep1();
    for (const label of ["Лист", "Тест", "Карточки", "Контрольная"]) {
      expect(screen.getAllByRole("radio", { name: new RegExp(label) }).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId("pick-type-interactive-step1")).toBeTruthy();
  });

  it("форматы «К уроку» достижимы: план урока, презентация, КТП", async () => {
    const user = await openStep1();
    // D2 (ТЗ-32 §7): группа раскрыта по умолчанию — показываем учителю, что бывает.
    const group = await screen.findByTestId("artifact-group-lesson");
    const opener = group.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(opener.getAttribute("aria-expanded")).toBe("true");

    // Заголовок остался кнопкой: клик по нему работает и в обе стороны.
    await user.click(opener);
    await waitFor(() => {
      expect(group.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe(
        "false"
      );
    });
    await user.click(opener);
    await waitFor(() => {
      expect(group.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
    });

    for (const label of ["План урока", "Презентация", "КТП"]) {
      expect(screen.getAllByRole("radio", { name: new RegExp(label) }).length).toBeGreaterThan(0);
    }
  });

  it("клик по типу помечает его выбранным, и выбор переживает смену предмета", async () => {
    const user = await openStep1();

    const testRadio = screen
      .getAllByRole("radio", { name: /Тест/ })
      .find((el) => el.closest('[data-testid="artifact-group-daily"]')) as HTMLElement;
    await user.click(testRadio);
    await waitFor(() => expect(testRadio.getAttribute("aria-checked")).toBe("true"));

    // Смена предмета не должна возвращать тип по умолчанию.
    const { subjects } = await import("@/lib/content/subjects");
    const math = subjects.find((s) => s.slug === "math");
    if (math) {
      await user.click(screen.getByTitle(math.title));
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("radio", { name: /Тест/ })
            .find((el) => el.closest('[data-testid="artifact-group-daily"]'))
            ?.getAttribute("aria-checked")
        ).toBe("true")
      );
    }
  });

  it("счётчик форматов не обещает лишнего: из восьми три закрыты тарифом", async () => {
    await openStep1();
    // ТЗ-32 B7: голое «8 форматов» вводило в заблуждение — на бесплатном
    // тарифе доступно пять из восьми. Число правдивое, обязана быть видна
    // вторая часть.
    expect(screen.getByText(/8 форматов, три — в тарифе «Плюс»/)).toBeTruthy();
  });
});
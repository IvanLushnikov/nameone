/**
 * ЖАЛОБА 1 (12.10.2026): «Попробовать» на карточке «Проверка работ по фото»
 * открывает генератор, а не проверку.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ТЕСТ ИНТЕГРАЦИОННЫЙ, А НЕ ЧТЕНИЕМ ФАЙЛА
 *
 * Баг был не в ссылке. `?photo=1` честно ставил `photoCheckOpen`, и компонент
 * `PhotoCheckEntry` был написан и отрисовывался — но правая колонка с ним была
 * спрятана условием `step === "select"`, а первый экран генератора — это как раз
 * шаг «select». Экран входа физически не мог появиться раньше, чем учитель сам
 * выберет предмет, класс и сценарий.
 *
 * Проверить это чтением исходника нельзя: комментарий в коде утверждал, что
 * фикс есть и работает. Проверяется только поведение — что после прихода с
 * карточки на экране ВХОД, а не форма выбора предмета.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ТЕСТ ТРЕБУЕТ
 *
 *  1. Приход по `?photo=1` → на экране «Проверка работ по фото» с кнопкой
 *     «Сделать лист и проверить фото», и формы выбора предмета НЕ видно.
 *  2. Кнопка «Сделать лист и проверить фото» возвращает генератор — иначе
 *     учитель застревает на экране входа без выхода.
 *  3. Без `?photo=1` поведение прежнее: сначала форма выбора предмета.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, setDevice } from "./helpers/constructor-flow";

const ENTRY_TEXT = "Сделать лист и проверить фото";

/** Подменяет адресную строку: конструктор читает `?photo=1` один раз на маунте. */
function arriveWithPhotoFlag(): void {
  window.history.replaceState({}, "", "/constructor/?photo=1");
}

beforeEach(() => {
  mockApi();
  // Десктоп: дефолтный innerWidth в jsdom равен 1024 и считается тачем,
  // из-за чего устройство определяется неверно (см. setDevice).
  setDevice({ coarse: false, touchPoints: 0, width: 1440 });
});

afterEach(() => {
  window.history.replaceState({}, "", "/constructor/");
});

describe("жалоба 1: карточка «Проверка работ по фото» ведёт в проверку", () => {
  it("после ?photo=1 сразу виден вход, а не форма выбора предмета", async () => {
    arriveWithPhotoFlag();

    const { openConstructor } = await import("./helpers/constructor-flow");
    // Рендерим без `openConstructor`: он ждёт «Что и для кого», а на первом
    // экране после правки этой надписи быть не должно.
    const user = userEvent.setup();
    const { render } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { default: ConstructorPage } = await import("@/app/constructor/page");

    render(createElement(ConstructorPage as never));
    await user.click(document.body as never); // смачиваем userEvent

    // Вход на месте.
    await waitFor(() => {
      expect(screen.getByText(ENTRY_TEXT)).toBeTruthy();
    });
    // Именно это и было сломано: форма выбора предмета забирала весь экран,
    // а панель с входом не рендерилась вовсе.
    await waitFor(() => {
      expect(screen.queryByText("Что и для кого")).toBeNull();
    });
    void openConstructor;
  });

  it("кнопка «Сделать лист и проверить фото» возвращает генератор", async () => {
    arriveWithPhotoFlag();
    const user = userEvent.setup();
    const { render } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { default: ConstructorPage } = await import("@/app/constructor/page");

    render(createElement(ConstructorPage as never));
    await user.click(document.body as never);

    const entryButton = await screen.findByText(ENTRY_TEXT);
    await user.click(entryButton);

    // Учитель не должен застрять: генератор доступен сразу после входа.
    await waitFor(() => {
      expect(screen.getByText("Что и для кого")).toBeTruthy();
    });
  });

  it("без ?photo=1 всё как было — сначала форма выбора предмета", async () => {
    const { openConstructor } = await import("./helpers/constructor-flow");
    await openConstructor();
    expect(screen.queryByText(ENTRY_TEXT)).toBeNull();
  });
});
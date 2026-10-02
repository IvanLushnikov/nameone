/**
 * З8: список тем в конструкторе — счётчик «Показано N из M» и видимая
 * полоса прокрутки (`src/app/constructor/page.tsx`, компонент TopicStep).
 *
 * Жалоба была: «там всего 4 темы… пролистала — а там всего 8». Список
 * обрезался по `max-h`, а класс `scrollbar-hide` прятал полосу прокрутки, и
 * обрезанный список выглядел как весь. Тест проверяет ровно это:
 *   1) есть текстовый счётчик «Показано N из M»;
 *   2) у списка НЕТ класса `scrollbar-hide`;
 *   3) кнопка «Показать все» реально раскрывает список до конца.
 *
 * Компонент `TopicStep` наружу не экспортируется, поэтому тест гоняет
 * настоящий визард страницы (см. helpers/constructor-flow) — это прямой
 * проверяющий тест, а не разбор исходника.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  goToTopicStep,
  mockApi,
  openConstructor,
  setDevice,
} from "./helpers/constructor-flow";

// next/navigation — концерн jsdom: страница читает useSearchParams/useRouter.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/constructor/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

beforeEach(() => {
  window.localStorage.clear();
  mockApi();
  setDevice({ coarse: false, touchPoints: 0, width: 1600 });
});

describe("список тем — счётчик и полоса прокрутки (З8)", () => {
  it("показывает «Показано N из M», где N меньше M", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    const counter = screen.getByText(/^Показано \d+ из \d+$/);
    const [, shown, total] = counter.textContent!.match(/^Показано (\d+) из (\d+)$/)!;

    expect(Number(shown)).toBeGreaterThan(0);
    expect(Number(total)).toBeGreaterThan(Number(shown));
  });

  it("у списка тем нет класса scrollbar-hide, который прятал полосу прокрутки", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    const list = screen.getByTestId("topics-list");

    expect(list.className).not.toContain("scrollbar-hide");
    // Список остаётся прокручиваемым (ограничение по высоте сохранено).
    expect(list.className).toContain("overflow-y-auto");
  });

  it("в разметке шага темы вообще нет scrollbar-hide", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    // Шаг целиком: класс мог бы вернуться на любом из внутренних контейнеров.
    expect(document.body.innerHTML).not.toContain("scrollbar-hide");
  });

  it("кнопка «Показать все» раскрывает список до конца и счётчик это показывает", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    const counter = screen.getByText(/^Показано \d+ из \d+$/);
    const total = Number(counter.textContent!.match(/из (\d+)$/)![1]);
    const shownBefore = screen.getByTestId("topics-list").querySelectorAll("button").length;

    const showAll = screen.getByTestId("show-all-topics");
    expect(showAll.textContent).toContain(String(total));
    expect(shownBefore).toBeLessThan(total);

    await user.click(showAll);

    expect(screen.getByTestId("topics-list").querySelectorAll("button")).toHaveLength(total);
    expect(screen.getByText(`Показано ${total} из ${total}`)).toBeInTheDocument();
    // Кнопка исчезает — раскрывать больше нечего.
    expect(screen.queryByTestId("show-all-topics")).not.toBeInTheDocument();
  });

  it("короткий список (6 тем) помещается целиком и не просит «Показать все»", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "geometry", 10);

    const counter = screen.getByText(/^Показано (\d+) из (\d+)$/);
    const [, shown, total] = counter.textContent!.match(/^Показано (\d+) из (\d+)$/)!;

    // TOPICS_PREVIEW_COUNT = 6: список не длиннее порога — счётчик 6 из 6.
    expect(Number(shown)).toBe(Number(total));
    expect(Number(total)).toBe(6);
    expect(screen.getByTestId("topics-list").querySelectorAll("button")).toHaveLength(6);
    expect(screen.queryByTestId("show-all-topics")).not.toBeInTheDocument();
  });

  it("список длиной 7 тем обрезается до 6 и честно об этом говорит", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "geometry", 8);

    // Счётчик показывает обрезание, кнопка «Показать все» есть.
    expect(screen.getByText("Показано 6 из 7")).toBeInTheDocument();
    expect(screen.getByTestId("show-all-topics")).toBeInTheDocument();
  });
});

/**
 * Правки 15.10.2026 №2 и №3: кабинет учителя — вход в интерактивы и
 * объяснение пустого кабинета.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО СЛОМАНО
 *
 * №2. На главной есть блок «Лист превращается в игру» со ссылкой на
 * /dashboard/interactives. Из кабинета туда не было входа вообще: ни в одной
 * из четырёх вкладок, ни среди карточек. То есть мы сами предлагали учителю
 * кликнуть туда, куда из кабинета не попасть.
 *
 * №3. Пустой кабинет показывал три счётчика в нуле и надпись «История пуста».
 * Числа честные, но бесполезные: человек не понимает, что кабинет вообще
 * для чего. Рассказ об этом был только на главной — на странице, которую
 * читают ДО регистрации.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 *
 *  1. Карточка «Игра для класса» есть в кабинете и ведёт в /dashboard/interactives.
 *  2. Блок «Что можно сделать с листом» виден при пустой истории.
 *  3. Блок исчезает, как только появился хоть один лист: с материалами он шум.
 *  4. Каждая карточка блока ведёт в рабочее место — без мёртвых ссылок.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

/** Вкладка «Выданное» — серверные формы, к этим правкам отношения не имеет. */
vi.mock("@/components/teacher/FormsTab", () => ({
  FormsTab: () => <div data-testid="forms-tab" />,
}));
vi.mock("@/components/shared/UsageCard", () => ({
  UsageCard: () => <div data-testid="usage-card" />,
}));
vi.mock("@/lib/auth/api", () => ({
  fetchUsage: async () => null,
  signOutFromApi: vi.fn(async () => undefined),
}));

import DashboardPage from "@/app/dashboard/page";
import { addToHistory } from "@/lib/utils/storage";
import type { SubjectSlug, Worksheet } from "@/lib/types";

const fetchMock = vi.fn();

function makeWorksheet(id: string): Worksheet {
  return {
    id,
    subject: "math",
    grade: 5,
    topic: "Дроби",
    difficulty: "medium",
    title: `Лист ${id}`,
    createdAt: new Date().toISOString(),
    // Задание собираем по реальному WorksheetTask: у задания есть номер,
    // тип и стоимость в баллах. Раньше здесь лежала карточка из другого
    // контракта ({text, answer, explanation}), и фикстура проходила только
    // потому, что приводилась `as Worksheet` — tsc такие подгонки не пускает.
    tasks: [
      {
        number: 1,
        text: "Задание 1",
        type: "short-answer",
        answer: "1",
        explanation: "",
        points: 1,
      },
    ],
  };
}

function seedOneWorksheet() {
  const ws = makeWorksheet("w1");
  addToHistory({
    id: ws.id,
    type: "worksheet",
    title: ws.title,
    subject: ws.subject as SubjectSlug,
    grade: ws.grade,
    createdAt: ws.createdAt,
    isFavorite: false,
    artifact: ws,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  fetchMock.mockRejectedValue(new Error("сеть недоступна в тесте"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("кабинет · вход в интерактивы", () => {
  it("есть карточка с переходом в /dashboard/interactives", async () => {
    render(<DashboardPage />);
    const link = await screen.findByRole("link", { name: /Открыть игры/ });
    expect((link as HTMLAnchorElement).getAttribute("href")).toBe("/dashboard/interactives");
    expect(screen.getByText("Игра для класса")).toBeTruthy();
  });

  it("карточка видна и анонимному учителю, без входа", async () => {
    render(<DashboardPage />);
    // Профиль не выставлен — это и есть анонимный путь.
    await screen.findByText("Игра для класса");
    expect(screen.queryByText("Войдите, чтобы увидеть")).toBeNull();
  });
});

describe("кабинет · пустое состояние объясняет себя", () => {
  it("при пустой истории виден блок с тремя карточками", async () => {
    render(<DashboardPage />);
    const guide = await screen.findByTestId("cabinet-guide");
    expect(guide.textContent).toContain("Что можно сделать с листом в кабинете");
    expect(guide.textContent).toContain("Выдать лист классу");
    expect(guide.textContent).toContain("Собрать игру из листа");
    expect(guide.textContent).toContain("Задать вопросы для беседы");
  });

  it("каждая карточка ведёт в рабочее место", async () => {
    render(<DashboardPage />);
    const guide = await screen.findByTestId("cabinet-guide");
    const hrefs = Array.from(guide.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/dashboard?tab=forms",
      "/dashboard/interactives",
      "/constructor?photo=1",
    ]);
  });

  it("как только появился лист, блок исчезает", async () => {
    seedOneWorksheet();
    render(<DashboardPage />);
    // Ждём именно данных, а не пустого состояния: с листом «История пуста»
    // на экране быть не должно.
    await waitFor(() => {
      expect(screen.queryByText(/История пуста/)).toBeNull();
    });
    expect(screen.getByText("Лист w1")).toBeTruthy();
    expect(screen.queryByTestId("cabinet-guide")).toBeNull();
  });
});
/**
 * ТЗ-32, часть 7 и решения владельца D4 и D5.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ПРОВЕРЯЕМ
 *
 * D4. Плитка «С нами» в кабинете убрана совсем. Не заменена на «сегодня» и не
 *     на «пока нет данных» — её нет вовсе. Раньше она показывала «—» у нового
 *     учителя, и это читалось как недогрузилось. Рядом с ней в сетке стояла
 *     четвёртая ячейка, поэтому здесь же проверяем, что после удаления плитки
 *     осталось ровно три счётчика, а не четыре с дырой.
 *
 * D5. Гостю в шапке доступна ссылка на кабинет рядом с «Войти». Проверяем и
 *     сам факт ссылки, и то, что она ведёт в /dashboard, а не в /login:
 *     кабинет умеет читать материалы с устройства и входа не требует, поэтому
 *     кнопка «Кабинет» у гостя не должна вести на страницу входа.
 *
 * Тесты идут против отрендеренного DOM, а не против исходника строки: цель —
 * поймать возврат плитки или замену ссылки на редирект, а не переименование
 * переменной.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/navigation в jsdom нет: подменяем маршрутизацию. Для Header важно, что
// путь не начинается с /constructor — иначе «Создать лист» в шапке не рендерится
// и мы бы проверяли не то состояние.
let currentPath = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(),
}));

/** Кабинет тянет серверные вкладки — они к этим правкам отношения не имеют. */
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
import { Header } from "@/components/layout/Header";
import { setProfile } from "@/lib/utils/storage";
import type { UserProfile } from "@/lib/types";

beforeEach(() => {
  currentPath = "/";
  window.localStorage.clear();
});

describe("ТЗ-32 D4: плитка «С нами» в кабинете удалена", () => {
  it("в кабинете нет подписи «С нами»", () => {
    render(<DashboardPage />);

    expect(screen.queryByText("С нами")).toBeNull();
  });

  it("в кабинете не осталось прочерка, который читался как недогрузилось", () => {
    render(<DashboardPage />);

    // Раньше плитка рисовала «—», когда материалов нет. Проверяем, что такой
    // символ не вернулся ни в одном счётчике.
    expect(screen.queryByText("—")).toBeNull();
  });

  it("остались ровно три счётчика, а не четыре с пустой ячейкой", () => {
    const { container } = render(<DashboardPage />);

    // Счётчики — карточки с числом и подписью. Ищем их по подписям, которые
    // обязаны остаться, и убеждаемся, что четвёртой плитки нет.
    for (const label of ["Сгенерировано", "В избранном", "Шаблонов"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    // Сетка плиток объявлена на три колонки: при `sm:grid-cols-4` на её месте
    // осталась бы пустая ячейка справа (именно это ТЗ называет «провалом»).
    // Ищем именно контейнер с числом колонок: класс `.grid` есть и у иконок
    // внутри плиток, поэтому он не годится.
    const gridEl = container.querySelector('[class*="grid-cols-"]');
    expect(gridEl).not.toBeNull();
    const classes = gridEl?.className ?? "";
    expect(classes).toContain("grid-cols-3");
    expect(classes).not.toContain("grid-cols-4");
  });
});

describe("ТЗ-32 D5: гостю в шапке доступна ссылка на кабинет", () => {
  /** Ищем именно кнопку-ссылку: по тексту «Кабинет» в шапке гостя может быть
   *  только одна, но проверять надо атрибут href, а не наличие слова. */
  function guestCabinetLink(): HTMLAnchorElement | null {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/dashboard"]')).find(
      (a) => a.textContent?.includes("Кабинет") ?? false
    ) ?? null;
  }

  it("гость без профиля видит и «Войти», и «Кабинет»", () => {
    render(<Header />);

    expect(screen.getAllByText("Войти").length).toBeGreaterThan(0);
    expect(guestCabinetLink()).not.toBeNull();
  });

  it("ссылка «Кабинет» ведёт в кабинет, а не на страницу входа", () => {
    render(<Header />);

    const link = guestCabinetLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/dashboard");
    expect(link?.getAttribute("href")).not.toBe("/login");
  });

  it("в мобильном меню гостю тоже есть вход в кабинет", () => {
    // Мобильное меню закрыто по умолчанию и открывается кнопкой «Меню».
    // Кликаем по ней, чтобы увидеть его содержимое.
    const { container } = render(<Header />);
    const burger = container.querySelector<HTMLButtonElement>('button[aria-label="Меню"]');
    expect(burger).not.toBeNull();
    burger?.click();

    // Кнопка скрыта классой md:hidden только на широких экранах, в jsdom
    // медиазапросов нет, поэтому элемент доступен после клика.
    expect(screen.getAllByText("Кабинет").length).toBeGreaterThan(0);
  });

  it("залогиненный по-прежнему видит одну кнопку «Кабинет» с именем, а не две", () => {
    // Правило шапки — одна кнопка на состояние. Проверяем, что решение D5 не
    // размножило кнопку у того, кому вход уже не нужен.
    setProfile({
      id: "u-1",
      email: "teacher@school.ru",
      name: "Иван Петров",
      plan: "free",
      generationsTotal: 0,
      generationsToday: 0,
      generationsLimit: 5,
      createdAt: "2026-10-01T10:00:00.000Z",
    } satisfies UserProfile);

    const { container } = render(<Header />);

    // Пункт «Кабинет» в списке меню так и не появился: он убран Д-3, и
    // возвращать его в меню D5 не просит.
    const cabinetLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href="/dashboard"]')
    );
    expect(cabinetLinks).toHaveLength(1);
    expect(cabinetLinks[0].textContent).toContain("Иван Петров");
    // И никакого «Войти» рядом — состояние одно.
    expect(screen.queryByText("Войти")).toBeNull();
  });
});
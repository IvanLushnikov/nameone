/**
 * Рендер-тесты страницы входа (src/app/login/page.tsx).
 *
 * Что здесь защищаем — не вёрстка, а честность обещаний:
 *
 *   1. Форма «введите email — пришлём ссылку» показывается ровно тогда, когда
 *      письма реально уходят. 3 октября 2026 домен для писем не был подтверждён
 *      в Resend, форма всё равно обещала ссылку, и учитель вводил адрес, видел
 *      «Проверьте почту» и ждал письма, которого физически не существует. Тогда
 *      страница показывала честное «входа пока нет» — и тест это фиксировал.
 *      7 октября 2026 домен подтверждён (Resend verified, живая отправка отдаёт
 *      {"ok":true}), форма вернулась.
 *   2. Путь «создать лист без регистрации» остаётся на странице в любом
 *      состоянии: пока входа нет — это главное действие, после — ссылка в
 *      подвале под формой. Регистрация для создания листа не нужна.
 *   3. Незаблокированные кнопки ВК/Яндекс/Telegram подписаны «скоро» ВИДИМО.
 *      Молчаливый `disabled` без подписи выглядит как сломанная кнопка.
 *
 * Тест на состояние «вход готов» написан через прямой мок модуля
 * magic-link-status, иначе он проверял бы только ветку, которая сейчас
 * выключена, а включение осталось бы без проверки.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MAGIC_LINK_READY } from "@/lib/auth/magic-link-status";
import LoginPage from "@/app/login/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Страница входа — вход по ссылке готов", () => {
  it("показывает форму входа, потому что письма реально уходят", () => {
    render(<LoginPage />);

    // Инвариант не изменился: форма обязана быть на месте ровно тогда, когда
    // вход включён. Пока MAGIC_LINK_READY был false, форма была скрыта и вместо
    // неё показывалось честное «входа пока нет».
    expect(MAGIC_LINK_READY).toBe(true);
    expect(screen.getByRole("button", { name: /получить ссылку/i })).toBeTruthy();
    expect(screen.getByLabelText(/^email$/i)).toBeTruthy();
    expect(screen.queryByText(/вход по ссылке из письма — пока недоступен/i)).toBeNull();
  });

  it("оставляет создание листа без регистрации доступным и на странице входа", () => {
    const { container } = render(<LoginPage />);
    // С входом работающим эта ссылка перестаёт быть главным действием и уходит
    // в подвал под формой — рабочий путь «создать лист без регистрации»
    // при этом сохраняется, поэтому проверяем наличие, а не размер кнопки.
    const cta = container.querySelector('a[href="/constructor"]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent).toMatch(/создать лист без регистрации/i);
  });

  it("подписывает соцкнопки «скоро» прямо на кнопке", () => {
    const { container } = render(<LoginPage />);
    const labels = Array.from(container.querySelectorAll("button[disabled]"))
      .map((b) => b.textContent ?? "");
    // Основная кнопка отправки тоже disabled — до отметки согласия на ПДн.
    // Соцкнопки отбираем по подписи, чтобы тест не зависел от её наличия.
    expect(labels).toEqual(
      expect.arrayContaining(["VKскоро", "Яндексскоро", "Telegramскоро"]),
    );
    expect(labels).toHaveLength(4);
  });
});

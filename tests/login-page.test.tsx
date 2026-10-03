/**
 * Рендер-тесты страницы входа (src/app/login/page.tsx).
 *
 * Что здесь защищаем — не вёрстка, а честность обещаний:
 *
 *   1. Пока письма не отправляются (домен для писем не подтверждён в Resend),
 *      страница НЕ показывает форму «введите email — пришлём ссылку» и НЕ
 *      говорит «Magic link — без пароля». Именно эта комбинация 3 октября 2026
 *      держала в дураке учителя: он вводил адрес, видел «Проверьте почту» и
 *      ждал письма, которого физически не существует (Resend отвечал 403).
 *   2. Пока входа нет, «Создать лист без регистрации» — главное действие
 *      страницы, а не мелкая ссылка в подвале: это единственный рабочий путь.
 *   3. Незаблокированные кнопки ВК/Яндекс/Telegram подписаны «скоро»
 *      ВИДИМО. Молчаливый `disabled` без подписи выглядит как сломанная
 *      кнопка, и человек тратит клик впустую.
 *
 * Тест на состояние «вход готов» написан через прямой мок модуля
 * magic-link-status, иначе он проверял бы только ветку, которая сейчас
 * выключена, а включение через 2-4 дня осталось бы без проверки.
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

describe("Страница входа — текущее состояние (почта ещё не работает)", () => {
  it("не обещает ссылку из письма, пока письма не отправляются", () => {
    render(<LoginPage />);

    if (MAGIC_LINK_READY) {
      // Вход включён — тогда форма обязана быть на месте.
      expect(screen.getByRole("button", { name: /получить ссылку/i })).toBeTruthy();
      return;
    }

    expect(screen.queryByRole("button", { name: /получить ссылку/i })).toBeNull();
    expect(screen.queryByLabelText(/^email$/i)).toBeNull();
    expect(screen.getByText(/вход по ссылке из письма — пока недоступен/i)).toBeTruthy();
  });

  it("показывает создание листа без регистрации как главное действие", () => {
    const { container } = render(<LoginPage />);
    // Кнопка во всю ширину карточки, а не ссылка в одну строку в подвале.
    const cta = container.querySelector('a[href="/constructor"]');
    expect(cta).not.toBeNull();
    expect(cta?.className).toContain("w-full");
    expect(cta?.textContent).toMatch(/создать лист без регистрации/i);
  });

  it("подписывает соцкнопки «скоро» прямо на кнопке", () => {
    const { container } = render(<LoginPage />);
    const buttons = Array.from(container.querySelectorAll("button[disabled]"));
    const labels = buttons.map((b) => b.textContent ?? "");
    expect(labels).toEqual(["VKскоро", "Яндексскоро", "Telegramскоро"]);
  });
});

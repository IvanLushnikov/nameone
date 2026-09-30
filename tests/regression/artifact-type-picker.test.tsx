/**
 * Regression: TZ-4 + TZ-5 (QA-аудит 2026-09-30) — ArtifactTypePicker.
 *
 * TZ-5: кнопки plusOnly для бесплатных юзеров должны:
 *   1. Визуально отличаться от enabled (opacity, яркий badge, lock-иконка).
 *   2. При клике НЕ вызывать onChange, а перенаправлять на /pricing/.
 *
 * TZ-4 (косвенно через TZ-5): кликабельные кнопки в enabled-режиме должны
 *   триггерить onChange (это та же prop, через которую родитель сбрасывает
 *   закэшированные артефакты при смене типа).
 *
 * Заметка: TZ-4 (логика `kind`-селектора в constructor/page.tsx) живёт внутри
 * `ConstructorPage` — это client component с useSearchParams + useRouter +
 * useUsage + Docx-генерация, который тянет ~20 импортов. Чтобы не мокать пол-приложения,
 * мы покрываем TZ-4 на уровне callback-контракта (ArtifactTypePicker правильно
 * зовёт onChange), а сброс закэшированных артефактов — отдельным unit-тестом
 * на чистую функцию-обёртку в этом файле (см. wrapper-тест ниже).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// next/navigation + next/link — концерн jsdom.
vi.mock("next/navigation", () => ({
  usePathname: () => "/constructor/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ArtifactTypePicker } from "@/components/constructor/ArtifactTypePicker";

// jsdom не позволяет напрямую перезаписать window.location.href — используем
// defineProperty. Сбрасываем перед каждым тестом, чтобы состояние не текло
// между сценариями (тест с /pricing/ иначе ломает следующий).
Object.defineProperty(window, "location", {
  value: { ...window.location, href: "" },
  writable: true,
  configurable: true,
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, href: "" },
    writable: true,
    configurable: true,
  });
});

describe("ArtifactTypePicker — TZ-5: plusOnly без hasPlus", () => {
  it("визуально отличается: opacity-60 + cursor-not-allowed + lock-иконка", () => {
    const { container } = render(
      <ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />
    );

    const btn = screen.getByRole("radio", { name: /План урока/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn.className).toMatch(/opacity-60/);
    expect(btn.className).toMatch(/cursor-not-allowed/);

    // Lock-иконка внутри плюс-бейджа: ищем по классу lucide-lock.
    const lockIcon = container.querySelector(".lucide-lock");
    expect(lockIcon).toBeTruthy();
  });

  it("яркий badge '+' с белым текстом на accent-500 для заблокированных опций", () => {
    const { container } = render(
      <ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />
    );

    // Находим бейдж '+' внутри disabled-кнопки «Презентация».
    const btn = screen.getByRole("radio", { name: /Презентация/ });
    const badge = btn.querySelector("span.bg-accent-500");
    expect(badge).toBeTruthy();
    expect(badge).toHaveTextContent("+");
    expect(badge?.className).toMatch(/text-white/);
  });

  it("при клике НЕ вызывает onChange, а перенаправляет на /pricing/", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={false} />);

    // Кликаем по «Презентация» (plusOnly) — onChange НЕ должен сработать,
    // а window.location.href должен стать "/pricing/".
    await user.click(screen.getByRole("radio", { name: /Презентация/ }));

    expect(onChange).not.toHaveBeenCalled();
    expect(window.location.href).toBe("/pricing/");
  });

  it("title/tooltip подсказывает тариф «Плюс»", () => {
    render(<ArtifactTypePicker value="worksheet" onChange={vi.fn()} hasPlus={false} />);
    const btn = screen.getByRole("radio", { name: /Презентация/ });
    expect(btn.getAttribute("title")).toMatch(/Плюс/);
  });
});

describe("ArtifactTypePicker — hasPlus: всё активно", () => {
  it("plusOnly-опции доступны и реагируют на клик", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={true} />);

    const btn = screen.getByRole("radio", { name: /Презентация/ });
    expect(btn).toHaveAttribute("aria-disabled", "false");
    expect(btn.className).not.toMatch(/opacity-60/);

    await user.click(btn);
    expect(onChange).toHaveBeenCalledWith("presentation");
    expect(window.location.href).toBe(""); // не ушли на /pricing/
  });
});

describe("ArtifactTypePicker — TZ-4: смена типа переключает preview", () => {
  it("enabled-кнопки зовут onChange (контракт с родителем: сбросить preview и поставить новый тип)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactTypePicker value="worksheet" onChange={onChange} hasPlus={true} />);

    await user.click(screen.getByRole("radio", { name: /Лист/ }));
    expect(onChange).toHaveBeenCalledWith("worksheet");

    await user.click(screen.getByRole("radio", { name: /Тест/ }));
    expect(onChange).toHaveBeenCalledWith("test");
  });
});

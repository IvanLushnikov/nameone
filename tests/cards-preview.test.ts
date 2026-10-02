/**
 * Рендер-тесты `CardsPreview` (TZ-16 §3.1, Этап 2).
 *
 * Вынесены отдельно от `tests/cards.test.ts`, потому что нуждаются в jsdom,
 * а основной файл гоняется с `--environment node` (на этой машине jsdom
 * на старте съедает память и минуты).
 *
 * Покрытие:
 *   1. непустой набор — рендерятся лицевые стороны и категории, есть сетка.
 *   2. пустой набор — понятное empty state учителю, а не пустой экран.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { CardSet } from "@/lib/types";
import { CardsPreview } from "@/components/constructor/CardsPreview";

describe("CardsPreview — рендер", () => {
  it("happy set: рендерит лицевые стороны, категории и сетку карточек", () => {
    const set: CardSet = {
      id: "t1",
      title: "Карточки · Обыкновенные дроби",
      subject: "math",
      grade: 5,
      topic: "drobi-obyknovennye",
      difficulty: "medium",
      cards: [
        { front: "Сократи дробь: 8/12 = __", back: "2/3", category: "Формулы" },
        { front: "Сложи: 2/5 + 1/5 = __", back: "3/5", category: "Формулы" },
      ],
      createdAt: new Date().toISOString(),
    };

    const { container } = render(React.createElement(CardsPreview, { set }));
    expect(container.textContent).toContain("Сократи дробь: 8/12 = __");
    expect(container.textContent).toContain("Формулы");
    expect(container.querySelectorAll(".cards-print-card").length).toBeGreaterThan(0);
    // Сетка 2×5: две карточки + 8 пустых рамок до 10
    expect(container.querySelectorAll(".cards-print-card")).toHaveLength(10);
    expect(container.querySelector(".cards-print-grid")).toBeTruthy();
  });

  it("пустой набор: понятное empty state, а не пустой экран", () => {
    const set: CardSet = {
      id: "t2",
      title: "Карточки · ne-suschestvuyuschiy-slug-xyz",
      subject: "math",
      grade: 5,
      topic: "ne-suschestvuyuschiy-slug-xyz",
      difficulty: "medium",
      cards: [],
      createdAt: new Date().toISOString(),
    };

    const { container } = render(React.createElement(CardsPreview, { set }));
    expect(container.textContent).toContain("Карточки не получились");
    expect(container.textContent).toContain("ne-suschestvuyuschiy-slug-xyz");
    expect(container.querySelectorAll(".cards-print-card")).toHaveLength(0);
  });
});

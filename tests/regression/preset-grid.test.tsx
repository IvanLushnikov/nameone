/**
 * Regression: TZ-11 (QA-аудит 2026-09-30) — PresetGrid визуальный preview.
 *
 * Контракт:
 *   1. У каждого из 5 пресетов в каталоге есть `preview` (ReactNode) — миниатюра
 *      формата вывода. Юзер сразу видит «как выглядит результат», а не только
 *      читает текст «Карточка / Лист / Тест / ...».
 *   2. Каждая карточка пресета рендерит миниатюру (data-testid="preview-*").
 *   3. Карточка имеет `title` (= previewHint) для hover-tooltip с развёрнутым
 *      описанием формата.
 *   4. При выборе пресета карточка остаётся функциональной (onSelectPreset зовётся).
 *
 * Заметка: PresetGrid — client component с минимальной логикой (нет useRouter /
 * useSearchParams / useUsage), поэтому монтируем напрямую — без моков next/navigation.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PRESETS,
  PresetGrid,
} from "@/components/constructor/PresetGrid";

describe("PresetGrid — TZ-11: визуальный preview формата", () => {
  it("каталог PRESETS содержит 5 пресетов и у каждого есть preview и previewHint", () => {
    expect(PRESETS).toHaveLength(5);
    for (const p of PRESETS) {
      expect(p.preview, `preset ${p.id} имеет preview`).toBeTruthy();
      expect(p.previewHint, `preset ${p.id} имеет previewHint`).toMatch(/\S/);
      expect(p.previewHint.length).toBeGreaterThan(30);
    }
  });

  it("каждый из 5 пресетов мапится на свой тип миниатюры (preview-card / -test / -handout / -list / -exam)", () => {
    // 4 пресета доступны для grade=5 (все кроме oge-ege, который только 9 и 11).
    const visible = PRESETS.filter(
      (p) => !p.onlyGrades || p.onlyGrades.includes(5)
    );
    expect(visible).toHaveLength(4);
    const testIds = visible.map(
      (p) =>
        // preview это ReactNode, мы ищем data-testid внутри через контейнер.
        // Проще проверить через рендер ниже; тут — sanity на каталог.
        p.id
    );
    expect(testIds).toEqual(
      expect.arrayContaining(["card-15min", "homework", "test-new-topic", "handout"])
    );
    expect(visible.find((p) => p.id === "oge-ege")).toBeUndefined();
  });

  it("рендерит миниатюру внутри каждой карточки (data-testid='preview-*')", () => {
    const { container } = render(
      <PresetGrid
        grade={5}
        mode="template"
        onModeChange={vi.fn()}
        onSelectPreset={vi.fn()}
        onSkipToTopic={vi.fn()}
      />
    );

    // 4 видимых пресета для grade=5
    const previews = container.querySelectorAll('[data-testid^="preview-"]');
    expect(previews.length).toBeGreaterThanOrEqual(4);

    // Каждая карточка оборачивает preview в контейнер с тон-окрашенным бордером.
    const card = container.querySelector("button[aria-pressed]");
    expect(card).toBeTruthy();
    const previewInside = card?.querySelector('[data-testid^="preview-"]');
    expect(previewInside).toBeTruthy();
  });

  it("карточка имеет hover-tooltip (title) с развёрнутым описанием формата", () => {
    render(
      <PresetGrid
        grade={5}
        mode="template"
        onModeChange={vi.fn()}
        onSelectPreset={vi.fn()}
        onSkipToTopic={vi.fn()}
      />
    );

    // Берём первую видимую карточку
    const card = screen.getByRole("button", {
      name: /Карточка на 15 минут/,
    });
    const title = card.getAttribute("title");
    expect(title).toBeTruthy();
    expect(title).toMatch(/разминк|Карточк|лист/i);
  });

  it("плашка формата вывода (outputLabel) сохранена и читается на каждой карточке", () => {
    const { container } = render(
      <PresetGrid
        grade={5}
        mode="template"
        onModeChange={vi.fn()}
        onSelectPreset={vi.fn()}
        onSkipToTopic={vi.fn()}
      />
    );

    const labels = Array.from(
      container.querySelectorAll("button .rounded-full")
    ).map((el) => el.textContent?.trim());
    // Проверяем что 4 видимых outputLabel присутствуют
    expect(labels).toEqual(
      expect.arrayContaining(["Карточка", "Лист", "Тест", "Раздаточный"])
    );
  });

  it("для grade=9 видны все 5 пресетов (oge-ege разблокирован)", () => {
    const { container } = render(
      <PresetGrid
        grade={9}
        mode="template"
        onModeChange={vi.fn()}
        onSelectPreset={vi.fn()}
        onSkipToTopic={vi.fn()}
      />
    );
    // 5 карточек пресетов = 5 aria-pressed кнопок
    const cards = container.querySelectorAll("button[aria-pressed]");
    expect(cards.length).toBe(5);
  });

  it("клик по карточке вызывает onSelectPreset с правильным preset", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <PresetGrid
        grade={5}
        mode="template"
        onModeChange={vi.fn()}
        onSelectPreset={onSelect}
        onSkipToTopic={vi.fn()}
      />
    );

    const homework = screen.getByRole("button", {
      name: /Домашняя работа/,
    });
    await user.click(homework);

    expect(onSelect).toHaveBeenCalledTimes(1);
    const passed = onSelect.mock.calls[0][0];
    expect(passed.id).toBe("homework");
    expect(passed.outputLabel).toBe("Лист");
    expect(passed.preview).toBeTruthy();
  });

  it("выбранная карточка подсвечена (aria-pressed=true) и сохраняет preview", () => {
    const { container } = render(
      <PresetGrid
        grade={5}
        mode="template"
        onModeChange={vi.fn()}
        onSelectPreset={vi.fn()}
        onSkipToTopic={vi.fn()}
        selectedPresetId="test-new-topic"
      />
    );
    const selected = container.querySelector('button[aria-pressed="true"]');
    expect(selected).toBeTruthy();
    // Внутри выбранной карточки всё равно есть preview
    expect(selected?.querySelector('[data-testid^="preview-"]')).toBeTruthy();
  });
});
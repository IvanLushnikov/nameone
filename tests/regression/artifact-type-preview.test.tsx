import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { ArtifactTypePreview } from "@/components/constructor/ArtifactTypePreview";
import type { TaskType } from "@/lib/types";

/**
 * TZ-12 (QA-аудит 2026-09-30): smoke-тест для нового <ArtifactTypePreview/>.
 *
 * Проверяем, что компонент рендерит SVG для всех типов артефактов
 * без падения и с правильным aria-label.
 */

const ALL_TYPES: TaskType[] = [
  "worksheet",
  "test",
  "cards",
  "control",
  "lesson-plan",
  "presentation",
  "ktp",
  "oge",
  "ege",
];

describe("ArtifactTypePreview (TZ-12)", () => {
  it.each(ALL_TYPES)("renders without crashing for type=%s", (type) => {
    const { container, unmount } = render(
      <ArtifactTypePreview type={type} title={`Превью ${type}`} />
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe(`Превью ${type}`);
    unmount();
  });

  it("falls back to worksheet for unknown type", () => {
    // TS не позволит нам передать invalid type, но в runtime-safe смысле —
    // проверим, что компонент терпим к undefined/null через type assertion.
    const { container } = render(
      // @ts-expect-error проверяем runtime fallback
      <ArtifactTypePreview type={"unknown" as TaskType} />
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // При неизвестном типе рендерится worksheet preview — у него есть rects с #E7E5E0
    // (серые плейсхолдеры для текста заданий).
    expect(svg?.innerHTML).toContain("#E7E5E0");
  });
});

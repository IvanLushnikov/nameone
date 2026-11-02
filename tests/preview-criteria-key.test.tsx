/**
 * ТЗ-71 / T-4: ключ превью показывает criteria, а не один «Ответ: —».
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import type { Worksheet } from "@/lib/types";

const CRITERIA_WORKSHEET = {
  id: "qa-criteria",
  title: "Тест критериев",
  subject: "math",
  grade: 5,
  topic: "Обыкновенные дроби",
  difficulty: "medium",
  createdAt: "2026-11-02T00:00:00.000Z",
  tasks: [
    {
      number: 11,
      text: "Объясните, что показывает знаменатель дроби.",
      type: "open-ended",
      answer: null,
      criteria: [
        "Называет, что знаменатель показывает, на сколько равных частей разделили целое",
        "Приводит пример с дробью из темы",
      ],
      points: 2,
    },
  ],
} as unknown as Worksheet;

describe("ТЗ-71: критерии в ключе превью", () => {
  it("показывает текст критерия и не оставляет только прочерк", () => {
    render(
      <WorksheetPreview worksheet={CRITERIA_WORKSHEET} withAnswers withExplanations={false} />,
    );

    expect(
      screen.getByText(/Называет, что знаменатель показывает/),
    ).toBeInTheDocument();
    expect(screen.getByText("Критерии:")).toBeInTheDocument();
    const answerLines = screen.queryAllByText(/^Ответ:$/);
    expect(answerLines.length).toBe(0);
  });

  it("обычный ответ без criteria — как раньше", () => {
    const ws = {
      ...CRITERIA_WORKSHEET,
      tasks: [
        {
          number: 1,
          text: "2+2",
          type: "computation",
          answer: "4",
          points: 1,
        },
      ],
    } as unknown as Worksheet;
    render(<WorksheetPreview worksheet={ws} withAnswers withExplanations={false} />);
    expect(screen.getByText(/4/)).toBeInTheDocument();
  });
});

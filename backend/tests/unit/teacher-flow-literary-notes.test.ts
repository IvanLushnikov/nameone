/**
 * teacher-flow п.6: чужие «Любитель-садовод» / «Слон и Моська» из notes.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeSlideNotes,
  normalizePresentation,
} from "../../src/llm/prompts/presentation-gen";

describe("teacher-flow · literary notes", () => {
  it("вырезает чужой пример из notes, если его нет на слайде", () => {
    const notes = sanitizeSlideNotes(
      "Расскажите басню «Слон и Моська» и сравните с темой",
      "Тема урока\nСвойства дробей",
    );
    expect(notes).toBeDefined();
    expect(notes!).not.toContain("Слон и Моська");
    expect(notes!).not.toContain("Любопытный");
  });

  it("оставляет пример, если он есть на слайде", () => {
    const notes = sanitizeSlideNotes(
      "Разберите «Любитель-садовод»",
      "Любитель-садовод\nРазбор стихотворения",
    );
    expect(notes).toContain("Любитель-садовод");
  });

  it("normalizePresentation чистит notes", () => {
    const p = normalizePresentation(
      {
        title: "Презентация",
        subject: "literature",
        grade: 6,
        topic: "Басни",
        slideCount: 5,
        theme: "school",
        slides: [
          {
            kind: "title",
            title: "Басни Крылова",
            bullets: ["Тема урока"],
            notes: "Вспомните «Слон и Моська»",
          },
          {
            kind: "bullets",
            title: "План",
            bullets: ["Мораль", "Образы"],
          },
          {
            kind: "bullets",
            title: "Разбор",
            bullets: ["Сравнение"],
          },
          {
            kind: "bullets",
            title: "Практика",
            bullets: ["Задание"],
          },
          {
            kind: "summary",
            title: "Итог",
            bullets: ["Вывод"],
          },
        ],
      },
      {
        subject: "literature",
        grade: 6,
        topic: "Басни",
        count: 10,
        type: "presentation",
        difficulty: "medium",
        withAnswers: true,
        withExplanations: false,
        slideCount: 5,
      },
    );
    expect(p.slides[0]?.notes ?? "").not.toContain("Слон и Моська");
  });
});

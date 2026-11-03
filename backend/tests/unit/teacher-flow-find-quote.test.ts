/**
 * teacher-flow п.3: найдите + ёлочки + пустой answer → выпадает.
 * Эталон из критерия не дописывается.
 */
import { describe, it, expect } from "vitest";
import {
  filterTasks,
  looksLikeFindQuoteTask,
  shouldDropFindQuoteEmptyAnswer,
} from "../../src/llm/validation/quality-filter";

describe("teacher-flow · find+ёлочки empty answer", () => {
  it("распознаёт «найдите» с фразой в ёлочках", () => {
    expect(looksLikeFindQuoteTask('Найдите в тексте «хлор»')).toBe(true);
    expect(looksLikeFindQuoteTask("Подчеркните «морфему» в слове")).toBe(true);
    expect(looksLikeFindQuoteTask("Сколько будет 2+2?")).toBe(false);
  });

  it("выкидывает задание с пустым answer", () => {
    const { tasks, report } = filterTasks(
      [
        {
          number: 1,
          text: "Найдите в тексте фразу «вечный двигатель»",
          answer: null,
          type: "short-answer",
        },
        {
          number: 2,
          text: "Сколько будет 3+5?",
          answer: "8",
          type: "short-answer",
        },
      ],
      "russian",
      { requireAnswer: false },
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.text).toContain("3+5");
    expect(report.droppedNoAnswer).toContain(1);
  });

  it("не дописывает эталон из criteria в answer — задание выпадает среди других", () => {
    const bad = {
      number: 1,
      text: "Выпишите «корень» из слова",
      answer: null,
      criteria: ["верно выделен корень"],
      type: "short-answer",
    };
    expect(shouldDropFindQuoteEmptyAnswer(bad)).toBe(true);
    // Рядом держим нормальные задания, иначе защита от пустого листа откатит всё.
    const { tasks } = filterTasks(
      [
        bad,
        { number: 2, text: "Назовите часть речи", answer: "существительное", type: "short-answer" },
        { number: 3, text: "Подберите синоним", answer: "дом — жилище", type: "short-answer" },
      ],
      "russian",
      { requireAnswer: false },
    );
    expect(tasks.every((t) => t.number !== 1)).toBe(true);
    expect(tasks.some((t) => typeof t.answer === "string" && t.answer.includes("корень"))).toBe(
      false,
    );
  });
});


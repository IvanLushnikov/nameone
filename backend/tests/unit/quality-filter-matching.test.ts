/**
 * ТЗ-70 / T-2: matching без правой колонки (меток а/б/в) режется фильтром.
 */

import { describe, it, expect } from "vitest";
import { buildTaskTypesPromptBlock } from "../../../src/lib/content/task-types";
import {
  checkTaskTypeRequirements,
  filterTasks,
  looksLikeLetterCountingTask,
} from "../../src/llm/validation/quality-filter";

/** W2 з.3 — нерешаемое matching: ответ с буквами, меток в text/items нет. */
const W2_MATCHING_BAD = {
  number: 3,
  type: "matching",
  text: "Установите соответствие между органоидом и функцией.",
  items: ["1) ядро", "2) митохондрия", "3) клеточная стенка"],
  answer: "1-в, 2-б, 3-а",
  points: 2,
};

/** Корректное matching: метки левой колонки в text. */
const MATCHING_GOOD = {
  number: 1,
  type: "matching",
  text: "Соотнесите: а) хранит ДНК б) синтез белка в) клеточная стенка растений",
  items: ["1) ядро", "2) рибосома", "3) клеточная стенка"],
  answer: "1-а, 2-б, 3-в",
  points: 2,
};

describe("ТЗ-70: matching с двумя колонками", () => {
  it("matching без меток а/б/в при ответе 1-в → matching-without-right-column", () => {
    expect(checkTaskTypeRequirements(W2_MATCHING_BAD)).toBe("matching-without-right-column");
  });

  it("matching с метками в text и ответом 1-а → проходит", () => {
    expect(checkTaskTypeRequirements(MATCHING_GOOD)).toBeNull();
  });

  it("filterTasks выкидывает плохое matching в droppedTypeMismatch", () => {
    const ok = {
      number: 1,
      type: "computation",
      text: "2+2",
      answer: "4",
      points: 1,
    };
    const { tasks, report } = filterTasks([ok, W2_MATCHING_BAD], "biology");
    expect(tasks).toHaveLength(1);
    expect(report.droppedTypeMismatch).toEqual([2]);
  });

  it("промпт-блок matching требует метки а/б/в в тексте", () => {
    const block = buildTaskTypesPromptBlock("biology", 5, 10);
    expect(block).toMatch(/matching/);
    expect(block).toMatch(/метк/i);
  });
});

describe("ТЗ-72: подсчёт букв вне уроков языка", () => {
  const letterCountTask = {
    number: 11,
    type: "short-answer",
    text: "Сколько букв «о» в слове «хлоропласт»?",
    answer: "2",
    points: 1,
  };

  it("looksLikeLetterCountingTask ловит формулировку W2 з.11", () => {
    expect(looksLikeLetterCountingTask(letterCountTask.text)).toBe(true);
  });

  it("filterTasks режет задание на biology", () => {
    const filler = {
      number: 1,
      type: "computation",
      text: "2+2",
      answer: "4",
      points: 1,
    };
    const { tasks, report } = filterTasks(
      [filler, filler, filler, filler, filler, letterCountTask],
      "biology",
    );
    expect(tasks).toHaveLength(5);
    expect(report.droppedForeignMath).toEqual([6]);
    expect(tasks.some((t) => t.text === letterCountTask.text)).toBe(false);
  });

  it("filterTasks не режет то же на russian", () => {
    const { tasks } = filterTasks([letterCountTask], "russian");
    expect(tasks).toHaveLength(1);
  });
});

/**
 * Unit-тесты для проверки ответов экзамена (services/exam.ts).
 *
 * Локальная детерминированная проверка — без LLM.
 */

import { describe, it, expect } from "vitest";
import { checkExamAnswers } from "../../src/services/exam";
import type { ExamProblem } from "../../src/types";

describe("checkExamAnswers", () => {
  const problems: ExamProblem[] = [
    { number: 1, part: 1, text: "2+2", type: "short-answer", answer: "4", explanation: "", points: 1 },
    { number: 2, part: 1, text: "5*5", type: "short-answer", answer: "25", explanation: "", points: 1 },
    { number: 3, part: 1, text: "x²=4", type: "short-answer", answer: "±2", explanation: "", points: 2 },
    { number: 4, part: 1, text: "color?", type: "choice", answer: "B", explanation: "", options: ["A","B","C","D"], points: 1 },
  ];

  it("all correct → score = maxScore", () => {
    const r = checkExamAnswers({ problems, answers: { 1: "4", 2: "25", 3: "±2", 4: "B" } });
    expect(r.score).toBe(5);
    expect(r.maxScore).toBe(5);
    expect(r.perProblem.every((p) => p.correct)).toBe(true);
  });

  it("all wrong → score = 0", () => {
    const r = checkExamAnswers({ problems, answers: { 1: "5", 2: "10", 3: "x", 4: "A" } });
    expect(r.score).toBe(0);
    expect(r.perProblem.every((p) => !p.correct)).toBe(true);
  });

  it("partial: 2 of 4 correct → score = 2", () => {
    const r = checkExamAnswers({ problems, answers: { 1: "4", 2: "10", 3: "5", 4: "B" } });
    expect(r.score).toBe(2);
    expect(r.perProblem[0]?.correct).toBe(true);
    expect(r.perProblem[3]?.correct).toBe(true);
  });

  it("missing answers treated as wrong", () => {
    const r = checkExamAnswers({ problems, answers: {} });
    expect(r.score).toBe(0);
    expect(r.perProblem.every((p) => !p.correct)).toBe(true);
  });

  it("numeric tolerance: 2.0 vs 2 → correct", () => {
    const r = checkExamAnswers({
      problems: [
        { number: 1, part: 1, text: "?", type: "short-answer", answer: "2", explanation: "", points: 1 },
      ],
      answers: { 1: "2.0" },
    });
    expect(r.score).toBe(1);
  });

  it("comma vs dot: 2,5 vs 2.5 → correct", () => {
    const r = checkExamAnswers({
      problems: [
        { number: 1, part: 1, text: "?", type: "short-answer", answer: "2,5", explanation: "", points: 1 },
      ],
      answers: { 1: "2.5" },
    });
    expect(r.score).toBe(1);
  });

  it("case insensitive: B vs b → correct", () => {
    const r = checkExamAnswers({
      problems: [
        { number: 1, part: 1, text: "?", type: "choice", answer: "B", explanation: "", options: ["A","B"], points: 1 },
      ],
      answers: { 1: "b" },
    });
    expect(r.score).toBe(1);
  });

  it("punctuation stripped", () => {
    const r = checkExamAnswers({
      problems: [
        { number: 1, part: 1, text: "?", type: "short-answer", answer: "Paris", explanation: "", points: 1 },
      ],
      answers: { 1: "Paris." },
    });
    expect(r.score).toBe(1);
  });

  it("feedback содержит правильный ответ если wrong", () => {
    const r = checkExamAnswers({ problems, answers: { 1: "5" } });
    expect(r.perProblem[0]?.feedback).toContain("4");
  });
});

/**
 * teacher-flow п.4: «только подписать» с 7 класса не отдаётся.
 */
import { describe, it, expect } from "vitest";
import {
  isSignOnlyPractice,
  normalizeLessonPlan,
} from "../../src/llm/prompts/lesson-plan-gen";

const baseStages = [
  {
    kind: "org-moment",
    title: "Оргмомент",
    durationMin: 5,
    teacherActions: "Проверяет готовность",
    studentActions: "Готовят тетради",
  },
  {
    kind: "practice",
    title: "только подписать",
    durationMin: 15,
    teacherActions: "только подписать",
    studentActions: "только подписать",
  },
  {
    kind: "homework",
    title: "Домашнее",
    durationMin: 5,
    teacherActions: "Задаёт упражнение",
    studentActions: "Записывают",
  },
];

describe("teacher-flow · только подписать", () => {
  it("распознаёт единственную практику «только подписать»", () => {
    expect(isSignOnlyPractice("только подписать")).toBe(true);
    expect(isSignOnlyPractice("Построить и доказать")).toBe(false);
  });

  it("с 7 класса не отдаёт такую практику; текст других стадий не переписывает", () => {
    const plan = normalizeLessonPlan(
      {
        title: "План",
        subject: "geometry",
        grade: 7,
        topic: "Треугольники",
        goals: { educational: ["a"], developmental: [], nurturing: [] },
        equipment: [],
        stages: baseStages,
        homework: { text: "№ 12" },
      },
      { subject: "geometry", grade: 7, topic: "Треугольники", count: 10, difficulty: "medium", withAnswers: true, withExplanations: false },
    );
    expect(plan.stages.some((s) => s.kind === "practice")).toBe(false);
    expect(plan.stages.find((s) => s.kind === "homework")?.teacherActions).toBe(
      "Задаёт упражнение",
    );
  });

  it("до 7 класса практику не выкидывает", () => {
    const plan = normalizeLessonPlan(
      {
        title: "План",
        subject: "math",
        grade: 5,
        topic: "Дроби",
        goals: { educational: ["a"], developmental: [], nurturing: [] },
        equipment: [],
        stages: baseStages,
        homework: { text: "№ 3" },
      },
      { subject: "math", grade: 5, topic: "Дроби", count: 10, difficulty: "medium", withAnswers: true, withExplanations: false },
    );
    expect(plan.stages.some((s) => s.kind === "practice")).toBe(true);
  });
});

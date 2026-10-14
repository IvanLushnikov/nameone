/**
 * ПРОМТ-УРОВЕНЬ СТАДИИ ПЛАНИРОВАНИЯ (ТЗ-26, В-1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ПРОВЕРЯЕМ И ПОЧЕМУ ИМЕННО ПРОМТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Живая проверка стадии (сквозной прогон с настоящей моделью) требует денег на
 * каждом запуске и не годится для обычного `npm test`. Этот тест закрывает
 * договорённость, которую ничего не сломает молча: ЕСЛИ план дошёл до
 * `generateWorksheet`, ТО промпт генерации содержит `PLAN_LIST` и все позиции.
 * Связка «план есть → план в промпте» проверяется здесь, а сквозной путь
 * — живьём.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ИМЕННО ЛАТИНИНСКИЙ МАРКЕР
 * ─────────────────────────────────────────────────────────────────────────────
 * Кириллица в исходниках, перенесённых через шелл, манглится, и проверка
 * молча становится ложной — это случилось и стоило получаса ложных
 * «стадия не работает». Маркер `PLAN_LIST` набран латиницей и потому
 * однозначен. Он же виден в логах.
 */

import { describe, it, expect } from "vitest";

import { buildWorksheetPrompt } from "../../src/llm/prompts/worksheet-gen";
import { buildPlanPrompt, normalizePlan, type PlanItem } from "../../src/llm/prompts/plan-gen";
import type { GenerationRequest } from "../../src/types";

const request = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  subject: "math",
  grade: 5,
  topic: "Обыкновенные дроби",
  difficulty: "medium",
  count: 3,
  type: "worksheet",
  withAnswers: true,
  withExplanations: true,
  ...over,
});

const plan: PlanItem[] = [
  { n: 1, подтема: "Сокращение", навык: "сократить дробь", тип: "решение задачи", сложность: "лёгкая" },
  { n: 2, подтема: "Сравнение", навык: "сравнить дроби", тип: "решение задачи", сложность: "средняя" },
  { n: 3, подтема: "Перевод", навык: "перевести в десятичную", тип: "решение задачи", сложность: "сложная" },
];

describe("ТЗ-26 В-1: план доходит до промпта генерации", () => {
  it("при наличии плана в промпте есть маркер и все позиции", () => {
    const { user } = buildWorksheetPrompt(request(), plan);
    expect(user).toContain("PLAN_LIST");
    for (const item of plan) {
      expect(user).toContain(item.навык);
    }
  });

  it("без плана маркера нет — старый путь не должен ловить чужое", () => {
    const { user } = buildWorksheetPrompt(request());
    expect(user).not.toContain("PLAN_LIST");
  });

  it("пустой план считается отсутствием плана", () => {
    const { user } = buildWorksheetPrompt(request(), []);
    expect(user).not.toContain("PLAN_LIST");
  });
});

describe("ТЗ-26 В-1: план не доверяем модели", () => {
  it("принимаем ровно count позиций и перенумеровываем их", () => {
    const result = normalizePlan({ items: plan }, 3);
    expect(result?.items).toHaveLength(3);
    expect(result?.items.map((i) => i.n)).toEqual([1, 2, 3]);
  });

  it("лишние позиции обрезаются", () => {
    const result = normalizePlan({ items: plan }, 2);
    expect(result?.items).toHaveLength(2);
  });

  it("неполный план отбрасывается целиком — лист без плана лучше плана с дырой", () => {
    const result = normalizePlan({ items: plan.slice(0, 1) }, 3);
    expect(result).toBeNull();
  });

  it("план с повтором навыка и подтемы схлопывается", () => {
    const dupe = { ...plan[0] };
    const result = normalizePlan({ items: [...plan, dupe] }, 3);
    expect(result?.items).toHaveLength(3);
  });

  it("мусор на входе даёт null, а не исключение", () => {
    expect(normalizePlan(null, 3)).toBeNull();
    expect(normalizePlan({}, 3)).toBeNull();
    expect(normalizePlan({ items: "нет" }, 3)).toBeNull();
    expect(normalizePlan({ items: [null, 42, {}] }, 3)).toBeNull();
  });

  it("сложность нормализуется к трём значениям", () => {
    const items = [
      { n: 1, подтема: "a", навык: "x", тип: "", сложность: "очень сложная" },
      { n: 2, подтема: "b", навык: "y", тип: "", сложность: "лёгкая" },
      { n: 3, подтема: "c", навык: "z", тип: "", сложность: "непонятно" },
    ];
    const result = normalizePlan({ items }, 3);
    expect(result?.items.map((i) => i.сложность)).toEqual(["сложная", "лёгкая", "средняя"]);
  });
});

describe("ТЗ-26 В-1: промпт планирования", () => {
  it("просит ровно count позиций и уникальный навык", () => {
    const { system, user } = buildPlanPrompt(request({ count: 7 }));
    expect(system).toContain("РОВНО столько позиций");
    expect(system).toContain("Каждый навык уникален");
    // Навык — это операция, а не инструкция вроде «выбрать правильный ответ».
    expect(system.replace(/\s+/g, " ")).toContain("это инструкция, а не навык");
    expect(user).toContain('"count": 7');
  });
});
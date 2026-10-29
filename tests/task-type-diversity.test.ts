/**
 * ТЗ-33, В1.1 (докрутка): правило разнообразия — числа, а не «половина».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Первая формулировка правила была «не больше половины заданий одного вида».
 * Формулировка неоднозначна: половина — от чего? Модель трактовала её как
 * угодно и выдавала листы, где шесть из восьми заданий были расчётами:
 * формально «не больше половины», по сути тот же однообразный лист.
 *
 * Теперь числа считаются в коде и попадают в промпт дословно. Тест проверяет
 * именно это: в промпте лежат КОНКРЕТНЫЕ числа, и они совпадают с тем, что
 * посчитал код.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧЕГО ТЕСТ НЕ ДЕЛАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Он не проверяет, что модель правильно распределила типы — это проверяется
 * живым прогоном (отчёт ТЗ-33, §3). Тест проверяет, что инструкция в промпте
 * однозначна: модель не должна ничего вычислять и ничего додумывать.
 */

import { describe, it, expect } from "vitest";
import {
  diversityLimits,
  buildTaskTypesPromptBlock,
} from "@/lib/content/task-types";

describe("ТЗ-33: числа разнообразия считаются в коде", () => {
  it("для 12 заданий — не больше 6 одного типа", () => {
    const limits = diversityLimits(12);
    expect(limits.maxSameType).toBe(6);
    expect(limits.minOtherTypes).toBe(6);
    expect(limits.minTypes).toBe(2);
  });

  it("для 5 заданий — не больше 3 одного типа", () => {
    const limits = diversityLimits(5);
    expect(limits.maxSameType).toBe(3);
    expect(limits.minOtherTypes).toBe(2);
  });

  it("округление вверх: при 5 заданиях разрешены 3 расчёта", () => {
    // Округление вниз («не больше 2») запрещало бы нормальный лист из трёх
    // расчётов и двух коротких ответов.
    expect(diversityLimits(5).maxSameType).toBe(3);
    expect(diversityLimits(4).maxSameType).toBe(2);
    expect(diversityLimits(3).maxSameType).toBe(2);
  });

  it("лист из одного задания не требует разнообразия", () => {
    const limits = diversityLimits(1);
    expect(limits.maxSameType).toBe(1);
    expect(limits.minOtherTypes).toBe(0);
    expect(limits.minTypes).toBe(1);
  });

  it("короткий лист (до 3 заданий) не требует двух разных типов", () => {
    // Лист из двух заданий не разнообразишь, и требование «минимум два типа»
    // только мешает модели.
    expect(diversityLimits(2).minTypes).toBe(1);
    expect(diversityLimits(3).minTypes).toBe(1);
    expect(diversityLimits(4).minTypes).toBe(2);
  });

  it("мусорное количество не ломает расчёт", () => {
    expect(diversityLimits(0).maxSameType).toBe(1);
    expect(diversityLimits(-5).maxSameType).toBe(1);
    // Дробное количество округляется ВНИЗ до целого: учитель просит целые
    // задания, а 12.7 — это 12 заданий, и лимит считается от 12, не от 13.
    expect(diversityLimits(12.7).maxSameType).toBe(6);
    expect(diversityLimits(12.7).minOtherTypes).toBe(6);
  });

  it("в промпте лежат конкретные числа, а не слово «половина»", () => {
    const block = buildTaskTypesPromptBlock("math", 5, 12);
    expect(block).toContain("12 заданий");
    expect(block).toContain("Не больше 6 заданий одного типа");
    expect(block).toContain("Остальные 6 заданий");
    expect(block).not.toMatch(/половина/i);
  });

  it("в промпте нет требования разнообразия для листа из одного задания", () => {
    const block = buildTaskTypesPromptBlock("math", 5, 1);
    // Лист из одного задания разнообразить нечем, и требование об этом молчит.
    expect(block).toMatch(/разнообразие/i);
    expect(block).not.toMatch(/Остальные \d/);
    expect(block).not.toMatch(/не меньше \d разных типов/);
  });

  it("склонение правильное: 1 задание, 2 задания, 5 заданий", () => {
    expect(buildTaskTypesPromptBlock("math", 5, 1)).toContain("1 задание.");
    expect(buildTaskTypesPromptBlock("math", 5, 2)).toContain("2 задания");
    expect(buildTaskTypesPromptBlock("math", 5, 5)).toContain("5 заданий");
    expect(buildTaskTypesPromptBlock("math", 5, 11)).toContain("11 заданий");
  });
});

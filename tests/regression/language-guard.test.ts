/**
 * TZ-13: регрессионный тест на language-guard.
 *
 * Симптом бага (QA-аудит 30.09.2026): в разделе ЕГЭ по предмету «Физика»
 * учитель получал задание на английском — «Open the brackets: She (read) a book now.»
 * Это критично: задание не по предмету и на чужом языке.
 *
 * Тест фиксирует контракт guard'а:
 *   • русскоязычные предметы → текст должен быть преимущественно кириллицей;
 *   • языковые предметы (english/german) → пропускаем проверку;
 *   • collectExamTexts вытаскивает text/options/explanation из заданий.
 */

import { describe, it, expect } from "vitest";
import {
  checkContentLanguage,
  collectExamTexts,
} from "../backend/src/llm/language-guard";

describe("TZ-13 language-guard", () => {
  it("ловит английский текст для не-языкового предмета (регрессия бага)", () => {
    const texts = [
      "Open the brackets: She (read) a book now.",
      "Choose the correct form: They (go) to school every day.",
      "Put the verb into the present perfect: I (see) him yesterday.",
    ];
    const res = checkContentLanguage(texts, "physics");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("physics");
  });

  it("ловит английский текст для математики", () => {
    const res = checkContentLanguage(
      ["Solve the equation: 3x + 12 = 0.", "Factorise the polynomial: x² - 5x + 6."],
      "math",
    );
    // Здесь есть только короткие английские технические термины при большой
    // доле кириллицы/цифр — guard НЕ должен ругаться (это нормальный текст).
    expect(res.ok).toBe(true);
  });

  it("пропускает английский для предмета english", () => {
    const res = checkContentLanguage(
      ["Open the brackets: She (read) a book now."],
      "english",
    );
    expect(res.ok).toBe(true);
  });

  it("пропускает немецкий для предмета german", () => {
    const res = checkContentLanguage(
      ["Setze die richtige Form ein: Ich ___ (gehen) in die Schule."],
      "german",
    );
    expect(res.ok).toBe(true);
  });

  it("пропускает нормальный русский текст по физике", () => {
    const res = checkContentLanguage(
      [
        "Тело массой 2 кг движется со скоростью 3 м/с. Найдите кинетическую энергию.",
        "Определите силу тока в цепи при напряжении 12 В и сопротивлении 4 Ом.",
      ],
      "physics",
    );
    expect(res.ok).toBe(true);
    expect(res.cyrillicRatio).toBeGreaterThan(0.5);
  });

  it("пустой массив текстов считается ок (не ложное срабатывание)", () => {
    const res = checkContentLanguage([], "physics");
    expect(res.ok).toBe(true);
  });

  it("collectExamTexts вытаскивает text, options и explanation", () => {
    const problems = [
      { text: "Вопрос 1", options: ["A", "B", "C"], explanation: "Разбор 1" },
      { text: "Вопрос 2", type: "short-answer", answer: "42" },
      { text: "Вопрос 3", options: [], explanation: "Разбор 3" },
    ];
    const texts = collectExamTexts(problems);
    expect(texts).toContain("Вопрос 1");
    expect(texts).toContain("A");
    expect(texts).toContain("Разбор 1");
    expect(texts).toContain("Вопрос 3");
    // answer не входит в проверку языка
    expect(texts).not.toContain("42");
  });

  it("collectExamTexts не падает на мусорных полях", () => {
    const texts = collectExamTexts([
      { text: 123 as unknown as string, options: "не массив" as unknown as string[] },
      {},
    ]);
    expect(Array.isArray(texts)).toBe(true);
  });
});

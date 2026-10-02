/**
 * TZ-13: регрессионный тест на language-guard.
 *
 * Симптом бага (QA-аудит 30.09.2026): в разделе ЕГЭ по предмету «Физика»
 * учитель получал задание на английском — «Open the brackets: She (read) a book now.»
 * Это критично: задание не по предмету и на чужом языке.
 *
 * Тест фиксирует контракт guard'а:
 *   • русскоязычные предметы → текст должен быть преимущественно кириллицей;
 *   • языковые предметы (english/german) → проверка пропускается;
 *   • короткий текст и текст без букв не дают ложного срабатывания;
 *   • findLanguageViolation указывает номер задания и причину отказа.
 *
 * ПРИМЕЧАНИЕ К ИСТОРИИ ФАЙЛА
 * Тест пришёл с сервера в корневых tests/regression/ и импортировал бэковский
 * модуль по пути ../backend/src/... Но корневой tsconfig.json исключает
 * backend/**, поэтому typecheck фронта на таком импорте падал. Тест проверяет
 * код бэка — он переехал в backend/tests/unit/, где и tsconfig, и vitest
 * видят backend/src целиком.
 *
 * Сервер принёс свою версию этого теста на API checkContentLanguage/
 * collectExamTexts (backend/src/llm/language-guard.ts). Та проверяли две
 * реализации одной проверки, поэтому здесь оставлена одна —
 * src/llm/validation/language-guard.ts: она типизована по SubjectSlug,
 * не принимает мусорные поля и покрывает answer.
 *
 * В серверной версии теста был кейс «Solve the equation: 3x + 12 = 0.» с
 * ожиданием ok=true и комментарием «большая доля кириллицы». Кириллицы в этом
 * тексте НОЛЬ: 41 буква, 0 кириллицы, 6 латинских слов. Guard отклонял такой текст
 * правильно, и тест с таким ожиданием не проходил. Ожидание исправлено на честное.
 */

import { describe, it, expect } from "vitest";
import {
  findLanguageViolation,
  letterRatios,
  passesLanguageGuard,
} from "../../src/llm/validation/language-guard";
import type { ExamVariant, SubjectSlug } from "../../src/types";

const problem = (over: Partial<ExamVariant["problems"][number]> = {}) =>
  ({
    number: 1,
    part: 1,
    text: "",
    type: "short-answer",
    ...over,
  }) as ExamVariant["problems"][number];

describe("TZ-13 language-guard", () => {
  it("ловит английский текст для не-языкового предмета (регрессия бага)", () => {
    const text = [
      "Open the brackets: She (read) a book now.",
      "Choose the correct form: They (go) to school every day.",
      "Put the verb into the present perfect: I (see) him yesterday.",
    ].join(" ");
    expect(passesLanguageGuard(text, "physics" as SubjectSlug)).toBe(false);
  });

  it("ловит полностью английское задание по математике", () => {
    // Раньше здесь стояло ожидание «пропустить», с расчётом на кириллицу в тексте.
    // Её в таком задании нет вообще — guard прав, что отклоняет.
    const text = "Solve the equation: 3x + 12 = 0. Factorise the polynomial: x^2 - 5x + 6.";
    expect(passesLanguageGuard(text, "math" as SubjectSlug)).toBe(false);
  });

  it("пропускает английский для предмета english", () => {
    expect(
      passesLanguageGuard("Open the brackets: She (read) a book now.", "english" as SubjectSlug),
    ).toBe(true);
  });

  it("пропускает немецкий для предмета german", () => {
    expect(
      passesLanguageGuard("Setze die richtige Form ein: Ich gehe in die Schule.", "german" as SubjectSlug),
    ).toBe(true);
  });

  it("пропускает нормальный русский текст по физике", () => {
    const text = [
      "Тело массой 2 кг движется со скоростью 3 м/с. Найдите кинетическую энергию.",
      "Определите силу тока в цепи при напряжении 12 В и сопротивлении 4 Ом.",
    ].join(" ");
    expect(passesLanguageGuard(text, "physics" as SubjectSlug)).toBe(true);
  });

  it("пропускает русский текст с единичными латинскими обозначениями", () => {
    // Латиница есть (x, sin, cos), но кириллицы подавляющее большинство —
    // это нормальный математический текст, а не сбой языка.
    const text = "Найдите корни уравнения x^2 = 4, используя формулу дискриминанта D = b^2 - 4ac.";
    expect(passesLanguageGuard(text, "math" as SubjectSlug)).toBe(true);
  });

  it("короткий текст не даёт ложного срабатывания", () => {
    // Меньше 20 букв детектор нестабилен — пропускаем осознанно.
    expect(passesLanguageGuard("Ok", "physics" as SubjectSlug)).toBe(true);
  });

  it("пустой текст и текст без букв считаются ок", () => {
    expect(passesLanguageGuard("", "physics" as SubjectSlug)).toBe(true);
    expect(passesLanguageGuard("12345 = 42", "physics" as SubjectSlug)).toBe(true);
  });

  it("findLanguageViolation указывает номер задания и причину", () => {
    const variant = {
      problems: [
        problem({ number: 1, text: "Определите силу тока в цепи при напряжении 12 В." }),
        problem({ number: 2, text: "Open the brackets: She (read) a book now every single day." }),
      ],
    } as ExamVariant;

    const violation = findLanguageViolation(variant, "physics" as SubjectSlug);
    expect(violation).not.toBeNull();
    expect(violation).toContain("#2");
    expect(violation).toContain("physics");
  });

  it("findLanguageViolation возвращает null на корректном варианте", () => {
    const variant = {
      problems: [
        problem({ number: 1, text: "Найдите кинетическую энергию тела массой 2 кг." }),
        problem({ number: 2, text: "Определите сопротивление проводника по закону Ома.", options: ["4 Ом", "8 Ом"] }),
      ],
    } as ExamVariant;
    expect(findLanguageViolation(variant, "physics" as SubjectSlug)).toBeNull();
  });

  it("не падает на мусорных полях задания", () => {
    const variant = {
      problems: [
        problem({ number: 1, text: 123 as unknown as string, options: "не массив" as unknown as string[] }),
        problem({ number: 2 }),
      ],
    } as ExamVariant;
    expect(() => findLanguageViolation(variant, "physics" as SubjectSlug)).not.toThrow();
  });

  it("letterRatios считает доли по буквам, игнорируя цифры и пунктуацию", () => {
    const { latin, cyrillic, totalLetters } = letterRatios("Найдите x = 2, y = 3.");
    expect(totalLetters).toBeGreaterThan(0);
    expect(cyrillic).toBeGreaterThan(latin);
  });
});

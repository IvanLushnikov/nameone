/**
 * ЗАДАНИЕ БЕЗ ОТВЕТА НЕ ДОХОДИТ ДО ВЫГРУЗКИ (ТЗ-26, Ф-5, гейт Г8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * Дефект из аудита 13.10: в листе по русскому 8 у задания 7 поле `answer` = null,
 * ответ был только в пояснении. В DOCX такое задание остаётся БЕЗ строки
 * ответа — учитель сверяет работу, а в ключе этого задания нет. Хуже всего,
 * что это молча: лист выглядит целым, и дефект обнаруживается при проверке.
 *
 * Раньше фильтр на ответ-заглушку обнулял поле и ОСТАВЛЯЛ задание в листе.
 * Теперь при `requireAnswer` такое задание выкидывается, и на его место
 * дозапрос ставит нормальное.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ТАК ТЩАТЕЛЬНО ПРО `withAnswers = false`
 * ─────────────────────────────────────────────────────────────────────────────
 * Лист БЕЗ ответов — законная просьба учителя: он снял галочку «С ответами».
 * Там `answer: null` у КАЖДОГО задания, и выкидывание съело бы лист целиком.
 * Поэтому выкидывание включается только когда ответы обязательны.
 */

import { describe, it, expect } from "vitest";

import {
  filterTasks,
  hasUsableAnswer,
  type RawTask,
} from "../../src/llm/validation/quality-filter";

const task = (over: Partial<RawTask>): RawTask => ({ text: "Задание", ...over });

/** Ответы обязательны — так учитель просил «С ответами». */
const required = { requireAnswer: true };
/** Ответы не обязательны — учитель снял галочку. */
const optional = { requireAnswer: false };

describe("ТЗ-26 Ф-5: hasUsableAnswer", () => {
  it("годный ответ — любая непустая строка", () => {
    expect(hasUsableAnswer("2/3")).toBe(true);
    expect(hasUsableAnswer("да")).toBe(true);
    expect(hasUsableAnswer("б) синий")).toBe(true);
    expect(hasUsableAnswer("2 1/5")).toBe(true);
  });

  it("негодный ответ — null, пусто, пробелы, заглушка", () => {
    expect(hasUsableAnswer(null)).toBe(false);
    expect(hasUsableAnswer(undefined)).toBe(false);
    expect(hasUsableAnswer("")).toBe(false);
    expect(hasUsableAnswer("   ")).toBe(false);
    expect(hasUsableAnswer(42)).toBe(false);
    expect(hasUsableAnswer("индивидуальный ответ")).toBe(false);
  });
});

describe("ТЗ-26 Ф-5: ответы обязательны — задание без ответа выкидывается", () => {
  it("задание с answer: null не доходит до листа (кейс аудита)", () => {
    const { tasks, report } = filterTasks(
      [
        task({ text: "Первое задание", answer: "12" }),
        task({ text: "Седьмое задание без ответа", answer: null }),
        task({ text: "Восьмое задание", answer: "8" }),
      ],
      "russian",
      required,
    );

    expect(report.droppedNoAnswer).toEqual([2]);
    expect(tasks.map((t) => t.text)).toEqual([
      "Первое задание",
      "Восьмое задание",
    ]);
    // В листе не осталось заданий без ответа — это и есть критерий Г8.
    expect(tasks.every((t) => hasUsableAnswer(t.answer))).toBe(true);
  });

  it("ответ-заглушка тоже выкидывается, а не остаётся с null", () => {
    const { tasks, report } = filterTasks(
      [
        task({ text: "Нормальное", answer: "5" }),
        task({ text: "С заглушкой", answer: "индивидуальный ответ" }),
      ],
      "math",
      required,
    );

    expect(report.droppedNoAnswer).toEqual([2]);
    expect(tasks).toHaveLength(1);
    expect(hasUsableAnswer(tasks[0]?.answer)).toBe(true);
  });

  it("задание с ответом остаётся, отчёт чистый", () => {
    const { tasks, report } = filterTasks(
      [task({ text: "Первое", answer: "3/4" }), task({ text: "Второе", answer: "1/2" })],
      "math",
      required,
    );

    expect(tasks).toHaveLength(2);
    expect(report.droppedNoAnswer).toEqual([]);
    expect(report.after).toBe(2);
  });
});

describe("ТЗ-26 Ф-5: ответы НЕ обязательны — поведение прежнее", () => {
  it("весь лист без ответов остаётся целиком", () => {
    const input = [
      task({ text: "Первое", answer: null }),
      task({ text: "Второе", answer: null }),
      task({ text: "Третье", answer: null }),
    ];
    const { tasks, report } = filterTasks(input, "russian", optional);

    // Это главный страх такой правки: выкинуть лист, который учитель просил
    // без ответов. Так делать нельзя.
    expect(tasks).toHaveLength(3);
    expect(report.droppedNoAnswer).toEqual([]);
  });

  it("опция по умолчанию тоже ничего не выкидывает", () => {
    const { tasks } = filterTasks([task({ answer: null })], "russian");
    expect(tasks).toHaveLength(1);
  });
});

describe("ТЗ-26 Ф-5: отчёт остаётся честным", () => {
  it("before/after отражают реальное число выкинутых", () => {
    const { report } = filterTasks(
      [
        task({ answer: null }),
        task({ answer: "1" }),
        task({ answer: "" }),
      ],
      "math",
      required,
    );

    expect(report.before).toBe(3);
    expect(report.after).toBe(1);
    expect(report.droppedNoAnswer).toEqual([1, 3]);
  });
});
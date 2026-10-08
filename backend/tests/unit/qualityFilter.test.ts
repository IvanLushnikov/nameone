/**
 * Фильтр качества заданий (08.10.2026).
 *
 * Каждый блок теста — это реальная жалоба учительницы, а не абстрактное
 * требование. Если тест нельзя связать с конкретной поломкой, он здесь лишний.
 */

import { describe, it, expect } from "vitest";
import {
  filterTasks,
  hasDanglingPatternRef,
  isPlaceholderAnswer,
  looksLikeForeignMath,
} from "../../src/llm/validation/quality-filter";

describe("ссылка на образец, которого нет", () => {
  it("ловит «выполните по образцу» без образца", () => {
    // Жалоба: 26 заданий «выполните по образцу», образца нет ни в листе,
    // ни в PDF. Ровно этот текст приходил в проде.
    expect(hasDanglingPatternRef("Задание №20 по теме «Природные зоны» — выполните по образцу.")).toBe(true);
    expect(hasDanglingPatternRef("Решите аналогично предыдущему заданию.")).toBe(true);
    expect(hasDanglingPatternRef("Определите такое же отношение, как в примере.")).toBe(true);
  });

  it("отпускает задание, где образец реально есть", () => {
    expect(hasDanglingPatternRef("Образец: 3/4 = 0,75. Выполните по образцу: 1/2 = __")).toBe(false);
    expect(hasDanglingPatternRef("Например, 2 + 3 = 5. Сложите по образцу: 4 + 5 = __")).toBe(false);
    expect(hasDanglingPatternRef("Найдите значение по формуле на полях: a = b / c")).toBe(false);
    expect(hasDanglingPatternRef("Посчитайте значения в таблице выше")).toBe(false);
  });

  it("выкидывает такое задание из листа", () => {
    const tasks = [
      { number: 1, text: "Нормальное задание по теме", answer: "5" },
      { number: 2, text: "Задание по теме — выполните по образцу.", answer: "7" },
      { number: 3, text: "Ещё одно нормальное задание", answer: "9" },
    ];
    const { tasks: out, report } = filterTasks(tasks, "biology");
    expect(out).toHaveLength(2);
    expect(report.droppedPatternRef).toEqual([2]);
    // Номера не перенумеровываются: задание 3 остаётся третьим, чтобы
    // учитель сверял со своим планом урока.
    expect(out[1].number).toBe(3);
  });
});

describe("ответ-заглушка", () => {
  it("узнаёт заглушки вместо ответа", () => {
    // Жалоба: в каждом задании стояло «Ответ: индивидуальный ответ».
    expect(isPlaceholderAnswer("индивидуальный ответ")).toBe(true);
    expect(isPlaceholderAnswer("  Свой ответ. ")).toBe(true);
    expect(isPlaceholderAnswer("зависит от ученика")).toBe(true);
    expect(isPlaceholderAnswer("Нет однозначного ответа")).toBe(true);
  });

  it("не трогает настоящие ответы", () => {
    expect(isPlaceholderAnswer("12")).toBe(false);
    expect(isPlaceholderAnswer("Устная речь")).toBe(false);
    expect(isPlaceholderAnswer("индивидуальный подход к ученику")).toBe(false);
  });

  it("обнуляет ответ, но оставляет само задание", () => {
    const tasks = [{ number: 1, text: "Опишите опыт", answer: "индивидуальный ответ" }];
    const { tasks: out, report } = filterTasks(tasks, "technology");
    expect(out).toHaveLength(1);
    expect(out[0].answer).toBeNull();
    expect(report.cleanedAnswer).toEqual([1]);
  });
});

describe("чужая математика в чужом предмете", () => {
  it("ловит дроби и геометрию в окружающем мире", () => {
    // Жалоба: «Окружающий мир, 4 класс» — задания про берёзы И про алгебру
    // с геометрией. Ровно так это и выглядело.
    expect(
      looksLikeForeignMath(
        "Найдите площадь прямоугольника по формуле и решите уравнение 2x + 5 = 15.",
        "world",
      ),
    ).toBe(true);
    expect(
      looksLikeForeignMath("Выполните теорему Пифагора и найдите синус угла.", "biology"),
    ).toBe(true);
  });

  it("не считает за чужак нормальный количественный вопрос", () => {
    expect(
      looksLikeForeignMath("Сколько видов растений в гербарии: 12 отрядов и 3 семейства?", "biology"),
    ).toBe(false);
  });

  it("не трогает математические предметы", () => {
    expect(looksLikeForeignMath("Решите уравнение 2x + 5 = 15 и постройте график.", "math")).toBe(false);
    expect(looksLikeForeignMath("Найдите площадь треугольника.", "geometry")).toBe(false);
  });

  it("выкидывает задание из листа по биологии", () => {
    const tasks = [
      { number: 1, text: "Опишите строение клетки растения", answer: "клеточная стенка" },
      {
        number: 2,
        text: "Решите систему уравнений и найдите производную функции по биологии.",
        answer: "5",
      },
    ];
    const { tasks: out, report } = filterTasks(tasks, "biology");
    expect(out).toHaveLength(1);
    expect(report.droppedForeignMath).toEqual([2]);
  });
});

describe("фильтр целиком", () => {
  it("на нормальном листе ничего не меняет", () => {
    const tasks = [
      { number: 1, text: "Что такое фотосинтез?", answer: "Образование органических веществ из света" },
      { number: 2, text: "Назовите органоиды клетки.", answer: "митохондрии, рибосомы" },
    ];
    const { tasks: out, report } = filterTasks(tasks, "biology");
    expect(out).toHaveLength(2);
    expect(report.before).toBe(2);
    expect(report.after).toBe(2);
    expect(report.droppedPatternRef).toEqual([]);
    expect(report.droppedForeignMath).toEqual([]);
    expect(report.cleanedAnswer).toEqual([]);
  });

  it("не падает на пустом и битом входе", () => {
    expect(filterTasks([], "math").tasks).toEqual([]);
    // Модель иногда отдаёт null вместо объекта — такое не должно ронять лист.
    const dirty = [null, undefined, { number: 1, text: "Нормально", answer: "1" }] as never[];
    expect(filterTasks(dirty, "math").tasks).toHaveLength(1);
  });
});
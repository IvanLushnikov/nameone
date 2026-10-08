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
    // `noUncheckedIndexedAccess` включён в бэкенде, поэтому индекс даёт
    // `T | undefined` — и это ЛОВИТ `tsc`. Раньше ошибку маскировал vitest:
    // esbuild снимает типы, не проверяя их, и 562 зелёных теста проходили
    // при падающей компиляции.
    expect(out[1]?.number).toBe(3);
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
    expect(out[0]?.answer).toBeNull();
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
  it("НЕ выкидывает задание с ОДНИМ математическим словом (регресс, 08.10.2026)", () => {
    // Найдено независимой проверкой: условие считалось через
    // `text.match(re).length`, а `String.match` без флага `g` возвращает
    // НЕ вхождения, а само совпадение плюс группы захвата. Длина была
    // одинаковой при одном маркере и при двух, порог «2+» не срабатывал
    // НИКОГДА — и фильтр выбрасывал любое задание с ОДНИМ математическим
    // словом по нематематическому предмету.
    //
    // «Площадь треугольника в горах» в географии — нормальное задание.
    expect(
      looksLikeForeignMath("Опишите, как горы меняют облик местности вокруг треугольника долин.", "geography"),
    ).toBe(false);
    expect(
      looksLikeForeignMath("Измерьте площадь прямоугольного участка по схеме и найдите его периметр.", "geography"),
    ).toBe(false);
  });

  it("ловит именно два независимых маркера", () => {
    expect(
      looksLikeForeignMath("Решите уравнение и найдите площадь треугольника по теореме косинусов.", "biology"),
    ).toBe(true);
    // Одно слово «алгебра» — маркер; раньше в списке его не было вовсе.
    expect(looksLikeForeignMath("Выполните задачу по алгебре для этого класса.", "biology")).toBe(true);
  });

  it("узнаёт заглушку с префиксом «Ответ: » (строка из жалобы)", () => {
    expect(isPlaceholderAnswer("Ответ: индивидуальный ответ")).toBe(true);
    expect(isPlaceholderAnswer("Ответ: нет однозначного ответа.")).toBe(true);
    // Настоящий ответ с префиксом остаётся ответом.
    expect(isPlaceholderAnswer("Ответ: 12")).toBe(false);
  });

  it("ловит «по такой же схеме», когда схемы на листе нет", () => {
    // Раньше `LEGIT_REF` содержал `схем[аеы]` как самостоятельную ссылку, и
    // «Оформите ответ по такой же схеме» проходило как разрешённая ссылка —
    // то есть битая ссылка на образец не ловилась.
    expect(hasDanglingPatternRef("Оформите ответ по такой же схеме")).toBe(true);
    // Настоящая ссылка на схему на листе — разрешена.
    expect(hasDanglingPatternRef("Рассмотрите схему на полях и дайте ответ по такой же схеме")).toBe(false);
  });

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

  it("не отдаёт пустой лист, если отфильтровано всё (08.10.2026)", () => {
    // Найдено независимой проверкой. Фильтр умеет выкинуть, но не умеет
    // починить: модель отдала 26 заданий «по образцу» — на выходе ноль, и
    // учитель получает пустой лист при уже списанной попытке.
    //
    // Здесь важно, чтобы решение было ВОЗВРАТОМ исходного набора, а не пустым
    // массивом: «по образцу» без образца хотя бы видно и можно попросить
    // переделать; пустой лист невидим.
    const allBad = Array.from({ length: 10 }, (_, i) => ({
      number: i + 1,
      text: `Задание №${i + 1} по теме «Природные зоны» — выполните по образцу.`,
      answer: "5",
    }));
    const { tasks: out } = filterTasks(allBad, "biology");
    expect(out.length).toBe(allBad.length);

    // То же с чужой математикой.
    const allMath = Array.from({ length: 8 }, (_, i) => ({
      number: i + 1,
      text: `Задание №${i + 1}: решите уравнение и найдите площадь треугольника по теореме косинусов.`,
      answer: "5",
    }));
    expect(filterTasks(allMath, "biology").tasks.length).toBe(allMath.length);
  });

  it("возвращает исходник и при агрессивной фильтрации (осталось меньше трети)", () => {
    // 6 заданий, пережили 1 — это меньше трети, значит фильтр сработал явно
    // агрессивнее, чем должен, и такому результату верить нельзя.
    const mixed = [
      { number: 1, text: "Решите уравнение и найдите площадь треугольника по теореме косинусов.", answer: "5" },
      { number: 2, text: "Решите систему уравнений и найдите производную функции.", answer: "6" },
      { number: 3, text: "Выполните задачу по алгебре для этого класса.", answer: "7" },
      { number: 4, text: "Решите уравнение и вычислите объём шара по формуле.", answer: "8" },
      { number: 5, text: "Найдите интеграл и площадь треугольника по теореме косинусов.", answer: "9" },
      { number: 6, text: "Опишите строение клетки растения.", answer: "мембрана" },
    ];
    const { tasks: out } = filterTasks(mixed, "biology");
    expect(out.length).toBe(mixed.length);
  });

  it("нормальный лист фильтрует как обычно, без отката", () => {
    const tasks = [
      { number: 1, text: "Опишите строение клетки растения", answer: "клеточная стенка" },
      { number: 2, text: "Назовите органоиды клетки.", answer: "митохондрии, рибосомы" },
      { number: 3, text: "Решите уравнение и найдите площадь треугольника по теореме косинусов.", answer: "5" },
      { number: 4, text: "Объясните фотосинтез.", answer: "образование глюкозы из воды и CO2" },
    ];
    const { tasks: out, report } = filterTasks(tasks, "biology");
    // 3 из 4 осталось — больше трети, отката нет, третье выкинуто.
    expect(out).toHaveLength(3);
    expect(report.droppedForeignMath).toEqual([3]);
  });

  it("не падает на пустом и битом входе", () => {
    expect(filterTasks([], "math").tasks).toEqual([]);
    // Модель иногда отдаёт null вместо объекта — такое не должно ронять лист.
    const dirty = [null, undefined, { number: 1, text: "Нормально", answer: "1" }] as never[];
    expect(filterTasks(dirty, "math").tasks).toHaveLength(1);
  });
});
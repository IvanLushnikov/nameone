/**
 * ТЗ-34: критерии оценивания — шкала отметок, стоп-лист, веса из реестра.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Три вещи, которые ТЗ-34 запрещает делать «где попало»:
 *
 *   1. ОТМЕТКИ СЧИТАЕТ КОД, а не модель. Пороги 85/70/50/0 живут в одном
 *      месте (`src/lib/content/grading.ts`). Если их размазать по API, печати и
 *      тестам, через месяц у одного учителя будет «5 за 80 %», у другого —
 *      «5 за 90 %», и доверие к отметке пропадёт.
 *   2. КРИТЕРИЙ ДОЛЖЕН БЫТЬ КОНКРЕТНЫМ. «Ответ неполный» — это не критерий,
 *      это способ занять строку. Такие формулировки сервер отбрасывает.
 *   3. БАЛЛ ЗА ЗАДАНИЕ — ИЗ РЕЕСТРА ТИПОВ, а не из модельного поля `points`.
 *      Модель ставит «2 балла» кому как вздумается; вес — свойство ФОРМЫ
 *      задания, и форма описана в реестре.
 *
 * Тест на старом коде падает: модуля `src/lib/content/grading.ts` не
 * существует, а в реестре типов нет поля `weight`.
 */

import { describe, it, expect } from "vitest";
import {
  MARK_THRESHOLDS,
  MIN_CRITERION_LENGTH,
  GENERIC_CRITERION_PHRASES,
  markForPercent,
  marksScale,
  isConcreteCriterion,
  maxPointsForTaskType,
  taskMaxPoints,
  readModelEvaluation,
  buildEvaluationPart,
} from "@/lib/content/grading";
import { TASK_TYPE_REGISTRY, getTaskTypeSpec } from "@/lib/content/task-types";

describe("ТЗ-34: шкала отметок 5/4/3/2 считается кодом", () => {
  it("пороги живут в одном месте и равны 85/70/50/0", () => {
    expect(MARK_THRESHOLDS).toEqual([
      { mark: 5, minPercent: 85 },
      { mark: 4, minPercent: 70 },
      { mark: 3, minPercent: 50 },
      { mark: 2, minPercent: 0 },
    ]);
  });

  it("отметка по проценту: границы ровно на порогах", () => {
    expect(markForPercent(100)).toBe(5);
    expect(markForPercent(85)).toBe(5);
    expect(markForPercent(84.9)).toBe(4);
    expect(markForPercent(70)).toBe(4);
    expect(markForPercent(69.9)).toBe(3);
    expect(markForPercent(50)).toBe(3);
    expect(markForPercent(49.9)).toBe(2);
    expect(markForPercent(0)).toBe(2);
  });

  it("процент вне [0..100] даёт нижнюю отметку, а не выброс", () => {
    expect(markForPercent(-5)).toBe(2);
    expect(markForPercent(140)).toBe(2);
    expect(markForPercent(Number.NaN)).toBe(2);
  });

  it("шкала для печати и API: четыре записи 5/4/3/2 с диапазонами", () => {
    const scale = marksScale();
    expect(scale).toHaveLength(4);
    expect(scale.map((s) => s.mark)).toEqual([5, 4, 3, 2]);
    expect(scale.map((s) => s.fromPercent)).toEqual([85, 70, 50, 0]);
    expect(scale.map((s) => s.toPercent)).toEqual([100, 84, 69, 49]);
  });

  it("шкала без пропусков: конец диапазона +1 = начало следующего", () => {
    const scale = marksScale();
    // Шкала упорядочена ОТ ВЫСШЕЙ отметки к низшей, поэтому диапазон каждой
    // отметки примыкает к диапазону следующей (более высокой) отметки.
    for (let i = 1; i < scale.length; i += 1) {
      const cur = scale[i];
      const higher = scale[i - 1];
      expect(cur?.toPercent + 1, `разрыв между ${higher?.mark} и ${cur?.mark}`).toBe(
        higher?.fromPercent,
      );
    }
  });
});

describe("ТЗ-34: критерий должен быть конкретным", () => {
  it("стоп-лист — данные, а не ветки в коде", () => {
    expect(Array.isArray(GENERIC_CRITERION_PHRASES)).toBe(true);
    expect(GENERIC_CRITERION_PHRASES.length).toBeGreaterThan(5);
    // Пополнять список можно, не трогая логику.
    expect(GENERIC_CRITERION_PHRASES).toContain("ответ неполный");
    expect(GENERIC_CRITERION_PHRASES).toContain("работа выполнена");
  });

  it("критерий короче 15 символов — не критерий", () => {
    expect(MIN_CRITERION_LENGTH).toBe(15);
    expect(isConcreteCriterion("Коротко")).toBe(false);
    expect(isConcreteCriterion("Ответ неполный")).toBe(false);
    expect(isConcreteCriterion("   ")).toBe(false);
    expect(isConcreteCriterion("")).toBe(false);
    expect(isConcreteCriterion(null)).toBe(false);
    expect(isConcreteCriterion(42)).toBe(false);
  });

  it("общие формулировки из стоп-листа отбрасываются", () => {
    for (const phrase of ["Ответ неполный", "Ответ неверный", "Бывают ошибки", "Работа выполнена"]) {
      expect(isConcreteCriterion(phrase), phrase).toBe(false);
    }
  });

  it("конкретный критерий длиной ≥ 15 символов проходит", () => {
    expect(isConcreteCriterion("Называет определение и приводит пример")).toBe(true);
    expect(
      isConcreteCriterion("Путает числитель и знаменатель при сокращении дроби"),
    ).toBe(true);
    expect(isConcreteCriterion("Верно определяет признаки прямоугольного треугольника")).toBe(
      true,
    );
  });

  it("слово «правильно» внутри конкретного критерия не выкидывает его", () => {
    // Стоп-лист ловит ОБЩУЮ формулировку, а не любое слово из неё: «правильно
    // называет числитель» — рабочий критерий, выкидывать его нельзя.
    expect(isConcreteCriterion("Правильно называет числитель при сокращении")).toBe(true);
  });
});

describe("ТЗ-34: вес задания берётся из реестра типов", () => {
  it("у каждого типа из реестра есть вес", () => {
    for (const spec of TASK_TYPE_REGISTRY) {
      expect(typeof spec.weight, `нет веса у ${spec.id}`).toBe("number");
      expect(spec.weight, `вес вне диапазона у ${spec.id}`).toBeGreaterThan(0);
    }
  });

  it("вес зависит от вида ответа, а не от конкретного задания", () => {
    expect(getTaskTypeSpec("computation")?.weight).toBe(2); // exact
    expect(getTaskTypeSpec("fill-blank")?.weight).toBe(2); // exact
    expect(getTaskTypeSpec("multiple-choice")?.weight).toBe(1); // choice
    expect(getTaskTypeSpec("multi-answer")?.weight).toBe(1); // choice
    expect(getTaskTypeSpec("short-answer")?.weight).toBe(2); // text
    expect(getTaskTypeSpec("error-fixing")?.weight).toBe(2); // text
    expect(getTaskTypeSpec("essay")?.weight).toBe(3); // criteria
    expect(getTaskTypeSpec("open-ended")?.weight).toBe(3); // criteria
    expect(getTaskTypeSpec("practical")?.weight).toBe(3); // criteria
    expect(getTaskTypeSpec("source-analysis")?.weight).toBe(3); // criteria
    expect(getTaskTypeSpec("matching")?.weight).toBe(2); // order
    expect(getTaskTypeSpec("sequence")?.weight).toBe(2); // order
    expect(getTaskTypeSpec("classification")?.weight).toBe(2); // order
  });

  it("вес задания НЕ берётся из модельного поля `points`", () => {
    // Два задания разных типов с разными `points` от модели получают вес из
    // реестра: модель не решает, сколько стоит задание.
    expect(maxPointsForTaskType("computation")).toBe(2);
    expect(maxPointsForTaskType("multiple-choice")).toBe(1);
    expect(taskMaxPoints({ type: "computation", points: 3 })).toBe(2);
    expect(taskMaxPoints({ type: "multiple-choice", points: 3 })).toBe(1);
  });

  it("у неизвестного типа вес не выдумывается из воздуха", () => {
    // Типа нет в реестре — веса нет. Ответ по умолчанию одинаков для всех
    // таких заданий, и это видно в коде, а не спрятано в формуле.
    expect(maxPointsForTaskType("diagram")).toBe(maxPointsForTaskType("qqq"));
    expect(taskMaxPoints({})).toBe(maxPointsForTaskType("qqq"));
  });
});

describe("ТЗ-34: блок evaluation собирается из заданий", () => {
  const TASKS = [
    { number: 1, type: "computation", points: 3, answer: "12", criteria: null },
    {
      number: 2,
      type: "essay",
      points: 1,
      answer: null,
      criteria: ["Называет определение и приводит пример", "Связывает с понятием урока"],
    },
    { number: 3, type: "multiple-choice", points: 3, answer: "б", criteria: null },
  ];

  it("критерии берутся из задания, максимальный балл — из реестра", () => {
    const part = buildEvaluationPart({
      variant: 1,
      title: "Вариант 1",
      tasks: TASKS,
      model: {
        typicalMistakes: ["Путает числитель и знаменатель при сокращении дроби"],
        recommendation: "Разобрать на доске перевод смешанного числа в неправильную дробь.",
      },
    });

    expect(part.criteria).toHaveLength(1);
    expect(part.criteria[0]?.number).toBe(2);
    expect(part.criteria[0]?.criteria).toEqual([
      "Называет определение и приводит пример",
      "Связывает с понятием урока",
    ]);
    // Essay весит 3 по реестру — модель просила 1 балл, это её мнение, а не правило.
    expect(part.criteria[0]?.maxPoints).toBe(3);
  });

  it("сумма максимальных баллов — по всем заданиям работы", () => {
    const part = buildEvaluationPart({ variant: 1, title: "Лист", tasks: TASKS });
    // computation 2 + essay 3 + multiple-choice 1
    expect(part.totalMaxPoints).toBe(6);
  });

  it("шкала отметок едет вместе с блоком", () => {
    const part = buildEvaluationPart({ variant: 1, title: "Лист", tasks: TASKS });
    expect(part.marks).toEqual(marksScale());
  });

  it("типичные ошибки и рекомендация приходят от модели и чистятся", () => {
    const part = buildEvaluationPart({
      variant: 1,
      title: "Лист",
      tasks: TASKS,
      model: {
        typicalMistakes: ["бывают ошибки", "Путает числитель и знаменатель при сокращении"],
        recommendation: "Ответ неполный",
      },
    });
    expect(part.typicalMistakes).toEqual([
      "Путает числитель и знаменатель при сокращении",
    ]);
    expect(part.recommendation).toBeNull();
  });

  it("пустые и общие критерии в задании не попадают в блок", () => {
    const part = buildEvaluationPart({
      variant: 1,
      title: "Лист",
      tasks: [
        { number: 1, type: "essay", criteria: ["Ответ неполный", "  ", "Называет понятие и даёт пример"] },
      ],
    });
    expect(part.criteria[0]?.criteria).toEqual(["Называет понятие и даёт пример"]);
  });

  it("задание без критериев в блок не попадает", () => {
    const part = buildEvaluationPart({
      variant: 1,
      title: "Лист",
      tasks: [{ number: 1, type: "computation", criteria: null }],
    });
    expect(part.criteria).toHaveLength(0);
    // Максимальный балл при этом остаётся — он нужен для отметки.
    expect(part.totalMaxPoints).toBe(2);
  });

  it("модельный блок без типичных ошибок и рекомендации не ломает сборку", () => {
    const part = buildEvaluationPart({
      variant: 1,
      title: "Лист",
      tasks: TASKS,
      model: { typicalMistakes: [], recommendation: "" },
    });
    expect(part.typicalMistakes).toEqual([]);
    expect(part.recommendation).toBeNull();
  });

  it("ответ модели читается осторожно: мусор не становится данными", () => {
    expect(readModelEvaluation(null)).toEqual({ typicalMistakes: [], recommendation: null });
    expect(readModelEvaluation({ typicalMistakes: "не массив", recommendation: 42 })).toEqual({
      typicalMistakes: [],
      recommendation: null,
    });
  });
});

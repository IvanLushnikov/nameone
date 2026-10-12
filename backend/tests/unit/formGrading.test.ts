/**
 * Unit-тесты автосверки форм (TZ-12, Решение 1).
 *
 * Модуль `src/services/formGrading.ts` чистый — ни D1, ни HTTP. Здесь
 * проверяем ровно то, на чём держится доверие учителя к автосверке:
 *
 *   1. computation: запятая как десятичный разделитель (русский ввод с телефона)
 *   2. computation: единицы измерения («12 руб» == «12»)
 *   3. computation: допуск 1e-6 (0.1+0.2 == 0.3)
 *   4. multiple-choice: сравнение индекса + «не выбрал» → unreviewed
 *   5. fill-blank: разбиение эталона, частичное совпадение → needs_review
 *   6. «не смогли решить» → needs_review, 0 баллов, is_correct = null
 *   7. short-answer → сверяется сам (12.10.2026, точное совпадение), essay → manual
 *
 * Запуск: `npm run test` или `npx vitest run tests/unit/formGrading.test.ts`
 */

import { describe, it, expect } from "vitest";
import { gradeAnswer, gradeSubmission, detectCheckMode } from "../../src/services/formGrading";
import type { WorksheetTask } from "../../src/types";

/** Задание-заготовка: меняем только type/answer/points. */
function task(over: Partial<WorksheetTask> & { type: WorksheetTask["type"] }): WorksheetTask {
  return {
    number: 1,
    text: "Задание",
    points: 2,
    ...over,
  };
}

describe("gradeAnswer · computation", () => {
  it("запятая как десятичный разделитель: «3,75» == «3.75»", () => {
    const v = gradeAnswer(task({ type: "computation", answer: "3.75" }), "3,75");
    expect(v.isCorrect).toBe(true);
    expect(v.pointsAwarded).toBe(2);
    expect(v.needsReview).toBe(false);
    expect(v.checkMethod).toBe("auto");
  });

  it("единицы измерения вырезаются: «12 руб» == «12»", () => {
    const v = gradeAnswer(task({ type: "computation", answer: "12" }), "12 руб");
    expect(v.isCorrect).toBe(true);
    expect(v.pointsAwarded).toBe(2);
  });

  it("единицы измерения с точкой и без пробела: «5км» == «5»", () => {
    expect(gradeAnswer(task({ type: "computation", answer: "5" }), "5км").isCorrect).toBe(true);
    expect(gradeAnswer(task({ type: "computation", answer: "5" }), "5 км").isCorrect).toBe(true);
    expect(gradeAnswer(task({ type: "computation", answer: "100" }), "100%").isCorrect).toBe(true);
  });

  it("неразрывный пробел с телефона не ломает разбор", () => {
    // \u00a0 — неразрывный пробел, \u202f — узкий: прилетают с мобильной клавиатуры.
    expect(gradeAnswer(task({ type: "computation", answer: "42" }), "4\u00a02").isCorrect).toBe(true);
    expect(gradeAnswer(task({ type: "computation", answer: "42" }), "4\u202f2").isCorrect).toBe(true);
  });

  it("допуск 1e-6: числа внутри допуска верны, за его пределами — нет", () => {
    // Разница 1e-9 — внутри допуска.
    expect(gradeAnswer(task({ type: "computation", answer: "0.300000001" }), "0.3").isCorrect).toBe(true);
    // Разница 1e-7 — тоже внутри 1e-6.
    expect(gradeAnswer(task({ type: "computation", answer: "0.3" }), "0.3000001").isCorrect).toBe(true);
    // Разница 1e-4 — уже за пределами допуска.
    expect(gradeAnswer(task({ type: "computation", answer: "0.3" }), "0.3001").isCorrect).toBe(false);
  });

  it("арифметическое выражение ученика против числа-эталона → needs_review", () => {
    // Эталон «0.3» — число, а «0.1 + 0.2» не парсится. Сравнивать не с чем:
    // не гадаем, отдаём учителю (это и есть ветка 3 ТЗ).
    const v = gradeAnswer(task({ type: "computation", answer: "0.3" }), "0.1 + 0.2");
    expect(v.isCorrect).toBeNull();
    expect(v.needsReview).toBe(true);
  });

  it("оба значения — выражения → точное строковое сравнение", () => {
    const v = gradeAnswer(task({ type: "computation", answer: "2+2" }), "2+2");
    expect(v.isCorrect).toBe(true);
    expect(v.needsReview).toBe(false);
  });

  it("неверный ответ — это false, а не «не смогли решить»", () => {
    const v = gradeAnswer(task({ type: "computation", answer: "4" }), "5");
    expect(v.isCorrect).toBe(false);
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(false);
  });

  it("пустой ответ при непустом эталоне — неверно (ученик не ответил)", () => {
    const v = gradeAnswer(task({ type: "computation", answer: "4" }), "");
    expect(v.isCorrect).toBe(false);
    expect(v.needsReview).toBe(false);
  });

  it("НЕ РЕШИЛИ: число против текста → needs_review, 0 баллов, is_correct = null", () => {
    const v = gradeAnswer(task({ type: "computation", answer: "12" }), "двенадцать");
    expect(v.isCorrect).toBeNull();
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(true);
    expect(v.reason).toBeTruthy();
  });

  it("НЕ РЕШИЛИ: пустой эталон → needs_review", () => {
    const v = gradeAnswer(task({ type: "computation", answer: "" }), "5");
    expect(v.isCorrect).toBeNull();
    expect(v.needsReview).toBe(true);
    expect(v.pointsAwarded).toBe(0);
  });

  it("оба значения — не числа → точное строковое сравнение", () => {
    expect(gradeAnswer(task({ type: "computation", answer: "нет" }), "нет").isCorrect).toBe(true);
    expect(gradeAnswer(task({ type: "computation", answer: "нет" }), "да").isCorrect).toBe(false);
  });
});

describe("gradeAnswer · multiple-choice", () => {
  it("совпал индекс варианта → верно, ровно 1 балл", () => {
    const v = gradeAnswer(
      task({ type: "multiple-choice", answer: "2", points: 5 }),
      "2",
    );
    expect(v.isCorrect).toBe(true);
    expect(v.pointsAwarded).toBe(1);
    expect(v.needsReview).toBe(false);
  });

  it("не совпал индекс → неверно, без needsReview", () => {
    const v = gradeAnswer(task({ type: "multiple-choice", answer: "2" }), "0");
    expect(v.isCorrect).toBe(false);
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(false);
  });

  it("НЕ РЕШИЛИ: вариант не выбран → unreviewed (как в ТЗ)", () => {
    for (const empty of ["", null, undefined]) {
      const v = gradeAnswer(task({ type: "multiple-choice", answer: "1" }), empty);
      expect(v.isCorrect).toBeNull();
      expect(v.needsReview).toBe(true);
      expect(v.pointsAwarded).toBe(0);
    }
  });

  it("НЕ РЕШИЛИ: нечитаемый индекс → unreviewed", () => {
    const v = gradeAnswer(task({ type: "multiple-choice", answer: "1" }), "непонятно");
    expect(v.isCorrect).toBeNull();
    expect(v.needsReview).toBe(true);
  });
});

describe("gradeAnswer · fill-blank", () => {
  it("все части совпали (эталон через запятую) → верно", () => {
    const v = gradeAnswer(
      task({ type: "fill-blank", answer: "3, 5, 7", points: 3 }),
      ["3", "5", "7"],
    );
    expect(v.isCorrect).toBe(true);
    expect(v.pointsAwarded).toBe(3);
  });

  it("порядок частей не важен — сравниваем множества", () => {
    // Фронт (этап 3) отдаёт набор полей массивом в любом порядке.
    expect(gradeAnswer(task({ type: "fill-blank", answer: "3; 5; 7" }), ["7", "5", "3"]).isCorrect).toBe(true);
    // И строкой через точку с запятой.
    expect(gradeAnswer(task({ type: "fill-blank", answer: "3; 5; 7" }), "7;5;3").isCorrect).toBe(true);
  });

  it("эталон-десятичная дробь «3,5» НЕ делится на части", () => {
    // Регрессия: тупое деление по запятой превратило бы 3,5 в два задания.
    const v = gradeAnswer(task({ type: "fill-blank", answer: "3,5" }), "3,5");
    expect(v.isCorrect).toBe(true);
  });

  it("НЕ РЕШИЛИ: совпала часть → needs_review, балл не начисляем", () => {
    const v = gradeAnswer(task({ type: "fill-blank", answer: "3, 5, 7", points: 3 }), "3, 9, 9");
    expect(v.isCorrect).toBeNull();
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(true);
    expect(v.reason).toContain("1 из 3");
  });

  it("ни одной верной части → неверно (без needsReview)", () => {
    const v = gradeAnswer(task({ type: "fill-blank", answer: "3, 5, 7" }), "1, 2, 4");
    expect(v.isCorrect).toBe(false);
    expect(v.needsReview).toBe(false);
  });

  it("НЕ РЕШИЛИ: пустой эталон → needs_review", () => {
    const v = gradeAnswer(task({ type: "fill-blank", answer: "" }), "3");
    expect(v.isCorrect).toBeNull();
    expect(v.needsReview).toBe(true);
  });
});

describe("gradeAnswer · short-answer → сверяем сами, essay → только учитель", () => {
  // 12.10.2026: короткий ответ больше не уходит учителю всегда. Решение владельца
  // — сверять точным совпадением с эталоном. Раньше здесь стояло ожидание
  // «manual / is_correct = null»: из-за него ученик после правильного ответа
  // видел «0 баллов», а треть листов на проде ждала ручной проверки.
  it("short-answer: совпадение с эталоном — верно, полный балл, без проверки", () => {
    const v = gradeAnswer(
      task({ type: "short-answer", answer: "атмосфера", points: 3 }),
      "атмосфера",
    );
    expect(v.checkMethod).toBe("auto");
    expect(v.isCorrect).toBe(true);
    expect(v.pointsAwarded).toBe(3);
    expect(v.needsReview).toBe(false);
  });

  it("short-answer: регистр, лишние пробелы, хвостовая точка и «ё» — не мешают", () => {
    for (const value of ["Атмосфера", "  атмосфера  ", "атмосфера.", "АтмосФера"]) {
      const v = gradeAnswer(task({ type: "short-answer", answer: "атмосфера", points: 1 }), value);
      expect(v.isCorrect, `«${value}» должен совпасть`).toBe(true);
    }
    // Эталон с «ё» — ученик пишет «е»: это один и тот же ответ.
    const withYo = gradeAnswer(task({ type: "short-answer", answer: "щёлки", points: 1 }), "щелки");
    expect(withYo.isCorrect).toBe(true);
  });

  it("short-answer: не совпало — минус, а не «ждут проверки»", () => {
    const v = gradeAnswer(task({ type: "short-answer", answer: "атмосфера", points: 3 }), "вода");
    expect(v.checkMethod).toBe("auto");
    expect(v.isCorrect).toBe(false);
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(false);
  });

  it("short-answer: пустой ответ при непустом эталоне — минус", () => {
    const v = gradeAnswer(task({ type: "short-answer", answer: "атмосфера", points: 3 }), "");
    expect(v.isCorrect).toBe(false);
    expect(v.needsReview).toBe(false);
  });

  it("short-answer: без эталона не гадаем — ждёт учителя", () => {
    const v = gradeAnswer(task({ type: "short-answer", answer: "", points: 3 }), "что-то");
    expect(v.isCorrect).toBeNull();
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(true);
  });

  // Находки независимого ревью (12.10.2026): обе проверки закрывают способы
  // засчитать заведомо неверный ответ как верный.

  it("short-answer: пробелы вокруг разделителя — тот же ответ («7 / 8» = «7/8»)", () => {
    const t = task({ type: "short-answer", answer: "7/8", points: 2 });
    for (const value of ["7 / 8", " 7 /8 ", "7/ 8", "7 / 8 "]) {
      const v = gradeAnswer(t, value);
      expect(v.isCorrect, `«${value}» должен засчитаться`).toBe(true);
    }
  });

  it("short-answer: пробелы вокруг оператора — тот же ответ («2x + 6» = «2x+6»)", () => {
    const t = task({ type: "short-answer", answer: "2x+6", points: 2 });
    expect(gradeAnswer(t, "2x + 6").isCorrect).toBe(true);
    // Пробел МЕЖДУ буквами и цифрами не убираем: «2 x» и «2x» — разные записи,
    // и склеивать их значит склеивать разные ответы.
    expect(gradeAnswer(t, "2 x + 6").isCorrect).toBe(false);
  });

  it("short-answer: разные числа не склеиваются при нормализации", () => {
    const t = task({ type: "short-answer", answer: "7/8", points: 2 });
    expect(gradeAnswer(t, "7,8").isCorrect).toBe(false);
    expect(gradeAnswer(t, "17/8").isCorrect).toBe(false);
  });

  it("short-answer: эталон из одной пунктуации уходит учителю, а не совпал бы с мусором", () => {
    // Раньше «?» и «!!!» после нормализации оба сворачивались в пустую строку
    // и совпадали между собой — ответ «засчитывался» как верный.
    const v = gradeAnswer(task({ type: "short-answer", answer: "?", points: 2 }), "!!!");
    expect(v.isCorrect).toBeNull();
    expect(v.needsReview).toBe(true);
  });

  it("short-answer: бессмысленный ответ ученика при нормальном эталоне — ноль", () => {
    const v = gradeAnswer(task({ type: "short-answer", answer: "воздух", points: 2 }), "!!!");
    expect(v.isCorrect).toBe(false);
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(false);
  });

  it("essay: manual даже если текст совпал с эталоном", () => {
    const v = gradeAnswer(task({ type: "essay", answer: "потому что", points: 5 }), "потому что");
    expect(v.checkMethod).toBe("manual");
    expect(v.isCorrect).toBeNull();
    expect(v.pointsAwarded).toBe(0);
    expect(v.needsReview).toBe(true);
  });

  it("неизвестный тип задания → manual, а не «угадали»", () => {
    const v = gradeAnswer(
      { number: 1, text: "?", type: "что-то" as WorksheetTask["type"], points: 1, answer: "x" },
      "x",
    );
    expect(v.checkMethod).toBe("manual");
    expect(v.isCorrect).toBeNull();
    expect(v.needsReview).toBe(true);
  });
});

describe("gradeSubmission", () => {
  const tasks: WorksheetTask[] = [
    { number: 1, text: "2+2", type: "computation", answer: "4", points: 2 },
    { number: 2, text: "Вариант?", type: "multiple-choice", answer: "1", points: 1 },
    { number: 3, text: "Вставь 3, 5", type: "fill-blank", answer: "3, 5", points: 2 },
    { number: 4, text: "Обоснуйте", type: "essay", points: 5, answer: "эталон" },
  ];

  it("считает баллы, max и пропущенные задания не теряет", () => {
    const answers = new Map<number, string>([
      [1, "4"], // верно → 2
      [2, "0"], // неверно → 0
      [3, "3, 5"], // верно → 2
      // 4 — пропущено, но essay всё равно ждёт учителя
    ]);
    const res = gradeSubmission(tasks, answers);

    expect(res.scoreTotal).toBe(4);
    expect(res.scoreMax).toBe(10);
    expect(res.perTask).toHaveLength(4);
    expect(res.needsReviewCount).toBe(1); // только essay

    const essay = res.perTask.find((p) => p.taskNumber === 4)!;
    expect(essay.studentValue).toBeNull();
    expect(essay.needsReview).toBe(true);
    expect(essay.pointsAwarded).toBe(0);
  });

  it("идеальная работа: scoreTotal == scoreMax, needsReview = 0", () => {
    const answers = new Map<number, string>([
      [1, "4"],
      [2, "1"],
      [3, "5, 3"], // порядок не важен
    ]);
    const res = gradeSubmission(tasks.slice(0, 3), answers);
    expect(res.scoreTotal).toBe(res.scoreMax);
    expect(res.needsReviewCount).toBe(0);
  });

  it("пустая форма (0 заданий) → нули, без исключения", () => {
    const res = gradeSubmission([], new Map());
    expect(res.scoreTotal).toBe(0);
    expect(res.scoreMax).toBe(0);
    expect(res.perTask).toEqual([]);
  });
});

describe("detectCheckMode", () => {
  it("без short-answer → auto", () => {
    expect(
      detectCheckMode([
        { number: 1, text: "?", type: "computation", answer: "1", points: 1 },
        { number: 2, text: "?", type: "essay", points: 1 },
      ]),
    ).toBe("auto");
  });

  it("есть short-answer → llm (сверка подключается на этапе 6)", () => {
    expect(
      detectCheckMode([
        { number: 1, text: "?", type: "computation", answer: "1", points: 1 },
        { number: 2, text: "?", type: "short-answer", answer: "x", points: 1 },
      ]),
    ).toBe("llm");
  });
});

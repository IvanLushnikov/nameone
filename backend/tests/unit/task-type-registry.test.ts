/**
 * ТЗ-33, В1.1: типы заданий в промпте и в валидации (бэк).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. ПРОМПТ собирает список типов заданий ИЗ РЕЕСТРА, и в нём нет типа,
 *    который предмету не подходит. Раньше список был зашит в шаблон строкой
 *    («computation | multiple-choice | short-answer | essay | fill-blank»), и
 *    «практическая работа» не могла появиться в математике в принципе, а
 *    «установите соответствие» — в иностранном языке.
 *
 * 2. ВАЛИДАЦИЯ отбрасывает задание, не соответствующее своему типу:
 *    «по образцу» без образца, «задание по таблице» без таблицы. Раньше
 *    «по образцу» без образца ПРОХОДИЛО: фильтр ловил только ссылку на
 *    образец в тексте, а не отсутствие самого образца.
 *
 * 3. ТИП ВНЕ РЕЕСТРА отбрасывается. Раньше zod проверял пять типов, а модель
 *    могла вернуть что угодно — и это доходило до учителя.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧЕГО ТЕСТ НЕ ДЕЛАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Он НЕ генерирует лист и не проверяет, что модель послушалась. Это стоит
 * денег и зависит от провайдера. Тест проверяет, что правило ЕСТЬ в промпте и
 * в коде — без него модель не может нарушить то, чего ей не сказали.
 * Фактическое поведение проверяется живым прогоном (см. отчёт ТЗ-33).
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  buildWorksheetPrompt,
  buildTopUpPrompt,
  buildVariantRetryPrompt,
} from "../../src/llm/prompts/worksheet-gen";
import {
  filterTasks,
  checkTaskTypeRequirements,
} from "../../src/llm/validation/quality-filter";
import type { GenerationRequest } from "../../src/types";

// Маркер успеха для гейт-чекера (unlazy). Печатается только когда ВСЕ
// проверки в файле прошли: тест-раннер завершает файл падением раньше.
afterAll(() => {
  console.log("TZ33-TASK-TYPES-OK");
});

function req(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    subject: "math",
    grade: 5,
    topic: "drobi-obyknovennye",
    difficulty: "medium",
    count: 5,
    type: "worksheet",
    withAnswers: true,
    withExplanations: false,
    ...over,
  };
}

/** Задание типа `pattern` с образцом — корректное. */
function patternTask(withSample: boolean) {
  return {
    number: 1,
    text: "Выполните по образцу: сократите дробь.",
    type: "pattern",
    answer: "1/4",
    points: 2,
    ...(withSample ? { sample: "Образец: 3/12 = 1/4. Сократите 8/20." } : {}),
  };
}

describe("ТЗ-33: типы заданий в промпте", () => {
  it("блок типов собран из реестра и попал в промпт", () => {
    const { user } = buildWorksheetPrompt(req());
    expect(user).toContain("ТИПЫ_ЗАДАНИЙ");
    expect(user).toContain("`pattern`");
  });

  it("в промпте по математике нет практической работы — она не по этому предмету", () => {
    const { user } = buildWorksheetPrompt(req({ subject: "math", grade: 5 }));
    expect(user).not.toContain("`practical`");
  });

  it("в промпте по физкультуре практическая работа есть", () => {
    const { user } = buildWorksheetPrompt(req({ subject: "pe", grade: 8 }));
    expect(user).toContain("`practical`");
  });

  it("в промпте по иностранному языку есть соответствие", () => {
    const { user } = buildWorksheetPrompt(req({ subject: "english", grade: 7 }));
    expect(user).toContain("`matching`");
  });

  it("в промпте есть требование разнообразия — иначе пять арифметик подряд", () => {
    const { user } = buildWorksheetPrompt(req());
    expect(user).toMatch(/не больше половины|одинаковых подряд/i);
  });

  it("system-промпт больше не перечисляет типы строкой — ссылается на блок", () => {
    const { system } = buildWorksheetPrompt(req());
    // Зашитый список из пяти типов означал бы, что новые формы модели
    // неизвестны. Ссылка на блок — признак, что список приходит из реестра.
    expect(system).toContain("ДОСТУПНЫЕ ТИПЫ ЗАДАНИЙ");
    expect(system).not.toContain(
      "computation | multiple-choice | short-answer | essay | fill-blank",
    );
  });

  it("дозапрос тоже знает про типы — иначе добавленные задания съедут в однообразие", () => {
    const { user } = buildTopUpPrompt(req(), 2, ["первое задание"]);
    expect(user).toContain("ТИПЫ_ЗАДАНИЙ");
  });

  it("ретрай контрольной тоже знает про типы", () => {
    const { user } = buildVariantRetryPrompt(
      req({ type: "control" }),
      [3],
      ["текст задания"],
      "второй вариант повторил первый",
    );
    expect(user).toContain("ТИПЫ_ЗАДАНИЙ");
  });
});

describe("ТЗ-33: валидация по реестру", () => {
  it("«по образцу» с образцом — годное задание", () => {
    expect(checkTaskTypeRequirements(patternTask(true))).toBeNull();
  });

  it("«по образцу» без образца — дефект, и это видно", () => {
    expect(checkTaskTypeRequirements(patternTask(false))).toBe("pattern-without-sample");
  });

  it("неизвестный тип — дефект, и он отделён от несоответствия", () => {
    const problem = checkTaskTypeRequirements({
      number: 1,
      text: "что-то",
      type: "diagram",
    });
    expect(problem).toBe("unknown-type:diagram");
  });

  it("задание по таблице без таблицы — дефект", () => {
    const problem = checkTaskTypeRequirements({
      number: 1,
      text: "по таблице",
      type: "table-task",
      answer: "5",
    });
    expect(problem).toBe("table-task-without-table");
  });

  it("задание по таблице с таблицей — годное", () => {
    const problem = checkTaskTypeRequirements({
      number: 1,
      text: "по таблице",
      type: "table-task",
      answer: "5",
      table: { headers: ["Товар", "Цена"], rows: [["Хлеб", "30"]] },
    });
    expect(problem).toBeNull();
  });

  it("«расположите в порядке» без элементов — дефект", () => {
    const problem = checkTaskTypeRequirements({
      number: 1,
      text: "расставьте",
      type: "sequence",
      answer: "2-1-3",
    });
    expect(problem).toBe("sequence-without-items");
  });

  it("фильтр выкидывает «по образцу» без образца и пишет это в отчёт", () => {
    const { tasks, report } = filterTasks(
      [patternTask(true), patternTask(false), patternTask(false)],
      "math",
    );
    expect(tasks).toHaveLength(1);
    expect(report.droppedTypeMismatch).toEqual([2, 3]);
  });

  it("фильтр выкидывает задание с типом вне реестра", () => {
    const { tasks, report } = filterTasks(
      [
        { number: 1, text: "нормальное", type: "computation", answer: "5", points: 1 },
        { number: 2, text: "неизвестный тип", type: "diagram", answer: "5", points: 1 },
      ],
      "math",
    );
    expect(tasks).toHaveLength(1);
    expect(report.droppedUnknownType).toEqual([2]);
  });

  it("старые пять типов проходят валидацию без изменений", () => {
    const { tasks } = filterTasks(
      [
        { number: 1, text: "Считай", type: "computation", answer: "5", points: 1 },
        {
          number: 2,
          text: "Выбери",
          type: "multiple-choice",
          answer: "A",
          options: ["A", "B", "C", "D"],
          points: 1,
        },
        { number: 3, text: "Ответь", type: "short-answer", answer: "5", points: 1 },
        { number: 4, text: "Развёрнуто", type: "essay", answer: "критерий", points: 2 },
        { number: 5, text: "Впиши", type: "fill-blank", answer: "5", points: 1 },
      ],
      "math",
    );
    expect(tasks).toHaveLength(5);
  });
});

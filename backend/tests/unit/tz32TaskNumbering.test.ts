/**
 * ТЗ-32, части 1 и 2: серверная нумерация заданий и счётчик пустых ключей.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * Часть 1. Номер задания приходил от модели и печатался как есть. На листе это
 * читалось как «1, 2, 3, 1», а хуже косметики — карта заданий в сводке по
 * выданному листу строится по номеру, и два задания с одинаковым номером
 * затирают друг друга. Проверяем: после перенумеровки номера идут подряд, в том
 * же порядке, и расхождение с моделью попадает в лог, а не чинится молча.
 *
 * Часть 2. Задание с пустым ключом доезжало до DOCX без строки ответа, и сайт
 * при этом обещал ответы. Проверяем: счётчик считает такие задания по
 * ФИНАЛЬНОМУ листу и при `withAnswers = false` молчит — там null законен.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ФИЛЬТР В ЭТОМ ТЕСТЕ НЕ МОК
 *
 * Сценарий «фильтр выкинул задание, номер остался от модели» — это ровно тот
 * случай, где нумерация до фильтра оставила бы пропуск «1, 2, 4». Здесь
 * проходится настоящий `filterTasks`, потому что порядок вызовов
 * «фильтр → перенумеровка» и есть содержание AD-2.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  countTasksWithoutAnswer,
  numberSheetForDelivery,
  renumberTasks,
  type NumberableTask,
} from "../../src/llm/validation/task-numbering";
import { filterTasks, type RawTask } from "../../src/llm/validation/quality-filter";
import { WORKSHEET_GEN_SYSTEM } from "../../src/llm/prompts/worksheet-gen";

/** Логгер импортируется в модуль до мока — поэтому мок объявляем до вызовов. */
const logMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../../src/llm/log", () => ({ logLlmEvent: logMock.warn }));

const task = (over: Partial<NumberableTask>): NumberableTask => ({
  text: "Задание",
  answer: "Ответ",
  ...over,
});

const nums = (tasks: readonly NumberableTask[]) => tasks.map((t) => t.number);

/** Задание, которое фильтр качества обязан выкинуть: «по образцу» без образца. */
const patternRefTask = (number: number): RawTask => ({
  number,
  text: "Выполните работу по образцу.",
  answer: "Ответ",
});

describe("ТЗ-32 AD-1/AD-2: номер задаёт сервер", () => {
  it("дубли номеров от модели become сквозная нумерация по позиции", () => {
    // Именно то, что наблюдалось на листе по обществознанию.
    const { tasks, mismatchedPositions } = renumberTasks([
      task({ number: 1 }),
      task({ number: 2 }),
      task({ number: 3 }),
      task({ number: 1 }),
    ]);
    expect(nums(tasks)).toEqual([1, 2, 3, 4]);
    // Расхождение видно: 4-е задание модель пронумеровала как 1-е.
    expect(mismatchedPositions).toEqual([4]);
  });

  it("пропуск номеров от модели закрывается, а не сохраняется", () => {
    const { tasks, modelNumbers } = renumberTasks([
      task({ number: 1 }),
      task({ number: 2 }),
      task({ number: 5 }),
    ]);
    expect(nums(tasks)).toEqual([1, 2, 3]);
    // Исходные номера остаются в результате: по ним видно, что делала модель.
    expect(modelNumbers).toEqual([1, 2, 5]);
  });

  it("после фильтра номера идут подряд, без пропусков", () => {
    const filtered = filterTasks(
      [
        patternRefTask(1),
        task({ number: 2 }),
        patternRefTask(3),
        task({ number: 4 }),
      ],
      "обществознание",
    );
    // Задания, которые фильтр убрал, были 1-м и 3-м: нумерация «по модели»
    // оставила бы пропуск 1, 3.
    expect(filtered.tasks.map((t) => t.number)).toEqual([2, 4]);

    const { tasks } = renumberTasks(filtered.tasks as NumberableTask[]);
    expect(nums(tasks)).toEqual([1, 2]);
    expect(nums(tasks)).toEqual(tasks.map((_, index) => index + 1));
  });

  it("число заданий после перенумеровки равно числу после фильтра", () => {
    const filtered = filterTasks(
      [
        patternRefTask(1),
        task({ number: 2 }),
        patternRefTask(3),
        task({ number: 4 }),
        task({ number: 5 }),
      ],
      "обществознание",
    );
    const { tasks } = renumberTasks(filtered.tasks as NumberableTask[]);
    expect(tasks).toHaveLength(filtered.tasks.length);
  });

  it("входные объекты не мутируются", () => {
    const original = task({ number: 7 });
    const { tasks } = renumberTasks([original]);
    expect(nums(tasks)).toEqual([1]);
    // Объект лежит в кэше листа: тихая правка на месте сделала бы номер
    // зависимым от порядка вызовов.
    expect(original.number).toBe(7);
  });

  it("у задания без номера номер всё равно появляется", () => {
    const { tasks, modelNumbers } = renumberTasks([task({ number: undefined })]);
    expect(nums(tasks)).toEqual([1]);
    expect(modelNumbers).toEqual([null]);
  });
});

describe("ТЗ-32 AD-3: расхождение номеров попадает в лог", () => {
  beforeEach(() => {
    logMock.warn.mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("лог содержит номера от модели и позиции расхождения", () => {
    numberSheetForDelivery([task({ number: 1 }), task({ number: 1 })], {
      subject: "обществознание",
      stage: "primary",
      withAnswers: true,
    });
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    const payload = logMock.warn.mock.calls[0]?.[2];
    expect(payload).toMatchObject({
      subject: "обществознание",
      stage: "primary",
      modelNumbers: [1, 1],
      mismatchedPositions: [2],
    });
  });

  it("совпавшие номера молчат: ремонта не было — и лога не нужно", () => {
    numberSheetForDelivery([task({ number: 1 }), task({ number: 2 })], {
      subject: "математика",
      stage: "primary",
      withAnswers: true,
    });
    expect(logMock.warn).not.toHaveBeenCalled();
  });
});

describe("ТЗ-32 AD-4: счётчик заданий без ключа", () => {
  it("считает задания с пустым и заглушечным ответом", () => {
    const count = countTasksWithoutAnswer(
      [
        task({ answer: "42" }),
        task({ answer: null }),
        task({ answer: "индивидуальный ответ" }),
        task({ answer: "   " }),
      ],
      true,
    );
    expect(count).toBe(3);
  });

  it("при withAnswers = false пустой ответ — не дефект", () => {
    const count = countTasksWithoutAnswer(
      [task({ answer: null }), task({ answer: null })],
      false,
    );
    expect(count).toBe(0);
  });

  it("счётчик идёт в том же вызове, что и перенумеровка", () => {
    const result = numberSheetForDelivery(
      [task({ number: 1, answer: "5" }), task({ number: 1, answer: null })],
      { subject: "обществознание", stage: "primary", withAnswers: true },
    );
    expect(nums(result.tasks)).toEqual([1, 2]);
    expect(result.withoutAnswer).toBe(1);
  });

  it("эссе без ключа и есть тот случай из находки ревью", () => {
    // Модель вернула эссе с ответом-заглушкой, фильтр обнулил ответ, но
    // задание оставил — так в выдачу уезжает задание без строки ответа.
    const filtered = filterTasks(
      [
        task({ number: 1, type: "essay", answer: "свой ответ" }) as RawTask,
        task({ number: 2, answer: "Ответ" }) as RawTask,
      ],
      "обществознание",
    );
    expect(filtered.report.cleanedAnswer).toEqual([1]);

    const result = numberSheetForDelivery(
      filtered.tasks as NumberableTask[],
      { subject: "обществознание", stage: "primary", withAnswers: true },
    );
    expect(nums(result.tasks)).toEqual([1, 2]);
    expect(result.withoutAnswer).toBe(1);
  });
});

describe("ТЗ-32 AD-6: защита от пустого листа не отменена", () => {
  it("когда отфильтровано больше двух третей, лист не пустой", () => {
    // Четыре из пяти — заведомо слишком агрессивно: фильтр откатывается и
    // отдаёт исходный набор. Именно этот откат выпускает в лист задания без
    // ключа (AD-4), и именно поэтому защиту не отменяем.
    const filtered = filterTasks(
      [
        patternRefTask(1),
        patternRefTask(2),
        patternRefTask(3),
        patternRefTask(4),
        task({ number: 5, answer: null }),
      ],
      "обществознание",
    );
    expect(filtered.report.after).toBe(1);
    expect(filtered.tasks).toHaveLength(5);
    const result = numberSheetForDelivery(
      filtered.tasks as NumberableTask[],
      { subject: "обществознание", stage: "primary", withAnswers: true },
    );
    expect(result.tasks).toHaveLength(5);
    expect(nums(result.tasks)).toEqual([1, 2, 3, 4, 5]);
    expect(result.withoutAnswer).toBe(1);
  });
});
describe("ТЗ-32 AD-5: промпт объясняет, что такое ответ у эссе", () => {
  it("в правилах есть требование: answer у essay — это критерии приёмки", () => {
    expect(WORKSHEET_GEN_SYSTEM).toMatch(/essay/i);
    expect(WORKSHEET_GEN_SYSTEM).toMatch(/КРИТЕРИИ, по которым учитель принимает/);
  });

  it("в правилах запрещён ответ-заглушка и пустой answer", () => {
    // Ответ-заглушку сервер обнуляет, и задание остаётся в листе без строки
    // ключа. Значит запрет должен быть в промпте, а не только в фильтре.
    expect(WORKSHEET_GEN_SYSTEM).toMatch(/ЗАПРЕЩЁН/);
    expect(WORKSHEET_GEN_SYSTEM).toMatch(/Пустой answer не допускается/);
  });
});

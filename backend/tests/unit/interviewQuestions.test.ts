/**
 * Unit-тесты генерации вопросов для беседы (TZ-17 §11).
 *
 * `src/services/interviewQuestions.ts` — чистый модуль: ни D1, ни R2, ни LLM.
 * Тестируем ровно то, на чём держится доверие учителя:
 *
 *   1. разбор JSON-ответа модели (happy path + markdown-обёртка);
 *   2. мусор от модели → пустой массив, а не выдуманные вопросы;
 *   3. вопрос с правильным ответом ВЫБРАСЫВАЕТСЯ (LEAKS_ANSWER);
 *   4. меньше вопросов, чем заданий → отдаём меньше, не добиваем;
 *   5. вопрос длиннее 200 знаков обрезается, дедупликация отсекает повторы;
 *   6. дефолтный отбор заданий — только неверные/неясные, максимум 5.
 *
 * Запуск: `cd backend && npx vitest run tests/unit/interviewQuestions.test.ts`
 */

import { describe, it, expect } from "vitest";
import {
  INTERVIEW_DISCLAIMER,
  MAX_QUESTION_LENGTH,
  buildInterviewPrompt,
  leaksExpectedAnswer,
  parseInterviewQuestions,
  pickDefaultTaskNumbers,
  sanitizeQuestion,
  type InterviewTaskItem,
} from "../../src/services/interviewQuestions";

/** Три задания: верное, неверное (эталон известен) и неразборчивое. */
const TASKS: InterviewTaskItem[] = [
  {
    number: 1,
    taskText: "Найди значение выражения 48 : 6 + 2",
    expected: "10",
    studentAnswer: "10",
    verdict: "correct",
  },
  {
    number: 3,
    taskText: "Найди значение выражения 48 : 6 + 2",
    expected: "11/12",
    studentAnswer: "11/12",
    verdict: "incorrect",
  },
  {
    number: 5,
    taskText: "Сколько треугольников на рисунке?",
    expected: "8",
    studentAnswer: "9",
    verdict: "incorrect",
  },
  {
    number: 7,
    taskText: "Найди значение выражения",
    expected: "25",
    studentAnswer: null,
    verdict: "unclear",
  },
];

/** Обёртка: собрать JSON так, как его вернула бы текстовая модель. */
function modelJson(questions: unknown[]): string {
  return JSON.stringify({ questions });
}

describe("buildInterviewPrompt", () => {
  it("кладёт в user-сообщение задания, эталон и ответ ученика", () => {
    const { system, user } = buildInterviewPrompt(TASKS, { subject: "математика", grade: 5 });
    expect(system).toContain("Никогда не упоминай правильный ответ");
    expect(user).toContain("11/12");
    expect(user).toContain("математика");
    // Вердикт в промпт не идёт: он толкнул бы модель в формулировки «здесь ошибка».
    expect(user).not.toContain('"incorrect"');
  });

  it("дисклеймер задан на сервере и не пустой", () => {
    expect(INTERVIEW_DISCLAIMER.length).toBeGreaterThan(10);
  });
});

describe("parseInterviewQuestions · happy path", () => {
  it("по одному вопросу на задание, порядок по номеру", () => {
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([
        { number: 7, question: "Расскажи, как ты решал это задание?" },
        { number: 3, question: "Как ты получил эту дробь? Проверь её другим способом." },
      ]),
      TASKS,
    );

    expect(dropped).toHaveLength(0);
    expect(questions.map((q) => q.taskNumber)).toEqual([3, 7]);
    expect(questions[0]!.question).toContain("дробь");
    // Вердикт-ясорь учителю сохраняется из позиции проверки.
    expect(questions[0]!.verdictAtGeneration).toBe("incorrect");
    expect(questions[1]!.verdictAtGeneration).toBe("unclear");
  });

  it("markdown-обёртка ```json НЕ ломает разбор", () => {
    const raw = '```json\n{"questions":[{"number":3,"question":"Как ты получил эту дробь?"}]}\n```';
    const { questions } = parseInterviewQuestions(raw, TASKS);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.taskNumber).toBe(3);
  });
});

describe("правила честности", () => {
  it("модель вернула меньше вопросов, чем заданий → отдаём меньше, НЕ добиваем", () => {
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([{ number: 3, question: "Как ты получил эту дробь?" }]),
      TASKS,
    );
    // Четыре задания, один вопрос. Учитель должен знать, что вопрос — один.
    expect(questions).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it("нечитаемый JSON → пустой массив, ни одного выдуманного вопроса", () => {
    const result = parseInterviewQuestions("извините, я не могу это сделать", TASKS);
    expect(result.questions).toEqual([]);
    expect(result.dropped[0]!.reason).toBe("INVALID_JSON");
  });

  it("пустой массив от модели → пустой результат", () => {
    const result = parseInterviewQuestions(modelJson([]), TASKS);
    expect(result.questions).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("6+ заданий: вопрос на каждое, лишние номера — в dropped", () => {
    const many: InterviewTaskItem[] = Array.from({ length: 7 }, (_, i) => ({
      number: i + 1,
      taskText: `Задание ${i + 1}`,
      expected: `${100 + i}`,
      studentAnswer: `${90 + i}`,
      verdict: "incorrect",
    }));
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([
        ...many.map((t) => ({ number: t.number, question: `Как ты решил задание ${t.number}?` })),
        { number: 99, question: "А что ты делал?" },
      ]),
      many,
    );
    expect(questions).toHaveLength(7);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toBe("UNKNOWN_TASK");
  });
});

describe("вопрос не должен выдавать правильный ответ (ТЗ §5.3)", () => {
  it("эталон внутри вопроса → вопрос ВЫБРАСЫВАЕТСЯ с причиной LEAKS_ANSWER", () => {
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([
        { number: 3, question: "Почему ты написал 11/12, ведь по условию получается 11/12?" },
        { number: 5, question: "Как ты считал треугольники? Проверь другим способом." },
      ]),
      TASKS,
    );

    expect(questions.map((q) => q.taskNumber)).toEqual([5]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toBe("LEAKS_ANSWER");
    expect(dropped[0]!.taskNumber).toBe(3);
  });

  it("слово «правильный ответ» в вопросе — тоже утечка", () => {
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([{ number: 5, question: "Правильный ответ здесь 8, почему ты написал другое?" }]),
      TASKS,
    );
    expect(questions).toEqual([]);
    expect(dropped[0]!.reason).toBe("LEAKS_ANSWER");
  });

  it("число 10 не ловится внутри числа 100 (ложных срабатываний не делаем)", () => {
    expect(leaksExpectedAnswer("Проверь, получится ли у тебя 100", "10")).toBe(false);
    expect(leaksExpectedAnswer("Почему ты написал 10?", "10")).toBe(true);
  });

  it("короткий односимвольный эталон не роняет вопрос", () => {
    expect(leaksExpectedAnswer("Как ты это получил?", "а")).toBe(false);
  });
});

describe("чистка и дедупликация", () => {
  it("вопрос длиннее 200 знаков обрезается до лимита", () => {
    const long = `Проверь своё решение ${"очень подробно ".repeat(30)}`;
    const { questions } = parseInterviewQuestions(
      modelJson([{ number: 3, question: long }]),
      TASKS,
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]!.question.length).toBeLessThanOrEqual(MAX_QUESTION_LENGTH);
  });

  it("sanitizeQuestion снимает markdown-обвязку и обрезает по лимиту", () => {
    expect(sanitizeQuestion("```\n**Как ты это получил?**\n```")).toBe("Как ты это получил?");
    expect(sanitizeQuestion("- Как ты это получил?")).toBe("Как ты это получил?");
    expect(sanitizeQuestion("«Как ты это получил?»")).toBe("Как ты это получил?");
    expect(sanitizeQuestion("   ")).toBeNull();
    expect(sanitizeQuestion(null)).toBeNull();
  });

  it("одинаковые вопросы дедуплицируются, лишний уходит в DUPLICATE", () => {
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([
        { number: 3, question: "Как ты получил эту дробь?" },
        { number: 5, question: "  Как ты получил эту дробь? " },
      ]),
      TASKS,
    );
    expect(questions).toHaveLength(1);
    expect(dropped[0]!.reason).toBe("DUPLICATE");
  });

  it("второй вопрос на то же задание — тоже дубль, один вопрос на задание", () => {
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([
        { number: 3, question: "Как ты получил эту дробь?" },
        { number: 3, question: "А проверь это умножением." },
      ]),
      TASKS,
    );
    expect(questions).toHaveLength(1);
    expect(dropped[0]!.reason).toBe("DUPLICATE");
  });

  it("пустой вопрос отбраковывается как EMPTY", () => {
    const { questions, dropped } = parseInterviewQuestions(
      modelJson([{ number: 3, question: "   " }]),
      TASKS,
    );
    expect(questions).toEqual([]);
    expect(dropped[0]!.reason).toBe("EMPTY");
  });
});

describe("дефолтный отбор заданий (В-2)", () => {
  it("отмечены только задания с verdict !== correct", () => {
    expect(pickDefaultTaskNumbers(TASKS)).toEqual([3, 5, 7]);
  });

  it("максимум 5 — но это дефолт, а не ограничение", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      number: i + 1,
      verdict: i % 2 === 0 ? "incorrect" : "correct",
    }));
    expect(pickDefaultTaskNumbers(many)).toHaveLength(5);
  });

  it("все задания верные → пустой дефолт, роут попросит выбрать вручную", () => {
    const allCorrect = TASKS.map((t) => ({ number: t.number, verdict: "correct" }));
    expect(pickDefaultTaskNumbers(allCorrect)).toEqual([]);
  });
});

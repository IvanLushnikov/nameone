/**
 * Unit-тесты сверки результатов проверки фото (TZ-11).
 *
 * Модуль `src/services/photoCheckGrading.ts` чистый — ни D1, ни R2, ни LLM.
 * Тестируем ровно то, на чём держится доверие учителя к автопроверке:
 *
 *   1. разбор JSON-ответа модели (в т.ч. мусор → «непонятно», а не «неверно»);
 *   2. «непонятно» (unclear) НЕ превращается в «неправильно» (главный риск!);
 *   3. расчёт баллов и процента, отметка по порогам;
 *   4. пропущенные моделью задания не исчезают из результата;
 *   5. срок хранения фото (7 дней) и признак просрочки.
 *
 * Запуск: `cd backend && npx vitest run tests/unit/photoCheckGrading.test.ts`
 */

import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  PHOTO_RETENTION_SECONDS,
  gradeFromPercentage,
  gradePhotoCheck,
  isPhotoExpired,
  normalizeVerdict,
  photoDeleteAt,
  type ExpectedTask,
} from "../../src/services/photoCheckGrading";

/** Три задания: одно верное, одно неверное, одно неразборчивое. */
const TASKS: ExpectedTask[] = [
  { number: 1, taskText: "3/4 + 1/6", correctAnswer: "11/12", maxPoints: 2 },
  { number: 2, taskText: "Сколько треугольников?", correctAnswer: "8", maxPoints: 1 },
  { number: 3, taskText: "Значение выражения", correctAnswer: "25", maxPoints: 1 },
];

/** Обёртка: собрать JSON так, как его вернула бы vision-модель. */
function modelJson(items: unknown[]): string {
  return JSON.stringify({ items });
}

describe("gradePhotoCheck · разбор ответа модели", () => {
  it("корректный JSON: верное/неверное/непонятное по одному заданию", () => {
    const summary = gradePhotoCheck(
      modelJson([
        { number: 1, studentAnswer: "11/12", verdict: "correct", confidence: 0.97 },
        { number: 2, studentAnswer: "7", verdict: "incorrect", confidence: 0.91, comment: "На рисунке 8" },
        { number: 3, studentAnswer: null, verdict: "unclear", confidence: 0.28, comment: "Почерк не читается" },
      ]),
      TASKS,
    );

    expect(summary.items).toHaveLength(3);
    expect(summary.items[0]!.verdict).toBe("correct");
    expect(summary.items[1]!.verdict).toBe("incorrect");
    expect(summary.items[2]!.verdict).toBe("unclear");
  });

  it("markdown-обёртка ```json НЕ ломает разбор", () => {
    const raw = '```json\n{"items":[{"number":1,"studentAnswer":"11/12","verdict":"correct","confidence":0.9}]}\n```';
    const summary = gradePhotoCheck(raw, TASKS);
    expect(summary.items[0]!.verdict).toBe("correct");
  });

  it("задание, пропущенное моделью, остаётся в результате как unclear", () => {
    // Модель ответила только про задание 1 — молча проглотать это нельзя.
    const summary = gradePhotoCheck(
      modelJson([{ number: 1, studentAnswer: "11/12", verdict: "correct", confidence: 0.95 }]),
      TASKS,
    );
    expect(summary.items).toHaveLength(3);
    expect(summary.items[1]!.verdict).toBe("unclear");
    expect(summary.items[2]!.verdict).toBe("unclear");
    expect(summary.needsReview).toBe(true);
  });

  it("полностью нечитаемый ответ модели → все задания unclear, а не incorrect", () => {
    const summary = gradePhotoCheck("извините, я не могу разобрать это фото", TASKS);
    expect(summary.items.every((i) => i.verdict === "unclear")).toBe(true);
    expect(summary.earnedPoints).toBe(0);
    expect(summary.reviewCount).toBe(3);
  });

  it("confidence без вердикта и без ответа → unclear", () => {
    const summary = gradePhotoCheck(
      modelJson([{ number: 1, studentAnswer: null, confidence: 0.99 }]),
      TASKS,
    );
    expect(summary.items[0]!.verdict).toBe("unclear");
  });
});

describe("«непонятно» ≠ «неправильно»", () => {
  it("уверенность ниже порога превращается в unclear, даже если ответ разобран", () => {
    // Модель прочитала ответ, но не уверена. Ставить «неверно» нельзя —
    // это ложный ноль в журнале ученика.
    const summary = gradePhotoCheck(
      modelJson([
        { number: 1, studentAnswer: "11/12", verdict: "correct", confidence: 0.2 },
      ]),
      TASKS,
    );
    expect(summary.items[0]!.verdict).toBe("unclear");
    expect(summary.items[0]!.pointsAwarded).toBe(0);
    expect(summary.items[0]!.needsReview).toBe(true);
  });

  it("normalizeVerdict: ответ есть, вердикта нет → unclear, а не incorrect", () => {
    expect(normalizeVerdict(undefined, "11/12", 0.99)).toBe("unclear");
    expect(normalizeVerdict("", "7", 0.95)).toBe("unclear");
  });

  it("normalizeVerdict: без ответа всегда unclear, даже при высокой уверенности", () => {
    // Договориться: если мы не прочитали ответ — мы не имеем права решать,
    // верен он или нет.
    expect(normalizeVerdict("incorrect", null, 1)).toBe("unclear");
    expect(normalizeVerdict(undefined, null, 1)).toBe("unclear");
  });

  it("явный unclear модели не переименовывается в incorrect", () => {
    expect(normalizeVerdict("unclear", "?", 0.3)).toBe("unclear");
    expect(normalizeVerdict("illegible", "?", 0.2)).toBe("unclear");
  });

  it("уверенность 85 (в процентах) нормализуется в 0.85", () => {
    const summary = gradePhotoCheck(
      modelJson([
        { number: 1, studentAnswer: "11/12", verdict: "correct", confidence: 85 },
        { number: 2, studentAnswer: "7", verdict: "incorrect", confidence: 90 },
        { number: 3, studentAnswer: "25", verdict: "correct", confidence: 99 },
      ]),
      TASKS,
    );
    expect(summary.items[0]!.confidence).toBeCloseTo(0.85, 5);
    // 0.85 выше порога 0.6 → верное задание засчитано
    expect(summary.items[0]!.verdict).toBe("correct");
  });
});

describe("расчёт баллов", () => {
  it("верное задание даёт полный балл, неверное и непонятное — ноль", () => {
    const summary = gradePhotoCheck(
      modelJson([
        { number: 1, studentAnswer: "11/12", verdict: "correct", confidence: 0.97 },
        { number: 2, studentAnswer: "7", verdict: "incorrect", confidence: 0.91 },
        { number: 3, studentAnswer: null, verdict: "unclear", confidence: 0.28 },
      ]),
      TASKS,
    );
    expect(summary.totalPoints).toBe(4); // 2 + 1 + 1
    expect(summary.earnedPoints).toBe(2);
    expect(summary.percentage).toBe(50);
  });

  it("процент округляется к целому", () => {
    const tasks: ExpectedTask[] = [
      { number: 1, taskText: "1", correctAnswer: "1", maxPoints: 3 },
      { number: 2, taskText: "2", correctAnswer: "2", maxPoints: 3 },
      { number: 3, taskText: "3", correctAnswer: "3", maxPoints: 3 },
    ];
    const summary = gradePhotoCheck(
      modelJson([
        { number: 1, studentAnswer: "1", verdict: "correct", confidence: 0.9 },
        { number: 2, studentAnswer: "2", verdict: "correct", confidence: 0.9 },
        { number: 3, studentAnswer: "x", verdict: "incorrect", confidence: 0.9 },
      ]),
      tasks,
    );
    expect(summary.earnedPoints).toBe(6);
    expect(summary.totalPoints).toBe(9);
    expect(summary.percentage).toBe(67); // 66.67 → 67
  });

  it("нулевые баллы у задания не роняют процент в ноль", () => {
    const tasks: ExpectedTask[] = [{ number: 1, taskText: "1", correctAnswer: "1", maxPoints: 0 }];
    const summary = gradePhotoCheck(
      modelJson([{ number: 1, studentAnswer: "1", verdict: "correct", confidence: 0.9 }]),
      tasks,
    );
    // maxPoints <= 0 → нормализуется в 1, деление на ноль исключено
    expect(summary.totalPoints).toBe(1);
    expect(summary.percentage).not.toBeNull();
  });

  it("needsReview агрегируется по всем строкам", () => {
    const summary = gradePhotoCheck(
      modelJson([
        { number: 1, studentAnswer: "11/12", verdict: "correct", confidence: 0.97 },
        { number: 2, studentAnswer: "7", verdict: "incorrect", confidence: 0.91 },
        { number: 3, studentAnswer: "25", verdict: "correct", confidence: 0.95 },
      ]),
      TASKS,
    );
    // incorrect тоже требует внимания учителя: отметку ставит человек
    expect(summary.reviewCount).toBe(1);
    expect(summary.needsReview).toBe(true);
  });
});

describe("отметка по проценту", () => {
  it("пороги из ТЗ §7.3", () => {
    expect(gradeFromPercentage(100)).toBe("5");
    expect(gradeFromPercentage(85)).toBe("5");
    expect(gradeFromPercentage(84)).toBe("4");
    expect(gradeFromPercentage(70)).toBe("4");
    expect(gradeFromPercentage(69)).toBe("3");
    expect(gradeFromPercentage(50)).toBe("3");
    expect(gradeFromPercentage(49)).toBe("2");
    expect(gradeFromPercentage(0)).toBe("2");
  });

  it("неизвестный процент → отметки нет (лучше пусто, чем выдуманная двойка)", () => {
    expect(gradeFromPercentage(null)).toBeNull();
  });
});

describe("срок хранения фото (В-2.3)", () => {
  const created = 1_760_000_000;

  it("срок = 7 дней с момента проверки", () => {
    expect(PHOTO_RETENTION_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(photoDeleteAt(created)).toBe(created + 604_800);
  });

  it("на границе срока фото ещё не просрочено, секундой позже — просрочено", () => {
    const due = created + PHOTO_RETENTION_SECONDS;
    expect(isPhotoExpired(created, null, due)).toBe(false);
    expect(isPhotoExpired(created, null, due + 1)).toBe(true);
  });

  it("уже удалённое фото не ждёт следующего срока", () => {
    const deletedAt = created + 10;
    expect(photoDeleteAt(created, deletedAt)).toBe(deletedAt);
  });
});

describe("порог уверенности", () => {
  it("порог из ТЗ — 0.85 (решение владельца 2026-10-03)", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.85);
  });

  // Тест ловит рассинхрон, найденный 2026-10-03: бэк считал уверенным от 0.6,
  // фронт прятал всё ниже 0,85. Бэк начислял балл и включал задание в итоговый
  // процент, а экран учителя показывал его в блоке «Проверьте сами» и итоговую
  // отметку не выводил. Сверка самого равенства двух констант живёт во фронте
  // (tests/integration/confidence-threshold-sources.test.ts) — здесь она
  // недоступна, потому что бэк-тесты идут в workerd, где нет fs.
});

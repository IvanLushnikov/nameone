/**
 * Unit-тесты серверного скоринга интерактивов (TZ-13 §2).
 *
 * Модуль `src/services/interactives-scoring.ts` чистый — ни D1, ни HTTP, ни
 * дат. Здесь проверяем РОВНО то, на чём держится доверие к результату:
 *
 *   1. все 6 форматов считаются по формулам ТЗ §2 (доля правильных, корзины,
 *      claims_correct/(correct+wrong), score/total, argmax, позиции);
 *   2. граничные случаи: пустой конфиг, один вопрос, деление на ноль,
 *      незнакомый itemId, мусор в ответах;
 *   3. НЕДОВЕРЕННОСТЬ ВХОДА: клиент не может «дописать» очки через поля,
 *      которых нет в эталоне, и правильные itemId не выдумываются;
 *   4. входные данные не мутируются (конфиг уезжает ученику из кэша/D1 —
 *      если скоринг его портит, ломается игра, а не только отчёт).
 *
 * Запуск: `npm run test` или `npx vitest run tests/unit/interactives-scoring.test.ts`
 */

import { describe, it, expect } from "vitest";
import {
  scoreAttempt,
  scoreQuizRace,
  scoreSortBaskets,
  scoreJumpTruth,
  scoreFortuneWheel,
  scoreJeopardy,
  scoreSortSequence,
  validateInteractiveConfig,
} from "../../src/services/interactives-scoring";
import type {
  AttemptAnswer,
  InteractiveConfig,
  InteractiveItem,
} from "../../src/lib/interactives/types";

// ─────────────────────────────────────────────────────────────────────────────
// Заготовки
// ─────────────────────────────────────────────────────────────────────────────

/** Задание с вариантами: правильный = индекс 0. */
function choice(id: string, extra: Partial<InteractiveItem> = {}): InteractiveItem {
  return {
    id,
    prompt: `Задание ${id}`,
    options: ["верно", "неверно1", "неверно2"],
    correctIndex: 0,
    ...extra,
  };
}

function config(
  format: InteractiveConfig["format"],
  items: InteractiveItem[],
  options: InteractiveConfig["options"] = {},
): InteractiveConfig {
  return { format, title: "Тест", items, options };
}

/** Глубокая копия через JSON — эталон для проверки «ничего не изменилось». */
function snapshot<T>(value: T): string {
  return JSON.stringify(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. quiz-race (ТЗ §2.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("quiz-race · доля правильных и бонус за скорость", () => {
  const cfg = config(
    "quiz-race",
    [choice("i1"), choice("i2"), choice("i3"), choice("i4")],
    { secondsPerItem: 0 },
  );

  it("все ответы верные → percent 100", () => {
    const r = scoreQuizRace(cfg, [
      { itemId: "i1", chosenIndex: 0 },
      { itemId: "i2", chosenIndex: 0 },
      { itemId: "i3", chosenIndex: 0 },
      { itemId: "i4", chosenIndex: 0 },
    ]);
    expect(r.percent).toBe(100);
    expect(r.score).toBe(400); // 4 × 100 базы, таймера нет
    expect(r.maxScore).toBe(400);
    expect(r.wrongItemIds).toEqual([]);
  });

  it("2 из 4 → percent 50, неверные в wrongItemIds", () => {
    const r = scoreQuizRace(cfg, [
      { itemId: "i1", chosenIndex: 0 },
      { itemId: "i2", chosenIndex: 1 },
      { itemId: "i3", chosenIndex: 0 },
      { itemId: "i4", chosenIndex: 2 },
    ]);
    expect(r.percent).toBe(50);
    expect(r.detail.correct).toBe(2);
    expect(r.detail.wrong).toBe(2);
    expect(r.wrongItemIds).toEqual(["i2", "i4"]);
  });

  it("percent считается от отвеченных, а не от всех заданий", () => {
    // Ответили только на 2 из 4, обе верные → 100%, а не 50%.
    const r = scoreQuizRace(cfg, [
      { itemId: "i1", chosenIndex: 0 },
      { itemId: "i2", chosenIndex: 0 },
    ]);
    expect(r.percent).toBe(100);
  });

  it("таймер даёт бонус за скорость, потолок — 50 на задание", () => {
    const timed = config("quiz-race", [choice("i1")], { secondsPerItem: 20 });
    const instant = scoreQuizRace(timed, [{ itemId: "i1", chosenIndex: 0, ms: 0 }]);
    expect(instant.score).toBe(150);
    expect(instant.maxScore).toBe(150);

    const slow = scoreQuizRace(timed, [{ itemId: "i1", chosenIndex: 0, ms: 20_000 }]);
    expect(slow.score).toBe(100); // времени не осталось
  });

  it("бонус нельзя вытянуть поддельным ms", () => {
    const timed = config("quiz-race", [choice("i1")], { secondsPerItem: 20 });
    // Отрицательное и огромное ms зажимаются в границы таймера.
    const spoofed = scoreQuizRace(timed, [{ itemId: "i1", chosenIndex: 0, ms: -999_999 }]);
    expect(spoofed.score).toBe(150); // максимум, не больше
    const huge = scoreQuizRace(timed, [{ itemId: "i1", chosenIndex: 0, ms: 99_999_999 }]);
    expect(huge.score).toBe(100);
  });

  it("второй вариант режет очки вдвое", () => {
    const r = scoreQuizRace(cfg, [{ itemId: "i1", chosenIndex: 0, secondTry: true }]);
    expect(r.score).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. sort-baskets (ТЗ §2.3)
// ─────────────────────────────────────────────────────────────────────────────

describe("sort-baskets · корзины и звёзды за ошибки", () => {
  const cfg = config(
    "sort-baskets",
    [
      { id: "i1", prompt: "берёза", correctBucket: "растения" },
      { id: "i2", prompt: "волк", correctBucket: "животные" },
      { id: "i3", prompt: "автобус", correctBucket: "транспорт" },
      { id: "i4", prompt: "лошадь", correctBucket: "животные" },
    ],
    { baskets: ["растения", "животные", "транспорт"] },
  );

  it("все на местах → percent 100, 3 звезды", () => {
    const r = scoreSortBaskets(cfg, [
      { itemId: "i1", chosenBucket: "растения" },
      { itemId: "i2", chosenBucket: "животные" },
      { itemId: "i3", chosenBucket: "транспорт" },
      { itemId: "i4", chosenBucket: "животные" },
    ]);
    expect(r.percent).toBe(100);
    expect(r.stars).toBe(3);
    expect(r.maxScore).toBe(4);
    expect(r.detail.errors).toBe(0);
  });

  it("звёзды зависят от числа ошибок, а не от процента (ТЗ §2.3)", () => {
    // 2 ошибки при 3 из 4 верных (75%) → по проценту было бы 3, по ТЗ — 3.
    const few = scoreSortBaskets(cfg, [
      { itemId: "i1", chosenBucket: "растения" },
      { itemId: "i2", chosenBucket: "животные" },
      { itemId: "i3", chosenBucket: "животные" },
      { itemId: "i4", chosenBucket: "животные" },
    ]);
    expect(few.detail.errors).toBe(1);
    expect(few.stars).toBe(3);
    expect(few.percent).toBe(75);

    // 4 карточки в одну корзину: 1 верная, 3 ошибки → 2 звезды.
    const some = scoreSortBaskets(cfg, [
      { itemId: "i1", chosenBucket: "растения" },
      { itemId: "i2", chosenBucket: "растения" },
      { itemId: "i3", chosenBucket: "растения" },
      { itemId: "i4", chosenBucket: "растения" },
    ]);
    expect(some.stars).toBe(2);
    expect(some.detail.errors).toBe(3);

    // 7 карточек в «B», правильная корзина «A» → 7 ошибок → 1 звезда.
    const long = config(
      "sort-baskets",
      Array.from({ length: 7 }, (_, i) => ({
        id: `i${i + 1}`,
        prompt: `x${i + 1}`,
        correctBucket: "A",
      })),
      { baskets: ["A", "B"] },
    );
    const allWrong = scoreSortBaskets(
      long,
      long.items.map((item) => ({ itemId: item.id, chosenBucket: "B" })),
    );
    expect(allWrong.stars).toBe(1);
    expect(allWrong.detail.errors).toBe(7);
    expect(allWrong.percent).toBe(0);
  });

  it("ловушка не имеет правильной корзины и портит счёт при попытке", () => {
    const withTrap = config(
      "sort-baskets",
      [
        { id: "i1", prompt: "берёза", correctBucket: "растения" },
        { id: "i2", prompt: "корзина", isTrap: true },
      ],
      { baskets: ["растения", "животные"] },
    );
    // Положил ловушку — ошибка.
    const r = scoreSortBaskets(withTrap, [
      { itemId: "i1", chosenBucket: "растения" },
      { itemId: "i2", chosenBucket: "растения" },
    ]);
    expect(r.detail.errors).toBe(1);
    expect(r.wrongItemIds).toEqual(["i2"]);
    // Ловушка не входит в total: 1 место из 1.
    expect(r.maxScore).toBe(1);
    expect(r.percent).toBe(100);
  });

  it("незаполненная карточка не считается ошибкой", () => {
    const r = scoreSortBaskets(cfg, [{ itemId: "i1", chosenBucket: "растения" }]);
    expect(r.detail.errors).toBe(0);
    expect(r.percent).toBe(25);
    expect(r.stars).toBe(3);
  });
});

/** Заглушка удалена: длинный кейс выше считается напрямую scoreSortBaskets. */

// ─────────────────────────────────────────────────────────────────────────────
// 3. jump-truth (ТЗ §2.4)
// ─────────────────────────────────────────────────────────────────────────────

describe("jump-truth · claims_correct / (correct + wrong)", () => {
  const cfg = config(
    "jump-truth",
    [
      { id: "i1", prompt: "Дробь 1/2 меньше 1", isTrue: true },
      { id: "i2", prompt: "В треугольнике 4 стороны", isTrue: false },
      { id: "i3", prompt: "5 > 10", isTrue: false },
      { id: "i4", prompt: "0 — чётное число", isTrue: true },
    ],
    { boardSize: 8, mines: 3 },
  );

  it("все верные → 100%", () => {
    const r = scoreJumpTruth(cfg, [
      { itemId: "i1", chosenTrue: true },
      { itemId: "i2", chosenTrue: false },
      { itemId: "i3", chosenTrue: false },
      { itemId: "i4", chosenTrue: true },
    ]);
    expect(r.percent).toBe(100);
    expect(r.detail.moves).toBe(4);
    expect(r.score).toBe(4);
  });

  it("незакрытые утверждения не портят процент (делитель = ответы)", () => {
    const r = scoreJumpTruth(cfg, [{ itemId: "i1", chosenTrue: true }]);
    expect(r.percent).toBe(100);
    expect(r.maxScore).toBe(4); // а максимум остался на весь набор
  });

  it("1 из 4 → 25%", () => {
    // Верным делаем только первое утверждение (isTrue: true).
    const r = scoreJumpTruth(cfg, [
      { itemId: "i1", chosenTrue: true },
      { itemId: "i2", chosenTrue: true },
      { itemId: "i3", chosenTrue: true },
      { itemId: "i4", chosenTrue: false },
    ]);
    expect(r.detail.correct).toBe(1);
    expect(r.detail.wrong).toBe(3);
    expect(r.percent).toBe(25);
    expect(r.wrongItemIds).toEqual(["i2", "i3", "i4"]);
  });

  it("без ответов — 0%, а не NaN (деление на ноль)", () => {
    const r = scoreJumpTruth(cfg, []);
    expect(r.percent).toBe(0);
    expect(r.stars).toBe(0);
    expect(r.detail.moves).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. fortune-wheel (ТЗ §2.5)
// ─────────────────────────────────────────────────────────────────────────────

describe("fortune-wheel · score / total_questions", () => {
  const cfg = config(
    "fortune-wheel",
    [
      choice("i1", { bucket: "Сложение" }),
      choice("i2", { bucket: "Сложение" }),
      choice("i3", { bucket: "Вычитание" }),
      choice("i4", { bucket: "Вычитание" }),
    ],
    { sectors: ["Сложение", "Вычитание"] },
  );

  it("процент от ВСЕХ вопросов, а не от отвеченных", () => {
    // Ответили на 1 из 4 и угадали → 25%, не 100%.
    const r = scoreFortuneWheel(cfg, [{ itemId: "i1", chosenIndex: 0 }]);
    expect(r.percent).toBe(25);
    expect(r.stars).toBe(1);
  });

  it("все секторы закрыты → 3 звезды, даже если не все верны", () => {
    const r = scoreFortuneWheel(cfg, [
      { itemId: "i1", chosenIndex: 0 },
      { itemId: "i2", chosenIndex: 1 }, // неверно, но вопрос закрыт
      { itemId: "i3", chosenIndex: 0 },
      { itemId: "i4", chosenIndex: 1 },
    ]);
    expect(r.detail.sectorProgress).toEqual({
      Сложение: { done: 2, total: 2 },
      Вычитание: { done: 2, total: 2 },
    });
    expect(r.stars).toBe(3);
  });

  it("ratio > 0.6 → 2 звезды, сектор открыт", () => {
    // 3 из 4 верных = 0.75 > 0.6, но сектор «Вычитание» не тронут.
    const r = scoreFortuneWheel(cfg, [
      { itemId: "i1", chosenIndex: 0 },
      { itemId: "i2", chosenIndex: 0 },
      { itemId: "i3", chosenIndex: 0 },
    ]);
    expect(r.percent).toBe(75);
    expect(r.stars).toBe(2);
  });

  it("пустой конфиг — 0 звёзд, без деления на ноль", () => {
    const r = scoreFortuneWheel(config("fortune-wheel", []), []);
    expect(r.percent).toBe(0);
    expect(r.stars).toBe(0);
    expect(r.maxScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. jeopardy (ТЗ §2.6)
// ─────────────────────────────────────────────────────────────────────────────

describe("jeopardy · очки клеток и argmax", () => {
  const cfg = config(
    "jeopardy",
    [
      { ...choice("i1"), bucket: "Математика", points: 100 },
      { ...choice("i2"), bucket: "Математика", points: 200 },
      { ...choice("i3"), bucket: "Природа", points: 100 },
      { ...choice("i4"), bucket: "Природа", points: 200 },
    ],
    { categories: ["Математика", "Природа"], pointLadder: [100, 200] },
  );

  it("очки берутся из клетки, не из присланного клиентом", () => {
    const r = scoreJeopardy(cfg, [
      { itemId: "i1", chosenIndex: 0, player: "Иван" },
      { itemId: "i2", chosenIndex: 0, player: "Иван" },
    ]);
    expect(r.detail.playerScores).toEqual({ Иван: 300 });
    expect(r.maxScore).toBe(600);
  });

  it("winner = argmax, при ничьей берётся первый по алфавиту", () => {
    const r = scoreJeopardy(cfg, [
      { itemId: "i1", chosenIndex: 0, player: "Маша" }, // 100
      { itemId: "i2", chosenIndex: 0, player: "Иван" }, // 200
      { itemId: "i3", chosenIndex: 0, player: "Иван" }, // 100 → 300
      { itemId: "i4", chosenIndex: 1, player: "Маша" }, // неверно
    ]);
    expect(r.detail.playerScores).toEqual({ Иван: 300, Маша: 100 });
    expect(r.detail.winner).toBe("Иван");
    expect(r.percent).toBe(75);
  });

  it("без очков winner = null, а не 'undefined'", () => {
    const r = scoreJeopardy(cfg, [{ itemId: "i1", chosenIndex: 1, player: "Маша" }]);
    expect(r.detail.winner).toBe("Маша"); // 0 очков, но единственный игрок
    const empty = scoreJeopardy(cfg, []);
    expect(empty.detail.winner).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. sort-sequence (ТЗ §2.7)
// ─────────────────────────────────────────────────────────────────────────────

describe("sort-sequence · позиции на своих местах", () => {
  const cfg = config(
    "sort-sequence",
    [
      { id: "i1", prompt: "2/9", orderIndex: 0 },
      { id: "i2", prompt: "1/3", orderIndex: 1 },
      { id: "i3", prompt: "0,3", orderIndex: 2 },
      { id: "i4", prompt: "10/11", orderIndex: 3 },
    ],
    { mode: "order", principle: "по возрастанию" },
  );

  it("идеальный порядок → 100%", () => {
    const r = scoreSortSequence(cfg, [
      { itemId: "i1", chosenOrder: ["i1", "i2", "i3", "i4"] },
    ]);
    expect(r.detail.positionsCorrect).toBe(4);
    expect(r.percent).toBe(100);
    expect(r.maxScore).toBe(4);
  });

  it("две позиции из четырёх → 50%", () => {
    const r = scoreSortSequence(cfg, [
      { itemId: "i1", chosenOrder: ["i1", "i4", "i3", "i2"] },
    ]);
    expect(r.detail.positionsCorrect).toBe(2);
    expect(r.percent).toBe(50);
  });

  it("повторный id не засчитывается дважды", () => {
    const r = scoreSortSequence(cfg, [
      { itemId: "i1", chosenOrder: ["i1", "i1", "i1", "i1"] },
    ]);
    expect(r.detail.positionsCorrect).toBe(1);
  });

  it("неполный порядок: совпавшая позиция засчитывается, хвост — нет", () => {
    const r = scoreSortSequence(cfg, [{ itemId: "i1", chosenOrder: ["i1", "i2"] }]);
    expect(r.detail.positionsCorrect).toBe(2);
    expect(r.percent).toBe(50); // 2 из 4 в эталоне
  });

  it("объекты без orderIndex не входят в эталон", () => {
    const cfg2 = config("sort-sequence", [
      { id: "i1", prompt: "a" },
      { id: "i2", prompt: "b", orderIndex: 0 },
    ]);
    // Эталон = ["i2"] (только у i2 есть orderIndex). Ученик поставил i1
    // первым — это не совпадение, поэтому 0 из 1.
    const r = scoreSortSequence(cfg2, [{ itemId: "i1", chosenOrder: ["i1", "i2"] }]);
    expect(r.maxScore).toBe(1);
    expect(r.detail.positionsCorrect).toBe(0);
    expect(r.percent).toBe(0);
    expect(r.wrongItemIds).toEqual(["i2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Граничные случаи и недоверенный вход
// ─────────────────────────────────────────────────────────────────────────────

describe("пустой конфиг и мусор во входе", () => {
  it("пустой конфиг не роняет ни один формат (деление на ноль)", () => {
    for (const format of [
      "quiz-race",
      "sort-baskets",
      "jump-truth",
      "fortune-wheel",
      "jeopardy",
      "sort-sequence",
    ] as const) {
      const r = scoreAttempt(config(format, []), []);
      expect(r.score).toBe(0);
      expect(r.maxScore).toBe(0);
      expect(r.percent).toBe(0);
      expect(r.stars).toBe(0);
      expect(Number.isFinite(r.percent)).toBe(true);
    }
  });

  it("одно задание: верный ответ → 100%, неверный → 0%", () => {
    const ok = scoreAttempt(config("quiz-race", [choice("i1")]), [
      { itemId: "i1", chosenIndex: 0 },
    ]);
    expect(ok.percent).toBe(100);

    const bad = scoreAttempt(config("quiz-race", [choice("i1")]), [
      { itemId: "i1", chosenIndex: 1 },
    ]);
    expect(bad.percent).toBe(0);
    expect(bad.wrongItemIds).toEqual(["i1"]);
  });

  it("незнакомый itemId игнорируется — очки не начисляются", () => {
    const r = scoreAttempt(config("quiz-race", [choice("i1")]), [
      { itemId: "i1", chosenIndex: 0 },
      { itemId: "hacked", chosenIndex: 0 },
    ]);
    expect(r.score).toBe(100);
    expect(r.detail.correct).toBe(1);
  });

  it("индекс вне диапазона не засчитывается как верный", () => {
    const r = scoreAttempt(config("quiz-race", [choice("i1")]), [
      { itemId: "i1", chosenIndex: 99 },
    ]);
    expect(r.score).toBe(0);
    expect(r.percent).toBe(0);
  });

  it("неизвестный формат → нули, без исключения", () => {
    const bogus = { format: "unknown-format", title: "x", items: [choice("i1")], options: {} };
    const r = scoreAttempt(bogus as unknown as InteractiveConfig, [
      { itemId: "i1", chosenIndex: 0 },
    ]);
    expect(r.score).toBe(0);
    expect(r.percent).toBe(0);
  });

  it("answers не массив не ломает скоринг", () => {
    const r = scoreAttempt(config("quiz-race", [choice("i1")]), undefined as never);
    expect(r.score).toBe(0);
  });
});

describe("входные данные не мутируются", () => {
  it("скоринг всех 6 форматов не трогает config и answers", () => {
    const configs: InteractiveConfig[] = [
      config("quiz-race", [choice("i1"), choice("i2")], { secondsPerItem: 20 }),
      config("sort-baskets", [{ id: "i1", prompt: "a", correctBucket: "A" }], { baskets: ["A"] }),
      config("jump-truth", [{ id: "i1", prompt: "t", isTrue: true }]),
      config("fortune-wheel", [choice("i1", { bucket: "S" })], { sectors: ["S"] }),
      config("jeopardy", [{ ...choice("i1"), points: 200 }], { categories: ["C"] }),
      config("sort-sequence", [{ id: "i1", prompt: "a", orderIndex: 0 }]),
    ];
    const answers: AttemptAnswer[] = [
      { itemId: "i1", chosenIndex: 0, ms: 500 },
      { itemId: "i1", chosenTrue: true },
      { itemId: "i1", chosenBucket: "A" },
      { itemId: "i1", chosenOrder: ["i1"] },
      { itemId: "i1", player: "Иван" },
    ];

    for (const cfg of configs) {
      const beforeConfig = snapshot(cfg);
      const beforeAnswers = snapshot(answers);
      for (const a of answers) scoreAttempt(cfg, [a]);
      expect(snapshot(cfg)).toBe(beforeConfig);
      expect(snapshot(answers)).toBe(beforeAnswers);
    }
  });
});

describe("itemResults · разбор по заданиям для сводки учителя", () => {
  it("по одному вердикту на ОТВЕЧЕННОЕ задание, незакрытых нет", () => {
    const cfg = config("quiz-race", [choice("i1"), choice("i2"), choice("i3")]);
    const r = scoreAttempt(cfg, [
      { itemId: "i1", chosenIndex: 0 },
      { itemId: "i2", chosenIndex: 1 },
    ]);
    // i3 не отвечен — его нет в разборе, иначе учитель увидит «0 из 0».
    expect(r.itemResults).toEqual([
      { itemId: "i1", correct: true },
      { itemId: "i2", correct: false },
    ]);
    // Разбор не может разойтись с баллами: он собран тем же циклом.
    expect(r.itemResults.filter((x) => x.correct).length).toBe(r.detail.correct);
    expect(r.itemResults.filter((x) => !x.correct).length).toBe(r.detail.wrong);
  });

  it("сортировка: вердикты по позициям, повтор id не дублируется", () => {
    const cfg = config("sort-sequence", [
      { id: "i1", prompt: "a", orderIndex: 0 },
      { id: "i2", prompt: "b", orderIndex: 1 },
    ]);
    const r = scoreSortSequence(cfg, [{ itemId: "i1", chosenOrder: ["i1", "i1"] }]);
    expect(r.itemResults).toEqual([{ itemId: "i1", correct: true }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Детерминированная валидация
// ─────────────────────────────────────────────────────────────────────────────

describe("validateInteractiveConfig", () => {
  it("хороший конфиг — без замечаний", () => {
    const cfg = config("quiz-race", [choice("i1"), choice("i2")]);
    expect(validateInteractiveConfig(cfg)).toEqual([]);
  });

  it("правильный вариант ровно один: битый индекс ловится", () => {
    const cfg = config("quiz-race", [{ ...choice("i1"), correctIndex: 7 }]);
    const issues = validateInteractiveConfig(cfg);
    expect(issues.map((i) => i.code)).toContain("no-correct");
  });

  it("дубли вариантов ловятся", () => {
    const cfg = config("quiz-race", [
      { id: "i1", prompt: "p", options: ["да", "Да", "нет"], correctIndex: 0 },
    ]);
    const issues = validateInteractiveConfig(cfg);
    expect(issues.map((i) => i.code)).toContain("duplicate-options");
  });

  it("jump-truth без isTrue — замечание", () => {
    const cfg = config("jump-truth", [{ id: "i1", prompt: "p" }]);
    expect(validateInteractiveConfig(cfg).map((i) => i.code)).toContain("missing-truth");
  });

  it("sort-sequence без orderIndex — замечание", () => {
    const cfg = config("sort-sequence", [{ id: "i1", prompt: "p" }]);
    expect(validateInteractiveConfig(cfg).map((i) => i.code)).toContain("missing-order");
  });

  it("пустой конфиг и повторяющийся id", () => {
    expect(validateInteractiveConfig(config("quiz-race", [])).map((i) => i.code)).toEqual([
      "empty-items",
    ]);
    const dup = config("quiz-race", [choice("i1"), choice("i1")]);
    expect(validateInteractiveConfig(dup).map((i) => i.code)).toContain("duplicate-id");
  });
});

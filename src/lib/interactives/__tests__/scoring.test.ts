/**
 * Скоринг интерактивов (TZ-13 §2) — по одному тесту на КАЖДУЮ формулу из ТЗ.
 *
 * Эти функции — зеркало серверного скоринга, поэтому тесты написаны не
 * «по реализации», а по тексту ТЗ: если формула в коде разойдётся с ТЗ, тест
 * должен упасть, а не «пройти как раньше».
 *
 * Покрыты ВСЕ шесть форматов (DoD фазы 1: «юнит-тесты scoring.ts — 100%
 * покрытие по всем 6 форматам»), включая граничные случаи: пустые ответы,
 * нулевой знаменатель, вторая попытка, ловушки, карточка «в две корзины».
 */

import { describe, it, expect } from "vitest";
import {
  scoreQuizRace,
  scoreSortBaskets,
  scoreJumpTruth,
  scoreFortuneWheel,
  scoreJeopardy,
  scoreSortSequence,
  scoreInteractive,
  starsFromPercent,
  maxScoreOf,
  scoreSummary,
  QUIZ_BASE_POINTS,
  QUIZ_ITEM_MAX_POINTS,
  QUIZ_SPEED_BONUS_MAX,
} from "../scoring";
import type { ClientAttemptAnswer, InteractiveConfig } from "../types";

/* ─── helpers ────────────────────────────────────────────────────────────── */

function quiz(answers: ClientAttemptAnswer[], secondsPerItem = 10): InteractiveConfig {
  return {
    format: "quiz-race",
    title: "Дроби",
    options: { itemCount: 2, secondsPerItem, shuffleOptions: false },
    items: [
      { id: "q1", prompt: "1/2 + 1/2 = ?", options: ["1", "2"], correctIndex: 0 },
      { id: "q2", prompt: "1/4 — это?", options: ["0,25", "0,4"], correctIndex: 0 },
    ],
  };
}

const BASKETS: InteractiveConfig = {
  format: "sort-baskets",
  title: "Свой / чужой",
  options: { baskets: ["Свой", "Чужой"] },
  items: [
    { id: "b1", prompt: "Собака", correctBucket: "Свой" },
    { id: "b2", prompt: "Стол", correctBucket: "Свой" },
    { id: "b3", prompt: "Луна", isTrap: true },
  ],
};

const JUMP: InteractiveConfig = {
  format: "jump-truth",
  title: "Правда или ложь",
  options: { itemCount: 3, boardSize: 8, mines: 3 },
  items: [
    { id: "j1", prompt: "Неправильные дроби меньше 1", isTrue: true },
    { id: "j2", prompt: "Пять больше трёх", isTrue: false },
    { id: "j3", prompt: "У квадрата 5 сторон", isTrue: false },
  ],
};

const WHEEL: InteractiveConfig = {
  format: "fortune-wheel",
  title: "Колесо",
  options: { sectors: ["Сложение", "Вычитание"], questionsPerSector: 2 },
  items: [
    { id: "w1", prompt: "2+2", bucket: "Сложение", options: ["4", "5"], correctIndex: 0 },
    { id: "w2", prompt: "3+3", bucket: "Сложение", options: ["6", "7"], correctIndex: 1 },
    { id: "w3", prompt: "7−2", bucket: "Вычитание", options: ["5", "4"], correctIndex: 0 },
    { id: "w4", prompt: "9−4", bucket: "Вычитание", options: ["5", "6"], correctIndex: 0 },
  ],
};

const JEOPARDY: InteractiveConfig = {
  format: "jeopardy",
  title: "Своя игра",
  options: { categories: ["Лёгкое", "Сложное"], rows: 2, pointLadder: [100, 200] },
  items: [
    { id: "p1", prompt: "Вопрос на 100", bucket: "Лёгкое", points: 100, options: ["да", "нет"], correctIndex: 0 },
    { id: "p2", prompt: "Вопрос на 200", bucket: "Лёгкое", points: 200, options: ["да", "нет"], correctIndex: 0 },
    { id: "p3", prompt: "Вопрос на 100", bucket: "Сложное", points: 100, options: ["да", "нет"], correctIndex: 1 },
    { id: "p4", prompt: "Вопрос на 200", bucket: "Сложное", points: 200, options: ["да", "нет"], correctIndex: 1 },
  ],
};

const SEQUENCE: InteractiveConfig = {
  format: "sort-sequence",
  title: "По возрастанию",
  options: { itemCount: 3, mode: "order", principle: "ascending" },
  items: [
    { id: "s3", prompt: "три", orderIndex: 2 },
    { id: "s1", prompt: "один", orderIndex: 0 },
    { id: "s2", prompt: "два", orderIndex: 1 },
  ],
};

/* ─── 1. Викторина-гонка (ТЗ §2.2) ──────────────────────────────────────── */

describe("quiz-race", () => {
  it("базовые 100 + бонус за скорость (50 при мгновенном ответе)", () => {
    const s = scoreQuizRace({
      config: quiz([]),
      answers: [{ itemId: "q1", chosenIndex: 0, ms: 0 }],
    });
    expect(s.score).toBe(QUIZ_BASE_POINTS + QUIZ_SPEED_BONUS_MAX);
    expect(s.maxScore).toBe(2 * QUIZ_ITEM_MAX_POINTS);
    expect(s.percent).toBe(100);
    expect(s.detail.ratio).toBe(1);
  });

  it("бонус за скорость убывает линейно по remaining/total", () => {
    // 10 секунд на вопрос, ответил за 5 секунд → половина бонуса: round(50*0.5) = 25.
    const s = scoreQuizRace({
      config: quiz([]),
      answers: [{ itemId: "q1", chosenIndex: 0, ms: 5000 }],
    });
    expect(s.score).toBe(125);
  });

  it("неправильный ответ — 0 очков, percent по отвеченным", () => {
    const s = scoreQuizRace({
      config: quiz([]),
      answers: [
        { itemId: "q1", chosenIndex: 0, ms: 0 },
        { itemId: "q2", chosenIndex: 1, ms: 0 },
      ],
    });
    expect(s.score).toBe(150);
    expect(s.detail.correct).toBe(1);
    expect(s.percent).toBe(50);
    expect(s.wrongItemIds).toEqual(["q2"]);
  });

  it("вторая попытка режет очки вдвое (ТЗ «очки режутся вдвое»)", () => {
    const s = scoreQuizRace({
      config: quiz([]),
      answers: [
        { itemId: "q1", chosenIndex: 0, ms: 0 },
        { itemId: "q2", chosenIndex: 0, secondTry: true, ms: 0 },
      ],
    });
    // q1 = 150, q2 = floor(150 / 2) = 75
    expect(s.score).toBe(225);
    expect(s.percent).toBe(100);
  });

  it("без таймера бонуса за скорость нет: ровно 100 за вопрос", () => {
    const s = scoreQuizRace({
      config: quiz([], 0),
      answers: [
        { itemId: "q1", chosenIndex: 0, ms: 0 },
        { itemId: "q2", chosenIndex: 0, ms: 0 },
      ],
    });
    expect(s.score).toBe(200);
  });

  it("без ответов percent = 0, а не NaN", () => {
    const s = scoreQuizRace({ config: quiz([]), answers: [] });
    expect(s.score).toBe(0);
    expect(s.percent).toBe(0);
    expect(s.detail.ratio).toBe(0);
  });

  it("неизвестный itemId и мусор в ответе игнорируются", () => {
    const s = scoreQuizRace({
      config: quiz([]),
      answers: [
        { itemId: "нет-такого", chosenIndex: 0, ms: 0 },
        { itemId: "q1" },
      ] as ClientAttemptAnswer[],
    });
    expect(s.score).toBe(0);
    expect(s.percent).toBe(0);
  });
});

/* ─── 2. Группировка по корзинам (ТЗ §2.3) ───────────────────────────────── */

describe("sort-baskets", () => {
  it("correct = карточки в своей корзине, percent = correct/total", () => {
    const s = scoreSortBaskets({
      config: BASKETS,
      answers: [{ itemId: "b1", chosenBucket: "Свой" }],
    });
    expect(s.score).toBe(1);
    // `total` = размещаемые карточки. Ловушка (`b3`) в него НЕ входит — так
    // считает и клиент (`isPlaceable`), и сервер (`!i.isTrap`). Значит
    // maxScore = 2, а не 3: ставить ловушку нельзя, и она не должна создавать
    // потолок, до которого невозможно дотянуться.
    expect(s.maxScore).toBe(2);
    expect(s.percent).toBe(50);
    expect(s.detail.errors).toBe(0);
  });

  it("звёзды: errors <= 2 → 3, <= 5 → 2, дальше → 1", () => {
    // `detail.errors` больше НЕ приходит от клиента: это число неверных
    // размещений, которое скоринг САМ считает по ответам (зеркалит сервер).
    // Нужное число ошибок задаём числом заведомо неверных корзин.
    //
    // Фикстура BASKETS годится только для 2 размещаемых карточек, а пороги
    // звёзд — 2 и 5, поэтому собираем конфиг на 7 предметов: иначе часть
    // порогов физически недостижима и тест ничего не проверяет.
    const many: InteractiveConfig = {
      format: "sort-baskets",
      title: "Свой / чужой",
      options: { baskets: ["Свой", "Чужой"] },
      items: Array.from({ length: 7 }, (_, i) => ({
        id: `m${i}`,
        prompt: `Предмет ${i}`,
        correctBucket: "Свой",
      })),
    };
    const withErrors = (errors: number) =>
      scoreSortBaskets({
        config: many,
        answers: [
          // Первая карточка — верная (ошибки не добавляет), остальные — неверные.
          { itemId: "m0", chosenBucket: "Свой" },
          ...Array.from({ length: errors }, (_, i) => ({
            itemId: `m${i + 1}`,
            chosenBucket: "Чужой",
          })),
        ],
      }).stars;
    expect(withErrors(0)).toBe(3);
    expect(withErrors(2)).toBe(3);
    expect(withErrors(3)).toBe(2);
    expect(withErrors(5)).toBe(2);
    expect(withErrors(6)).toBe(1);
  });

  it("ловушка не даёт очка и не входит в total (maxScore = 2, 100% достижим)", () => {
    const s = scoreSortBaskets({
      config: BASKETS,
      answers: [
        { itemId: "b1", chosenBucket: "Свой" },
        { itemId: "b2", chosenBucket: "Свой" },
        { itemId: "b3", chosenBucket: "__trap__" },
      ],
    });
    expect(s.score).toBe(2);
    // Ловушка исключена из `total`, поэтому 2 из 2 = 100%, а не 67%.
    expect(s.percent).toBe(100);
  });

  it("карточка «в две корзины» (bucket через |) принимается в любую", () => {
    const config: InteractiveConfig = {
      ...BASKETS,
      items: [{ id: "x1", prompt: "И то и другое", correctBucket: "Свой|Чужой" }],
    };
    expect(
      scoreSortBaskets({ config, answers: [{ itemId: "x1", chosenBucket: "Чужой" }] }).score,
    ).toBe(1);
    expect(
      scoreSortBaskets({ config, answers: [{ itemId: "x1", chosenBucket: "Свой" }] }).score,
    ).toBe(1);
  });
});

/* ─── 3. Прыг по правде (ТЗ §2.4) ───────────────────────────────────────── */

describe("jump-truth", () => {
  it("percent по формуле correct / (correct + wrong)", () => {
    const s = scoreJumpTruth({
      config: JUMP,
      answers: [
        { itemId: "j1", chosenTrue: true },
        { itemId: "j2", chosenTrue: true },
      ],
      moves: 7,
    });
    expect(s.detail.correct).toBe(1);
    expect(s.detail.wrong).toBe(1);
    expect(s.percent).toBe(50);
    expect(s.detail.moves).toBe(7);
  });

  it("неотвеченные утверждения не портят процент (знаменатель = ответы)", () => {
    const s = scoreJumpTruth({
      config: JUMP,
      answers: [{ itemId: "j1", chosenTrue: true }],
      moves: 1,
    });
    expect(s.percent).toBe(100);
    expect(s.maxScore).toBe(3);
  });

  it("без ответов percent = 0", () => {
    expect(scoreJumpTruth({ config: JUMP, answers: [] }).percent).toBe(0);
  });
});

/* ─── 4. Колесо фортуны (ТЗ §2.5) ───────────────────────────────────────── */

describe("fortune-wheel", () => {
  it("score = число правильных, percent = score/total", () => {
    const s = scoreFortuneWheel({
      config: WHEEL,
      answers: [
        { itemId: "w1", chosenIndex: 0 },
        { itemId: "w2", chosenIndex: 0 },
        { itemId: "w3", chosenIndex: 0 },
        { itemId: "w4", chosenIndex: 1 },
      ],
    });
    // Верных ровно 2: w1 (выбран 0, правильный 0) и w3 (выбран 0, правильный 0).
    // У w2 правильный индекс 1, у w4 правильный 0 — выбранные индексы неверны.
    // Раньше стояло 3/75: тест засчитывал ответы, не совпадающие с конфигом.
    expect(s.score).toBe(2);
    expect(s.percent).toBe(50);
  });

  it("неверный ответ закрывает вопрос: done растёт, очко не даётся", () => {
    const s = scoreFortuneWheel({
      config: WHEEL,
      answers: [
        { itemId: "w1", chosenIndex: 0 },
        { itemId: "w2", chosenIndex: 0 },
      ],
    });
    expect(s.score).toBe(1);
    expect(s.detail.sectorProgress?.["Сложение"]).toEqual({ done: 2, total: 2 });
    expect(s.detail.sectorProgress?.["Вычитание"]).toEqual({ done: 0, total: 2 });
  });

  it("все секторы пройдены → 3 звезды", () => {
    const s = scoreFortuneWheel({
      config: WHEEL,
      answers: [
        { itemId: "w1", chosenIndex: 0 },
        { itemId: "w2", chosenIndex: 1 },
        { itemId: "w3", chosenIndex: 0 },
        { itemId: "w4", chosenIndex: 0 },
      ],
    });
    expect(s.stars).toBe(3);
  });

  it("доля 0.25 — но 3 звезды: все секторы закрыты", () => {
    const s = scoreFortuneWheel({
      config: WHEEL,
      answers: [
        { itemId: "w1", chosenIndex: 0 },
        { itemId: "w2", chosenIndex: 0 },
        { itemId: "w3", chosenIndex: 1 },
        { itemId: "w4", chosenIndex: 1 },
      ],
    });
    // Верный только w1. У w2 правильный индекс 1, у w3 и w4 — 0, выбрано 0/1/1.
    expect(s.score).toBe(1);
    expect(s.score / 4).toBe(0.25);
    // Звёзды 3, а не 1. Правило ТЗ §2.5 буквальное: «все секторы пройдены ? 3».
    // «Пройден» = вопрос закрыт ответом (верным или нет), поэтому ответивший
    // на всё получает 3 звезды независимо от результата — см. примечание
    // в конце describe, это продуктовый вопрос, а не баг.
    expect(s.stars).toBe(3);
  });

  /*
   * ⚠️ ПРОДУКТОВЫЙ ВОПРОС, а не баг (зафиксировано 02.10.2026).
   *
   * ТЗ §2.5 дословно: `stars = все секторы пройдены ? 3 : score/total > 0.6 ? 2 : 1`.
   * «Пройден» = вопрос закрыт ответом, верным или нет. Практический вывод:
   * ученик, ответивший на 1 вопрос из 4 (25%), получает 3 звезды, потому что
   * все секторы формально закрыты. Ветка «> 0.6» при полном прохождении
   * недостижима почти никогда.
   *
   * Клиент и сервер считают одинаково (см. `WHEEL_STARS_RATIO` и
   * `STAR3_PERCENT/STAR2_PERCENT` в бэкенде), тесты фиксируют ИМЕННО ЭТО
   * поведение. Менять его — продуктовое решение: например, требовать для
   * трёх звёзд ещё и долю правильных ответов.
   */

  it("доля РОВНО 0.6 — 3 звезды: сработала ветка «все секторы пройдены»", () => {
    // Пять вопросов, три верных = ровно 0.6. Формально «> 0.6» не выполнено.
    const config: InteractiveConfig = {
      ...WHEEL,
      items: [
        ...WHEEL.items,
        { id: "w5", prompt: "ещё", bucket: "Сложение", options: ["1", "2"], correctIndex: 0 },
      ],
    };
    const s = scoreFortuneWheel({
      config,
      answers: [
        { itemId: "w1", chosenIndex: 0 },
        { itemId: "w2", chosenIndex: 1 },
        { itemId: "w3", chosenIndex: 0 },
        { itemId: "w4", chosenIndex: 1 },
        { itemId: "w5", chosenIndex: 1 },
      ],
    });
    // Верные: w1 (0===0), w2 (1===1), w3 (0===0). w4 и w5 — нет.
    expect(s.score).toBe(3);
    expect(s.score / 5).toBeCloseTo(0.6, 5);
    // 3 звезды при доле 0.6: сработала первая ветка правила (все секторы
    // закрыты ответами), до порога «> 0.6» дело не дошло.
    expect(s.stars).toBe(3);
  });
});

/* ─── 5. Своя игра (ТЗ §2.6) ────────────────────────────────────────────── */

describe("jeopardy", () => {
  it("percent = правильные клетки / все клетки", () => {
    const s = scoreJeopardy({
      config: JEOPARDY,
      answers: [
        { itemId: "p1", chosenIndex: 0 },
        { itemId: "p3", chosenIndex: 1 },
      ],
      playerScores: { Иван: 300, Маша: 500 },
    });
    expect(s.detail.correct).toBe(2);
    expect(s.percent).toBe(50);
    expect(s.maxScore).toBe(600);
  });

  it("winner = argmax, в score идёт счёт победителя", () => {
    const s = scoreJeopardy({
      config: JEOPARDY,
      answers: [],
      playerScores: { Иван: 700, Маша: 500 },
    });
    expect(s.detail.winner).toBe("Иван");
    expect(s.score).toBe(700);
  });

  it("при равенстве очков побеждает тот, кто введён раньше", () => {
    const s = scoreJeopardy({
      config: JEOPARDY,
      answers: [],
      playerScores: { Иван: 400, Маша: 400 },
    });
    expect(s.detail.winner).toBe("Иван");
  });

  it("без игроков winner = null, а не падение", () => {
    const s = scoreJeopardy({ config: JEOPARDY, answers: [] });
    expect(s.detail.winner).toBeNull();
    expect(s.score).toBe(0);
  });
});

/* ─── 6. Сортировка (ТЗ §2.7) ───────────────────────────────────────────── */

describe("sort-sequence", () => {
  it("positions_correct считает совпавшие позиции, а не соседств", () => {
    const s = scoreSortSequence({
      config: SEQUENCE,
      answers: [{ itemId: "s1", chosenOrder: ["s2", "s1", "s3"] }],
    });
    // эталон s1, s2, s3 → совпала только позиция 3
    expect(s.detail.positionsCorrect).toBe(1);
    expect(s.percent).toBe(33);
  });

  it("идеальный порядок = 100%", () => {
    const s = scoreSortSequence({
      config: SEQUENCE,
      answers: [{ itemId: "s1", chosenOrder: ["s1", "s2", "s3"] }],
    });
    expect(s.percent).toBe(100);
    expect(s.maxScore).toBe(3);
  });

  it("пустой порядок = 0, без деления на ноль", () => {
    const s = scoreSortSequence({ config: SEQUENCE, answers: [] });
    expect(s.percent).toBe(0);
    expect(s.detail.positionsCorrect).toBe(0);
  });

  it("эталон строится по orderIndex даже при непоследовательных индексах", () => {
    const config: InteractiveConfig = {
      ...SEQUENCE,
      items: [
        { id: "a", prompt: "a", orderIndex: 10 },
        { id: "b", prompt: "b", orderIndex: 20 },
        { id: "c", prompt: "c", orderIndex: 30 },
      ],
    };
    const s = scoreSortSequence({
      config,
      answers: [{ itemId: "a", chosenOrder: ["a", "b", "c"] }],
    });
    expect(s.percent).toBe(100);
  });
});

/* ─── диспетчер, максимумы, сводка ───────────────────────────────────────── */

/**
 * По одному рабочему случаю на каждый из шести форматов.
 *
 * Объявлено на модульном уровне, а не внутри describe: кейсы нужны и
 * диспетчеру, и блоку «вспомогательное» ниже. Когда массив жил внутри
 * describe, нижний блок его не видел и падал с «Cannot find name 'cases'».
 */
const ALL_FORMAT_CASES: Array<[InteractiveConfig, ClientAttemptAnswer[]]> = [
  [quiz([]), [{ itemId: "q1", chosenIndex: 0, ms: 0 }]],
  [BASKETS, [{ itemId: "b1", chosenBucket: "Свой" }]],
  [JUMP, [{ itemId: "j1", chosenTrue: true }]],
  [WHEEL, [{ itemId: "w1", chosenIndex: 0 }]],
  [JEOPARDY, [{ itemId: "p1", chosenIndex: 0 }]],
  [SEQUENCE, [{ itemId: "s1", chosenOrder: ["s1", "s2", "s3"] }]],
];

describe("scoreInteractive — диспетчер по формату", () => {
  const cases = ALL_FORMAT_CASES;

  it.each(cases)("%s считается и не падает", (config, answers) => {
    const s = scoreInteractive(config.format, { config, answers });
    expect(s.percent).toBeGreaterThanOrEqual(0);
    expect(s.percent).toBeLessThanOrEqual(100);
    expect(s.maxScore).toBeGreaterThan(0);
  });

  it("все шесть форматов покрыты (смена списка = падение теста)", () => {
    expect(cases.map(([c]) => c.format).sort()).toEqual(
      [
        "fortune-wheel",
        "jeopardy",
        "jump-truth",
        "quiz-race",
        "sort-baskets",
        "sort-sequence",
      ].sort(),
    );
  });
});

describe("вспомогательное", () => {
  it("starsFromPercent: 80+ → 3, 50+ → 2, ниже 50 → 1, без ответов → 0", () => {
    // Пороги взяты не «с потолка», а из реализации: клиентский
    // `PERCENT_STARS = { three: 80, two: 50 }` обязан совпадать с серверным
    // `STAR3_PERCENT = 80 / STAR2_PERCENT = 50`. Раньше тест ждал 85/60, чего
    // нет ни на клиенте, ни на сервере, — то есть проверял несуществующее
    // правило и падал.
    //
    // Второй аргумент — сколько заданий отвечено. Он важен: при `answered <= 0`
    // звёзд нет вовсе, даже при percent = 100, иначе «идеальная» пустая попытка
    // выглядела бы как лучший результат.
    expect(starsFromPercent(100, 10)).toBe(3);
    expect(starsFromPercent(80, 10)).toBe(3);
    expect(starsFromPercent(79, 10)).toBe(2);
    expect(starsFromPercent(50, 10)).toBe(2);
    expect(starsFromPercent(49, 10)).toBe(1);
    expect(starsFromPercent(0, 10)).toBe(1);
    expect(starsFromPercent(100, 0)).toBe(0);
  });

  it("maxScoreOf совпадает с maxScore скоринга", () => {
    for (const [config] of ALL_FORMAT_CASES) {
      expect(maxScoreOf(config)).toBe(
        scoreInteractive(config.format, { config, answers: [] }).maxScore,
      );
    }
  });

  it("scoreSummary даёт тексты для всех шести форматов", () => {
    for (const [config, answers] of ALL_FORMAT_CASES) {
      const s = scoreInteractive(config.format, { config, answers });
      const summary = scoreSummary(config.format, s);
      expect(summary.headline.length).toBeGreaterThan(0);
      expect(summary.details.length).toBeGreaterThan(0);
    }
  });
});

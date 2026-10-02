/**
 * Реестр форматов (TZ-13 §4.3) — метаданные, дефолты и нормализация опций.
 *
 * Что здесь защищаем:
 *   - все шесть форматов на месте и у каждого есть метаданные и дефолты
 *     (новый формат без реестра = тихо пустой плеер);
 *   - `normalizeOptions` ЗАЖИМАЕТ мусор: LLM-ранклер может прислать что угодно,
 *     а плеер обязан получить играбельные числа (ТЗ Р-3);
 *   - `validateFormatOptions` не молчит, а говорит учителю, что поправил.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_OPTIONS,
  FORMAT_META,
  SORT_PRINCIPLES,
  formatMeta,
  isInteractiveFormat,
  normalizeOptions,
  totalCodeDays,
  validateFormatOptions,
} from "../formats";
import { INTERACTIVE_FORMATS, type InteractiveFormat, type InteractiveOptions } from "../types";

describe("реестр форматов", () => {
  it("все шесть форматов ТЗ §2.1 зарегистрированы", () => {
    expect([...INTERACTIVE_FORMATS]).toEqual([
      "quiz-race",
      "sort-baskets",
      "jump-truth",
      "fortune-wheel",
      "jeopardy",
      "sort-sequence",
    ]);
  });

  it("у каждого формата есть метаданные и дефолтные опции", () => {
    for (const format of INTERACTIVE_FORMATS) {
      const meta = FORMAT_META[format];
      expect(meta.title.length, format).toBeGreaterThan(0);
      expect(meta.mechanic.length, format).toBeGreaterThan(0);
      expect(meta.codeDays, format).toBeGreaterThan(0);
      expect(meta.settings.length, format).toBeGreaterThan(0);
      expect(DEFAULT_OPTIONS[format], format).toBeTruthy();
    }
  });

  it("оценка объёма по ТЗ §2.1 сходится к 12.5 дня", () => {
    expect(totalCodeDays()).toBeCloseTo(12.5, 5);
  });

  it("викторина-гонка помечена рекомендуемой (сценарий A, шаг 3)", () => {
    expect(FORMAT_META["quiz-race"].recommended).toBe(true);
  });

  it("isInteractiveFormat отсекает мусор", () => {
    expect(isInteractiveFormat("quiz-race")).toBe(true);
    expect(isInteractiveFormat("unknown")).toBe(false);
    expect(isInteractiveFormat(42)).toBe(false);
    expect(isInteractiveFormat(null)).toBe(false);
  });

  it("formatMeta для неизвестного значения не падает", () => {
    const fallback = formatMeta("нет-такого" as InteractiveFormat);
    expect(fallback.title.length).toBeGreaterThan(0);
  });

  it("список принципов сортировки закрытый (ТЗ §2.7 «не пишет свой»)", () => {
    expect(Object.keys(SORT_PRINCIPLES).length).toBeGreaterThan(2);
  });
});

describe("normalizeOptions", () => {
  it("quiz-race: таймер приводится к 10/20/30/0", () => {
    const as = (v: unknown) =>
      (normalizeOptions("quiz-race", { secondsPerItem: v } as InteractiveOptions) as { secondsPerItem: number })
        .secondsPerItem;
    expect(as(10)).toBe(10);
    expect(as(30)).toBe(30);
    expect(as(0)).toBe(0);
    expect(as(17)).toBe(20);
    expect(as("мусор")).toBe(20);
  });

  it("quiz-race: количество вопросов зажато в 3..20", () => {
    const n = (v: unknown) =>
      (normalizeOptions("quiz-race", { itemCount: v } as InteractiveOptions) as { itemCount: number }).itemCount;
    expect(n(1)).toBe(3);
    expect(n(100)).toBe(20);
    expect(n(12)).toBe(12);
  });

  it("sort-baskets: одна корзина заменяется на две (иначе нечего группировать)", () => {
    const o = normalizeOptions("sort-baskets", { baskets: ["Одна"] }) as { baskets: string[] };
    expect(o.baskets).toEqual(["Свой", "Чужой"]);
  });

  it("sort-baskets: максимум четыре корзины, дубли и мусор убираются", () => {
    const o = normalizeOptions("sort-baskets", {
      baskets: ["А", "А", "Б", "В", "Г", "Д", 42],
    } as unknown as InteractiveOptions) as { baskets: string[] };
    expect(o.baskets).toEqual(["А", "Б", "В", "Г"]);
  });

  it("jump-truth: поле только 6 или 8, мины не больше размера поля", () => {
    expect((normalizeOptions("jump-truth", { boardSize: 7 }) as { boardSize: number }).boardSize).toBe(8);
    expect((normalizeOptions("jump-truth", { boardSize: 6 }) as { boardSize: number }).boardSize).toBe(6);
    const o = normalizeOptions("jump-truth", { boardSize: 6, mines: 50 }) as { mines: number };
    expect(o.mines).toBe(6);
  });

  it("fortune-wheel: секторов меньше двух — берём дефолт", () => {
    const o = normalizeOptions("fortune-wheel", { sectors: ["Один"] }) as { sectors: string[] };
    expect(o.sectors.length).toBeGreaterThanOrEqual(2);
  });

  it("jeopardy: mode только solo или queue, лестница очков 2..4 значения", () => {
    expect((normalizeOptions("jeopardy", { mode: "чепуха" }) as { mode: string }).mode).toBe("solo");
    expect((normalizeOptions("jeopardy", { mode: "queue" }) as { mode: string }).mode).toBe("queue");
    const ladder = (normalizeOptions("jeopardy", { pointLadder: [100, 200, 300, 400, 500] }) as {
      pointLadder: number[];
    }).pointLadder;
    expect(ladder.length).toBe(4);
  });

  it("sort-sequence: mode только order или classify", () => {
    expect((normalizeOptions("sort-sequence", { mode: "бред" }) as { mode: string }).mode).toBe("order");
    expect((normalizeOptions("sort-sequence", { mode: "classify" }) as { mode: string }).mode).toBe(
      "classify",
    );
  });

  it("null и undefined не ломают normalizeOptions", () => {
    for (const format of INTERACTIVE_FORMATS) {
      expect(() => normalizeOptions(format, null)).not.toThrow();
      expect(() => normalizeOptions(format, undefined)).not.toThrow();
    }
  });
});

describe("validateFormatOptions", () => {
  it("чистые опции не дают замечаний", () => {
    expect(validateFormatOptions("quiz-race", { itemCount: 10, secondsPerItem: 20 })).toEqual([]);
  });

  it("сообщает о зажатом значении, а не молча чинит", () => {
    const issues = validateFormatOptions("quiz-race", { itemCount: 99 });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("itemCount");
  });

  it("ругается на неизвестный принцип сортировки", () => {
    const issues = validateFormatOptions("sort-sequence", { principle: "на глазок" });
    expect(issues.join(" ")).toContain("principle");
  });

  it("ругается на недопустимый режим игры", () => {
    expect(validateFormatOptions("jeopardy", { mode: "как-нибудь" }).join(" ")).toContain("mode");
  });

  it("корзина одна — понятное сообщение учителю", () => {
    expect(validateFormatOptions("sort-baskets", { baskets: ["Одна"] }).length).toBeGreaterThan(0);
  });
});

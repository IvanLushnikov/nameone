/**
 * Доверие к распознаванию: что решает сервер, а что порог (ТЗ-18 §7 + ТЗ-19).
 *
 * ГЛАВНОЕ ЗДЕСЬ, а не в остальных тестах: признак `needsReview` приходит с
 * сервера, и он важнее клиентского порога. Если бы интерфейс решал по-своему,
 * учитель увидел бы в перепроверке задание, которого сервер не просит, поставил
 * бы по нему отметку — и она улетела бы в никуда, а учитель считал бы, что
 * сохранил.
 *
 * Порог при этом не выброшен: он решает, где данных о признаке ещё нет
 * (старые сохранённые результаты, тестовые фикстуры), и по нему показывается
 * уверенность в интерфейсе.
 */

import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  confidenceHistogram,
  confidencePercent,
  confidenceState,
  isConfident,
  partitionByConfidence,
} from "@/lib/photo-check/confidence";
import type { PhotoCheckItem } from "@/lib/photo-check/types";

/**
 * Фикстура БЕЗ серверного признака `needsReview` — то есть данные, где флага
 * ещё нет. На них проверяется фолбэк на порог. Для проверки приоритета сервера
 * признак проставляется явно через `over`.
 */
function item(over: Partial<PhotoCheckItem> = {}): PhotoCheckItem {
  return {
    number: 1,
    taskText: "Задание",
    expected: "10",
    studentAnswer: "10",
    correct: true,
    verdict: "correct",
    pointsAwarded: 1,
    maxPoints: 1,
    confidence: 0.95,
    // По умолчанию флаг снят: в данных без серверного признака работает
    // фолбэк на порог. Тесты про приоритет сервера проставляют его явно.
    needsReview: undefined as unknown as boolean,
    comment: null,
    ...over,
  };
}

describe("приоритет серверного признака (решение владельца, 04.10.2026)", () => {
  it("needsReview=true уводит в перепроверку даже при уверенности 0.99", () => {
    // Порог здесь 0.85, то есть по нему это задание было бы «уверенным».
    // Решает сервер — иначе ручная отметка по нему улетит в никуда.
    expect(confidenceState(item({ confidence: 0.99, needsReview: true }))).toBe("unsure");
  });

  it("needsReview=false оставляет задание в разобранных даже при уверенности 0.1", () => {
    expect(confidenceState(item({ confidence: 0.1, needsReview: false }))).toBe("confident");
  });

  it("нулевая уверенность при needsReview=false — всё равно разобрано: решил сервер", () => {
    expect(confidenceState(item({ confidence: 0, needsReview: false }))).toBe("confident");
  });

  it("нет ответа на фото — даже при needsReview=false это «не разобрано»", () => {
    // Отсутствие ответа нельзя превратить в уверенный verdict: тогда блок
    // показывает зелёную галочку на пустом месте.
    expect(confidenceState(item({ studentAnswer: null, needsReview: false }))).toBe("unrecognized");
  });

  it("partitionByConfidence разводит по серверному признаку, а не по порогу", () => {
    const items = [
      item({ number: 1, confidence: 0.99, needsReview: true }),
      item({ number: 2, confidence: 0.2, needsReview: false }),
    ];
    const p = partitionByConfidence(items);
    expect(p.review.map((i) => i.number)).toEqual([1]);
    expect(p.confident.map((i) => i.number)).toEqual([2]);
  });
});

describe("порог уверенности", () => {
  it("равен решению владельца — 0.85", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.85);
  });

  it("confidence на пороге — доверяем, ниже порога — нет", () => {
    expect(confidenceState(item({ confidence: 0.85 }))).toBe("confident");
    expect(confidenceState(item({ confidence: 0.84 }))).toBe("unsure");
  });

  it("null и не-число — это «не проверено», а не «уверенно»", () => {
    expect(confidenceState(item({ confidence: null }))).toBe("unsure");
    expect(confidenceState(item({ confidence: Number.NaN }))).toBe("unsure");
    expect(isConfident(item({ confidence: null }))).toBe(false);
  });

  it("нет распознанного ответа — отдельное состояние «не распознано»", () => {
    const s = confidenceState(item({ studentAnswer: null, confidence: 0.99 }));
    expect(s).toBe("unrecognized");
  });

  it("вердикт «не разобрал» не становится уверенным даже при высокой цифре", () => {
    const s = confidenceState(item({ confidence: 0.99, verdict: "unclear" }));
    expect(s).toBe("unsure");
  });

  it("работает и когда серверный признак есть, если он совпадает с порогом", () => {
    // Признак и порог могут разойтись при смене настроек: тогда решает сервер,
    // и это нормально. Тест фиксирует, что разворот приоритета не ломает
    // обычный случай «флаг совпал с порогом».
    expect(confidenceState(item({ confidence: 0.9, needsReview: true }))).toBe("unsure");
    expect(confidenceState(item({ confidence: 0.9, needsReview: false }))).toBe("confident");
  });

  it("порог переопределяется аргументом, а не правкой кода", () => {
    expect(confidenceState(item({ confidence: 0.7 }), 0.6)).toBe("confident");
    expect(confidenceState(item({ confidence: 0.7 }), 0.9)).toBe("unsure");
  });
});

describe("разбор результата на состояния", () => {
  const items: PhotoCheckItem[] = [
    item({ number: 1, confidence: 0.97, verdict: "correct" }),
    item({ number: 2, confidence: 0.7, verdict: "correct" }), // бэк назвал верным при 0.7
    item({ number: 3, studentAnswer: null, confidence: 0.9, verdict: "unclear" }),
    item({ number: 4, confidence: null, verdict: "correct" }),
    item({ number: 5, confidence: 0.86, verdict: "incorrect" }),
  ];

  it("раскладывает по трём состояниям и собирает блок проверки", () => {
    const p = partitionByConfidence(items);
    expect(p.confident.map((i) => i.number)).toEqual([1, 5]);
    expect(p.unsure.map((i) => i.number)).toEqual([2, 4]);
    expect(p.unrecognized.map((i) => i.number)).toEqual([3]);
    expect(p.review.map((i) => i.number)).toEqual([2, 3, 4]);
    expect(p.total).toBe(5);
    expect(p.threshold).toBe(CONFIDENCE_THRESHOLD);
  });

  it("блок проверки идёт в исходном порядке номеров, а не «сначала неуверенные»", () => {
    const p = partitionByConfidence([
      item({ number: 3, studentAnswer: null }),
      item({ number: 1, confidence: 0.5 }),
      item({ number: 2, confidence: 0.95 }),
    ]);
    expect(p.review.map((i) => i.number)).toEqual([3, 1]);
  });

  it("когда сомнительных нет — блок проверки пуст", () => {
    const p = partitionByConfidence([item({ confidence: 0.9 })]);
    expect(p.review).toHaveLength(0);
  });
});

describe("вспомогательное", () => {
  it("проценты показываются честно, включая отсутствие числа", () => {
    expect(confidencePercent(0.857)).toBe("86%");
    expect(confidencePercent(0)).toBe("0%");
    expect(confidencePercent(null)).toBe("нет данных");
  });

  it("гистограмма считает все задания, а не только сомнительные", () => {
    const h = confidenceHistogram([
      item({ number: 1, confidence: 0.3 }),
      item({ number: 2, confidence: 0.6 }),
      item({ number: 3, confidence: 0.8 }),
      item({ number: 4, confidence: 0.9 }),
      item({ number: 5, confidence: null }),
    ]);
    expect(h).toEqual({ low: 1, mid: 1, high: 1, top: 1, unknown: 1 });
  });
});

/**
 * Тесты для мока КТП (src/lib/mock/ktp.ts).
 *
 * Покрытие минимум (TZ-03):
 *   1. Happy-path: 5 кл русский → totalHours === 68, 34 недели, 34 записи.
 *   2. Edge-case: тем в таксономии меньше, чем нужно → циклический обход.
 *
 * Плюс дополнительные проверки, чтобы ловить регрессии в матрице часов и датах.
 */
import { describe, it, expect } from "vitest";
import { generateKtp, computeWeekDates } from "@/lib/mock/ktp";
import { getGrade } from "@/lib/content/subjects";
import type { GenerationRequest } from "@/lib/types";

function req(partial: Partial<GenerationRequest>): GenerationRequest {
  return {
    subject: "russian",
    grade: 5,
    topic: "orfografiya-korney",
    difficulty: "medium",
    count: 10,
    type: "ktp",
    withAnswers: true,
    withExplanations: false,
    schoolYear: "2026/2027",
    ...partial,
  };
}

describe("generateKtp — 5 кл русский (happy-path, 68 ч)", () => {
  it("возвращает totalHours=68 и 34 недели", async () => {
    const ktp = await generateKtp(req({}));
    expect(ktp.totalHours).toBe(68);
    expect(ktp.weeks.length).toBe(34);
    expect(ktp.subject).toBe("russian");
    expect(ktp.grade).toBe(5);
    expect(ktp.schoolYear).toBe("2026/2027");
  });

  it("каждая неделя имеет 1 запись × 2 ч, всего 68 часов", async () => {
    const ktp = await generateKtp(req({}));
    for (const week of ktp.weeks) {
      expect(week.entries.length).toBe(1);
      expect(week.entries[0].hours).toBe(2);
    }
    const total = ktp.weeks.reduce((sum, w) => sum + w.entries[0].hours, 0);
    expect(total).toBe(68);
    expect(ktp.weeks[0].entries[0].num).toBe(1);
    expect(ktp.weeks[33].entries[0].num).toBe(34);
  });

  it("даты считаются от 1 сентября — week 1 = 01.09–06.09, week 2 = 08.09–13.09", async () => {
    expect(computeWeekDates(1, "2026/2027")).toBe("01.09–06.09");
    expect(computeWeekDates(2, "2026/2027")).toBe("08.09–13.09");
  });

  it("entry № 10 = control, № 20 = test (детерминированный kind)", async () => {
    const ktp = await generateKtp(req({}));
    const allEntries = ktp.weeks.flatMap((w) => w.entries);
    const e10 = allEntries.find((e) => e.num === 10);
    const e20 = allEntries.find((e) => e.num === 20);
    expect(e10?.kind).toBe("control");
    expect(e20?.kind).toBe("test");
  });
});

describe("generateKtp — edge-case: циклический обход тем", () => {
  it("5 кл русский: 7 тем закольцованы на 34 записи (распределение по индексам 0..6)", async () => {
    const ktp = await generateKtp(req({}));
    const allEntries = ktp.weeks.flatMap((w) => w.entries);
    expect(allEntries.length).toBe(34);
    // Проверяем, что entry num=N получает тему topics[(N-1) % 7].
    // topics[0] для русского 5 кл — "Чередующиеся гласные в корне".
    const grade = getGrade("russian", 5);
    expect(grade).toBeDefined();
    const topics = grade!.topics;
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.length).toBeLessThan(allEntries.length); // условие edge-case
    for (let n = 1; n <= 34; n++) {
      const entry = allEntries.find((e) => e.num === n);
      const expectedTopic = topics[(n - 1) % topics.length];
      expect(entry).toBeDefined();
      expect(entry!.topic).toBe(expectedTopic.title);
    }
  });

  it("entry № 1 имеет fgosRef первой темы, следующий цикл — той же первой темы", async () => {
    const ktp = await generateKtp(req({}));
    const allEntries = ktp.weeks.flatMap((w) => w.entries);
    const topics = getGrade("russian", 5)!.topics;
    // Число тем класса меняется при переносе тем между классами, поэтому
    // длину цикла берём из данных, а не из константы.
    const cycleEntry = topics.length + 1;
    const e1 = allEntries.find((e) => e.num === 1);
    const eCycle = allEntries.find((e) => e.num === cycleEntry);
    expect(cycleEntry).toBeLessThanOrEqual(allEntries.length);
    expect(e1!.topic).toBe(topics[0].title);
    expect(eCycle!.topic).toBe(topics[0].title); // (cycleEntry - 1) % topics.length === 0
    if (topics[0].fgosRef) {
      expect(e1!.fgosRef).toBe(topics[0].fgosRef);
      expect(eCycle!.fgosRef).toBe(topics[0].fgosRef);
    }
  });
});

describe("generateKtp — матрица часов для разных subject+grade", () => {
  it("английский 5 кл = 102 ч (3 ч/нед, 2 записи/нед)", async () => {
    const ktp = await generateKtp(
      req({ subject: "english", grade: 5, topic: "future-simple" })
    );
    expect(ktp.totalHours).toBe(102);
    expect(ktp.weeks.length).toBe(34);
    for (const week of ktp.weeks) {
      expect(week.entries.length).toBe(2);
      // 1-я запись — 2 ч, 2-я — 1 ч.
      expect(week.entries[0].hours).toBe(2);
      expect(week.entries[1].hours).toBe(1);
    }
    const total = ktp.weeks.reduce(
      (s, w) => s + w.entries[0].hours + w.entries[1].hours,
      0
    );
    expect(total).toBe(102);
  });

  it("математика 1 кл = 68 ч (fallback), алгебра 10 кл = 102 ч", async () => {
    const math1 = await generateKtp(
      req({ subject: "math", grade: 1, topic: "chisla-ot-1-do-10" })
    );
    expect(math1.totalHours).toBe(68);

    const alg10 = await generateKtp(
      req({ subject: "algebra", grade: 10, topic: "trigonometriya" })
    );
    expect(alg10.totalHours).toBe(102);
  });

  it("default schoolYear = '2026/2027', если не передан", async () => {
    const ktp = await generateKtp(req({ schoolYear: undefined }));
    expect(ktp.schoolYear).toBe("2026/2027");
  });
});

describe("computeWeekDates — корректность диапазона", () => {
  it("формат DD.MM–DD.MM, через en-dash", async () => {
    expect(computeWeekDates(1, "2026/2027")).toMatch(/^\d{2}\.\d{2}\u2013\d{2}\.\d{2}$/);
  });

  it("week 34 укладывается в конец учебного года (апрель следующего календарного года)", async () => {
    // 1 сент 2026 + (34-1)*7 = 231 день = 20 апреля 2027; старт + 5 дней = 25 апреля 2027.
    expect(computeWeekDates(34, "2026/2027")).toBe("20.04\u201325.04");
  });
});

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
import type { SubjectSlug } from "@/lib/types";
import type { GenerationRequest } from "@/lib/types";

/**
 * Класс, где тем МЕНЬШЕ, чем записей в плане (34) — единственный случай, в
 * котором цикл обхода тем замыкается. Ищем по данным, а не хардкодим: число
 * тем в классе меняется, когда таксономию дополняют (подключение тем ФГОС
 * добавило в 1 класс русского 62 темы), и зашитый класс однажды перестал быть
 * нужным.
 */
function findCyclingGrade(): { subject: SubjectSlug; grade: number; topic: string; topicCount: number } {
  for (let grade = 1; grade <= 11; grade += 1) {
    const g = getGrade("russian", grade);
    if (!g) continue;
    const topics = g.topics;
    if (topics.length >= 2 && topics.length < 34) {
      return { subject: "russian", grade, topic: topics[0]!.slug, topicCount: topics.length };
    }
  }
  throw new Error("нет класса, где тем меньше 34");
}


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
  // ЧТО ИЗМЕНИЛОСЬ 16.10.2026. Тест брал 5 класс русского и утверждал, что
  // там 7 тем, закольцованные на 34 записи. После подключения тем из
  // федеральных рабочих программ в этом классе их стало 122 — цикл там
  // больше не замыкается, и класс перестал быть примером edge-case.
  // Проверять формулу `(num - 1) % topics.length` на данных, где она не
  // срабатывает, бессмысленно. Поэтому ниже два честных случая:
  //   1) класс, где тем больше, чем записей — темы идут подряд, без повторов;
  //   2) класс, где тем меньше, чем записей — реальное закольцовывание.
  // Формула одна и та же, и она проверяется на обоих.

  it("класс, где тем больше, чем записей: темы идут подряд, без повторов", async () => {
    const ktp = await generateKtp(req({}));
    const allEntries = ktp.weeks.flatMap((w) => w.entries);
    expect(allEntries.length).toBe(34);
    const topics = getGrade("russian", 5)!.topics;
    expect(topics.length).toBeGreaterThan(allEntries.length); // условие этого случая
    for (let n = 1; n <= allEntries.length; n++) {
      const entry = allEntries.find((e) => e.num === n);
      expect(entry).toBeDefined();
      expect(entry!.topic).toBe(topics[n - 1].title);
    }
    // Повторов нет: каждая запись — своя тема.
    expect(new Set(allEntries.map((e) => e.topic)).size).toBe(allEntries.length);
  });

  it("класс, где тем меньше, чем записей: темы закольцованы, каждая попала в план", async () => {
    // Класс берём из данных: цикл замыкается только там, где тем меньше, чем
    // записей, а конкретный такой класс меняется при каждом расширении
    // таксономии.
    const found = findCyclingGrade();
    const ktp = await generateKtp(req({ subject: found.subject, grade: found.grade, topic: found.topic }));
    const allEntries = ktp.weeks.flatMap((w) => w.entries);
    // Длину плана берём из данных, а не константой: она тоже меняется вместе
    // с таксономией, и зашитое число однажды опровергает само себя.
    expect(allEntries.length).toBeGreaterThan(0);
    const topics = getGrade(found.subject, found.grade)!.topics;
    expect(topics.length).toBeGreaterThan(0);
    // Условие edge-case проверяется по факту, а не по предположению о данных:
    // цикл замыкается только когда тем меньше, чем записей.
    const cycles = Math.floor(allEntries.length / topics.length);
    expect(cycles, "цикл должен закрыться хотя бы раз — иначе это не тот случай").toBeGreaterThan(1);
    for (let n = 1; n <= allEntries.length; n++) {
      const entry = allEntries.find((e) => e.num === n);
      expect(entry).toBeDefined();
      expect(entry!.topic).toBe(topics[(n - 1) % topics.length].title);
    }
    // Ни одна тема класса не выпала из плана, и каждая встречалась.
    expect(new Set(allEntries.map((e) => e.topic))).toEqual(
      new Set(topics.map((t) => t.title)),
    );
  });

  it("entry № 1 имеет fgosRef первой темы, следующий цикл — той же первой темы", async () => {
    const found = findCyclingGrade();
    const ktp = await generateKtp(req({ subject: found.subject, grade: found.grade, topic: found.topic }));
    const allEntries = ktp.weeks.flatMap((w) => w.entries);
    const topics = getGrade(found.subject, found.grade)!.topics;
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

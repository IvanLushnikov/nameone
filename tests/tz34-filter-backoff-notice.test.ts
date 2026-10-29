/**
 * ТЗ-34, Q-08: УЧИТЕЛЬ ВИДИТ ПРАВДУ ПРО ОТКАТ ФИЛЬТРА.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО НЕ ТАК
 * ─────────────────────────────────────────────────────────────────────────────
 * Признак `quality.filterBackedOff` вычислялся неверно: он стоял `true`
 * именно тогда, когда фильтр НИЧЕГО не отбросил. То есть «откат фильтра» и
 * «всё чисто» выглядели одинаково, и отличить их по ответу было невозможно.
 *
 * На экране это превращалось в прямую неправду: учителю, которому не хватило
 * заданий по другой причине, говорили «Фильтр отсеял слишком много заданий,
 * поэтому часть материала оставлена без изменений» — про фильтр, который не
 * отсеял ни одного.
 *
 * Теперь признак значит ровно одно: фильтр ОТКАтил свою проверку. И строка
 * про откат показывается именно тогда, когда откат был.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЧИСТАЯ ФУНКЦИЯ, А НЕ ТЕСТ КОМПОНЕНТА
 * ─────────────────────────────────────────────────────────────────────────────
 * Решение «показывать блок или нет» принимается в `buildQualityNotice`.
 * Пока оно живёт в JSX, «блок не нарисован» и «блок нарисован пустым»
 * выглядят на скриншоте одинаково.
 */

import { describe, it, expect } from "vitest";

import { buildQualityNotice } from "@/lib/constructor/quality-notice";
import type { QualityLoss } from "@/lib/client/llm";

const base = (over: Partial<QualityLoss> = {}): QualityLoss => ({
  requested: 12,
  delivered: 12,
  dropped: 0,
  droppedPatternRef: [],
  droppedForeignMath: [],
  cleanedAnswer: [],
  topUpAdded: 0,
  stillMissing: 0,
  filterBackedOff: false,
  repeatedSkills: 0,
  ...over,
});

/** Строка про откат фильтра — как её видит учитель. */
const BACKOFF_LINE = /Фильтр качества откатил/i;

describe("ТЗ-34: признак отката фильтра в тексте для учителя", () => {
  it("отката не было — строку про откат учитель не видит", () => {
    // Материала не хватило, но фильтр не откатывал проверку: виноват не он.
    const notice = buildQualityNotice(
      base({ delivered: 10, stillMissing: 2 }),
      null,
    );
    expect(notice).toBeTruthy();
    expect(notice!.lines.join(" ")).not.toMatch(BACKOFF_LINE);
  });

  it("откат был — строка появляется, даже когда заданий хватает", () => {
    // Откат не уменьшает лист — он возвращает в него задания, которые
    // проверка не пропустила. Учитель обязан знать об этом ДО печати, даже
    // если объём материала в норме.
    const notice = buildQualityNotice(
      base({ filterBackedOff: true, stillMissing: 0 }),
      null,
    );
    expect(notice).toBeTruthy();
    expect(notice!.tone).toBe("warning");
    expect(notice!.lines.join(" ")).toMatch(BACKOFF_LINE);
  });

  it("откат был и материала не хватило — обе правды видны", () => {
    const notice = buildQualityNotice(
      base({ filterBackedOff: true, delivered: 9, stillMissing: 3 }),
      null,
    );
    const text = notice!.lines.join(" ");
    expect(text).toMatch(BACKOFF_LINE);
    // И нехватка не потерялась.
    expect(notice!.title).toContain("12");
    expect(notice!.title).toContain("9");
  });

  it("отклонённые задания показываются, когда фильтр отбросил часть", () => {
    // Фильтр отбросил два задания и отката не было — учитель видит, что
    // именно отклонено и почему.
    const notice = buildQualityNotice(
      base({
        delivered: 10,
        stillMissing: 2,
        dropped: 2,
        droppedPatternRef: [4, 5],
      }),
      null,
    );
    const text = notice!.lines.join(" ");
    expect(text).toMatch(/2 задания отклонено/);
    expect(text).toMatch(/образец/);
    // И это НЕ откат.
    expect(text).not.toMatch(BACKOFF_LINE);
  });

  it("чистый лист не показывает ничего лишнего", () => {
    expect(buildQualityNotice(base(), null)).toBeNull();
  });
});

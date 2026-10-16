/**
 * СЧЁТЧИК ЗАДАНИЙ БЕЗ КЛЮЧА ВИДИТ УЧИТЕЛЬ (ТЗ-32, AD-4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО НЕ ТАК
 *
 * На листе по обществознанию 9 класс у части заданий (эссе) не оказалось строки
 * ответа: фильтр обнулил ответ-заглушку и оставил само задание. При этом сайт
 * обещает ответы, и учитель узнавал об отсутствии ключа уже на печати — то
 * есть после того, как отдал работу классу.
 *
 * Теперь бэкенд считает такие задания по финальному листу и отдаёт число в
 * `quality.tasksWithoutAnswer`, а интерфейс превращает его в строку ДО кнопки
 * скачивания. Тест защищает именно эту цепочку: если число снова перестанет
 * доезжать до текста, предупреждение исчезнет молча.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ НУЛЕВОЙ СЧЁТЧИК НИЧЕГО НЕ ПОКАЗЫВАЕТ
 *
 * Банкер «все ответы на месте» — это та же тишина, только с текстом. Учитель
 * должен видеть предупреждение тогда, когда есть что поправить, а не всегда.
 */

import { describe, it, expect } from "vitest";

import { buildQualityNotice } from "@/lib/constructor/quality-notice";
import type { QualityLoss } from "@/lib/client/llm";

const base = (over: Partial<QualityLoss> = {}): QualityLoss => ({
  requested: 10,
  delivered: 10,
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

describe("ТЗ-32 AD-4: задания без ключа видны учителю", () => {
  it("нулевой счётчик не рисует ничего", () => {
    expect(buildQualityNotice(base({ tasksWithoutAnswer: 0 }), null)).toBeNull();
  });

  it("одно задание без ключа даёт предупреждение", () => {
    const notice = buildQualityNotice(base({ tasksWithoutAnswer: 1 }), null);
    expect(notice).toBeTruthy();
    expect(notice!.tone).toBe("warning");
    expect(notice!.lines.join(" ")).toMatch(/нет ключа/i);
  });

  it("несколько заданий без ключа — количество названо", () => {
    const notice = buildQualityNotice(base({ tasksWithoutAnswer: 4 }), null);
    expect(notice).toBeTruthy();
    expect(notice!.lines.join(" ")).toContain("4");
    // Учителю сказано, что делать: ключ он составит сам.
    expect(notice!.lines.join(" ")).toMatch(/самому/i);
  });

  it("предупреждение появляется даже когда количество заданий верное", () => {
    // Ровно тот случай, который раньше уезжал молча: лист полного размера,
    // выглядит цельным, а ключа нет.
    const notice = buildQualityNotice(
      base({ requested: 10, delivered: 10, stillMissing: 0, tasksWithoutAnswer: 2 }),
      null,
    );
    expect(notice).toBeTruthy();
    expect(notice!.lines.join(" ")).toMatch(/нет ключа/i);
  });

  it("не теряет сообщение, когда одновременно не хватило заданий", () => {
    const notice = buildQualityNotice(
      base({ stillMissing: 3, delivered: 7, dropped: 3, tasksWithoutAnswer: 1 }),
      null,
    );
    expect(notice).toBeTruthy();
    const text = notice!.lines.join(" ");
    expect(text).toMatch(/в материале 7/i);
    expect(text).toMatch(/нет ключа/i);
  });

  it("ответ сервера без нового поля не ломает интерфейс", () => {
    // Материал из кэша, сохранённый до правки: поля нет. Молчание тут уместно —
    // дописать счётчик для такого ответа нечем.
    expect(buildQualityNotice(base(), null)).toBeNull();
  });
});
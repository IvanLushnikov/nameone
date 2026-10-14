/**
 * УЧИТЕЛЬ ВИДИТ, ЧТО ПОВТОР ОСТАЛСЯ (ТЗ-26, Г9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО НЕ ТАК
 * ─────────────────────────────────────────────────────────────────────────────
 * Конвейер знал, что повтор починить не удалось, но молчал. Лист приходил
 * полного размера, выглядел цельным, и повтор учителю приходилось замечать
 * самому. Замеры 14.10.2026 на контрольной «Квадратный трёхчлен» (алгебра 8):
 * модель возвращает «найдите корни квадратного трёхчлена» снова и снова, и в
 * части прогонов повтор уезжал.
 *
 * Теперь это поле `repeatedSkills` едет до интерфейса и превращается в строку
 * предупреждения. Задача теста — не дать этому механизму снова замолчать.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ОТДЕЛЬНЫМ БЛОКОМ, А НЕ ВМЕСТЕ С «НЕ ХВАТИЛО ЗАДАНИЙ»
 * ─────────────────────────────────────────────────────────────────────────────
 * Количество заданий может быть ровно правильным, а повтор — остаться. Если
 * вшить это в блок недостачи, предупреждение не появится никогда: условие
 * `stillMissing > 0` ложно. Это ровно тот случай, который и уезжал молча.
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

describe("ТЗ-26 Г9: повтор, который не убрали, показывается учителю", () => {
  it("чистый лист не показывает ничего лишнего", () => {
    expect(buildQualityNotice(base(), null)).toBeNull();
  });

  it("одна пара повторов даёт предупреждение", () => {
    const notice = buildQualityNotice(base({ repeatedSkills: 1 }), null);
    expect(notice).toBeTruthy();
    expect(notice!.tone).toBe("warning");
    expect(notice!.title).toMatch(/повтор/i);
    expect(notice!.lines.join(" ")).toMatch(/тот же навык/i);
  });

  it("несколько пар — количество названо, а не «что-то не так»", () => {
    const notice = buildQualityNotice(base({ repeatedSkills: 3 }), null);
    expect(notice).toBeTruthy();
    expect(notice!.lines.join(" ")).toContain("3");
  });

  it("срабатывает даже когда заданий ровно сколько просили", () => {
    // Ключевой случай: `stillMissing === 0`, поэтому старое условие было ложно.
    const notice = buildQualityNotice(
      base({ requested: 16, delivered: 16, stillMissing: 0, repeatedSkills: 2 }),
      null,
    );
    expect(notice, "повтор промолчал при правильном количестве заданий").toBeTruthy();
  });

  it("не выдумывает повтор там, где его нет", () => {
    const notice = buildQualityNotice(base({ repeatedSkills: 0, stillMissing: 2 }), null);
    expect(notice).toBeTruthy();
    expect(notice!.lines.join(" ")).not.toMatch(/тот же навык/i);
  });

  it("повтор не тонет в шуме других замечаний", () => {
    const notice = buildQualityNotice(
      base({ repeatedSkills: 1, dropped: 2, stillMissing: 1 }),
      null,
    );
    expect(notice!.lines.join(" ")).toMatch(/тот же навык/i);
  });

  it("учитель узнаёт и про повтор, и про пропавший второй вариант", () => {
    const notice = buildQualityNotice(base({ repeatedSkills: 1 }), {
      expected: 2,
      delivered: 2,
      degraded: true,
      degradedReason: "второй вариант повторил первый",
      retried: true,
    });
    expect(notice!.tone).toBe("warning");
    const text = notice!.lines.join(" ");
    expect(text).toMatch(/тот же навык/i);
    expect(text).toMatch(/второй получился копией/i);
  });
});
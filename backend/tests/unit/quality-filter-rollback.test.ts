/**
 * ТЗ-34, Q-08: ОТКАТ ФИЛЬТРА КАЧЕСТВА — ЭТО СОБЫТИЕ, А НЕ СЛЕДСТВИЕ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО НЕ ТАК
 * ─────────────────────────────────────────────────────────────────────────────
 * Фильтр умеет откатить свою работу: если он отбросил больше двух третей
 * заданий, результат считается ненадёжным, и фильтр возвращает исходный набор
 * целиком (см. конец `quality-filter.ts`). Отката не оставляло следов: по
 * отчёту «откатился» и «фильтр ничего не нашёл» выглядели одинаково.
 *
 * Из-за этого признак `filterBackedOff` в ответе API врал. Он вычислялся как
 * «фильтр ничего не отбросил» (`before - after == 0`), то есть стоял `true`
 * именно тогда, когда всё было чисто. Учитель, которому не хватило заданий
 * по другой причине, получал строку «Фильтр отсеял слишком много заданий,
 * поэтому часть материала оставлена без изменений» — про фильтр, который не
 * отсеял ни одного.
 *
 * Теперь откат отмечается ТАМ, ГДЕ ОН ПРОИСХОДИТ, и приезжает в отчёте
 * отдельным полем `rolledBack`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Не «в поле что-то записано», а РАЗЛИЧИЕ ТРЁХ СОСТОЯНИЙ, которые раньше
 * сливались в одно:
 *   1. фильтр откатил проверку;
 *   2. фильтр ничего не отбросил;
 *   3. фильтр отбросил часть заданий.
 *
 * Плюс главное: в конвейере `filterBackedOff` ставится ПО ФАКТУ ОТКАТА, и
 * «откат» больше нельзя спутать с «всё чисто». Это проверяется в
 * `sheet-dedupe-postcondition.test.ts` — на уровне ответа API.
 */

import { describe, it, expect } from "vitest";
import {
  filterTasks,
  type QualityFilterReport,
} from "../../src/llm/validation/quality-filter";

/**
 * То, что делает конвейер с отчётом фильтра перед тем, как его прочитать.
 *
 * `filterAndReport` (backend/src/llm/index.ts) выравнивает `report.after` по
 * фактическому числу заданий, которые уедут учителю: при откате фильтр
 * возвращает исходный набор, и «после» равно «до». Вот после этого
 * выравнивания откат и «фильтр ничего не отбросил» дают ОДНО И ТО ЖЕ число
 * `before - after == 0` — и различить их можно было только по отдельному
 * признаку.
 */
function asPipelineSeesIt(report: QualityFilterReport, delivered: number) {
  const after = report.after !== delivered ? delivered : report.after;
  return { before: report.before, after, dropped: report.before - after };
}

/** Задание, которое фильтр quality НЕ трогает. */
function okTask(n: number) {
  return {
    number: n,
    text: `Опишите устройство предмета номер ${n} и его назначение.`,
    answer: `Ответ ${n}`,
  };
}

/** Задание, которое фильтр выкидывает: ссылка на образец, которого нет. */
function brokenTask(n: number) {
  return {
    number: n,
    text: `Задание номер ${n}: выполните по образцу следующее задание.`,
    answer: `Ответ ${n}`,
  };
}

describe("откат фильтра качества: признак в отчёте", () => {
  it("откат помечается в отчёте", () => {
    // 6 заданий, фильтр выкинул 5 → остался 1, это меньше трети → откат.
    const tasks = [
      brokenTask(1),
      brokenTask(2),
      brokenTask(3),
      brokenTask(4),
      brokenTask(5),
      okTask(6),
    ];
    const { tasks: out, report } = filterTasks(tasks, "history");

    // Откат вернул исходный набор — это и есть смысл отката.
    expect(out).toHaveLength(tasks.length);
    expect(report.rolledBack).toBe(true);
  });

  it("фильтр, который ничего не отбросил, — это НЕ откат", () => {
    // Обычный лист: фильтр ничего не выкинул.
    const tasks = [okTask(1), okTask(2), okTask(3)];
    const { tasks: out, report } = filterTasks(tasks, "history");

    expect(out).toHaveLength(3);
    expect(report.rolledBack).toBe(false);
    expect(report.before).toBe(3);
    expect(report.after).toBe(3);
  });

  it("частичная фильтрация — тоже не откат", () => {
    // Выкинули одно из четырёх: треть осталась, отката нет.
    const tasks = [okTask(1), okTask(2), okTask(3), brokenTask(4)];
    const { tasks: out, report } = filterTasks(tasks, "history");

    expect(out).toHaveLength(3);
    expect(report.rolledBack).toBe(false);
    expect(report.droppedPatternRef).toEqual([4]);
  });

  it("«before - after == 0» откат от «ничего не отбросил» НЕ различает — различает rolledBack", () => {
    // Вот тот самый разрыв, из-за которого признак врал.
    const rolled = filterTasks(
      [brokenTask(1), brokenTask(2), brokenTask(3), brokenTask(4), okTask(5)],
      "history",
    );
    const clean = filterTasks([okTask(1), okTask(2), okTask(3)], "history");

    // После выравнивания, которое делает конвейер, ЧИСЛА ОДИНАКОВЫЕ:
    // и откат, и «фильтр ничего не отбросил» дают `before - after == 0`.
    const rolledSeen = asPipelineSeesIt(rolled.report, rolled.tasks.length);
    const cleanSeen = asPipelineSeesIt(clean.report, clean.tasks.length);
    expect(rolledSeen.dropped).toBe(0);
    expect(cleanSeen.dropped).toBe(0);

    // Различие — только в признаке отката. Он и есть источник правды.
    expect(rolled.report.rolledBack).toBe(true);
    expect(clean.report.rolledBack).toBe(false);
  });

  it("пустой лист — тоже откат: фильтр не имеет права вернуть ноль заданий", () => {
    // Отдельный случай отката: выкинули ВСЁ. Возвращать пустой лист нельзя —
    // учитель потратил попытку и не понял, куда делся материал.
    const tasks = [brokenTask(1), brokenTask(2), brokenTask(3)];
    const { tasks: out, report } = filterTasks(tasks, "history");

    expect(out).toHaveLength(3);
    expect(report.rolledBack).toBe(true);
  });
});

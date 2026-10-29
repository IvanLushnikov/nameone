/**
 * ПРОВЕРКА РАЗНООБРАЗИЯ ТИПОВ ЗАДАНИЙ ПОСЛЕ ГЕНЕРАЦИИ (ТЗ-34, Н-2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ─────────────────────────────────────────────────────────────────────────────
 * ТЗ-33 сделал правило разнообразия числами («не больше 2 заданий одного типа
 * из 4»), и числа подставляются в промпт дословно. Но проверяло правило только
 * МОДЕЛЬ, а она его нарушала: в живом ответе контрольной вариант 2 был
 * `short-answer, computation, computation, computation` — три расчёта из
 * четырёх при лимите «не больше 2 одного типа». В блоке `quality` ответа про
 * распределение типов не было ни одного поля, `dropped = 0` — нарушение не
 * заметил никто.
 *
 * Промпт — это просьба. Гарантию даёт код ПОСЛЕ ответа модели. Этот файл —
 * та самая гарантия.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧЕГО ФАЙЛ НЕ ДЕЛАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 *   · не переписывает задание за учителя — он либо находит нарушение, либо
 *     нет;
 *   · не меняет лимиты: они берутся из `diversityLimits()` реестра типов, то
 *     есть новый тип задания обслуживается автоматически, а не «ещё одним
 *     правилом в валидаторе»;
 *   · не выкидывает задания: нарушение либо чинится ЗАМЕНОЙ задания (в том же
 *     числе заданий, которое просил учитель), либо показывается в `quality`.
 */

import { diversityLimits } from "../../../../src/lib/content/task-types";

/** Задание в том виде, в каком оно лежит в листе. */
export interface TypedTaskLike {
  type?: unknown;
  [key: string]: unknown;
}

/**
 * Нарушение разнообразия.
 *
 * `type` — тип, которого слишком много; `actual` — сколько его вышло;
 * `limit` — сколько разрешено (`maxSameType`).
 *
 * `scope` — где нарушение: в конкретном варианте или по всей работе суммой.
 * Без него список из двух-трёх записей нечитаем: не видно, какой именно лист
 * однообразный.
 */
export interface TypeDiversityViolation {
  type: string;
  actual: number;
  limit: number;
  scope: string;
}

/** Группа заданий, для которой считается разнообразие. */
export interface DiversityGroup {
  /** Подпись группы: «variant1», «variant2», «work». */
  scope: string;
  /** Задания группы. */
  tasks: readonly TypedTaskLike[];
  /**
   * Сколько заданий в группе всего (включая те, у которых тип не указан).
   * Лимит считается от этого числа, а не от числа заданий с известным типом:
   * лист из четырёх заданий, у которых тип есть только у двух, всё равно
   * остаётся листом из четырёх.
   */
  count: number;
}

/**
 * Гистограмма типов по заданиям.
 *
 * Задания без типа или с типом вне реестра в гистограмму НЕ попадают: их
 * нельзя ни проверить, ни напечатать, и считать их «одним типом» нельзя.
 * Задание без типа — обычное дело (так приходят листы, созданные до
 * ТЗ-33), и из-за них проверка не должна ломаться.
 */
export function typeHistogram(tasks: readonly TypedTaskLike[]): Map<string, number> {
  const histogram = new Map<string, number>();
  for (const task of tasks) {
    const type = typeof task?.type === "string" ? task.type.trim() : "";
    if (!type) continue;
    histogram.set(type, (histogram.get(type) ?? 0) + 1);
  }
  return histogram;
}

/**
 * Нарушения разнообразия по группам заданий.
 *
 * Проверяется одно правило: ни один тип не встречается чаще `maxSameType`.
 * Остальные числа из `diversityLimits` (`minOtherTypes`, `minTypes`) — следствия
 * этого же правила, и отдельными нарушениями они не докладываются: в отчёт
 * идёт то, что учитель может прочитать: «тип X — 3 штуки при норме 2».
 *
 * Проверка идёт по каждой группе ОТДЕЛЬНО. Для контрольной это два варианта
 * плюс работа суммой: восемь заданий контрольной — это восемь, а не четыре.
 */
export function findTypeDiversityViolations(
  groups: readonly DiversityGroup[],
): TypeDiversityViolation[] {
  const violations: TypeDiversityViolation[] = [];
  for (const group of groups) {
    const limits = diversityLimits(group.count);
    const histogram = typeHistogram(group.tasks);
    for (const [type, actual] of histogram) {
      if (actual > limits.maxSameType) {
        violations.push({
          type,
          actual,
          limit: limits.maxSameType,
          scope: group.scope,
        });
      }
    }
  }
  return violations;
}

/**
 * Какое задание менять, чтобы нарушение ушло.
 *
 * Берётся задание САМОГО ЧАСТОГО типа (то самое, из-за которого нарушение) —
 * иначе мы заменим задание редкого типа, а нарушение останется.
 *
 * При нескольких типах с одинаковой частотой выбирается тот, у которого
 * больше всего «лишних» заданий сверх лимита: это и есть то, что реально
 * портит лист.
 *
 * Возвращает индекс задания в массиве (0-based) или `null`, если менять нечего.
 */
export function pickReplacementIndex(
  tasks: readonly TypedTaskLike[],
  violation: TypeDiversityViolation,
): number | null {
  const histogram = typeHistogram(tasks);
  let worstType: string | null = null;
  let worstExcess = 0;
  for (const [type, actual] of histogram) {
    const excess = actual - violation.limit;
    if (excess <= 0) continue;
    if (excess > worstExcess) {
      worstExcess = excess;
      worstType = type;
    }
  }
  if (!worstType) return null;
  // Меняем ПОСЛЕДНЕЕ задание этого типа: первое обычно самое сильное по
  // содержанию, а замена последнего меньше портит логику листа.
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const type = tasks[i]?.type;
    if (typeof type === "string" && type.trim() === worstType) return i;
  }
  return null;
}

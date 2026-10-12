/**
 * «Кто поставил отметку» — общая разметка для результата и для журнала.
 *
 * ГЛАВНАЯ МЫСЛЬ ПЕРЕРАБОТКИ: учитель должен видеть не «одну безликую
 * отметку», а ЧЬЁ это решение — машины или его. Поэтому метка это СЛОВО
 * («ИИ» / «вы»), а точка рядом — только украшение. На печати, где цвет мог и
 * не напечататься, по слову всё равно видно, чья это была отметка.
 *
 * Когда учитель поправил модель, показываются ОБЕ отметки: прежняя остаётся
 * на месте зачёркнутой, рядом появляется его, а в колонке «Кто поставил» —
 * «вы» и под ним «было: ИИ». Так через месяц по журналу видно, какие
 * отметки учительские, а какие модельные, и правка не выглядит ошибкой
 * распознавания.
 *
 * Модуль общий для результата проверки и для открытой работы в журнале:
 * через месяц именно копия этого куска разъехалась бы с панелью — правка в
 * одном месте тихо оставила бы второе место с чужим текстом.
 */

import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";
import type { MarkSource, PhotoVerdict } from "@/lib/photo-check/types";

export const VERDICT_LABEL: Record<PhotoVerdict, string> = {
  correct: "Верно",
  incorrect: "Неверно",
  unclear: "Не разобрал",
};

const VERDICT_TONE = {
  correct: "success",
  incorrect: "danger",
  unclear: "warm",
} as const;

/**
 * Разобрать строку результата на «кто поставил» и «что было до правки».
 *
 * `decidedBy` и `modelVerdict` необязательны в типе: ответ старого бека или
 * тестовая фикстура без них не должны ломать таблицу. Отсутствие поля
 * читается как «решила машина» — это и было поведением до ТЗ-19.
 */
export function markAttribution(item: {
  verdict: PhotoVerdict;
  decidedBy?: MarkSource;
  modelVerdict?: PhotoVerdict;
}): { byTeacher: boolean; modelVerdict: PhotoVerdict; changed: boolean } {
  const byTeacher = item.decidedBy === "teacher";
  const modelVerdict = item.modelVerdict ?? item.verdict;
  return { byTeacher, modelVerdict, changed: byTeacher && modelVerdict !== item.verdict };
}

/** Метка «ИИ» / «вы» с точкой. Точка — украшение, слово — главное. */
export function WhoLabel({
  byTeacher,
  className,
}: {
  byTeacher: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap",
        byTeacher ? "text-brand-800" : "text-warm-600",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "w-[7px] h-[7px] rounded-full shrink-0",
          byTeacher ? "bg-brand-600" : "bg-warm-400",
        )}
      />
      {byTeacher ? "вы" : "ИИ"}
    </span>
  );
}

/**
 * Отметка в колонке «Отметка».
 *
 * Поправленная строка показывает обе: прежняя зачёркнута, стрелка, новая.
 * Без зачёркнутой было бы не видно, ЧТО именно учитель исправил, — а это и
 * было главным вопросом при разборе.
 */
export function MarkBadges({
  verdict,
  modelVerdict,
  changed,
  withIcons = false,
}: {
  verdict: PhotoVerdict;
  modelVerdict: PhotoVerdict;
  changed: boolean;
  withIcons?: boolean;
}) {
  const icon = (v: PhotoVerdict) =>
    withIcons ? (
      <span aria-hidden>{v === "correct" ? "✅" : v === "incorrect" ? "❌" : "⚠️"}</span>
    ) : null;

  if (!changed) {
    return (
      <Badge tone={VERDICT_TONE[verdict]}>
        {icon(verdict)}
        {VERDICT_LABEL[verdict]}
      </Badge>
    );
  }

  return (
    <span className="flex items-center gap-2 flex-wrap">
      <Badge
        tone={VERDICT_TONE[modelVerdict]}
        className="line-through opacity-65 decoration-1"
      >
        {icon(modelVerdict)}
        {VERDICT_LABEL[modelVerdict]}
      </Badge>
      <span aria-hidden className="text-warm-400">
        →
      </span>
      <span className="sr-only">учитель изменил на</span>
      <Badge tone={VERDICT_TONE[verdict]}>
        {icon(verdict)}
        {VERDICT_LABEL[verdict]}
      </Badge>
    </span>
  );
}

/**
 * Ячейка «Кто поставил»: «вы», а под ним — «было: ИИ», если это правка.
 *
 * Строка «было: ИИ» нарочно без зачёркивания самой метки: «было» и есть
 * прошлое время, а зачёркнутое «ИИ» читалось бы как «это уже не ИИ».
 */
export function WhoCell({
  byTeacher,
  changed,
  className,
}: {
  byTeacher: boolean;
  changed: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <WhoLabel byTeacher={byTeacher} />
      {changed && (
        <div className="mt-1 flex items-center gap-1">
          <span className="text-xs text-warm-600">было:</span>
          <WhoLabel byTeacher={false} className="font-normal" />
        </div>
      )}
    </div>
  );
}
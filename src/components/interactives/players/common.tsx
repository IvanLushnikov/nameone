"use client";

/**
 * Общие куски всех шести плееров (движок, TZ-13 §4.3).
 *
 * Здесь то, что иначе пришлось бы копировать шесть раз: полоса прогресса,
 * список вариантов ответа, детерминированное перемешивание и сборка результата
 * для оболочки.
 *
 * Проверки снапшота из `localStorage` — НЕ здесь: у каждого формата своя форма
 * состояния, поэтому тип-гарды живут в самих плеерах (`isQuizState`,
 * `isWheelState` и т.п.). Общее здесь только то, что действительно общее.
 *
 * ⚠️ Всё собрано на UI-примитивах репы и Tailwind-классах. Новых примитивов и
 * библиотек не заводим.
 */

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import type { ClientAttemptAnswer, PlayerResult } from "@/lib/interactives/types";
import { scoreInteractive, type ScoringInput } from "@/lib/interactives/scoring";

/**
 * Длительность прохождения в целых секундах.
 *
 * `startedAt` приходит как `Date.now()` (unix ms). Время идёт в `duration_s`
 * попытки — учитель по нему видит, сколько заняла игра, поэтому округляем
 * вниз (не больше, чем реально прошло) и отсекаем отрицательное: часы на
 * устройстве ученика могут быть переведены назад прямо во время игры, и
 * без этой проверки в базу уехал бы `-3600`.
 */
export function elapsedSeconds(startedAt: number): number {
  const deltaMs = Date.now() - startedAt;
  return Math.max(0, Math.floor(deltaMs / 1000));
}

/**
 * Сборка результата для оболочки: ответы + счёт по формуле ТЗ + длительность.
 *
 * Защита от повторного финиша — здесь: один клик по «Закончить» (или один
 * авто-финиш на последнем задании) даёт ровно одну попытку отправки. Кнопка
 * могла остаться активной на долю секунды после перехода экрана, а повторная
 * отправка = вторая попытка в сводке учителя.
 */
export function useFinish(
  onFinish: (result: PlayerResult) => void,
): (input: ScoringInput, startedAt: number) => void {
  const doneRef = React.useRef(false);
  const onFinishRef = React.useRef(onFinish);
  React.useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  return React.useCallback((input: ScoringInput, startedAt: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onFinishRef.current({
      answers: input.answers as ClientAttemptAnswer[],
      score: scoreInteractive(input.config.format, input),
      durationS: elapsedSeconds(startedAt),
    });
  }, []);
}

/* ─── перемешивание вариантов ────────────────────────────────────────────── */

/**
 * Детерминированная перестановка индексов: одинаковый `seed` — одинаковый
 * порядок, при перезагрузке страницы и при восстановлении из `localStorage`.
 *
 * Обычный `Math.random()` здесь не годится: ученик перезагрузит страницу, и
 * правильный ответ переедет на другую кнопку — это выглядит как «взлом», хотя
 * ученик честно его нажал. `seed` — id задания, оно неизменно.
 */
export function shuffledIndices(count: number, seed: string): number[] {
  const indices = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  // Фишер–Йетс на детерминированном генераторе.
  for (let i = indices.length - 1; i > 0; i -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = Math.abs(state) % (i + 1);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices;
}

/* ─── полоса прогресса ───────────────────────────────────────────────────── */

export function Progress({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mb-4" data-interactive-progress="">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-sm text-warm-600">
          {label ?? `${done} из ${total}`}
        </span>
        <span className="text-sm font-medium text-warm-950">{percent}%</span>
      </div>
      <div
        className="h-2 w-full rounded-full bg-warm-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label ?? `Прогресс: ${done} из ${total}`}
      >
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/* ─── варианты ответа ────────────────────────────────────────────────────── */

/**
 * Список вариантов ответа. Один компонент на quiz-race, fortune-wheel и
 * jeopardy — у них механика выбора одинакова, различается только обёртка.
 */
export function ChoiceList({
  options,
  chosen,
  onChoose,
  correctIndex,
  reveal = false,
  itemId,
}: {
  options: string[];
  chosen?: number;
  onChoose: (index: number) => void;
  /** Показать правильный ответ (после проверки). */
  correctIndex?: number;
  reveal?: boolean;
  itemId: string;
}) {
  return (
    <ul className="space-y-2" data-interactive-options="" data-interactive-item={itemId}>
      {options.map((text, index) => {
        const isChosen = chosen === index;
        const isCorrect = reveal && correctIndex === index;
        const isWrong = reveal && isChosen && correctIndex !== index;
        return (
          <li key={`${itemId}-${index}`}>
            <button
              type="button"
              onClick={() => onChoose(index)}
              aria-pressed={isChosen}
              className={cn(
                "w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center gap-3",
                isCorrect && "border-emerald-400 bg-emerald-50",
                isWrong && "border-rose-400 bg-rose-50",
                !isCorrect && !isWrong && isChosen && "border-brand-500 bg-brand-50",
                !isCorrect && !isWrong && !isChosen && "border-warm-200 bg-white hover:border-warm-300",
              )}
              data-interactive-choice={index}
            >
              <span
                className={cn(
                  "shrink-0 w-7 h-7 rounded-lg grid place-items-center text-sm font-semibold",
                  isCorrect && "bg-emerald-500 text-white",
                  isWrong && "bg-rose-500 text-white",
                  !isCorrect && !isWrong && isChosen && "bg-brand-500 text-white",
                  !isCorrect && !isWrong && !isChosen && "bg-warm-100 text-warm-600",
                )}
                aria-hidden
              >
                {String.fromCharCode(65 + index)}
              </span>
              <span className="min-w-0 break-words text-warm-950">{text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

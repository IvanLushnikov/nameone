/**
 * Полоса шагов «Сфотографировать → Проверить → Разобрать».
 *
 * ЗАЧЕМ ОНА: раньше загрузка фото, согласие, список заданий, кнопка и лимит
 * лежали в одном полотне, и учителю было не видно, где он сейчас и сколько
 * шагов осталось. Полоса отвечает на оба вопроса словами и цифрами.
 *
 * Состояния шага:
 *   done    — шаг пройден, в кружке галочка;
 *   current — шаг текущий, кружок залит брендом, число жирное;
 *   blocked — шаг закрыт (нужен вход): в кружке «!», подпись не выбрасывается,
 *             а называет, что именно мешает («Войти в аккаунт»);
 *   todo    — шаг впереди, кружок с номером.
 *
 * Мобильная вёрстка: подписи не сжимаются в нечитаемую кашу, а полоса
 * прокручивается по горизонтали внутри себя (`overflow-x-auto`). Страница при
 * этом не разъезжается — прокручивается только сама полоса.
 */

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type StepState = "done" | "current" | "todo" | "blocked";

export interface CheckStep {
  label: string;
  state: StepState;
}

/** Кружок с номером/галочкой/восклицательным знаком. */
const CIRCLE: Record<StepState, string> = {
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  current: "bg-brand-700 text-white border-brand-700",
  todo: "bg-warm-100 text-warm-600 border-warm-200",
  blocked: "bg-amber-100 text-amber-900 border-amber-300",
};

const LABEL: Record<StepState, string> = {
  done: "text-warm-600",
  current: "text-warm-950 font-semibold",
  todo: "text-warm-500",
  blocked: "text-amber-900 font-semibold",
};

function Circle({ state, number }: { state: StepState; number: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 grid place-items-center w-5 h-5 sm:w-[22px] sm:h-[22px] rounded-full border text-xs font-semibold",
        CIRCLE[state],
      )}
    >
      {state === "done" ? "✓" : state === "blocked" ? "!" : number}
    </span>
  );
}

export function CheckSteps({ steps, className }: { steps: CheckStep[]; className?: string }) {
  return (
    <nav aria-label="Шаги проверки работы" className={cn("-mx-1", className)}>
      {/* На телефоне соединительные линии убраны (40px) и кружки чуть меньше:
          с ними полоса не влезает в 390px, и третий шаг уезжал за край —
          имя текущего шага читалось как «шага нет». Если полоса всё равно не
          влезла (экран 320px), она переносится на вторую строку, а не
          прокручивается. На широком экране — как в макете: линии есть. */}
      <ol className="flex flex-wrap sm:flex-nowrap items-center gap-y-1.5 px-1 py-0.5 text-xs sm:text-[13px]">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden
                className="hidden sm:block w-8 mx-2.5 h-px bg-warm-200 shrink-0"
              />
            )}
            <span
              className={cn(
                "flex items-center gap-1.5 sm:gap-[7px] whitespace-nowrap",
                LABEL[step.state],
              )}
              {...(step.state === "current" ? { "aria-current": "step" as const } : {})}
            >
              <Circle state={step.state} number={i + 1} />
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Шаги по экранам флоу. Вынесено, чтобы панель не собирала массив в четырёх
 * местах и не разъезжалась по подписям при смене состояния.
 */
export function photoCheckSteps(
  phase: "upload" | "running" | "result" | "access",
): CheckStep[] {
  if (phase === "access") {
    // Подпись второго шага меняется на ту, что реально блокирует: «Войти в
    // аккаунт». Шаг не выбрасывается — иначе выглядит, будто фото потерялось.
    return [
      { label: "Сфотографировать", state: "done" },
      { label: "Войти в аккаунт", state: "blocked" },
      { label: "Разобрать", state: "todo" },
    ];
  }
  if (phase === "running") {
    return [
      { label: "Сфотографировать", state: "done" },
      { label: "Проверить", state: "current" },
      { label: "Разобрать", state: "todo" },
    ];
  }
  if (phase === "result") {
    return [
      { label: "Сфотографировать", state: "done" },
      { label: "Проверить", state: "done" },
      { label: "Разобрать", state: "current" },
    ];
  }
  return [
    { label: "Сфотографировать", state: "current" },
    { label: "Проверить", state: "todo" },
    { label: "Разобрать", state: "todo" },
  ];
}
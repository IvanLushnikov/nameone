"use client";

/**
 * Поле ввода по типу задания (TZ-12, этап 3).
 *
 * Требование ТЗ — мобильный UX: ученик отвечает с телефона, в классе, одной рукой.
 * Отсюда конкретные решения:
 *   - все зоны тапа ≥ 44px (`min-h-11` + `py-3` на вариантах);
 *   - `text-base` (16px) на инпутах: меньший кегль заставляет iOS Safari зумить
 *     страницу при фокусе, и после закрытия клавиатуры лист остаётся увеличенным;
 *   - `inputMode` вместо `type="number"` — у `type="number"` есть свои стрелки
 *     и он не даёт ввести запятую как десятичный разделитель, а в русском
 *     школьном блокноте пишут именно «0,375»;
 *   - сетки, а не фиксированные ширины: на 360px ничего не уезжает по горизонтали.
 */

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import type { FormTask } from "@/lib/forms/types";

export interface TaskInputProps {
  task: FormTask;
  value: string;
  onChange: (value: string) => void;
}

const inputClass =
  "w-full min-w-0 h-12 px-3.5 text-base bg-white border border-warm-200 rounded-xl text-warm-950 placeholder:text-[color:var(--text-muted)] transition-all focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100";

export function TaskInput({ task, value, onChange }: TaskInputProps) {
  switch (task.type) {
    case "multiple-choice":
      return <ChoiceInput task={task} value={value} onChange={onChange} />;
    case "fill-blank":
      return <FillBlankInput task={task} value={value} onChange={onChange} />;
    case "essay":
      return (
        <textarea
          className={cn(inputClass, "py-3 resize-y min-h-[140px] leading-relaxed")}
          placeholder="Напишите развёрнутый ответ"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`task-input-${task.number}`}
        />
      );
    case "short-answer":
      return (
        <textarea
          className={cn(inputClass, "py-3 resize-y min-h-[88px]")}
          placeholder="Короткий ответ"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`task-input-${task.number}`}
        />
      );
    case "computation":
    default:
      return (
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={inputClass}
          placeholder="Введите ответ"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`task-input-${task.number}`}
        />
      );
  }
}

/**
 * Варианты ответа — radio, но сверстанные как крупные карточки: нажать пальцем
 * по «точечному» radio на телефоне невозможно. Значение — **индекс** варианта
 * (не текст), чтобы подмена текста варианта в devtools не влияла на сверку.
 */
function ChoiceInput({ task, value, onChange }: TaskInputProps) {
  const options = task.options ?? [];
  return (
    <div className="grid gap-2" role="radiogroup" aria-label={`Варианты к заданию ${task.number}`}>
      {options.map((opt, i) => {
        const checked = value === String(i);
        return (
          <label
            key={`${task.number}-${i}`}
            className={cn(
              "flex items-center gap-3 min-h-11 px-4 py-3 rounded-xl border cursor-pointer transition-all",
              checked
                ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100"
                : "border-warm-200 bg-white hover:border-warm-300"
            )}
          >
            <input
              type="radio"
              name={`task-${task.number}`}
              value={String(i)}
              checked={checked}
              onChange={() => onChange(String(i))}
              className="w-5 h-5 accent-brand-500 shrink-0"
              data-testid={`task-option-${task.number}-${i}`}
            />
            <span className="text-base text-warm-900 break-words">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * `fill-blank` — «Вставь числа: 3, __, 5, __, 7».
 *
 * Сколько полей рисовать, известно только по маркерам `__` в тексте задания:
 * количество значений в эталоне клиенту не отдают (и не должны — эталон у сервера).
 * Значения склеиваем через `;` — именно этот разделитель сервер режет при сверке
 * (ТЗ §4.3, `fill-blank`).
 *
 * Если маркеров нет (модель сгенерировала задание без `__`), показываем одно поле
 * и прямо говорим, что несколько значений пишутся через запятую: сервер тоже режет
 * по запятой, такой ответ засчитается. Это честнее, чем угадывать число полей.
 *
 * Сетка на 2 колонки: на 360px четыре поля в ряд не влезают.
 */
function FillBlankInput({ task, value, onChange }: TaskInputProps) {
  const markers = task.text.match(/__+/g) ?? [];
  const hasMarkers = markers.length > 0;
  const count = Math.max(1, markers.length);
  const parts = value ? value.split(";") : [];

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Array.from({ length: count }, (_, i) => (
          <input
            key={`${task.number}-blank-${i}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Пропуск ${i + 1} из ${count}`}
            placeholder={hasMarkers ? `${i + 1}` : "значение"}
            className={inputClass}
            value={parts[i] ?? ""}
            onChange={(e) => {
              const next = Array.from({ length: count }, (_, j) => parts[j] ?? "");
              next[i] = e.target.value;
              onChange(next.join(";"));
            }}
            data-testid={`task-blank-${task.number}-${i}`}
          />
        ))}
      </div>
      {!hasMarkers && (
        <p className="mt-1.5 text-xs text-warm-500">
          Нужно несколько значений — напишите их через запятую.
        </p>
      )}
    </div>
  );
}

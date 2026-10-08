"use client";

/**
 * Переключатель двух вариантов КОНТРОЛЬНОЙ работы (08.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ОТДЕЛЬНЫЙ КОМПОНЕНТ, А НЕ КНОПКИ В КОНСТРУКТОРЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * Здесь логика «какой лист показать», и именно её ломало. В конструкторе стояло:
 *
 *     const next = n === 1 ? worksheet : controlVariant2;
 *
 * `worksheet` — это лист, который СЕЙЧАС НА ЭКРАНЕ, а не «вариант 1». Клик по
 * «Вариант 2» записывал второй лист в `worksheet`, после чего `worksheet` и
 * «вариант 1» становились одним и тем же — возврат к первому варианту был
 * невозможен. Учитель видел подпись «Вариант 1» и содержимое варианта 2, а
 * скачивался файл с тем же враньём в имени.
 *
 * Раз логика отдельная и маленькая — она обязана быть проверяемой. Компонент
 * принимает ОБА варианта и отдаёт наружу выбранный; он не знает, что такое
 * `worksheet`, поэтому повторить ту ошибку здесь нельзя физически.
 *
 * `active` — какая кнопка подсвечена, `onVariantChange` — что выбрали.
 */

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ControlVariantSwitchProps<T> {
  /** Вариант 1. */
  variant1: T;
  /** Вариант 2. Если нет — переключатель не рисуется вовсе. */
  variant2: T | null;
  /** Что показано сейчас: 1 или 2. */
  active: 1 | 2;
  onVariantChange: (n: 1 | 2) => void;
}

export function ControlVariantSwitch<T>({
  variant1,
  variant2,
  active,
  onVariantChange,
}: ControlVariantSwitchProps<T>) {
  // Без второго варианта переключивать нечего — и показывать кнопку «Вариант 2»
  // значило бы обещать учителю то, чего нет.
  if (!variant2) return null;

  return (
    <div
      className="inline-flex p-1 rounded-full bg-warm-100 border border-warm-200"
      role="group"
      aria-label="Вариант контрольной работы"
      data-testid="control-variant-switch"
    >
      {([1, 2] as const).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onVariantChange(n)}
          aria-pressed={active === n}
          data-testid={`control-variant-${n}`}
          className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium transition-all",
            active === n
              ? "bg-white text-warm-950 shadow-soft"
              : "text-warm-600 hover:text-warm-900",
          )}
        >
          Вариант {n}
        </button>
      ))}
    </div>
  );
}
"use client";

import clsx from "clsx";

interface Props {
  fgosRef?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Зелёный чип «По ФГОС 2021» с tooltip `Раздел ФГОС: {fgosRef}`.
 * Если fgosRef не задан — рендерит null.
 *
 * Отстройка от 5 из 6 конкурентов (ТОП-25 vc.ru): только у videouroki.net
 * есть похожий фильтр-чип, но он не виден на карточке материала.
 *
 * Цвета — Tailwind green-100 / green-800, контраст ≥ 4.5:1.
 */
export function FgosBadge({ fgosRef, size = "md", className }: Props) {
  if (!fgosRef) return null;

  const label = "По ФГОС 2021";
  const tooltip = `Раздел ФГОС: ${fgosRef}`;

  return (
    <span
      data-fgos-badge="true"
      title={tooltip}
      aria-label={tooltip}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full bg-green-100 text-green-800 font-medium whitespace-nowrap",
        size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1",
        className
      )}
    >
      <svg
        className={size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"}
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 6L5 9L10 3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </span>
  );
}

"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

type VerifyState = boolean | null | undefined;

interface Props {
  verified: VerifyState;
  explanation?: string;
  className?: string;
}

/**
 * F-05-B: badge статуса AI-проверки.
 *
 *   verified === true  → зелёный «✓ AI-проверено»
 *   verified === false → жёлтый «⚠ Требует проверки»
 *   verified === null  → серый «— не проверено» (Worker недоступен / таймаут)
 *   undefined          → серый «— не проверено» (verify ещё не запускался)
 *
 * Tooltip через native `title` — без зависимостей и работает в print/export.
 *
 * `no-print` в базовых классах: бейдж нужен учителю при проверке в браузере,
 * но на распечатанном листе «не проверено» — служебная мусорная плашка.
 * Правило `.no-print { display: none !important }` живёт в @media print
 * в globals.css.
 */
export function VerifiedBadge({ verified, explanation, className }: Props) {
  const state: "ok" | "warn" | "unknown" =
    verified === true ? "ok" : verified === false ? "warn" : "unknown";

  const config = STATE_CONFIG[state];

  return (
    <span
      title={explanation ?? config.title}
      className={cn(
        "no-print inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset whitespace-nowrap",
        config.classes,
        className
      )}
    >
      <span aria-hidden="true">{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}

const STATE_CONFIG = {
  ok: {
    icon: "✓",
    label: "AI-проверено",
    classes: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    title: "AI подтвердил правильность ответа",
  },
  warn: {
    icon: "⚠",
    label: "Требует проверки",
    classes: "bg-amber-50 text-amber-800 ring-amber-200",
    title: "AI обнаружил потенциальную неточность",
  },
  unknown: {
    icon: "—",
    label: "не проверено",
    classes: "bg-warm-100 text-warm-600 ring-warm-200",
    title: "Сервис проверки недоступен",
  },
} as const;
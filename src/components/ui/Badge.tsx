import * as React from "react";
import { cn } from "@/lib/utils/cn";

type BadgeTone = "neutral" | "brand" | "accent" | "warm" | "info" | "success" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-warm-100 text-warm-700 ring-warm-200",
  brand: "bg-brand-100 text-brand-800 ring-brand-200",
  accent: "bg-accent-100 text-accent-800 ring-accent-200",
  warm: "bg-warm-100 text-warm-800 ring-warm-200",
  info: "bg-blue-100 text-blue-800 ring-blue-200",
  success: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  danger: "bg-rose-100 text-rose-800 ring-rose-200",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
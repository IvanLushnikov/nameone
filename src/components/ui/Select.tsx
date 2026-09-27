"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { ChevronDown } from "lucide-react";

type SelectOption = {
  value: string;
  label: string;
  description?: string;
};

type SelectProps = {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
};

export function Select({
  options,
  value,
  onChange,
  placeholder = "Выберите…",
  disabled,
  className,
  size = "md",
}: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const sizeClasses = {
    sm: "h-9 text-sm",
    md: "h-11 text-sm",
    lg: "h-13 text-base",
  }[size];

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full px-3.5 flex items-center justify-between gap-2 bg-white border border-warm-200 rounded-xl text-left transition-all",
          "focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100",
          "disabled:bg-warm-50 disabled:cursor-not-allowed disabled:text-warm-400",
          sizeClasses,
          open && "border-brand-500 ring-4 ring-brand-100"
        )}
      >
        <span className={cn("truncate", selected ? "text-warm-950" : "text-warm-400")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-warm-400 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full bg-white rounded-xl border border-warm-100 shadow-soft-lg overflow-hidden animate-fade-in max-h-72 overflow-y-auto">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange?.(opt.value);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3.5 py-2.5 hover:bg-brand-50 transition-colors flex items-start gap-2",
                opt.value === value && "bg-brand-50"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-warm-950">{opt.label}</div>
                {opt.description && (
                  <div className="text-xs text-warm-500 mt-0.5">{opt.description}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
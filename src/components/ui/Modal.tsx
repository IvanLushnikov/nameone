"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: ModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-warm-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "relative w-full bg-white shadow-soft-lg rounded-t-3xl sm:rounded-3xl border border-warm-100 animate-scale-in",
          sizeClasses[size],
          className
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-9 h-9 inline-flex items-center justify-center rounded-full text-warm-500 hover:bg-warm-100 hover:text-warm-700 transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>

        {(title || description) && (
          <div className="p-6 sm:p-8 pb-0 sm:pb-0">
            {title && (
              <h2 className="text-xl sm:text-2xl font-display font-semibold text-warm-950 pr-8">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-2 text-sm text-warm-600">{description}</p>
            )}
          </div>
        )}

        <div className="p-6 sm:p-8">{children}</div>

        {footer && (
          <div className="px-6 sm:px-8 py-4 border-t border-warm-100 bg-warm-50 rounded-b-3xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
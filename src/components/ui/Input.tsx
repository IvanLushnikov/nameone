"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function InputInner({ className, label, hint, error, leftIcon, rightSlot, id, ...props }, ref) {
    const reactId = React.useId();
    const inputId = id ?? reactId;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block mb-1.5 text-sm font-medium text-warm-700"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400 pointer-events-none">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full h-11 px-3.5 text-sm bg-white border border-warm-200 rounded-xl text-warm-950 placeholder:text-[color:var(--text-muted)] transition-all",
              "focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100",
              "disabled:bg-warm-50 disabled:cursor-not-allowed",
              error && "border-rose-400 focus:border-rose-500 focus:ring-rose-100",
              leftIcon && "pl-10",
              rightSlot && "pr-12",
              className
            )}
            {...props}
          />
          {rightSlot && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">{rightSlot}</div>
          )}
        </div>
        {(hint || error) && (
          <p
            className={cn(
              "mt-1.5 text-xs",
              // hint — приглушённый текст 12px, warm-500 (~2.7:1) не проходит AA
              error ? "text-rose-600" : "text-[color:var(--text-muted)]"
            )}
          >
            {error ?? hint}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function TextareaInner({ className, label, hint, error, id, ...props }, ref) {
    const reactId = React.useId();
    const inputId = id ?? reactId;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block mb-1.5 text-sm font-medium text-warm-700"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            "w-full px-3.5 py-2.5 text-sm bg-white border border-warm-200 rounded-xl text-warm-950 placeholder:text-[color:var(--text-muted)] transition-all resize-y min-h-[88px]",
            "focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100",
            error && "border-rose-400 focus:border-rose-500 focus:ring-rose-100",
            className
          )}
          {...props}
        />
        {(hint || error) && (
          <p
            className={cn(
              "mt-1.5 text-xs",
              error ? "text-rose-600" : "text-[color:var(--text-muted)]"
            )}
          >
            {error ?? hint}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";
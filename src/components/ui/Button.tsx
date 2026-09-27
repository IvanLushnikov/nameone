import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type ButtonVariant =
  | "primary"      // брендовый зелёный
  | "accent"       // коралловый
  | "secondary"    // белый с бордером
  | "ghost"        // без фона
  | "dark";        // тёмный

type ButtonSize = "sm" | "md" | "lg" | "xl";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-500 text-white shadow-brand hover:bg-brand-600 active:bg-brand-700",
  accent:
    "bg-accent-500 text-white shadow-accent hover:bg-accent-600 active:bg-accent-700",
  secondary:
    "bg-white text-warm-900 border border-warm-200 hover:bg-warm-50 hover:border-warm-300",
  ghost:
    "bg-transparent text-warm-700 hover:bg-warm-100",
  dark:
    "bg-warm-900 text-white hover:bg-warm-950",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm rounded-lg gap-1.5",
  md: "h-11 px-5 text-sm rounded-xl gap-2",
  lg: "h-13 px-6 text-base rounded-xl gap-2",
  xl: "h-16 px-8 text-lg rounded-2xl gap-3",
};

const baseClasses =
  "inline-flex items-center justify-center font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed select-none";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    as?: "button";
  };

type ButtonAsLink = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
    as: "link";
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const {
    variant = "primary",
    size = "md",
    leftIcon,
    rightIcon,
    loading = false,
    fullWidth = false,
    className,
    children,
    ...rest
  } = props as ButtonProps & { as?: "button" | "link" };

  const classes = cn(
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && "w-full",
    className
  );

  const content = (
    <>
      {loading ? (
        <span
          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden
        />
      ) : leftIcon}
      <span className="truncate">{children}</span>
      {!loading && rightIcon}
    </>
  );

  if (props.as === "link") {
    const linkRest = rest as Omit<ButtonAsLink, "as">;
    return (
      <Link {...linkRest} className={classes}>
        {content}
      </Link>
    );
  }

  const btnRest = rest as Omit<ButtonAsButton, "as">;
  return (
    <button {...btnRest} className={classes} disabled={loading || btnRest.disabled}>
      {content}
    </button>
  );
}
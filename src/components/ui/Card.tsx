import * as React from "react";
import { cn } from "@/lib/utils/cn";

export function Card({
  className,
  children,
  hover = false,
  padded = true,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  hover?: boolean;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-white rounded-2xl border border-warm-100 shadow-soft",
        hover &&
          "transition-all duration-200 hover:shadow-soft-lg hover:-translate-y-0.5 hover:border-warm-200",
        padded && "p-5 sm:p-6",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-lg font-semibold text-warm-950", className)} {...rest}>
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-warm-600 mt-1.5", className)} {...rest}>
      {children}
    </p>
  );
}
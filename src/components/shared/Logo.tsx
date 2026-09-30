import { cn } from "@/lib/utils/cn";

export function Logo({
  size = "md",
  showText = true,
  className,
}: {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}) {
  const iconSize = { sm: 24, md: 32, lg: 40 }[size];
  const textClass = { sm: "text-base", md: "text-lg", lg: "text-xl" }[size];

  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <div
        className="relative grid place-items-center rounded-xl bg-brand-500 text-white shadow-brand"
        style={{ width: iconSize, height: iconSize }}
        aria-hidden
      >
        {/* Лист бумаги с чертой */}
        <svg
          viewBox="0 0 24 24"
          width={iconSize * 0.6}
          height={iconSize * 0.6}
          fill="none"
        >
          <path
            d="M5 4h10l4 4v12H5z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            fill="rgba(255,255,255,0.18)"
          />
          <path d="M15 4v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path
            d="M8.5 12h7M8.5 15h7M8.5 18h5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        {/* Маленькая звёздочка-AI в углу */}
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent-500 border-2 border-white" />
      </div>
      {showText && (
        <span className={cn("font-display font-bold tracking-tight text-warm-950", textClass)}>
          РабочиеЛисты <span className="text-brand-500">AI</span>
        </span>
      )}
    </div>
  );
}
import * as React from "react";

/**
 * Кастомные SVG-иллюстрации для предметов и режимов.
 * Рисуются в одном стиле (warm/friendly), линейные, с акцентным цветом.
 */

const baseProps = {
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
} as const;

export function FileCheckIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="check-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#DEC59D" />
          <stop offset="100%" stopColor="#BC8E54" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#check-bg)" opacity="0.18" />
      {/* документ с галочкой */}
      <rect x="20" y="14" width="40" height="52" rx="3" fill="white" stroke="currentColor" strokeWidth="2" />
      <path d="M26 26 h28 M26 34 h22 M26 42 h24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="58" cy="58" r="11" fill="#22B37C" />
      <path d="M53 58 l3 3 l7 -7" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MathIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="math-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="100%" stopColor="#22B37C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#math-bg)" opacity="0.12" />
      <circle cx="30" cy="32" r="14" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M22 32 h16 M30 24 v16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M50 24 L64 50 M50 50 L64 24" stroke="#FF5E2E" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="60" r="4" fill="#22B37C" />
      <path d="M16 64 q 6 -6 12 0" stroke="#FF5E2E" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function RussianIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="ru-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFA688" />
          <stop offset="100%" stopColor="#FF5E2E" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#ru-bg)" opacity="0.12" />
      {/* открытая книга */}
      <path
        d="M16 22 L40 28 L64 22 L64 60 L40 66 L16 60 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M40 28 L40 66" stroke="currentColor" strokeWidth="2.5" />
      <path d="M22 36 L36 39" stroke="#FF5E2E" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 44 L36 47" stroke="#FF5E2E" strokeWidth="2" strokeLinecap="round" />
      <path d="M44 39 L58 36" stroke="#FF5E2E" strokeWidth="2" strokeLinecap="round" />
      <path d="M44 47 L58 44" stroke="#FF5E2E" strokeWidth="2" strokeLinecap="round" />
      <circle cx="40" cy="14" r="3" fill="#22B37C" />
    </svg>
  );
}

export function EnglishIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="en-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#DEC59D" />
          <stop offset="100%" stopColor="#BC8E54" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#en-bg)" opacity="0.18" />
      {/* глобус */}
      <circle cx="40" cy="40" r="22" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <ellipse cx="40" cy="40" rx="10" ry="22" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M18 40 h44 M22 28 q 18 8 36 0 M22 52 q 18 -8 36 0" stroke="currentColor" strokeWidth="2" fill="none" />
      {/* speech bubble с "Aa" */}
      <circle cx="58" cy="22" r="9" fill="#FF5E2E" />
      <text x="58" y="26" textAnchor="middle" fontFamily="serif" fontWeight="bold" fontSize="11" fill="white">Aa</text>
    </svg>
  );
}

export function OgeIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="oge-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#82E0BB" />
          <stop offset="100%" stopColor="#107456" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#oge-bg)" opacity="0.15" />
      {/* свиток / экзаменационный лист */}
      <rect x="18" y="14" width="44" height="52" rx="3" fill="white" stroke="currentColor" strokeWidth="2" />
      <path d="M24 24 h32 M24 32 h32 M24 40 h32 M24 48 h22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* чекмарк */}
      <circle cx="60" cy="58" r="10" fill="#FF5E2E" />
      <path d="M55 58 l4 4 l6 -8" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WorksheetIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="ws-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#82E0BB" />
          <stop offset="100%" stopColor="#22B37C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#ws-bg)" opacity="0.12" />
      {/* лист с галочками */}
      <rect x="20" y="14" width="40" height="52" rx="3" fill="white" stroke="currentColor" strokeWidth="2" />
      <path d="M26 26 h28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="26" cy="36" r="2.5" fill="#22B37C" />
      <path d="M26 36 l1.5 1.5 l3 -3" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M32 36 h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="26" cy="46" r="2.5" fill="#22B37C" />
      <path d="M26 46 l1.5 1.5 l3 -3" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M32 46 h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="26" cy="56" r="2.5" fill="#22B37C" />
      <path d="M26 56 l1.5 1.5 l3 -3" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M32 56 h22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CardsIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="cards-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFA688" />
          <stop offset="100%" stopColor="#FF7E55" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#cards-bg)" opacity="0.12" />
      {/* стопка карточек */}
      <rect x="14" y="42" width="36" height="22" rx="3" fill="white" stroke="currentColor" strokeWidth="2" transform="rotate(-8 32 53)" />
      <rect x="22" y="34" width="36" height="22" rx="3" fill="white" stroke="currentColor" strokeWidth="2" transform="rotate(4 40 45)" />
      <rect x="20" y="22" width="36" height="22" rx="3" fill="#FF5E2E" />
      <path d="M28 32 h20 M28 38 h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ControlIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="ctrl-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C5A3FF" />
          <stop offset="100%" stopColor="#7C4DFF" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#ctrl-bg)" opacity="0.15" />
      {/* два варианта A/B */}
      <rect x="14" y="18" width="24" height="44" rx="3" fill="white" stroke="currentColor" strokeWidth="2" />
      <text x="26" y="30" textAnchor="middle" fontFamily="serif" fontWeight="bold" fontSize="14" fill="#22B37C">A</text>
      <path d="M18 38 h16 M18 44 h14 M18 50 h12 M18 56 h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="42" y="18" width="24" height="44" rx="3" fill="white" stroke="currentColor" strokeWidth="2" />
      <text x="54" y="30" textAnchor="middle" fontFamily="serif" fontWeight="bold" fontSize="14" fill="#FF5E2E">Б</text>
      <path d="M46 38 h16 M46 44 h12 M46 50 h14 M46 56 h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function TimerIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="timer-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#82E0BB" />
          <stop offset="100%" stopColor="#22B37C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#timer-bg)" opacity="0.12" />
      <circle cx="40" cy="42" r="22" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M40 42 L40 28 M40 42 L52 42" stroke="#FF5E2E" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="40" cy="42" r="2" fill="#FF5E2E" />
      <path d="M34 14 h12 M40 14 v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="shield-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFA688" />
          <stop offset="100%" stopColor="#FF5E2E" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#shield-bg)" opacity="0.12" />
      <path d="M40 14 L58 22 V 42 Q58 56 40 64 Q22 56 22 42 V 22 Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M30 40 L37 47 L52 32" stroke="#22B37C" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LayersIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="layers-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#82E0BB" />
          <stop offset="100%" stopColor="#22B37C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#layers-bg)" opacity="0.12" />
      <path d="M40 16 L62 28 L40 40 L18 28 Z" fill="white" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M18 40 L40 52 L62 40" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinejoin="round" opacity="0.6" />
      <path d="M18 52 L40 64 L62 52" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinejoin="round" opacity="0.3" />
    </svg>
  );
}

export function SmartphoneIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="phone-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFA688" />
          <stop offset="100%" stopColor="#FF5E2E" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#phone-bg)" opacity="0.12" />
      <rect x="26" y="14" width="28" height="52" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <rect x="30" y="22" width="20" height="32" rx="2" fill="#22B37C" opacity="0.2" />
      <circle cx="40" cy="60" r="2" fill="currentColor" />
      <path d="M34 30 h12 M34 36 h10 M34 42 h12 M34 48 h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="heart-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#BC8E54" />
          <stop offset="100%" stopColor="#856033" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#heart-bg)" opacity="0.18" />
      <path
        d="M40 60 C20 46 18 32 26 24 C32 18 38 22 40 28 C42 22 48 18 54 24 C62 32 60 46 40 60 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="34" r="3" fill="#FF5E2E" />
    </svg>
  );
}

export function ChartIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="chart-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#82E0BB" />
          <stop offset="100%" stopColor="#22B37C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#chart-bg)" opacity="0.12" />
      <path d="M14 56 L66 56 M14 56 L14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 48 L34 38 L46 42 L58 24" stroke="#22B37C" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="58" cy="24" r="3" fill="#22B37C" />
      <circle cx="46" cy="42" r="2" fill="#22B37C" />
      <circle cx="34" cy="38" r="2" fill="#22B37C" />
      <circle cx="22" cy="48" r="2" fill="#22B37C" />
      <path d="M58 24 l4 -8 l-2 0 l0 -2 l-4 0 l0 2 l-2 0 z" fill="#FF5E2E" opacity="0.8" />
    </svg>
  );
}

export function SparklesIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="sparkles-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFA688" />
          <stop offset="100%" stopColor="#FF5E2E" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#sparkles-bg)" opacity="0.12" />
      <path d="M40 16 L43 30 L57 33 L43 36 L40 50 L37 36 L23 33 L37 30 Z" fill="#FF5E2E" />
      <circle cx="58" cy="56" r="3" fill="#22B37C" />
      <circle cx="20" cy="60" r="2" fill="#22B37C" />
      <circle cx="62" cy="20" r="1.5" fill="#22B37C" />
    </svg>
  );
}
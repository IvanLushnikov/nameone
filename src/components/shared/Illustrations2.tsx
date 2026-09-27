/**
 * Иллюстрации для предметов таксономии (расширенная коллекция).
 */

const baseProps = {
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
} as const;

export function AlgebraIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="alg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#82E0BB" />
          <stop offset="100%" stopColor="#22B37C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#alg-bg)" opacity="0.12" />
      {/* ось X/Y */}
      <path d="M10 70 h60 M10 70 V 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* парабола */}
      <path d="M16 22 Q 40 56 64 22" stroke="#FF5E2E" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* точка */}
      <circle cx="40" cy="40" r="3.5" fill="#22B37C" />
      <text x="48" y="44" fontFamily="serif" fontSize="11" fill="currentColor">y = x²</text>
    </svg>
  );
}

export function GeometryIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="geo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#82E0BB" />
          <stop offset="100%" stopColor="#22B37C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#geo-bg)" opacity="0.12" />
      {/* треугольник */}
      <path d="M16 60 L64 60 L40 18 Z" stroke="currentColor" strokeWidth="2.5" fill="white" strokeLinejoin="round" />
      {/* прямой угол */}
      <rect x="36" y="56" width="8" height="4" fill="currentColor" />
      <circle cx="40" cy="20" r="2.5" fill="#FF5E2E" />
    </svg>
  );
}

export function PhysicsIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="phys-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A5B4FC" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#phys-bg)" opacity="0.15" />
      {/* атом */}
      <circle cx="40" cy="40" r="6" fill="#FF5E2E" />
      <ellipse cx="40" cy="40" rx="22" ry="10" stroke="currentColor" strokeWidth="2" fill="none" />
      <ellipse cx="40" cy="40" rx="22" ry="10" stroke="currentColor" strokeWidth="2" fill="none" transform="rotate(60 40 40)" />
      <ellipse cx="40" cy="40" rx="22" ry="10" stroke="currentColor" strokeWidth="2" fill="none" transform="rotate(-60 40 40)" />
      <circle cx="62" cy="40" r="3" fill="#6366F1" />
      <circle cx="22" cy="40" r="3" fill="#22B37C" />
      <circle cx="40" cy="18" r="3" fill="#FF5E2E" />
    </svg>
  );
}

export function ChemistryIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="chem-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#chem-bg)" opacity="0.15" />
      {/* колба */}
      <path d="M32 14 V 36 L 18 60 Q 18 66 24 66 H 56 Q 62 66 62 60 L 48 36 V 14" stroke="currentColor" strokeWidth="2.5" fill="white" strokeLinejoin="round" />
      <path d="M32 14 H 48" stroke="currentColor" strokeWidth="2.5" />
      {/* жидкость */}
      <path d="M22 52 Q 24 58 28 58 H 52 Q 56 58 58 52" fill="#7C3AED" opacity="0.4" stroke="none" />
      {/* пузырьки */}
      <circle cx="32" cy="58" r="2" fill="#FF5E2E" />
      <circle cx="42" cy="62" r="1.5" fill="#22B37C" />
      <circle cx="48" cy="56" r="1.5" fill="#FF5E2E" />
    </svg>
  );
}

export function BiologyIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="bio-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#86EFAC" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#bio-bg)" opacity="0.15" />
      {/* ДНК */}
      <path d="M20 12 Q 40 28 20 44 Q 0 60 20 76" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M60 12 Q 40 28 60 44 Q 80 60 60 76" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M22 22 H 58 M22 34 H 58 M22 50 H 58 M22 62 H 58" stroke="#FF5E2E" strokeWidth="1.5" />
      <circle cx="22" cy="22" r="2" fill="#22B37C" />
      <circle cx="58" cy="22" r="2" fill="#22B37C" />
      <circle cx="22" cy="50" r="2" fill="#22B37C" />
      <circle cx="58" cy="50" r="2" fill="#22B37C" />
    </svg>
  );
}

export function InformaticsIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="inf-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#93C5FD" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#inf-bg)" opacity="0.15" />
      {/* монитор */}
      <rect x="14" y="18" width="52" height="34" rx="3" fill="white" stroke="currentColor" strokeWidth="2.5" />
      <path d="M30 60 H 50 M28 64 H 52" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* код на экране */}
      <path d="M22 26 L 26 30 L 22 34" stroke="#22B37C" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M32 32 H 40" stroke="#FF5E2E" strokeWidth="2" strokeLinecap="round" />
      <path d="M44 28 L 50 28" stroke="#22B37C" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 40 L 32 40" stroke="#FF5E2E" strokeWidth="2" strokeLinecap="round" />
      <circle cx="56" cy="40" r="2" fill="#22B37C" />
    </svg>
  );
}

export function HistoryIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="hist-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FCD34D" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#hist-bg)" opacity="0.15" />
      {/* колонна + купол */}
      <path d="M16 64 H 64" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="20" y="50" width="6" height="14" fill="currentColor" />
      <rect x="34" y="50" width="6" height="14" fill="currentColor" />
      <rect x="48" y="50" width="6" height="14" fill="currentColor" />
      <path d="M16 50 H 64" stroke="currentColor" strokeWidth="2.5" />
      <path d="M40 16 L 64 36 H 16 Z" fill="currentColor" />
      <path d="M40 12 L 18 30 H 62 Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="36" y="36" width="8" height="14" fill="#FF5E2E" />
    </svg>
  );
}

export function SocialIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="soc-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#92400E" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#soc-bg)" opacity="0.18" />
      {/* весы */}
      <rect x="36" y="14" width="8" height="3" fill="currentColor" />
      <path d="M40 17 V 56" stroke="currentColor" strokeWidth="2.5" />
      <path d="M22 56 H 58" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M40 22 L 20 30 L 22 38 H 30 L 32 30 Z" fill="#FF5E2E" stroke="currentColor" strokeWidth="1.5" />
      <path d="M40 22 L 60 30 L 58 38 H 50 L 48 30 Z" fill="#22B37C" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 38 H 30" stroke="currentColor" strokeWidth="1.5" />
      <path d="M50 38 H 58" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function GeographyIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="geo2-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#geo2-bg)" opacity="0.15" />
      {/* глобус */}
      <circle cx="40" cy="40" r="24" fill="white" stroke="currentColor" strokeWidth="2.5" />
      <ellipse cx="40" cy="40" rx="10" ry="24" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 40 h48 M18 28 q 22 8 44 0 M18 52 q 22 -8 44 0" stroke="currentColor" strokeWidth="2" fill="none" />
      {/* материк (Евразия) */}
      <path d="M30 28 Q 36 24 44 26 Q 50 30 52 36 Q 48 42 44 42 Q 38 40 32 38 Z" fill="#22B37C" />
      <path d="M28 48 Q 32 50 36 48 Q 40 50 44 48" fill="none" stroke="#22B37C" strokeWidth="2" />
    </svg>
  );
}

export function LiteratureIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="lit-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FCA5A5" />
          <stop offset="100%" stopColor="#DC2626" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#lit-bg)" opacity="0.15" />
      {/* открытая книга */}
      <path d="M14 22 L 40 28 L 66 22 L 66 60 L 40 66 L 14 60 Z" fill="white" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M40 28 L 40 66" stroke="currentColor" strokeWidth="2.5" />
      {/* перо */}
      <path d="M52 36 L 64 24 L 68 28 L 56 40 Z" fill="#FF5E2E" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M52 36 L 48 40" stroke="currentColor" strokeWidth="2" />
      <path d="M44 44 L 56 44" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function OkruzhaetIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="okr-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#okr-bg)" opacity="0.18" />
      {/* солнце + земля + дерево */}
      <circle cx="58" cy="22" r="8" fill="#FF5E2E" />
      <path d="M10 60 Q 40 56 70 60 V 70 H 10 Z" fill="#22B37C" />
      <path d="M30 60 V 40" stroke="#5B3A29" strokeWidth="3" strokeLinecap="round" />
      <circle cx="30" cy="36" r="10" fill="#22B37C" />
      <circle cx="22" cy="38" r="6" fill="#22B37C" />
      <circle cx="38" cy="38" r="6" fill="#22B37C" />
    </svg>
  );
}

export function GermanIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="ger-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#DEC59D" />
          <stop offset="100%" stopColor="#BC8E54" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#ger-bg)" opacity="0.18" />
      {/* флагшток */}
      <path d="M54 14 V 68" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* полотнище флага Германии */}
      <rect x="14" y="16" width="38" height="26" rx="2" fill="white" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="16" width="38" height="8.5" fill="#1F2937" />
      <rect x="14" y="24.5" width="38" height="8.5" fill="#DC2626" />
      <rect x="14" y="33" width="38" height="9" fill="#F5C518" />
      {/* "Ä" в речевом облачке */}
      <circle cx="58" cy="56" r="11" fill="#22B37C" stroke="currentColor" strokeWidth="2" />
      <text x="58" y="60" textAnchor="middle" fontFamily="serif" fontWeight="bold" fontSize="13" fill="white">Ä</text>
    </svg>
  );
}

export function ObzhIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="obzh-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDBA74" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#obzh-bg)" opacity="0.18" />
      {/* щит */}
      <path d="M40 12 L 60 20 V 40 Q 60 54 40 64 Q 20 54 20 40 V 20 Z" fill="white" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      {/* медицинский крест */}
      <rect x="36" y="24" width="8" height="30" fill="#DC2626" rx="1" />
      <rect x="25" y="35" width="30" height="8" fill="#DC2626" rx="1" />
      {/* галочка-индикатор */}
      <circle cx="58" cy="56" r="9" fill="#22B37C" stroke="currentColor" strokeWidth="2" />
      <path d="M53 56 L 57 60 L 63 53" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TechnologyIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="tech-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#tech-bg)" opacity="0.18" />
      {/* линейка (диагональ \ ) */}
      <g transform="rotate(35 40 40)">
        <rect x="12" y="36" width="56" height="8" rx="1" fill="white" stroke="currentColor" strokeWidth="2" />
        <path d="M20 36 V 41 M28 36 V 44 M36 36 V 41 M44 36 V 44 M52 36 V 41 M60 36 V 44" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      {/* молоток (диагональ / ) */}
      <g transform="rotate(-35 40 40)">
        <rect x="38" y="44" width="4" height="22" fill="currentColor" />
        <rect x="24" y="34" width="32" height="12" rx="1" fill="#FF5E2E" stroke="currentColor" strokeWidth="2" />
        <path d="M24 34 L 28 38 M56 34 L 52 38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      {/* гайка-акцент */}
      <circle cx="60" cy="20" r="7" fill="#22B37C" stroke="currentColor" strokeWidth="2" />
      <circle cx="60" cy="20" r="2.5" fill="white" />
    </svg>
  );
}

export function FinanceIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="fin-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#86EFAC" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#fin-bg)" opacity="0.18" />
      {/* ось */}
      <path d="M14 64 H 68" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 64 V 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* столбцы роста */}
      <rect x="18" y="50" width="9" height="14" fill="#22B37C" rx="1" />
      <rect x="30" y="40" width="9" height="24" fill="#22B37C" rx="1" />
      <rect x="42" y="28" width="9" height="36" fill="#22B37C" rx="1" />
      {/* стрелка вверх */}
      <path d="M54 38 L 62 30 L 70 38" stroke="#FF5E2E" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M62 30 V 50" stroke="#FF5E2E" strokeWidth="2.5" strokeLinecap="round" />
      {/* монета */}
      <circle cx="58" cy="60" r="8" fill="#FCD34D" stroke="currentColor" strokeWidth="2" />
      <text x="58" y="64" textAnchor="middle" fontFamily="serif" fontWeight="bold" fontSize="11" fill="currentColor">₽</text>
    </svg>
  );
}

export function MusicIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="mus-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0ABFC" />
          <stop offset="100%" stopColor="#A21CAF" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#mus-bg)" opacity="0.18" />
      {/* нотный стан (5 линий) */}
      <path d="M12 24 H 50 M12 30 H 50 M12 36 H 50 M12 42 H 50 M12 48 H 50" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {/* восьмая нота */}
      <ellipse cx="26" cy="56" rx="9" ry="6.5" fill="white" stroke="currentColor" strokeWidth="2.5" transform="rotate(-20 26 56)" />
      <path d="M34 54 V 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M34 22 Q 46 20 48 30 Q 40 32 34 30" fill="#FF5E2E" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {/* аккомпанемент */}
      <circle cx="58" cy="40" r="3" fill="#22B37C" />
      <path d="M58 40 V 30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="66" cy="46" r="2.5" fill="#FF5E2E" />
      <path d="M66 46 V 36" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ArtIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="art-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FED7AA" />
          <stop offset="100%" stopColor="#C2410C" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#art-bg)" opacity="0.18" />
      {/* палитра */}
      <path d="M18 38 Q 12 26 22 18 Q 34 10 50 14 Q 64 18 66 32 Q 66 44 56 46 Q 52 47 52 52 Q 52 60 44 62 Q 32 62 24 54 Q 16 46 18 38 Z" fill="white" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      {/* дырка под палец */}
      <ellipse cx="42" cy="48" rx="4.5" ry="3.2" fill="currentColor" />
      {/* капли краски */}
      <circle cx="28" cy="24" r="3.5" fill="#FF5E2E" />
      <circle cx="40" cy="20" r="3" fill="#22B37C" />
      <circle cx="52" cy="24" r="3" fill="#3B82F6" />
      <circle cx="60" cy="34" r="2.5" fill="#FCD34D" />
      {/* кисть */}
      <g transform="rotate(30 62 56)">
        <rect x="60" y="50" width="4" height="16" fill="#5B3A29" />
        <path d="M58 50 Q 56 44 62 42 Q 68 44 66 50 Z" fill="#FF5E2E" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function PeIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} {...baseProps}>
      <defs>
        <linearGradient id="pe-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#93C5FD" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="68" height="68" rx="16" fill="url(#pe-bg)" opacity="0.18" />
      {/* беговая дорожка */}
      <path d="M8 68 H 72" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 64 H 22 M30 64 H 38 M46 64 H 54 M62 64 H 70" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      {/* бегущий человек */}
      <circle cx="46" cy="18" r="5" fill="white" stroke="currentColor" strokeWidth="2.5" />
      {/* тело */}
      <path d="M46 23 L 42 38 L 36 56" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* передняя нога */}
      <path d="M42 38 L 52 44 L 56 58" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* руки */}
      <path d="M44 28 L 32 34" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M46 28 L 58 22" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* мяч */}
      <circle cx="22" cy="58" r="9" fill="#FF5E2E" stroke="currentColor" strokeWidth="2" />
      <path d="M13 58 H 31 M22 49 V 67 M15 51 L 29 65 M29 51 L 15 65" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.7" />
      {/* свисток-акцент */}
      <circle cx="64" cy="14" r="5" fill="#22B37C" stroke="currentColor" strokeWidth="2" />
      <rect x="63" y="9" width="2" height="4" fill="currentColor" />
    </svg>
  );
}
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Бренд-палитра: тёплый мятный + персиковый, дружелюбный edtech
        brand: {
          50: "#F0FDF8",
          100: "#DDF7EC",
          200: "#B6EFD6",
          300: "#82E0BB",
          400: "#46CB97",
          500: "#22B37C",
          600: "#159066",
          700: "#107456",
          800: "#105C47",
          900: "#0E4B3C",
          950: "#062C24",
        },
        accent: {
          50: "#FFF5F1",
          100: "#FFE7DC",
          200: "#FFCAB8",
          300: "#FFA688",
          400: "#FF7E55",
          500: "#FF5E2E",
          600: "#F04419",
          700: "#C73213",
          800: "#9F2A14",
          900: "#7F2614",
          950: "#451006",
        },
        warm: {
          50: "#FBF8F4",
          100: "#F6EFE5",
          200: "#ECDDC6",
          300: "#DEC59D",
          400: "#CBA772",
          500: "#BC8E54",
          600: "#A5783F",
          700: "#856033",
          800: "#6C502E",
          900: "#5A432A",
          950: "#312313",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      // Шкала объявлена ЯВНО, хотя extend её и так дополняет дефолтами.
      // Причина: Tailwind не ругается на несуществующую утилиту — он молча
      // выбрасывает её из CSS. Из-за этого `h-13` в Button/Select снёс высоту
      // у 35 кнопок на 19 страницах (схлопнулись до высоты текста), и никто
      // об этом не узнал. Теперь пропущенный шаг виден глазами в конфиге.
      // Правда Tailwind ошибку сборки на такой класс не поднимет — единственная
      // честная защита здесь это явный список шагов + grep по h-\d+ в CI.
      spacing: {
        13: "3.25rem",
      },
      // Кегли продублированы явно по той же причине, что и spacing выше.
      // Значения — дефолтные Tailwind, чтобы extend ничего не потерял.
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem" }],
        "5xl": ["3rem", { lineHeight: "1" }],
      },
      boxShadow: {
        "soft": "0 2px 8px -2px rgba(31, 41, 55, 0.06), 0 4px 16px -4px rgba(31, 41, 55, 0.06)",
        "soft-lg": "0 8px 24px -8px rgba(31, 41, 55, 0.10), 0 16px 40px -16px rgba(31, 41, 55, 0.08)",
        "brand": "0 4px 14px -4px rgba(34, 179, 124, 0.40)",
        "accent": "0 4px 14px -4px rgba(255, 94, 46, 0.40)",
      },
      borderRadius: {
        "xl2": "1.25rem",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "bounce-subtle": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "shimmer": "shimmer 2s linear infinite",
        "bounce-subtle": "bounce-subtle 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
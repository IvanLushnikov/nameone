import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * F-03: Кнопка «Показать/Скрыть ответ» под заданием-образцом.
 *
 * Нативный <details>/<summary>:
 * - работает без JS (дружелюбно к static export + SEO);
 * - доступен с клавиатуры из коробки;
 * - состояние «открыто» сохраняется браузером при навигации.
 *
 * Ответ выводится приглушённым (warm-50 фон), моноширинным если выглядит
 * как число/формула (12, 1/2, >, 5.5 и т.п.).
 */
export function AnswerToggle({ answer }: { answer: string }) {
  if (!answer || !answer.trim()) return null;

  return (
    <details className="group mt-3">
      <summary
        className={cn(
          "inline-flex items-center gap-1.5 cursor-pointer list-none",
          "text-xs font-medium px-2.5 py-1.5 rounded-md select-none",
          "bg-warm-50 border border-warm-100 text-warm-700",
          "hover:bg-warm-100 hover:border-warm-200 transition-colors",
          "group-open:bg-warm-100 group-open:border-warm-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
        )}
      >
        <ChevronRight
          aria-hidden
          className="w-3.5 h-3.5 transition-transform group-open:rotate-90 text-warm-500 group-open:text-warm-700"
        />
        <span className="group-open:hidden">Показать ответ</span>
        <span className="hidden group-open:inline">Скрыть ответ</span>
      </summary>
      <div className="mt-2 px-3 py-2 rounded-lg bg-warm-50 border border-warm-100">
        <p
          className={cn(
            "text-sm text-warm-600 leading-relaxed break-words",
            isNumericAnswer(answer) && "font-mono tracking-tight"
          )}
        >
          {answer}
        </p>
      </div>
    </details>
  );
}

/**
 * Эвристика «похоже на число/формулу»:
 * - есть хотя бы одна цифра;
 * - длина разумная (≤ 30 символов, чтобы не превращать длинный ответ в моноширинный);
 * - латинских/кириллических букв не больше двух (допускаем короткие единицы «кг», «см»).
 */
function isNumericAnswer(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed || trimmed.length > 30) return false;
  if (!/\d/.test(trimmed)) return false;
  const letterCount = (trimmed.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length;
  return letterCount <= 2;
}

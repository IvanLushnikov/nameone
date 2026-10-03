"use client";

import { Card } from "@/components/ui/Card";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useInView } from "@/hooks/useInView";
import { Check, X, Sparkles, Loader2 } from "lucide-react";
import * as React from "react";

/**
 * `show` — анимация включается ТОЛЬКО после монтирования на клиенте.
 * Раньше `opacity: inView ? 1 : 0` попадал в статический HTML, и поисковик
 * (и учитель с отключённым JS) видел пустые карточки. Теперь в разметке
 * всегда opacity 1, а скрытое состояние появляется уже в браузере.
 */
function useReveal(inView: boolean) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return !mounted || inView;
}

const GENERIC_ROW = [
  "Шаблон не различает классы — задания часто мимо программы",
  "Готового PDF нет — копируете в Word и верстаете руками",
  "Один шаблон на всё, каждый лист собираете с нуля",
  "Платные подписки, реклама, часы на форматирование",
];

const OUR_ROW = [
  "Таксономия: ФГОС 2021 для 1–9, ФГОС СОО с 01.09.2027 для 10–11",
  "PDF в формате A4 с ответами и пояснениями",
  "Каждый ответ проверяется автоматически",
  "Без зарубежной карты, оплата в рублях, от 500 ₽ в месяц",
  "Планы уроков, презентации, КТП — в одном сервисе",
];

export function Comparison() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true, margin: "-15% 0px" });
  const reducedMotion = useReducedMotion();
  const show = useReveal(inView);

  return (
    <section ref={ref} className="py-20 sm:py-28">
      <div className="container-tight">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
            Не в&nbsp;Word
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            30 секунд на&nbsp;лист против вечера в&nbsp;Word
          </h2>
          <p className="mt-3 text-warm-600">
            Шаблоны и ручная работа в Word не учитывают ваш класс, ошибаются в задачах и не дают готовый PDF. УчЛист — узкоспециализированный инструмент для&nbsp;учителей.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-5xl mx-auto">
          {/* Generic card */}
          <Card
            className="relative h-full transition-transform duration-300 ease-out motion-safe:hover:rotate-[-0.5deg]"
            style={{
              opacity: show ? 1 : 0,
              transform: show ? "translateX(0)" : "translateX(-20px)",
              transitionProperty: "opacity, transform",
              transitionDuration: "600ms",
            }}
          >
            <div className="absolute top-4 right-4">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-warm-100 text-warm-600 text-xs font-semibold">
                Шаблон
              </span>
            </div>
            <h3 className="text-lg font-semibold text-warm-950 mb-1">В&nbsp;Word или в&nbsp;шаблоне</h3>
            <p className="text-sm text-warm-500 mb-5">20–40 минут ручной работы</p>

            {/* Mock chat */}
            <div className="bg-warm-50 rounded-2xl p-4 mb-4 space-y-2 text-xs">
              <ChatBubble role="user" text="Сделайте рабочий лист по дробям, 5 класс, 10 заданий" />
              <ChatBubble role="assistant" typing />
              <ChatBubble role="assistant" text="Конечно! Вот 10 заданий..." />
            </div>

            <ul className="space-y-2.5">
              {GENERIC_ROW.map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm text-warm-700">
                  <X className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  {t}
                </li>
              ))}
            </ul>
          </Card>

          {/* УчЛист card */}
          <Card
            className="relative h-full bg-gradient-to-br from-brand-50/50 to-white border-brand-200"
            style={{
              opacity: show ? 1 : 0,
              transform: show ? "translateX(0)" : "translateX(20px)",
              transitionProperty: "opacity, transform",
              transitionDuration: "600ms",
              transitionDelay: "150ms",
            }}
          >
            <div className="absolute top-4 right-4">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand-500 text-white text-xs font-semibold">
                <Sparkles className="w-3 h-3" />
                УчЛист
              </span>
            </div>
            <h3 className="text-lg font-semibold text-warm-950 mb-1">Через УчЛист</h3>
            <p className="text-sm text-brand-700 mb-5 font-medium">30 секунд — PDF готов</p>

            {/* Mock worksheet auto-generated */}
            <div className="bg-white border border-brand-200 rounded-2xl p-4 mb-4 space-y-2 relative overflow-hidden">
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-100/50 to-transparent pointer-events-none"
                style={{ animation: reducedMotion ? "none" : "shimmer 2s linear infinite", backgroundSize: "200% 100%" }}
              />
              <div className="relative flex items-center justify-between mb-2 pb-2 border-b border-warm-100">
                <div className="text-[10px] font-semibold text-warm-950">Обыкновенные дроби · 5 кл.</div>
                <div className="text-[9px] text-emerald-600 font-bold">✓ 30 сек</div>
              </div>
              {[
                "Сократите: 8/12 = __",
                "Сложите: 2/5 + 1/5 = __",
                "Приведите к общему знаменателю...",
              ].map((task, i) => (
                <div
                  key={i}
                  className="relative flex items-start gap-1.5 text-[10px] text-warm-700"
                  style={{
                    opacity: show ? 1 : 0,
                    transform: show ? "translateX(0)" : "translateX(8px)",
                    transitionProperty: "opacity, transform",
                    transitionDuration: "300ms",
                    transitionDelay: `${500 + i * 150}ms`,
                  }}
                >
                  <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-brand-100 text-brand-800 font-bold text-[8px] shrink-0">
                    {i + 1}
                  </span>
                  {task}
                </div>
              ))}
            </div>

            <ul className="space-y-2.5">
              {OUR_ROW.map((t) => (
                <li key={t} className="flex items-start gap-2 text-sm text-warm-700">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  {t}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <p className="mt-8 text-center text-sm text-warm-500 max-w-xl mx-auto">
          Это не&nbsp;рекламные цифры, а расчёт на&nbsp;одном реальном листе.
          Для&nbsp;учителя с&nbsp;12&nbsp;учениками&nbsp;— около 6&nbsp;часов в&nbsp;месяц.
        </p>
      </div>
    </section>
  );
}

function ChatBubble({ role, text, typing }: { role: "user" | "assistant"; text?: string; typing?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-2.5 py-1.5 rounded-2xl ${
          isUser
            ? "bg-brand-500 text-white rounded-br-sm"
            : "bg-white border border-warm-200 text-warm-700 rounded-bl-sm"
        }`}
      >
        {typing ? (
          <div className="flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>печатает...</span>
          </div>
        ) : (
          <span>{text}</span>
        )}
      </div>
    </div>
  );
}
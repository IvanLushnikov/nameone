"use client";

import Link from "next/link";
import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Check, Sparkles } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils/cn";

type Period = "month" | "year";

const plans = [
  {
    id: "free",
    name: "Бесплатно",
    description: "Попробовать и понять, нужно ли",
    features: [
      "3 генерации в сутки",
      "Все предметы, 1-11 класс",
      "PDF с ответами и пояснениями",
      "Без регистрации",
    ],
    cta: "Начать бесплатно",
    href: "/constructor",
    highlight: false,
    accent: "from-warm-300 to-warm-500",
    month: { price: "0 ₽", sub: "навсегда", saving: null },
    year: { price: "0 ₽", sub: "навсегда", saving: null },
  },
  {
    id: "base",
    name: "Базовый",
    description: "Для репетиторов и родителей",
    features: [
      "Безлимитные генерации",
      "История и шаблоны",
      "Избранное и сохранённые настройки",
      "Семейный доступ до 5 человек",
    ],
    cta: "Оформить подписку",
    href: "/pricing",
    highlight: true,
    accent: "from-brand-400 via-brand-500 to-brand-600",
    month: { price: "590 ₽", sub: "в месяц", saving: null },
    year: {
      price: "490 ₽",
      sub: "в месяц при оплате за год",
      saving: "5 900 ₽ за год",
    },
  },
  {
    id: "plus",
    name: "Плюс",
    description: "Всё для урока: листы, планы, презентации, КТП, ОГЭ/ЕГЭ",
    features: [
      "Всё из Базового",
      "Планы уроков по ФГОС",
      "Презентации и КТП",
      "Варианты ОГЭ/ЕГЭ с разбором",
      "Адаптивные тесты",
      "Telegram-бот",
      "Ранний доступ к новым фичам",
    ],
    cta: "Выбрать Плюс",
    href: "/pricing",
    highlight: false,
    accent: "from-accent-400 to-accent-600",
    month: { price: "1 490 ₽", sub: "в месяц", saving: null },
    year: {
      price: "990 ₽",
      sub: "в месяц при оплате за год",
      saving: "11 900 ₽ за год",
    },
  },
];

export function PricingTeaser() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  const [period, setPeriod] = React.useState<Period>("year");

  return (
    <section
      ref={ref}
      className="py-20 sm:py-28 bg-gradient-to-b from-white to-warm-50 border-t border-warm-100"
    >
      <div className="container-tight">
        <div className="max-w-2xl mx-auto text-center mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
            Тарифы
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Начните бесплатно. Платите, когда&nbsp;удобно.
          </h2>
          <p className="mt-3 text-warm-600">
            Без скрытых платежей. Отмена в 1 клик. Возврат за 7 дней.
          </p>
        </div>

        {/* Period toggle */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex p-1 rounded-full bg-warm-100 border border-warm-200">
            <button
              type="button"
              onClick={() => setPeriod("month")}
              className={cn(
                "px-4 sm:px-5 py-2 rounded-full text-sm font-medium transition-all",
                period === "month"
                  ? "bg-white text-warm-950 shadow-soft"
                  : "text-warm-600 hover:text-warm-900"
              )}
            >
              Помесячно
            </button>
            <button
              type="button"
              onClick={() => setPeriod("year")}
              className={cn(
                "px-4 sm:px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5",
                period === "year"
                  ? "bg-white text-warm-950 shadow-soft"
                  : "text-warm-600 hover:text-warm-900"
              )}
            >
              За год
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                −17%
              </span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 sm:gap-5 max-w-5xl mx-auto">
          {plans.map((p, i) => (
            <PricingCard
              key={p.name}
              plan={p}
              index={i}
              inView={inView}
              period={period}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-warm-500">
          Также доступны{" "}
          <Link
            href="/pricing"
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            годовые тарифы со скидкой
          </Link>{" "}
          и{" "}
          <Link
            href="/pricing#b2b"
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            подписка для классов
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

function PricingCard({
  plan,
  index,
  inView,
  period,
}: {
  plan: (typeof plans)[number];
  index: number;
  inView: boolean;
  period: Period;
}) {
  const isHighlight = plan.highlight;
  const pricing = plan[period];

  return (
    <div
      className="relative"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(20px)",
        transitionProperty: "opacity, transform",
        transitionDuration: "500ms",
        transitionDelay: `${index * 100}ms`,
      }}
    >
      {/* Rotating glow for highlight card */}
      {isHighlight && (
        <div
          className={`absolute -inset-[2px] rounded-3xl bg-gradient-to-br ${plan.accent} opacity-60 blur-lg animate-fade-in`}
          style={{
            animation: "shimmer 4s linear infinite",
            backgroundSize: "200% 200%",
          }}
        />
      )}
      <Card
        className={`relative h-full transition-all duration-300 hover:-translate-y-1 ${
          isHighlight ? "ring-2 ring-brand-400 shadow-soft-lg" : ""
        }`}
      >
        {isHighlight && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-brand-500 to-accent-500 text-white text-xs font-semibold flex items-center gap-1 shadow-accent z-10">
            <Sparkles className="w-3 h-3" />
            Популярный
          </div>
        )}
        <div className="mb-4">
          <div className="text-sm font-semibold uppercase tracking-wider text-warm-500 mb-2">
            {plan.name}
          </div>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-3xl font-bold text-warm-950 whitespace-nowrap">
              {pricing.price}
            </span>
            <span className="text-sm text-warm-500">/ {pricing.sub}</span>
          </div>
          {pricing.saving && (
            <p className="mt-1.5 text-xs font-medium text-emerald-700">
              {pricing.saving} — экономия 1 080 ₽
            </p>
          )}
          <p className="mt-2 text-sm text-warm-600">{plan.description}</p>
        </div>

        <ul className="space-y-2.5 mb-6">
          {plan.features.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-warm-700"
            >
              <Check
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  isHighlight ? "text-brand-600" : "text-brand-500"
                }`}
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Button
          as="link"
          href={plan.href}
          variant={isHighlight ? "primary" : "secondary"}
          size="md"
          fullWidth
        >
          {plan.cta}
        </Button>
      </Card>
    </div>
  );
}
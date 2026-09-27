"use client";

import * as React from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Check, Sparkles, Lock } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  remaining: number;
}

const plans = [
  {
    id: "base",
    name: "Базовый",
    price: "590",
    priceYear: "490",
    period: "₽/мес",
    periodYear: "₽/мес · за год 5 900 ₽",
    description: "Для репетиторов и родителей",
    features: [
      "Безлимитные генерации",
      "Все предметы 1-11 класс",
      "История и шаблоны",
      "Избранное и сохранённые настройки",
    ],
    accent: false,
  },
  {
    id: "plus",
    name: "Плюс",
    price: "1 490",
    priceYear: "990",
    period: "₽/мес",
    periodYear: "₽/мес · за год 11 900 ₽",
    description: "Подготовка к ОГЭ/ЕГЭ",
    features: [
      "Всё из Базового",
      "Варианты ОГЭ/ЕГЭ с разбором",
      "Telegram-бот",
      "Ранний доступ к фичам",
    ],
    accent: true,
  },
];

export function PaywallModal({ open, onClose }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-accent-500" />
          Лимит бесплатных генераций
        </span>
      }
      description={`Вы использовали 3 бесплатных листа. Чтобы продолжить — оформите подписку. Отменить можно в любой момент.`}
    >
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        {plans.map((p) => (
          <div
            key={p.id}
            className={
              p.accent
                ? "relative p-5 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand"
                : "p-5 rounded-2xl border border-warm-200 bg-white"
            }
          >
            {p.accent && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-accent-500 text-white text-xs font-semibold flex items-center gap-1 shadow-accent">
                <Sparkles className="w-3 h-3" />
                Популярный
              </div>
            )}
            <div className="text-sm font-semibold uppercase tracking-wider opacity-80 mb-2">
              {p.name}
            </div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-3xl font-bold">{p.price}</span>
              <span className="text-sm opacity-80">{p.period}</span>
            </div>
            <div className="text-xs opacity-70 mb-2">
              или <span className="font-semibold">{p.priceYear}</span>
              {p.periodYear.replace("₽/мес · ", " ")}
            </div>
            <div className="text-sm opacity-90 mb-4">{p.description}</div>
            <ul className="space-y-1.5 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="opacity-90">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="space-y-2.5">
        <Button variant="primary" size="lg" fullWidth leftIcon={<Sparkles className="w-4 h-4" />}>
          Оформить Базовый · 590 ₽/мес
        </Button>
        <Button variant="accent" size="lg" fullWidth>
          Оформить Плюс · 1 490 ₽/мес
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={onClose}>
          Вернуться в генератор
        </Button>
      </div>

      <p className="mt-5 text-center text-xs text-warm-500">
        Оплата через ЮKassa / СБП. Возврат в течение 7 дней. Отмена в 1 клик.
        <br />
        <span className="font-medium text-warm-700">
          Первый месяц Базового — 1 ₽
        </span>
      </p>
    </Modal>
  );
}
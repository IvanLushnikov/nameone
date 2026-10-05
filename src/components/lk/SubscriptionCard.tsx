"use client";

/**
 * Компактная строка подписки для ПЕРВОГО экрана кабинета (ТЗ-21, блок 4).
 *
 * Зачем отдельный компонент, если кабинет уже показывает норму в UsageCard:
 * дата следующего списания пряталась мелкой строкой внутри карточки объёма, и
 * платящий учитель не мог за минуту понять, сколько он платит, когда и как.
 *
 * Этот компонент — РОВНО та строка, которой не хватало: тариф, цена, дата
 * следующего списания, способ оплаты и кнопка «Управлять».
 *
 * Файл `src/app/dashboard/page.tsx` в этой работе не трогается (его правит
 * соседняя задача), поэтому компонент сделан так, чтобы вставлялся одним
 * блоком:
 *
 *     import { SubscriptionCard } from "@/components/lk/SubscriptionCard";
 *     <SubscriptionCard />
 *
 * Компонент сам грузит данные и сам умеет показать честную неудачу, поэтому
 * странице кабинета не нужно знать про `/api/billing/*` вообще.
 */

import * as React from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { loadSubscription, type SubscriptionView } from "@/lib/lk/subscription-api";

/** «15 октября» / «15 октября 2026» — коротко и по-русски. */
export function formatChargeDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

export function stateBadge(state: SubscriptionView["state"]): { tone: "brand" | "warm" | "accent" | "neutral"; label: string } {
  switch (state) {
    case "active":
      return { tone: "brand", label: "активна" };
    case "canceled":
      return { tone: "warm", label: "без автопродления" };
    case "over":
      return { tone: "accent", label: "объём превышен" };
    default:
      return { tone: "neutral", label: "бесплатный тариф" };
  }
}

export function SubscriptionCard() {
  const [subscription, setSubscription] = React.useState<SubscriptionView | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // Молча игнорируем любую ошибку: это СДОПОЛНИТЕЛЬНАЯ строка на главном
    // экране. Упавшая подписка не должна ломать кабинет, который и без неё
    // работает (ТЗ-21, главное правило).
    loadSubscription()
      .then((res) => {
        if (!cancelled) setSubscription(res.subscription);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!subscription) return null;

  const badge = stateBadge(subscription.state);

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
            <CreditCard className="w-5 h-5 text-brand-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-warm-950">Подписка «{subscription.planName}»</h2>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
            <p className="text-sm text-warm-600 mt-1">
              {subscriptionPriceLine(subscription)}
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center h-9 px-3 text-sm rounded-lg border border-warm-200 text-warm-900 hover:bg-warm-50 whitespace-nowrap"
        >
          Управлять
        </Link>
      </div>
    </Card>
  );
}

/** Строка «цена · следующее списание». Одна и та же логика на обоих экранах. */
export function subscriptionPriceLine(s: SubscriptionView): string {
  const price = s.priceLabel;
  if (s.state === "free") {
    return `${price} · платить не нужно`;
  }
  if (!s.autoRenew) {
    return s.periodEndsAt
      ? `${price} · действует до ${formatChargeDate(s.periodEndsAt)}, автопродление выключено`
      : `${price} · автопродление выключено`;
  }
  return s.nextChargeAt
    ? `${price} · следующее списание ${formatChargeDate(s.nextChargeAt)}`
    : `${price} · автопродление включено`;
}

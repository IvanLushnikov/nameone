"use client";

/**
 * Блок «Подписка» в кабинете (ТЗ-21, блок 4).
 *
 * Закрывает то, чего в кабинете не было вообще: сменить тариф, отменить
 * подписку, посмотреть чеки и узнать дату следующего списания. Серверные
 * методы `/api/billing/subscription`, `/cancel`, `/history`, `/create` были
 * готовы и не вызывались ни разу — здесь вызываются.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ОПЛАТА ДОВОДИТСЯ ДО РЕЗУЛЬТАТА, НО НЕ ИМИТИРУЕТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Кнопка «Перейти к оплате» создаёт платёж на сервере и уводит на страницу
 * платёжного сервиса. Если приём платежей не настроен (сейчас именно так:
 * ключи ЮKassa не заданы, демо-оплата выключена осознанно), сервер отвечает
 * отказом, и мы показываем его как есть. Показывать учителю «оплата прошла» или
 * прятать кнопку с текстом «скоро» — одинаково плохо: в первом случае мы
 * обещаем тариф, которого нет, во втором — теряем продажу без причины.
 * Никаких заглушек «успешной оплаты» в этом файле нет.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * АНОНИМ
 * ─────────────────────────────────────────────────────────────────────────────
 * Блок виден всегда. Без аккаунта в нём честно: тариф есть, цена есть, даты и
 * чека нет — и сказано почему. «Войдите, чтобы увидеть» здесь не появляется
 * ни в одном состоянии.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CreditCard, RefreshCw } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import {
  PLANS,
  PERIODS,
  PERIOD_IDS,
  DEFAULT_PERIOD,
  formatRub,
  type PeriodId,
  type PlanId,
} from "@/lib/content/plans";
import { cn } from "@/lib/utils/cn";
import {
  loadSubscription,
  quotePlanChange,
  createPayment,
  type LoadSubscriptionResult,
  type SubscriptionView,
} from "@/lib/lk/subscription-api";
import { CancelSubscriptionFlow } from "./CancelSubscriptionFlow";
import { PaymentHistory } from "./PaymentHistory";
import { formatChargeDate, stateBadge } from "./SubscriptionCard";

export function SubscriptionPanel() {
  const router = useRouter();
  const [data, setData] = React.useState<LoadSubscriptionResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [planOpen, setPlanOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await loadSubscription();
    setData(res);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Подписка</CardTitle>
        </CardHeader>
        <div className="space-y-2" aria-busy>
          <div className="h-5 w-52 rounded bg-warm-100 animate-pulse" />
          <div className="h-5 w-72 rounded bg-warm-100 animate-pulse" />
        </div>
      </Card>
    );
  }

  const s = data?.subscription;
  if (!s || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Подписка</CardTitle>
        </CardHeader>
        <p className="text-sm text-warm-600">Не удалось загрузить данные подписки.</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4" />
          Попробовать ещё раз
        </Button>
      </Card>
    );
  }

  const badge = stateBadge(s.state);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Подписка</CardTitle>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <CardDescription>
            Тариф, цена и когда в следующий раз спишется — здесь, а не мелкой строкой внутри
            карточки объёма.
          </CardDescription>
        </CardHeader>

        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Тариф" value={`«${s.planName}»`} />
          <Row label="Цена" value={s.priceLabel} />
          <Row
            label="Следующее списание"
            value={
              s.state === "free"
                ? "платить не нужно"
                : s.nextChargeAt
                  ? formatChargeDate(s.nextChargeAt)
                  : s.periodEndsAt
                    ? `не будет — доступ до ${formatChargeDate(s.periodEndsAt)}`
                    : "нет активного тарифа"
            }
          />
          <Row label="Способ оплаты" value={paymentMethodLabel(s)} />
        </dl>

        {s.state === "over" ? (
          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-warm-800">
              Объём тарифа превышен. <b>Генерация при этом не останавливается</b> — материалы
              выдаются как обычно. Если нагрузка станет постоянной, поможет «Плюс».
            </p>
          </div>
        ) : null}

        {s.state === "canceled" ? (
          <p className="mt-4 rounded-xl bg-warm-50 border border-warm-200 p-3 text-sm text-warm-700">
            Автопродление выключено. Доступ работает до{" "}
            <b>{s.periodEndsAt ? formatChargeDate(s.periodEndsAt) : "конца периода"}</b>, дальше
            списаний не будет. Материалы и история останутся в кабинете.
          </p>
        ) : null}

        {s.note ? (
          <p className="mt-4 rounded-xl border border-warm-200 bg-warm-50 p-3 text-sm text-warm-700">
            {s.note}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setPlanOpen(true)}>
            Управлять тарифом
          </Button>
          {s.autoRenew ? (
            <Button variant="ghost" onClick={() => setCancelOpen(true)}>
              Отменить автопродление
            </Button>
          ) : null}
          {!data.canPay ? (
            <Button variant="secondary" onClick={() => router.push("/pricing")}>
              Посмотреть тарифы
            </Button>
          ) : null}
        </div>

        {data.canPayReason ? (
          <p className="mt-2 text-xs text-warm-500">{data.canPayReason}</p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>История платежей</CardTitle>
          <CardDescription>
            Дата, сумма и чек. Незавершённые оплаты показываем отдельно, а не прячем.
          </CardDescription>
        </CardHeader>
        <PaymentHistory payments={data.history} />
      </Card>

      <PlanChangeDialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        subscription={s}
        canPay={data.canPay}
        canPayReason={data.canPayReason}
      />

      <CancelSubscriptionFlow
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        subscription={s}
        onDone={() => void load()}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-warm-200 px-4 py-3">
      <dt className="text-xs text-warm-500">{label}</dt>
      <dd className="text-sm font-medium text-warm-950 mt-0.5">{value}</dd>
    </div>
  );
}

function paymentMethodLabel(s: SubscriptionView): string {
  if (s.state === "free") return "не привязан — платить не нужно";
  switch (s.paymentMethod) {
    case "saved":
      return "карта сохранена у платёжного сервиса";
    case "none":
      return "не сохранён — списаний не будет";
    default:
      return "нужно проверить у платёжного сервиса";
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Смена тарифа
 * ──────────────────────────────────────────────────────────────────────────── */

const SELLABLE: PlanId[] = ["base", "plus"];

function PlanChangeDialog({
  open,
  onClose,
  subscription,
  canPay,
  canPayReason,
}: {
  open: boolean;
  onClose: () => void;
  subscription: SubscriptionView;
  canPay: boolean;
  canPayReason: string | null;
}) {
  const [plan, setPlan] = React.useState<PlanId>(subscription.plan === "free" ? "base" : subscription.plan);
  const [period, setPeriod] = React.useState<PeriodId>(subscription.period ?? DEFAULT_PERIOD);
  const [busy, setBusy] = React.useState(false);
  const [payError, setPayError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPlan(subscription.plan === "free" ? "base" : subscription.plan);
    setPeriod(subscription.period ?? DEFAULT_PERIOD);
    setPayError(null);
  }, [open, subscription.plan, subscription.period]);

  const now = Math.floor(Date.now() / 1000);
  const quote = quotePlanChange({
    from: subscription.plan,
    to: plan,
    period,
    now,
    periodEndsAt: subscription.periodEndsAt,
  });

  const pay = async () => {
    setBusy(true);
    setPayError(null);
    try {
      const returnUrl = `${window.location.origin}/dashboard/settings?paid=1`;
      const res = await createPayment({ plan, period, returnUrl });
      if (!res.ok) {
        setPayError(
          res.error === "payment_unavailable"
            ? "Приём платежей сейчас не настроен, поэтому оплатить нельзя. Мы не показываем «оплата прошла», потому что платежа не было. Попробуйте позже — кнопка останется на месте."
            : res.error === "unauthorized"
              ? "Вход истёк — войдите заново, чтобы оплатить."
              : "Не удалось создать платёж. Попробуйте ещё раз.",
        );
        return;
      }
      // Уходим на страницу платёжного сервиса. Что будет дальше — его зона.
      window.location.assign(res.confirmationUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Тариф и период"
      description="Считаем честно: при повышении — только разница за оставшиеся дни, при понижении — со следующего периода."
      footer={
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            variant="primary"
            onClick={pay}
            loading={busy}
            disabled={quote.kind === "same" || !canPay}
          >
            {payLabel(quote.kind, quote.payNowRub)}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="text-sm font-medium text-warm-700 mb-2">Период</p>
          <div className="flex flex-wrap gap-2">
            {PERIOD_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setPeriod(id)}
                className={cn(
                  "px-3 h-10 rounded-xl border text-sm",
                  period === id
                    ? "border-brand-500 bg-brand-50 text-brand-800"
                    : "border-warm-200 text-warm-700 hover:border-warm-300",
                )}
              >
                {PERIODS[id].label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-warm-500">{PERIODS[period].note}</p>
        </div>

        <div>
          <p className="text-sm font-medium text-warm-700 mb-2">Тариф</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SELLABLE.map((id) => {
              const selected = plan === id;
              const price = PLANS[id].prices[period]?.amount ?? 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPlan(id)}
                  className={cn(
                    "text-left rounded-xl border p-4 transition-colors",
                    selected
                      ? "border-brand-500 bg-brand-50"
                      : "border-warm-200 hover:border-warm-300",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-warm-950">{PLANS[id].name}</span>
                    {selected ? <Badge tone="brand">выбран</Badge> : null}
                  </div>
                  <p className="text-sm text-warm-600 mt-1">
                    {formatRub(price)}{" "}
                    {period === "academicYear" ? "за 9 месяцев" : "в месяц"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-warm-200 bg-warm-50 p-4 text-sm text-warm-800 space-y-1">
          <p>{quote.note}</p>
          {quote.kind === "same" ? (
            <p className="text-warm-600">Чтобы изменить тариф, выберите другой вариант выше.</p>
          ) : null}
        </div>

        {!canPay && canPayReason ? (
          <p className="text-sm text-warm-700 bg-warm-50 border border-warm-200 rounded-lg p-3">
            {canPayReason}
          </p>
        ) : null}

        {payError ? (
          <p className="text-sm text-warm-800 bg-warm-50 border border-warm-200 rounded-lg p-3">
            {payError}
          </p>
        ) : null}

        <p className="text-xs text-warm-500 flex items-start gap-1.5">
          <CreditCard className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Оплата проходит на стороне платёжного сервиса: мы передаём сумму и уходим на его
          страницу. Списание списывается только после подтверждения на той стороне.
        </p>
      </div>
    </Modal>
  );
}

function payLabel(kind: ReturnType<typeof quotePlanChange>["kind"], amount: number): string {
  const rub = formatRub(amount);
  switch (kind) {
    case "start":
      return `Оплатить ${rub}`;
    case "upgrade":
      return amount > 0 ? `Доплатить ${rub} и перейти` : "Перейти сейчас";
    case "downgrade":
      return "Перейти на новый тариф";
    default:
      return "Тариф не изменится";
  }
}

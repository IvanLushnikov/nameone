"use client";

/**
 * История платежей и чеки (ТЗ-21, блок 4, пункт 4).
 *
 * До этого блока чеки не показывались нигде: деньги платились на странице тарифов
 * и исчезали. Здесь — дата, сумма, тариф, статус и ссылка на чек платёжного
 * сервиса.
 *
 * Ссылка на чек берётся ТОЛЬКО из того, что вернул сервер (`confirmation_url`).
 * Ничего не конструируется и не додумывается: чек есть там, где он есть.
 * Незавершённые платежи показываем отдельным списком с честным статусом
 * («оплата не завершена»), а не прячем — иначе учитель думает, что заплатил.
 */

import { ExternalLink, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils/cn";
import { PLANS, formatRub, type PlanId } from "@/lib/content/plans";
import type { PaymentItem } from "@/lib/lk/subscription-api";

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warm" | "danger" | "neutral" }> = {
  succeeded: { label: "оплачен", tone: "success" },
  pending: { label: "не завершён", tone: "warm" },
  canceled: { label: "отменён", tone: "neutral" },
  refunded: { label: "возврат", tone: "neutral" },
};

function statusOf(status: string) {
  return STATUS_LABELS[status] ?? { label: status, tone: "neutral" as const };
}

export function PaymentHistory({ payments }: { payments: PaymentItem[] }) {
  if (payments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-warm-300 p-4 flex items-start gap-3">
        <Receipt className="w-5 h-5 text-warm-500 shrink-0 mt-0.5" />
        <p className="text-sm text-warm-600">
          Платежей пока нет. Как только вы оплатите тариф, здесь появятся дата, сумма и чек.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-warm-100">
      {payments.map((p) => {
        const status = statusOf(p.status);
        const planName = PLANS[p.plan as PlanId]?.name ?? p.plan;
        return (
          <li key={p.id} className="py-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-warm-950">
                  Тариф «{planName}»
                </span>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <p className="text-xs text-warm-500 mt-0.5">
                {formatDate((p.completedAt ?? p.createdAt) * 1000)} · {formatRub(p.amountRub)}
                {p.period ? ` · ${p.period === "academicYear" ? "учебный год" : "месяц"}` : ""}
              </p>
            </div>
            {p.receiptUrl ? (
              <a
                href={p.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"
              >
                Чек
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="text-xs text-warm-500">чек недоступен</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

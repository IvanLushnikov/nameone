"use client";

import * as React from "react";
import {
  loadMoney,
  formatRub,
  formatPercent,
  formatDay,
  type Money,
  type LoadResult,
} from "@/lib/superpower-api";
import {
  Panel,
  StatCard,
  DataTable,
  Loading,
  LoadError,
  EmptyState,
} from "@/components/superpower/Primitives";

/**
 * Экран 4 — деньги подробно (ТЗ-24, раздел 7).
 *
 * Это единственный экран `/superpower`, открытие которого пишется в
 * `admin_audit_log`: здесь видно выручку и себестоимость, и именно про этот
 * экран потом может идти спор «я такого не видел».
 *
 * ЧТО ГДЕ ВЗЯЛОСЬ
 * ---------------
 *   Выручка       — сумма успешных платежей из `payments`. Факт, не прайс.
 *   Расход        — фактическое списание из `llm_costs_actual` (счёт polza.ai).
 *   Пополнения    — РОСТ кошелька провайдера между суточными снимками.
 *   Доля расхода  — расход ÷ выручка. null там, где выручки не было (годовая
 *                   оплата целиком попала в другой месяц) — это не «0%».
 */

/** Понятная подпись тарифа из технического плана. */
const PLAN_LABEL: Record<string, string> = {
  free: "Бесплатный",
  base: "Базовый",
  standard: "Оптимальный",
  plus: "Плюс",
  school: "Школа",
};

const PAYMENT_STATUS: Record<string, string> = {
  succeeded: "Оплачен",
  pending: "Не завершён",
  canceled: "Отменён",
  refunded: "Возврат",
};

export default function SuperpowerMoneyPage() {
  const [result, setResult] = React.useState<LoadResult<Money & { ok: true }> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    loadMoney().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result) return <Loading />;
  if (result.error) return <LoadError error={result.error} />;

  const data = result.data!;
  const { summary, topups } = data;

  const overBudget = data.costByUser.filter((u) => u.overAlert);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Выручка" value={formatRub(summary.revenueRub)} hint={`Месяц ${data.month}`} />
        <StatCard
          label="Расход по счёту"
          value={formatRub(summary.costRubActual)}
          tone={summary.costRubActual === null ? "default" : "warn"}
        />
        <StatCard label="Расход по расчёту" value={formatRub(summary.costRubEstimate)} />
        <StatCard
          label="Доля расхода"
          value={formatPercent(summary.costShare)}
          hint="Тревога — выше 25%"
          tone={
            summary.costShare === null
              ? "default"
              : summary.costShare > 100
                ? "bad"
                : summary.costShare > 25
                  ? "warn"
                  : "good"
          }
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel
          title="Пополнения"
          hint="Рост кошелька провайдера между суточными снимками. Уменьшение баланса пополнением не считается."
        >
          <StatCard label="Пополнено за месяц" value={formatRub(topups.totalRub)} tone="good" />
          <div className="mt-3">
            <DataTable
              rows={topups.byDay}
              emptyText="Пополнений не было: снимков баланса ещё недостаточно"
              columns={[
                { key: "date", header: "Дата", render: (r) => r.date },
                {
                  key: "amount",
                  header: "На кошелёк",
                  render: (r) => <span className="tabular-nums">{formatRub(r.amountRub)}</span>,
                },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Кошелёк у провайдера" hint="Снимок раз в сутки.">
          {data.providerBalance ? (
            <div className="space-y-2">
              <StatCard
                label="Сейчас на балансе"
                value={formatRub(data.providerBalance.amountRub)}
                tone={data.providerBalance.amountRub < 500 ? "warn" : "default"}
              />
              <div className="text-sm text-warm-600">
                Доступно к трате: {formatRub(data.providerBalance.availableRub)}
              </div>
            </div>
          ) : (
            <EmptyState text="Снимков баланса ещё нет" />
          )}
        </Panel>
      </div>

      {overBudget.length > 0 ? (
        <Panel
          title="Кто съел больше четверти выручки"
          hint="Предохранитель: при мягкой норме учителя убыток виден только здесь."
        >
          <DataTable
            rows={overBudget}
            emptyText="Ни у кого не превышено"
            columns={[
              { key: "email", header: "Учитель", render: (r) => r.email ?? "анонимно" },
              { key: "plan", header: "Тариф", render: (r) => PLAN_LABEL[r.plan] ?? r.plan },
              { key: "cost", header: "Расход", render: (r) => <span className="tabular-nums">{formatRub(r.costRub)}</span> },
              { key: "rev", header: "Выручка", render: (r) => <span className="tabular-nums">{formatRub(r.revenueRub)}</span> },
              {
                key: "share",
                header: "Доля",
                render: (r) => <span className="tabular-nums text-accent-700">{formatPercent(r.costShare)}</span>,
              },
            ]}
          />
        </Panel>
      ) : null}

      <Panel title="Расходы по учителям" hint="Только те, по ком у провайдер отдал фактическую сумму.">
        <DataTable
          rows={data.costByUser}
          emptyText="Фактических списаний пока нет: провайдер ещё не отдавал суммы"
          columns={[
            { key: "email", header: "Учитель", render: (r) => r.email ?? "анонимно" },
            { key: "plan", header: "Тариф", render: (r) => PLAN_LABEL[r.plan] ?? r.plan },
            {
              key: "cost",
              header: "Расход",
              render: (r) => <span className="tabular-nums">{formatRub(r.costRub)}</span>,
            },
            {
              key: "rev",
              header: "Выручка за месяц",
              render: (r) => <span className="tabular-nums">{formatRub(r.revenueRub)}</span>,
            },
            { key: "share", header: "Доля", render: (r) => formatPercent(r.costShare) },
          ]}
        />
      </Panel>

      <Panel title="Платежи" hint="Из базы, фактические записи.">
        <DataTable
          rows={data.payments}
          emptyText="Платежей за месяц не было"
          columns={[
            { key: "date", header: "Дата", render: (r) => formatDay(r.created_at) },
            { key: "plan", header: "Тариф", render: (r) => PLAN_LABEL[r.plan] ?? r.plan },
            {
              key: "amount",
              header: "Сумма",
              render: (r) => <span className="tabular-nums">{formatRub(r.amount_rub)}</span>,
            },
            {
              key: "status",
              header: "Статус",
              render: (r) => PAYMENT_STATUS[r.status] ?? r.status,
            },
          ]}
        />
      </Panel>

      <Panel title="Подписки" hint="Кто на каком тарифе и с автопродлечением ли.">
        <DataTable
          rows={data.subscriptions}
          emptyText="Подписок пока нет"
          columns={[
            { key: "plan", header: "Тариф", render: (r) => PLAN_LABEL[r.plan] ?? r.plan },
            { key: "status", header: "Статус", render: (r) => r.status },
            { key: "period", header: "Период", render: (r) => (r.period === "monthly" ? "месяц" : "учебный год") },
            {
              key: "renew",
              header: "Автопродление",
              render: (r) => (r.auto_renew === 1 ? "включено" : "выключено"),
            },
            { key: "ends", header: "До", render: (r) => formatDay(r.ends_at) },
          ]}
        />
      </Panel>
    </div>
  );
}
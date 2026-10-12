"use client";

import * as React from "react";
import {
  loadGenerations,
  formatRub,
  formatPercent,
  type Generations,
  type LoadResult,
} from "@/lib/superpower-api";
import {
  Panel,
  StatCard,
  BarSeries,
  DataTable,
  Loading,
  LoadError,
  EmptyState,
} from "@/components/superpower/Primitives";

/**
 * Экран 3 — генерации (ТЗ-24, раздел 7).
 *
 * Три вопроса: сколько генераций, какие из них сорвались и сколько брали из
 * кэша. Последнее важно не меньше: если доля кэша упала, значит либо полез
 * трафик, либо сломалась семантическая выборка — и это видно сразу.
 */
const DAY_OPTIONS = [7, 30, 90];

export default function SuperpowerGenerationsPage() {
  const [days, setDays] = React.useState(30);
  const [result, setResult] = React.useState<LoadResult<Generations & { ok: true }> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setResult(null);
    loadGenerations(days).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const switcher = (
    <div className="flex gap-1" role="group" aria-label="Период">
      {DAY_OPTIONS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          aria-pressed={days === d}
          className={
            days === d
              ? "px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium"
              : "px-3 py-1.5 rounded-lg text-warm-700 hover:bg-warm-100 text-sm font-medium"
          }
        >
          {d} дней
        </button>
      ))}
    </div>
  );

  if (!result) return <Loading />;
  if (result.error) return <LoadError error={result.error} />;

  const data = result.data!;
  const { totals } = data;
  const failRate = totals.calls > 0 ? Math.round((totals.failed / totals.calls) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Вызовов" value={totals.calls} hint={`За ${data.days} дней`} />
        <StatCard
          label="С ошибкой"
          value={totals.failed}
          hint={`${failRate}% от всех`}
          tone={failRate > 20 ? "bad" : failRate > 5 ? "warn" : "good"}
        />
        <StatCard label="Ушло на резервную модель" value={totals.fallback} hint="fallback-вызовы" />
        <StatCard
          label="Взято из кэша"
          value={totals.cached}
          hint={`${formatPercent(totals.cacheRate)} от всех вызовов`}
          tone={totals.cacheRate < 10 && totals.calls > 20 ? "warn" : "good"}
        />
      </div>

      <Panel
        title="Вызовы по дням"
        hint="Красные — те, что завершились ошибкой. Скачок после релиза читается здесь."
        action={switcher}
      >
        {data.byDay.length === 0 ? (
          <EmptyState text="За выбранный период генераций не было" />
        ) : (
          <>
            <BarSeries
              points={data.byDay.map((d) => ({ label: d.date, value: d.calls }))}
              formatValue={(v) => `${v} вызовов`}
            />
            {totals.failed > 0 ? (
              <div className="mt-4 pt-4 border-t border-warm-100">
                <div className="text-sm text-warm-600 mb-2">Из них с ошибкой</div>
                <BarSeries
                  points={data.byDay.map((d) => ({ label: d.date, value: d.failed }))}
                  height={80}
                />
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <Panel
        title="По типам материалов"
        hint="Расход — фактическое списание по счёту провайдера. «Нет данных» означает, что провайдер сумму не отдал."
      >
        <DataTable
          rows={data.byTask}
          emptyText="Генераций за период не было"
          columns={[
            { key: "task", header: "Задача", render: (r) => <code className="text-xs">{r.task}</code> },
            {
              key: "calls",
              header: "Вызовов",
              render: (r) => <span className="tabular-nums">{r.calls}</span>,
            },
            { key: "cost", header: "Расход по счёту", render: (r) => formatRub(r.costRubActual) },
          ]}
        />
      </Panel>

      <Panel title="По дням" hint="Число вызовов и сколько из них сорвалось.">
        <DataTable
          rows={data.byDay.slice().reverse().slice(0, 40)}
          emptyText="Данных нет"
          columns={[
            { key: "date", header: "Дата", render: (r) => r.date },
            { key: "calls", header: "Вызовов", render: (r) => <span className="tabular-nums">{r.calls}</span> },
            {
              key: "failed",
              header: "С ошибкой",
              render: (r) =>
                r.failed > 0 ? (
                  <span className="tabular-nums text-accent-700">{r.failed}</span>
                ) : (
                  <span className="text-warm-400">0</span>
                ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
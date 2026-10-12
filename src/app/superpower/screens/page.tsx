"use client";

import * as React from "react";
import { loadScreens, formatPercent, type Screens, type LoadResult } from "@/lib/superpower-api";
import {
  Panel,
  StatCard,
  BarSeries,
  DataTable,
  Loading,
  LoadError,
  ConversionCell,
} from "@/components/superpower/Primitives";

/**
 * Экран 2 — экраны и воронка (ТЗ-24, раздел 7).
 *
 * Два вопроса: на какие экраны заходят и где люди отваливаются.
 *
 * ПРО ВОРОНКУ ЧЕСТНО
 * ------------------
 * Шаги взяты из событий, которые реально расставлены по коду. Если события нет,
 * шага в воронке не будет — и это лучше, чем нарисовать шаг, который никто не
 * измеряет. Пустая воронка означает «события ещё не собираются» (или данных
 * нет), а не «никто не ходит».
 */
const DAY_OPTIONS = [7, 30, 90];

export default function SuperpowerScreensPage() {
  const [days, setDays] = React.useState(30);
  const [result, setResult] = React.useState<LoadResult<Screens & { ok: true }> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setResult(null);
    loadScreens(days).then((r) => {
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Всего событий" value={data.totals.events} hint={`За ${data.days} дней`} />
        <StatCard
          label="Разных событий"
          value={data.events.length}
          hint="Сколько экранов и действий вообще считается"
        />
        <StatCard
          label="Первый шаг воронки"
          value={data.funnel[0]?.users ?? 0}
          hint={data.funnel[0]?.label ?? "—"}
        />
        <StatCard
          label="Дошёл до генерации"
          value={data.funnel.find((f) => f.step === "constructor_generate_click")?.users ?? 0}
          hint="Нажал «сгенерировать»"
        />
      </div>

      <Panel title="Воронка" hint="Сколько людей дошло с предыдущего шага. Прочерк — сравнивать не с чем.">
        <DataTable
          rows={data.funnel}
          emptyText="Событий ещё нет: поставьте сбор или подождите первых данных"
          columns={[
            { key: "label", header: "Шаг", render: (r) => r.label },
            {
              key: "users",
              header: "Событий",
              render: (r) => <span className="tabular-nums">{r.users}</span>,
            },
            { key: "conv", header: "От предыдущего", render: (r) => <ConversionCell fromPrev={r.fromPrev} /> },
          ]}
        />
      </Panel>

      <Panel title="События по дням" hint="Общий поток событий за период.">
        <BarSeries
          points={data.totals.byDay.map((d) => ({ label: d.date, value: d.count }))}
        />
      </Panel>

      <Panel
        title="Что считается на сайте"
        hint="Топ событий по частоте. Технические имена — так они названы в коде."
        action={switcher}
      >
        <DataTable
          rows={data.events.slice(0, 25)}
          emptyText="Событий ещё нет"
          columns={[
            { key: "event", header: "Событие", render: (r) => <code className="text-xs">{r.event}</code> },
            {
              key: "total",
              header: "Всего",
              render: (r) => <span className="tabular-nums">{r.total}</span>,
            },
            {
              key: "share",
              header: "Доля",
              render: (r) =>
                formatPercent(
                  data.totals.events > 0 ? Math.round((r.total / data.totals.events) * 100) : null,
                ),
            },
            {
              key: "peak",
              header: "Пик за день",
              render: (r) => (
                <span className="tabular-nums">
                  {Math.max(0, ...r.byDay.map((d) => d.count))}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
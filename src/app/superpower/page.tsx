"use client";

import * as React from "react";
import Link from "next/link";
import {
  loadOverview,
  loadErrorText,
  formatRub,
  formatPercent,
  type Overview,
  type LoadResult,
} from "@/lib/superpower-api";
import { StatCard, Panel, Loading, LoadError, EmptyState } from "@/components/superpower/Primitives";

/**
 * Экран 1 — светофор (ТЗ-24, раздел 7).
 *
 * Открыл и сразу видно, что происходит: сколько событий, генераций и новых
 * учителей сегодня, сколько заработали за месяц, сколько потратили на AI и
 * во сколько раз расходы отличаются от счёта провайдера.
 *
 * ЧЕСТНОСТЬ ЦИФР
 * -------------
 * Блок «Расходы» показывает ДВЕ цифры: фактическое списание из счёта polza.ai
 * и наш расчёт по прайсу. Если факта ещё нет (провайдер раньше не отдавал
 * `usage.cost_rub`), показывается «нет данных» — НЕ ноль. Разница принципиальна:
 * ноль означал бы «мы ничего не потратили».
 *
 * «Заходы на сайт» здесь отсутствуют намеренно: посещаемость считает Метрика,
 * и дублировать её вторым счётчиком — значит поддерживать два инструмента ради
 * одного числа (решение владельца, ТЗ-24 раздел 4).
 */
export default function SuperpowerOverviewPage() {
  const [result, setResult] = React.useState<LoadResult<Overview & { ok: true }> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    loadOverview().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result) return <Loading />;
  if (result.error) return <LoadError error={result.error} />;

  const data = result.data!;
  const { money } = data;

  const costTone = !money.costShare
    ? "default"
    : money.costShare > 100
      ? "bad"
      : money.costShare > 25
        ? "warn"
        : "good";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Событий сегодня" value={data.today.events} />
        <StatCard label="Генераций сегодня" value={data.today.generations} />
        <StatCard label="Новых учителей сегодня" value={data.today.signups} />
        <StatCard label="Активных подписок" value={data.activeSubscriptions} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Выручка за месяц"
          value={formatRub(money.revenueRub)}
          hint={`Месяц ${data.month}`}
        />
        <StatCard
          label="Расходы по счёту polza.ai"
          value={formatRub(money.costRubActual)}
          hint={money.costRubActual === null ? "Счёт ещё не забирался" : "Факт с провайдера"}
          tone={money.costRubActual === null ? "default" : "warn"}
        />
        <StatCard
          label="Расходы по нашему расчёту"
          value={formatRub(money.costRubEstimate)}
          hint="Расчёт по прайсу-снимку"
        />
        <StatCard
          label="Доля расходов в выручке"
          value={formatPercent(money.costShare)}
          hint="Тревога — выше 25%"
          tone={costTone}
        />
      </div>

      {money.divergenceAlert ? (
        <div className="rounded-2xl bg-accent-50 border border-accent-200 p-4">
          <div className="text-accent-800 font-medium">
            Счёт провайдера и наш расчёт разошлись на {formatPercent(
              money.divergence === null ? null : Math.round(money.divergence * 100),
            )}
          </div>
          <div className="text-sm text-accent-700 mt-1">
            Обычно причина одна: провайдер поменял цены, а прайс в коде остался
            старым. Прайс снимается со страницы polza.ai и сверяется тестом —
            обновите снимок.
          </div>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel
          title="Кошелёк у провайдера"
          hint="Снимается раз в сутки. Пополнить заранее дешевле, чем разбираться с упавшими генерациями."
        >
          {data.providerBalance ? (
            <div className="space-y-3">
              <StatCard
                label="На балансе"
                value={formatRub(data.providerBalance.amountRub)}
                tone={data.providerBalance.amountRub < 500 ? "warn" : "default"}
              />
              {data.providerBalance.availableRub !== null ? (
                <div className="text-sm text-warm-600">
                  Доступно к трате: {formatRub(data.providerBalance.availableRub)}. Разница с
                  балансом — деньги, зарезервированные под текущие запросы.
                </div>
              ) : null}
              <Link
                href="/superpower/money"
                className="inline-block text-sm text-brand-700 hover:text-brand-800"
              >
                Подробности и пополнения →
              </Link>
            </div>
          ) : (
            <EmptyState text="Снимков баланса ещё нет — они появятся после первого запроса к провайдеру" />
          )}
        </Panel>

        <Panel title="За последние 30 дней" hint="Активность по продуктовым событиям, а не посещаемость сайта.">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Событий" value={data.last30.events} />
            <StatCard label="Активных людей" value={data.last30.activeUsers} />
            <StatCard label="Генераций" value={data.last30.generations} />
          </div>
          <div className="text-xs text-warm-500 mt-3">
            Посещаемость сайта смотрите в Метрике — здесь её второй раз не
            считаем.
          </div>
        </Panel>
      </div>
    </div>
  );
}
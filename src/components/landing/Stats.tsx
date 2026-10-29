"use client";

import { useInView, useCountUp } from "@/hooks/useInView";
import * as React from "react";
import type { LandingMetrics } from "@/lib/content/landing-metrics";
import { plural } from "@/lib/utils/cn";

/**
 * Блок «Что внутри».
 *
 * Метрики приходят ПРОПСОМ, а не считаются здесь. Раньше компонент сам их
 * считал и потому импортировал каталог материалов, а тот — полную таксономию
 * (`subjects.ts`, 3.8 МБ). Таксономия попадала в общий клиентский чанк на
 * 4.2 МБ, и он грузился на главной ради трёх чисел.
 *
 * Теперь числа считаются на сервере (`src/lib/content/landing-metrics.ts`), а
 * сюда приходят уже готовые значения. Тип — `LandingMetrics`, тот же, что
 * возвращает серверный счётчик: рассинхрон типов невозможен.
 */
export function RealStats({ metrics }: { metrics: LandingMetrics }) {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  const m = metrics;

  return (
    <section ref={ref} className="py-14 sm:py-20 border-y border-warm-200 bg-warm-50/40">
      <div className="container-tight">
        <div className="text-center mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-2">
            Каталог
          </p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
            Что внутри
          </h2>
        </div>
        {/* Три блока — все из данных: 2 колонки на телефоне, 3 в ряд на
            десктопе. Четвёртым стоял «N материалов в банке» — счётчик из
            MATERIALS_CATALOG. Каталога как такового ещё нет: учительские
            материалы должны появляться по ходу генерации, а до этого момента
            витрина обещала учителю то, чего на сайте не лежит. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {/* Подписи — формы слов, а не строки: числа считаются динамически,
              поэтому «предметов» жёстко в разметке давало «21 предметов». */}
          <StatBox
            value={m.subjects}
            labelForms={["предмет", "предмета", "предметов"]}
            sub="по ФГОС"
            inView={inView}
          />
          <StatBox
            value={m.subjectGradePairs}
            labelForms={["комбинация", "комбинации", "комбинаций"]}
            sub="предмет×класс"
            inView={inView}
          />
          <StatBox
            value={m.topics}
            labelForms={["тема", "темы", "тем"]}
            sub="и добавляются"
            inView={inView}
          />
        </div>
      </div>
    </section>
  );
}

function StatBox({
  value,
  suffix,
  labelForms,
  sub,
  inView,
}: {
  value: number;
  suffix?: string;
  /** Формы слова для подписи: ["предмет", "предмета", "предметов"].
   *  Одна форма = без склонения (для неизменяемых подписей). */
  labelForms: [string] | [string, string, string];
  sub: string;
  inView: boolean;
}) {
  // Счётчик — только украшение. `useCountUp` отдаёт 0 до старта анимации, и
  // это 0 уезжало в статический HTML: поисковик и учитель с отключённым JS
  // видели «0 предмет». Теперь в разметке всегда настоящее число, а скрипт
  // лишь перебирает его от нуля, когда блок попал в экран.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const v = useCountUp(value, { start: inView });
  const shown = mounted && inView ? v : value;
  // Склоняем по конечному числу, а не по анимированному — иначе подпись
  // дёргалась бы на каждом кадре счётчика.
  const label =
    labelForms.length === 3
      ? plural(value, labelForms[0], labelForms[1], labelForms[2])
      : labelForms[0];
  return (
    <div className="text-center">
      <div className="text-3xl sm:text-5xl font-display font-bold text-warm-950 tabular-nums">
        {shown.toLocaleString("ru-RU")}
        <span className="text-brand-600">{suffix ?? ""}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-warm-700">{label}</div>
      <div className="text-xs text-warm-500">{sub}</div>
    </div>
  );
}

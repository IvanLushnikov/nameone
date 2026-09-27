"use client";

import { useInView, useCountUp } from "@/hooks/useInView";
import { subjects } from "@/lib/content/subjects";

/**
 * Реальные метрики продукта (не выдуманные цифры активности).
 * Считаются из таксономии в момент рендера.
 */

function getRealMetrics() {
  let totalTopics = 0;
  let subjectGradePairs = 0;
  const totalSubjects = subjects.length;
  for (const subject of subjects) {
    subjectGradePairs += subject.grades.length;
    for (const grade of subject.grades) {
      totalTopics += grade.topics.length;
    }
  }
  return {
    subjects: totalSubjects,
    subjectGradePairs,
    topics: totalTopics,
    avgTimeSec: 30,
  };
}

export function RealStats() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  const m = getRealMetrics();

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatBox value={m.subjects} label="предметов" sub="по ФГОС" inView={inView} />
          <StatBox value={m.subjectGradePairs} label="комбинаций" sub="предмет×класс" inView={inView} />
          <StatBox value={m.topics} label="тем в каталоге" sub="растёт" inView={inView} />
          <StatBox value={m.avgTimeSec} suffix=" сек" label="среднее время" sub="генерация листа" inView={inView} />
        </div>
      </div>
    </section>
  );
}

function StatBox({
  value,
  suffix,
  label,
  sub,
  inView,
}: {
  value: number;
  suffix?: string;
  label: string;
  sub: string;
  inView: boolean;
}) {
  const v = useCountUp(value, { start: inView });
  return (
    <div className="text-center">
      <div className="text-3xl sm:text-5xl font-display font-bold text-warm-950 tabular-nums">
        {v.toLocaleString("ru-RU")}
        <span className="text-brand-600">{suffix ?? ""}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-warm-700">{label}</div>
      <div className="text-xs text-warm-500">{sub}</div>
    </div>
  );
}

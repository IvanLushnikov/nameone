import * as React from "react";
import type { LessonPlan, LessonStage } from "@/lib/types";
import { formatDate } from "@/lib/utils/cn";

interface Props {
  plan: LessonPlan;
}

const STAGE_BADGES: Record<LessonStage["kind"], { label: string; tone: string }> = {
  "org-moment": { label: "1. Орг. момент", tone: "bg-warm-100 text-warm-700" },
  motivation: { label: "2. Мотивация", tone: "bg-warm-100 text-warm-700" },
  "new-topic": { label: "3. Новая тема", tone: "bg-brand-100 text-brand-800" },
  practice: { label: "4. Отработка", tone: "bg-brand-100 text-brand-800" },
  reflex: { label: "5. Рефлексия", tone: "bg-accent-100 text-accent-800" },
  homework: { label: "6. Домашка", tone: "bg-accent-100 text-accent-800" },
};

/**
 * A4-превью плана урока.
 *
 * Стиль — как у WorksheetPreview.tsx: та же `.worksheet-page` обёртка
 * (210mm × 297mm), та же шапка с шифром/датой и та же типографика.
 *
 * Empty state: если stages пустые (заглушка) — показываем «Скоро будет».
 * Контракт ширины — single-page, шаги компактные, чтобы 6 шагов + цели + ДЗ
 * влезали на 1 A4 без переноса.
 */
export function LessonPlanPreview({ plan }: Props) {
  if (!plan.stages || plan.stages.length === 0) {
    return (
      <div className="bg-warm-100 rounded-2xl p-3 sm:p-6 print:p-0 print:bg-white">
        <div className="mx-auto max-w-[800px]">
          <article className="worksheet-page flex items-center justify-center min-h-[60vh] animate-fade-in print:shadow-none">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-warm-500 mb-2">
                План урока
              </div>
              <h1 className="text-xl font-semibold text-warm-950 mb-1">Скоро будет</h1>
              <p className="text-sm text-warm-500">
                Заглушка ещё не заменена — обновите модуль lesson-plan.
              </p>
            </div>
          </article>
        </div>
      </div>
    );
  }

  const totalMin = plan.stages.reduce((s, st) => s + st.durationMin, 0);

  return (
    <div className="bg-warm-100 rounded-2xl p-3 sm:p-6 print:p-0 print:bg-white">
      <div className="mx-auto max-w-[800px]">
        <article className="worksheet-page animate-fade-in print:shadow-none">
          {/* Шапка плана */}
          <header className="flex items-start justify-between pb-4 mb-5 border-b-2 border-warm-950">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-warm-500">
                План урока · ФГОС-конспект
              </div>
              <h1 className="text-xl font-bold text-warm-950 mt-1">
                {plan.title.replace(/^План урока · /, "")}
              </h1>
              <div className="text-xs text-warm-600 mt-1">
                {plan.subject} · {plan.grade} класс · {totalMin} мин
                {plan.fgosRef ? ` · ${plan.fgosRef}` : ""}
              </div>
            </div>
            <div className="text-right text-xs text-warm-500 shrink-0">
              <div>ЛистAI</div>
              <div className="mt-0.5">{formatDate(plan.createdAt)}</div>
              <div className="mt-2 inline-block px-2 py-0.5 rounded border border-brand-300 text-brand-700 text-[10px] font-semibold">
                Конспект урока
              </div>
            </div>
          </header>

          {/* Цели */}
          <section className="mb-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-2">
              Цели урока
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[13px] leading-snug">
              <GoalColumn label="Обучающие" tone="brand" items={plan.goals.educational} />
              <GoalColumn label="Развивающие" tone="accent" items={plan.goals.developmental} />
              <GoalColumn label="Воспитательные" tone="warm" items={plan.goals.nurturing} />
            </div>
          </section>

          {/* Оборудование */}
          {plan.equipment.length > 0 && (
            <section className="mb-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1.5">
                Оборудование
              </h2>
              <ul className="text-[13px] text-warm-700 leading-snug flex flex-wrap gap-x-4 gap-y-1">
                {plan.equipment.map((line, i) => (
                  <li key={i} className="before:content-['•'] before:mr-1.5 before:text-warm-400">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Шаги — таблица */}
          <section className="mb-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-2">
              Ход урока
            </h2>
            <div className="border border-warm-200 rounded-lg overflow-hidden">
              <table className="w-full text-[12.5px] leading-snug">
                <thead className="bg-warm-50">
                  <tr className="text-warm-600 text-left">
                    <th className="font-semibold py-1.5 px-2 w-[28%]">Этап</th>
                    <th className="font-semibold py-1.5 px-2 w-[8%] text-center">Время</th>
                    <th className="font-semibold py-1.5 px-2 w-[32%]">Деятельность учителя</th>
                    <th className="font-semibold py-1.5 px-2 w-[32%]">Деятельность учеников</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.stages.map((stage, idx) => {
                    const badge = STAGE_BADGES[stage.kind];
                    return (
                      <tr
                        key={`${stage.kind}-${idx}`}
                        className="border-t border-warm-100 align-top"
                      >
                        <td className="py-2 px-2">
                          <span
                            className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${badge.tone}`}
                          >
                            {badge.label}
                          </span>
                          <div className="text-warm-950 font-medium mt-1">{stage.title}</div>
                          {stage.materials && stage.materials.length > 0 && (
                            <div className="mt-1 text-[11px] text-warm-500">
                              <span className="font-semibold">Материалы: </span>
                              {stage.materials.join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-warm-700 whitespace-nowrap">
                          {stage.durationMin} мин
                        </td>
                        <td className="py-2 px-2 text-warm-800">{stage.teacherActions}</td>
                        <td className="py-2 px-2 text-warm-800">{stage.studentActions}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-warm-50 border-t border-warm-200 text-warm-600 text-[11px]">
                    <td className="py-1.5 px-2 font-semibold" colSpan={2}>
                      Итого
                    </td>
                    <td className="py-1.5 px-2 font-mono font-semibold" colSpan={2}>
                      {totalMin} мин
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ДЗ */}
          <section className="mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-warm-500 mb-1.5">
              Домашнее задание
            </h2>
            <div className="rounded-lg border border-warm-200 bg-warm-50 p-3 text-[13px] leading-snug text-warm-900">
              {plan.homework.text}
              {plan.homework.alternatives && plan.homework.alternatives.length > 0 && (
                <div className="mt-2 text-warm-600">
                  <span className="font-semibold text-warm-700">Альтернативы:</span>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside marker:text-warm-400">
                    {plan.homework.alternatives.map((alt, i) => (
                      <li key={i}>{alt}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          {/* Подвал */}
          <footer className="mt-6 pt-3 border-t border-warm-200 flex items-center justify-between text-[10px] text-warm-400">
            <span>ЛистAI · listai.ru · план урока по ФГОС</span>
            <span>Конспект на {totalMin} мин · {plan.stages.length} шагов</span>
          </footer>
        </article>
      </div>
    </div>
  );
}

function GoalColumn({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "brand" | "accent" | "warm";
  items: string[];
}) {
  const toneClass =
    tone === "brand"
      ? "border-brand-200 bg-brand-50/50"
      : tone === "accent"
        ? "border-accent-200 bg-accent-50/50"
        : "border-warm-200 bg-warm-50/60";
  return (
    <div className={`rounded-lg border p-2.5 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-warm-500 mb-1.5">
        {label}
      </div>
      {items.length === 0 ? (
        <div className="text-warm-400 text-[12px]">—</div>
      ) : (
        <ul className="space-y-1 text-warm-800">
          {items.map((g, i) => (
            <li key={i} className="pl-3 relative before:absolute before:left-0 before:top-0 before:text-warm-400 before:content-['—']">
              {g}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
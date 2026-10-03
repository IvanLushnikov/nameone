"use client";

import * as React from "react";
import type { Ktp, KtpLessonKind } from "@/lib/types";
import { formatDate } from "@/lib/utils/cn";
import { SITE_HOST } from "@/lib/site";
import { WorksheetScale } from "./WorksheetScale";

interface Props {
  ktp: Ktp;
}

/**
 * A4-preview КТП — таблица по неделям.
 *
 * Колонки: № | Неделя | Даты | Тема | Тип | Часы | ФГОС.
 * - 1–2 строки уроков на неделю (через rowSpan на первой).
 * - Контрольная/тест — выделены `bg-warm-100` + emoji.
 * - Footer: «Всего: N ч · M недель».
 *
 * Layout через `.worksheet-page` (A4) + transform-scale для мобилки.
 * Стили таблицы — Tailwind-утилиты, без правки globals.css.
 *
 * TZ: docs/tz/03-ktp.md
 */
export function KtpPreview({ ktp }: Props) {
  const totalLessons = ktp.weeks.reduce((acc, w) => acc + w.entries.length, 0);

  return (
    <div className="bg-warm-100 rounded-2xl p-3 sm:p-6 print:p-0 print:bg-white">
      <div className="mx-auto max-w-[920px]">
        <WorksheetScale>
          <article className="worksheet-page animate-fade-in print:shadow-none">
            {/* Шапка */}
            <header className="flex items-start justify-between pb-4 mb-5 border-b-2 border-warm-950">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-warm-500">
                  Календарно-тематическое планирование
                </div>
                <h1 className="text-xl font-bold text-warm-950 mt-1">{ktp.title}</h1>
                <div className="text-xs text-warm-600 mt-1">
                  {ktp.subject} · {ktp.grade} класс · учебный год {ktp.schoolYear}
                </div>
              </div>
              <div className="text-right text-xs text-warm-500 shrink-0">
                <div>УчЛист</div>
                <div className="mt-0.5">{formatDate(ktp.createdAt)}</div>
                <div className="mt-2 inline-block px-2 py-0.5 rounded border border-brand-300 text-brand-700 text-[10px] font-semibold">
                  {totalLessons} уроков
                </div>
              </div>
            </header>

            {/* Таблица по неделям. Tailwind-утилиты вместо globals.css ktp-* классов. */}
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-warm-200/70">
                  <th className="border border-warm-300 px-2 py-2 text-left font-semibold text-warm-950" style={{ width: "6%" }}>№</th>
                  <th className="border border-warm-300 px-2 py-2 text-left font-semibold text-warm-950" style={{ width: "8%" }}>Нед.</th>
                  <th className="border border-warm-300 px-2 py-2 text-left font-semibold text-warm-950" style={{ width: "16%" }}>Даты</th>
                  <th className="border border-warm-300 px-2 py-2 text-left font-semibold text-warm-950" style={{ width: "34%" }}>Тема урока</th>
                  <th className="border border-warm-300 px-2 py-2 text-left font-semibold text-warm-950" style={{ width: "14%" }}>Тип</th>
                  <th className="border border-warm-300 px-2 py-2 text-center font-semibold text-warm-950" style={{ width: "8%" }}>Часы</th>
                  <th className="border border-warm-300 px-2 py-2 text-left font-semibold text-warm-950" style={{ width: "16%" }}>ФГОС</th>
                </tr>
              </thead>
              <tbody>
                {ktp.weeks.map((week) => (
                  <React.Fragment key={week.weekNum}>
                    {week.entries.map((entry, idx) => {
                      const isFirstInWeek = idx === 0;
                      const isHighlight =
                        entry.kind === "control" ||
                        entry.kind === "test" ||
                        entry.kind === "review" ||
                        entry.kind === "reserve" ||
                        entry.kind === "project";
                      const rowClass = isHighlight ? "bg-warm-100" : "odd:bg-white even:bg-warm-50/40";

                      // Первая запись недели определяет "фон всей недели"
                      // (визуально мы красим только tr — rowSpan ведёт себя корректно
                      // и в первой строке, и в последующих).
                      return (
                        <tr
                          key={`${week.weekNum}-${entry.num}`}
                          className={rowClass}
                        >
                          {isFirstInWeek ? (
                            <td
                              className="border border-warm-300 px-2 py-2 text-center font-bold text-warm-950 align-middle"
                              rowSpan={week.entries.length}
                            >
                              {week.weekNum}
                            </td>
                          ) : null}
                          {isFirstInWeek ? (
                            <td
                              className="border border-warm-300 px-2 py-2 text-warm-700 align-middle text-xs"
                              rowSpan={week.entries.length}
                            >
                              <div>{entry.dates.split("–")[0]}</div>
                              <div className="text-[10px] text-[color:var(--text-muted)] mt-0.5">
                                {entry.dates}
                              </div>
                            </td>
                          ) : null}
                          <td className="border border-warm-300 px-2 py-2 text-warm-950">
                            {entry.topic}
                          </td>
                          <td className="border border-warm-300 px-2 py-2 text-warm-700">
                            <KindBadge kind={entry.kind} />
                          </td>
                          <td className="border border-warm-300 px-2 py-2 text-center font-mono text-warm-700">
                            {entry.hours}
                          </td>
                          <td className="border border-warm-300 px-2 py-2 text-warm-600 text-xs">
                            {entry.fgosRef ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>

            {/* Подвал */}
            <footer className="mt-8 pt-4 border-t border-warm-200 flex items-center justify-between text-[10px] text-[color:var(--text-muted)]">
              <span>УчЛист · {SITE_HOST} · КТП-демо</span>
              <span>
                Всего: {ktp.totalHours} ч · {ktp.weeks.length} недель · {totalLessons} уроков
              </span>
            </footer>
          </article>
        </WorksheetScale>
      </div>
    </div>
  );
}

function kindEmoji(kind: KtpLessonKind): string {
  switch (kind) {
    case "control":
      return "⚑";
    case "test":
      return "✎";
    case "review":
      return "↻";
    case "reserve":
      return "·";
    case "project":
      return "★";
    case "lesson":
    default:
      return "";
  }
}

const KIND_LABEL: Record<KtpLessonKind, string> = {
  lesson: "Урок",
  control: "Контрольная",
  test: "Тест",
  review: "Повторение",
  reserve: "Резерв",
  project: "Проект",
};

function KindBadge({ kind }: { kind: KtpLessonKind }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden>{kindEmoji(kind)}</span>
      <span>{KIND_LABEL[kind]}</span>
    </span>
  );
}

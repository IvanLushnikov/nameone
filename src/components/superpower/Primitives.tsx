"use client";

import * as React from "react";
import { loadErrorText } from "@/lib/superpower-api";

/**
 * Общие детали экранов `/superpower`.
 *
 * Собраны в один файл намеренно: это примитивы без логики, которые
 * используют все четыре экрана. Пять файлов по двадцать строчек читались бы
 * хуже, чем один файл на сто пятьдесят.
 *
 * ГЛАВНОЕ ЗДЕСЬ — СОСТОЯНИЯ ДАННЫХ
 * --------------------------------
 * Загрузка, ошибка и пустое состояние — разные вещи, и путать их нельзя:
 *
 *   • «Нет данных» — данных правда нет. Показываем прочерк, а не ноль.
 *   • «Не удалось загрузить» — сервер не ответил. Это жёлтое, а не белое.
 *   • «Нужен вход» — сессии нет. Отправляем на вход.
 *
 * Раньше страницы кабинета в последнем случае показывали демонстрационные
 * данные. Для раздела с выручкой это недопустимо (см. superpower-api.ts).
 */

/** Плитка с одним числом. */
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    default: "text-warm-900",
    good: "text-brand-700",
    warn: "text-accent-600",
    bad: "text-accent-700",
  }[tone];

  return (
    <div className="rounded-2xl bg-white border border-warm-100 p-4">
      <div className="text-sm text-warm-600 mb-1">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="text-xs text-warm-500 mt-1">{hint}</div> : null}
    </div>
  );
}

/** Карточка-контейнер с заголовком. */
export function Panel({
  title,
  children,
  hint,
  action,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white border border-warm-100 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-warm-900">{title}</h2>
          {hint ? <p className="text-sm text-warm-600 mt-0.5">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Загрузка: пусто, но с рамкой — чтобы страница не «прыгала» при приходе данных. */
export function Loading() {
  return (
    <div className="rounded-2xl bg-white border border-warm-100 p-8 text-center text-warm-500">
      Загружаю данные…
    </div>
  );
}

/** Ошибка с честным текстом причины. */
export function LoadError({ error }: { error: Parameters<typeof loadErrorText>[0] }) {
  if (error === "unauthorized") {
    return (
      <div className="rounded-2xl bg-accent-50 border border-accent-200 p-8 text-center">
        <div className="text-accent-800 font-medium mb-2">Нужен вход администратора</div>
        <div className="text-sm text-accent-700">
          Сессия закончилась или у этой учётной записи нет прав. Данные на этом
          экране хранятся на сервере и отдаются только администратору.
        </div>
        <a
          href="/login"
          className="inline-block mt-4 px-4 py-2 rounded-lg bg-accent-600 text-white text-sm font-medium hover:bg-accent-700"
        >
          Войти
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-accent-50 border border-accent-200 p-8 text-center">
      <div className="text-accent-800 font-medium mb-1">{loadErrorText(error)}</div>
      <div className="text-sm text-accent-700">
        Показаны не все цифры — это лучше, чем правдоподобные выдуманные.
      </div>
    </div>
  );
}

/** Пустое состояние с честным объяснением. */
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-warm-200 p-6 text-center text-sm text-warm-500">
      {text}
    </div>
  );
}

/**
 * Простой столбиковый график без библиотеки.
 *
 * Отдельная библиотека графиков на первом проходе не нужна: здесь нужен ряд
 * чисел, а не аналитика. Данные нормализуются по максимуму, поэтому при
 * нуле во всём ряду график не рисует бесконечные столбики.
 */
export function BarSeries({
  points,
  height = 120,
  formatValue,
}: {
  points: Array<{ label: string; value: number }>;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  if (points.length === 0) {
    return <EmptyState text="За выбранный период записей нет" />;
  }

  const max = Math.max(...points.map((p) => p.value), 0);
  const allZero = max === 0;
  const showEvery = points.length > 14 ? Math.ceil(points.length / 7) : 1;

  return (
    <div>
      <div className="flex items-end gap-[3px] w-full" style={{ height }} aria-hidden="true">
        {points.map((p, i) => {
          const pct = allZero ? 2 : Math.max((p.value / max) * 100, 2);
          return (
            <div
              key={`${p.label}-${i}`}
              className="flex-1 rounded-t bg-brand-400 min-w-[3px]"
              style={{ height: `${pct}%` }}
              title={`${p.label}: ${formatValue ? formatValue(p.value) : p.value}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-warm-500">
        <span>{points[0]?.label ?? ""}</span>
        <span>{points[points.length - 1]?.label ?? ""}</span>
      </div>
      {points.length > showEvery * 2 ? (
        <div className="text-xs text-warm-400 mt-1">Подробности — в таблице ниже</div>
      ) : null}
    </div>
  );
}

/** Простая таблица. */
export function DataTable<T>({
  rows,
  columns,
  emptyText,
}: {
  rows: T[];
  columns: Array<{ key: string; header: string; render: (row: T) => React.ReactNode }>;
  emptyText: string;
}) {
  if (rows.length === 0) return <EmptyState text={emptyText} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-warm-200">
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-left font-medium text-warm-600 py-2 pr-4 whitespace-nowrap"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-warm-100 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4 text-warm-800 align-top">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * «Сколько человек дошло с предыдущего шага».
 *
 * fromPrev = null означает «считать не от чего» — первый шаг или ноль в
 * предыдущем. Показывать там 0% нельзя: это выглядит как «никто не дошёл»,
 * хотя на самом деле просто нет базы для сравнения.
 */
export function ConversionCell({ fromPrev }: { fromPrev: number | null }) {
  if (fromPrev === null) return <span className="text-warm-400">—</span>;
  return <span className="tabular-nums">{fromPrev}%</span>;
}
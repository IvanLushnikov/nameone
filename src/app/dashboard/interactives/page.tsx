/**
 * `/dashboard/interactives/` — сводка по выданным интерактивам (TZ-13 §3,
 * сценарий C).
 *
 * ⚠️ ПОЧЕМУ НЕТ `[id]/` В ПУТИ. ТЗ §4.6 перечисляет
 * `src/app/dashboard/interactives/[id]/page.tsx`, но там же (последний абзац)
 * говорит обратное: страница за авторизацией учителя — тоже динамическая, и
 * при `output: "export"` требует `generateStaticParams()`, а id интерактивов
 * создаются в рантайме → **сборка упала бы**.
 *
 * Поэтому деталка читает `?id=<int_...>`, как уже сделано для листов:
 * `src/app/dashboard/page.tsx` линкует на `/preview?id=...`, и тот же приём
 * разбирает `useSearchParams()`. Одна страница, два состояния:
 * `?id` нет → список, `?id` есть → сводка по попыткам. Динамических сегментов
 * в ЛК нет вообще — ровно как в остальной репе.
 *
 * Ссылка «назад к списку» — это удаление `id` из query через `router.replace`,
 * а не `router.back()`: ученик мог открыть прямую ссылку, и «назад» увёл бы
 * его на чужой сайт.
 */

import type { Metadata } from "next";
import * as React from "react";
import { InteractivesView } from "./InteractivesView";

export const metadata: Metadata = {
  title: "Интерактивы — личный кабинет",
  robots: { index: false, follow: false },
};

function LoadingFallback() {
  return (
    <div className="container-tight py-12 max-w-md mx-auto text-center">
      <h1 className="text-xl font-semibold text-warm-950">Загружаем интерактивы…</h1>
    </div>
  );
}

export default function InteractivesPage() {
  return (
    <React.Suspense fallback={<LoadingFallback />}>
      <InteractivesView />
    </React.Suspense>
  );
}

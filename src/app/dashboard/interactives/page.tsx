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
 *
 * Обёртка `<Suspense>` была нужна только ради `useSearchParams()` во
 * `InteractivesView`; её fallback закрывал страницу до гидратации. Сейчас
 * `?id` читается из `window.location.search` в useEffect.
 */

import type { Metadata } from "next";
import { InteractivesView } from "./InteractivesView";

export const metadata: Metadata = {
  title: "Интерактивы — личный кабинет",
  // Свой description: без него страница наследовала описание кабинета,
  // и в выдаче два раздела выглядели как одна страница.
  description:
    "Интерактивы, выданные классу: сводка по темам, классам и результатам учеников.",
  robots: { index: false, follow: false },
};

export default function InteractivesPage() {
  return <InteractivesView />;
}

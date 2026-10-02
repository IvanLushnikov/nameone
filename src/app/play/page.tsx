/**
 * `/play/` — страница прохождения интерактива (TZ-13 §4.5–§4.6).
 *
 * ВАЖНО, почему путь именно такой, а не `/play/[token]`:
 * фронт собирается как статика (`next.config.mjs` → `output: "export"`), SSR нет.
 * Динамический сегмент при статическом экспорте потребовал бы
 * `generateStaticParams()` со всеми возможными токенами, а токены интерактивов
 * создаются в рантайме и на билде неизвестны — сборка бы упала (ТЗ §4.2,
 * вариант 5 «отклонено»). Поэтому ровно та же схема, что у TZ-12 для форм:
 * одна статическая страница + токен в query `?t=<token>` + клиентский fetch.
 *
 * Обёртка `<Suspense>` обязательна: Next 14 не пререндерит клиентский компонент
 * с `useSearchParams()` без границы (при `output: "export"` это deopt-предупреждение,
 * а с включённым strict — ошибка). Копируем приём из `src/app/form/page.tsx`,
 * второй раз не изобретаем.
 *
 * Заголовки приватности (как у `/form/`):
 *   - `robots: { index: false, follow: false }` — страница прохождения не должна
 *     попадать в индекс, иначе в поиске может всплыть ссылка с чужим токеном;
 *   - `other.referrer` → `<meta name="referrer" content="no-referrer">`: токен не
 *     должен утекать в `Referer`, когда ученик уходит с нашего сайта.
 */

import * as React from "react";
import type { Metadata } from "next";
import { PlayRunner } from "./PlayRunner";

export const metadata: Metadata = {
  title: "Интерактив — играем",
  robots: { index: false, follow: false },
  other: { referrer: "no-referrer" },
};

function LoadingFallback() {
  return (
    <div className="container-tight py-12 sm:py-20 max-w-md mx-auto text-center">
      <div className="w-12 h-12 rounded-xl bg-brand-500 text-white grid place-items-center mx-auto mb-4 shadow-brand animate-pulse">
        <span className="text-xl font-bold" aria-hidden>
          ?
        </span>
      </div>
      <h1 className="text-xl font-semibold text-warm-950">Загружаем игру…</h1>
      <p className="text-sm text-warm-500 mt-2">Это занимает пару секунд.</p>
    </div>
  );
}

export default function PlayPage() {
  return (
    <React.Suspense fallback={<LoadingFallback />}>
      <PlayRunner />
    </React.Suspense>
  );
}

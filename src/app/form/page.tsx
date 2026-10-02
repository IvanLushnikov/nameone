/**
 * /form/ — страница ученика (TZ-12, этап 3).
 *
 * ВАЖНО, почему путь именно такой, а не `/form/[token]`:
 * фронт собирается как статика (`next.config.mjs` → `output: "export"`), SSR нет.
 * Динамический маршрут `src/app/form/[token]/page.tsx` при статическом экспорте
 * потребовал бы `generateStaticParams()` со всеми возможными токенами, а токены
 * форм создаются в рантайме и на билде неизвестны — сборка бы упала.
 * Поэтому: одна статическая страница + токен в query `?t=<token>` + данные из
 * отдельного бэкенд-воркера (ТЗ §4.1, вариант 1).
 *
 * Тот же приём с `useSearchParams()` и `<Suspense>` уже применён в
 * `src/app/auth/callback/page.tsx` — копируем его, а не изобретаем второй.
 *
 * Заголовки приватности:
 *   - `robots: { index: false, follow: false }` — чтобы поисковик не закешировал
 *     страницу с чужим токеном;
 *   - `other.referrer` рендерится как `<meta name="referrer" content="no-referrer">`
 *     — токен не должен утекать в `Referer` при переходе ученика на другой сайт.
 *   - `no-referrer` намеренно не в `metadata.referrer`: он ставит заголовок
 *     для **всех** исходящих запросов, а нам нужен именно запрет утечки из URL.
 */

import * as React from "react";
import type { Metadata } from "next";
import { FormRunner } from "./FormRunner";

export const metadata: Metadata = {
  title: "Задания — реши и отправь",
  // Страница ученика не должна попадать в индекс.
  robots: { index: false, follow: false },
  // Next превращает это в <meta name="referrer" content="no-referrer"> в head.
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
      <h1 className="text-xl font-semibold text-warm-950">Загружаем задания…</h1>
      <p className="text-sm text-warm-500 mt-2">Это занимает пару секунд.</p>
    </div>
  );
}

export default function FormPage() {
  return (
    <React.Suspense fallback={<LoadingFallback />}>
      <FormRunner />
    </React.Suspense>
  );
}

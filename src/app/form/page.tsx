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
 * Обёртка `<Suspense>` была нужна только ради `useSearchParams()` в `FormRunner`:
 * при `output: "export"` Next.js 14 требует границы, а её fallback закрывал собой
 * страницу до гидратации. Сейчас токен читается из `window.location.search`
 * в useEffect, поэтому страница рендерится сразу.
 *
 * Заголовки приватности:
 *   - `robots: { index: false, follow: false }` — чтобы поисковик не закешировал
 *     страницу с чужим токеном;
 *   - `other.referrer` рендерится как `<meta name="referrer" content="no-referrer">`
 *     — токен не должен утекать в `Referer` при переходе ученика на другой сайт.
 *   - `no-referrer` намеренно не в `metadata.referrer`: он ставит заголовок
 *     для **всех** исходящих запросов, а нам нужен именно запрет утечки из URL.
 */

import type { Metadata } from "next";
import { FormRunner } from "./FormRunner";

export const metadata: Metadata = {
  title: "Задания — реши и отправь",
  // Страница ученика не должна попадать в индекс.
  robots: { index: false, follow: false },
  // Next превращает это в <meta name="referrer" content="no-referrer"> в head.
  other: { referrer: "no-referrer" },
};

export default function FormPage() {
  return <FormRunner />;
}

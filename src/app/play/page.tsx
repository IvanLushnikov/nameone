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
 * Обёртка `<Suspense>` была обязательна только ради `useSearchParams()` в
 * `PlayRunner`. Хук при `output: "export"` требует границы, а её fallback
 * закрывал собой страницу до гидратации. Теперь токен читается из
 * `window.location.search` в useEffect, поэтому страница рендерится сразу.
 *
 * Заголовки приватности (как у `/form/`):
 *   - `robots: { index: false, follow: false }` — страница прохождения не должна
 *     попадать в индекс, иначе в поиске может всплыть ссылка с чужим токеном;
 *   - `other.referrer` → `<meta name="referrer" content="no-referrer">`: токен не
 *     должен утекать в `Referer`, когда ученик уходит с нашего сайта.
 */

import type { Metadata } from "next";
import { PlayRunner } from "./PlayRunner";

export const metadata: Metadata = {
  title: "Интерактив — играем",
  robots: { index: false, follow: false },
  other: { referrer: "no-referrer" },
};

export default function PlayPage() {
  return <PlayRunner />;
}

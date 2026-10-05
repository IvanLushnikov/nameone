import type { Metadata } from "next";

/**
 * Метаданные предпросмотра листа.
 *
 * Живут здесь, а не в `page.tsx`: страница — клиентский компонент
 * («use client»), а `export const metadata` в таком файле Next роняет при
 * сборке (та же схема, что в `src/app/journal/layout.tsx`).
 *
 * ТЗ-21 п.13 / SEO-аудит P1-5: страница отдавала заголовок главной, и тот
 * же заголовок стоял на восьми страницах сразу.
 *
 * Canonical здесь НЕ ставим осознанно: `/preview` — служебная страница,
 * открытая по прямой ссылке без токена, и в `robots.ts` она в disallow.
 * Ссылка в закрытой зоне, на которую всё равно нельзя встать, только шумит
 * в разметке. Достаточно запрета индексации.
 */
export const metadata: Metadata = {
  title: "Предпросмотр листа",
  description: "Предпросмотр готового рабочего листа перед выдачей ученикам.",
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}

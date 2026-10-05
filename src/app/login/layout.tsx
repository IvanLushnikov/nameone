import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo/metadata";

/**
 * Метаданные входа по magic-link.
 *
 * Живут здесь, а не в `page.tsx`: страница — клиентский компонент
 * («use client»), а `export const metadata` в таком файле Next роняет при
 * сборке (та же схема, что в `src/app/journal/layout.tsx`).
 *
 * ТЗ-21 п.13 / SEO-аудит P1-5: страница отдавала заголовок главной, и тот
 * же заголовок стоял на восьми страницах сразу. Теперь у входа есть своё
 * название — вкладка учителя после клика по ссылке из письма называется
 * «Вход в кабинет», а не «УчЛист — рабочие листы по ФГОС за 30 секунд».
 *
 * Индексация закрыта (`index: false`), а переходы по ссылкам оставлены
 * (`follow: true`) — так же, как было в main до слияния: страница ведёт
 * внутрь кабинета, и запрет обхода ссылок ей не нужен.
 */
export const metadata: Metadata = {
  title: "Вход в кабинет",
  description:
    "Войдите в кабинет УчЛист по ссылке из письма — без пароля. Пришлём новую ссылку в один клик.",
  alternates: { canonical: absoluteUrl("/login") },
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

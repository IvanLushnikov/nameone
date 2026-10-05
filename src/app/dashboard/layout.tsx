import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo/metadata";

/**
 * Метаданные кабинета.
 *
 * Живут здесь, а не в `page.tsx`: страница — клиентский компонент
 * («use client»), а `export const metadata` в таком файле Next роняет при
 * сборке. Схема та же, что в `src/app/journal/layout.tsx`.
 *
 * ТЗ-21 п.13 / SEO-аудит P1-5: до этого файла заголовок кабинета был
 * заголовком главной — «УчЛист — рабочие листы по ФГОС за 30 секунд», и он
 * повторялся на восьми страницах сразу. Разделённый заголовок попал в
 * замер дублей; для закрытой страницы это не влияет на выдачу, но
 * вкладка браузера и история вкладок учителя перестают показывать чужое
 * название.
 *
 * Бренд в title руками не пишем — его добавляет template "%s · УчЛист"
 * в корневом layout, иначе будет «Кабинет · УчЛист · УчЛист».
 *
 * `robots: noindex, nofollow` — кабинет закрыт входом и содержит персональные
 * данные учителя и его класса. `nofollow` тоже: внутри кабинета ссылки на
 * служебные адреса не должны попадать в индекс как путь обхода сайта.
 */
export const metadata: Metadata = {
  title: "Кабинет учителя",
  description:
    "Личные кабинеты УчЛист: история листов, избранное, выданные работы и журнал проверок.",
  alternates: { canonical: absoluteUrl("/dashboard") },
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}

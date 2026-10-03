import type { Metadata } from "next";

/**
 * Метаданные кабинета вынесены в layout, а не в page.tsx: страница помечена
 * «use client», а из клиентского компонента экспортировать metadata нельзя.
 * Без собственного описания кабинет наследовал описание главной — в выдаче
 * вход и кабинет выглядели как две копии главной страницы.
 */
export const metadata: Metadata = {
  title: "Кабинет",
  description:
    "Личный кабинет УчЛист: история генераций, задания и проверка по фото.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

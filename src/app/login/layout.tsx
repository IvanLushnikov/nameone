import type { Metadata } from "next";

/**
 * Метаданные входа вынесены в layout: сама страница помечена «use client»,
 * а из клиентского компонента экспортировать metadata нельзя. Без своего
 * описания вход наследовал описание главной — в выдаче он выглядел как её
 * копия. Индексировать его незачем, поэтому закрыт от индексации.
 */
export const metadata: Metadata = {
  title: "Вход — УчЛист",
  description:
    "Вход в личный кабинет учителя УчЛист: история листов, история педагога и проверка заданий по фото.",
  robots: { index: false, follow: true },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

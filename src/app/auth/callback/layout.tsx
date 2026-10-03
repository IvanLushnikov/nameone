import type { Metadata } from "next";

/**
 * Финальная точка входа по одноразовой ссылке. Служебная страница: в поиске
 * ей нечего предложить, и без закрытия она наследовала описание главной —
 * то есть выглядела в выдаче как главная страница сайта.
 */
export const metadata: Metadata = {
  title: "Вход — УчЛист",
  description: "Завершение входа в личный кабинет УчЛист по одноразовой ссылке.",
  robots: { index: false, follow: false },
};

export default function AuthCallbackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

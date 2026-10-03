import type { Metadata } from "next";

/**
 * Метаданные предпросмотра — в layout, потому что страница клиентская
 * («use client»), а metadata из клиентских компонентов экспортировать нельзя.
 * Без собственного описания страница наследовала описание главной.
 */
export const metadata: Metadata = {
  title: "Предпросмотр",
  description:
    "Предпросмотр рабочего листа, теста, презентации или КТП перед скачиванием.",
  robots: { index: false, follow: false },
};

export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

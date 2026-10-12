import type { Metadata } from "next";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { SuperpowerShell } from "@/components/superpower/SuperpowerShell";

export const metadata: Metadata = {
  // Бренд добавляет template в корневой layout — руками не дописываем.
  title: "Суперадминка",
  // Страница физически отдаётся всем (статический экспорт), закрыты данные,
  // а не страница. В поиск она попадать не должна ни при каких условиях.
  robots: { index: false, follow: false, nocache: true },
};

export default function SuperpowerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <SuperpowerShell>{children}</SuperpowerShell>
    </AdminGuard>
  );
}
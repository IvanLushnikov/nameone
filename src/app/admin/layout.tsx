import type { Metadata } from "next";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { AdminLayout } from "@/components/admin/AdminLayout";

export const metadata: Metadata = {
  // Бренд добавляет template в корневом layout — руками не дописываем.
  title: "Админка",
  robots: { index: false, follow: false },
};

export default function AdminSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGuard>
      <AdminLayout>{children}</AdminLayout>
    </AdminGuard>
  );
}

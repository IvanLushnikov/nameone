"use client";

/**
 * Настройки личного кабинета учителя (ТЗ-21, блоки 4 и 5).
 *
 *   /dashboard/settings
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ СТРАНИЦА, А НЕ ЕЩЁ ОДНА ВКЛАДКА В `dashboard`
 * ─────────────────────────────────────────────────────────────────────────────
 * `src/app/dashboard/page.tsx` в этой работе не трогается (его переписывает
 * соседняя задача). Настройки и подписка — не «ещё одна вкладка» в ленте из 50
 * карточек, а отдельный экран: сюда приходят с конкретным вопросом, и здесь
 * ничего не должно отвлекать. Ссылку на страницу в кабинете ставит соседняя
 * задача — ей принадлежит `dashboard/page.tsx`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * АНОНИМ — ПОЛНОПРАВНЫЙ УЧИТЕЛЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Экран НЕ начинается с требования войти. Имя, классы и блок подписки работают
 * без аккаунта; отличается только то, что переносится между устройствами, и
 * об этом сказано прямо в подписях. Единственный блок, который объясняет
 * отсутствие данных, — список устройств: устройств на сервере без входа
 * физически нет, и выдумывать их нельзя.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ProfileSection } from "@/components/lk/ProfileSection";
import { ClassesSection } from "@/components/lk/ClassesSection";
import { SessionsSection } from "@/components/lk/SessionsSection";
import { SubscriptionPanel } from "@/components/lk/SubscriptionPanel";
import { deviceView, loadProfile, type TeacherProfileView } from "@/lib/lk/profile-api";

export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const emailConfirmId = searchParams.get("email_confirm");

  const [view, setView] = React.useState<TeacherProfileView | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // Мгновенно показываем устройство, потом уточняем по серверу: экран
      // никогда не мигает «Загрузка» и никогда не оказывается пустым.
      setView(deviceView());
      const res = await loadProfile();
      if (cancelled) return;
      if (res.status === "ready") setView(res.view);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Возврат из платёжного сервиса. Честно: мы не знаем, чем закончился платёж,
  // пока сервер не подтвердит подписку, поэтому и говорим «проверяем».
  React.useEffect(() => {
    if (searchParams.get("paid") !== "1") return;
    toast({
      tone: "info",
      title: "Проверяем оплату",
      description: "Если платёж прошёл, тариф обновится в ближайшую минуту.",
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("paid");
    window.history.replaceState(null, "", url.toString());
  }, [searchParams, toast]);

  if (!view) {
    return (
      <div className="container-tight py-8 sm:py-12">
        <div className="h-8 w-64 rounded bg-warm-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="container-tight py-8 sm:py-12 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold text-warm-950">
            Настройки
          </h1>
          <p className="text-sm text-warm-600 mt-1">
            {view.source === "account"
              ? "Профиль, классы, подписка и устройства — всё в одном месте."
              : "Профиль, классы и подписка. Хранятся на этом устройстве: вход в аккаунт сегодня отключён, и это не мешает ими пользоваться."}
          </p>
        </div>
        <Button variant="ghost" onClick={() => router.push("/dashboard")} loading={loading}>
          <ArrowLeft className="w-4 h-4" />
          В кабинет
        </Button>
      </div>

      <ProfileSection view={view} onChange={setView} emailConfirmId={emailConfirmId} />

      <ClassesSection view={view} onChange={setView} />

      <SubscriptionPanel />

      <SessionsSection hasAccount={view.source === "account"} />
    </div>
  );
}

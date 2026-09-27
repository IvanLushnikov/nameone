"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui/Button";
import { Menu, X, Sparkles, GraduationCap, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { getProfile } from "@/lib/utils/storage";
import type { UserProfile } from "@/lib/types";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";

const nav = [
  { href: "/constructor", label: "Генератор", icon: Sparkles },
  { href: "/oge", label: "ОГЭ / ЕГЭ", icon: GraduationCap },
  { href: "/pricing", label: "Тарифы", icon: null },
  { href: "/dashboard", label: "Кабинет", icon: LayoutDashboard },
];

export function Header() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [profile, setProfileState] = React.useState<UserProfile | null>(null);
  const pathname = usePathname();

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Перечитываем профиль при mount и при изменениях.
  React.useEffect(() => {
    const refresh = () => setProfileState(getProfile());
    refresh();

    // Cross-tab: выстреливает storage когда другая вкладка меняет localStorage.
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === "listai.profile") refresh();
    };
    window.addEventListener("storage", onStorage);

    // Same-tab: CustomEvent после успешного login/logout.
    const onProfileChanged = () => refresh();
    window.addEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);
    };
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all duration-200",
        scrolled
          ? "bg-warm-50/85 backdrop-blur-md border-b border-warm-100"
          : "bg-transparent"
      )}
    >
      <div className="container-tight">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="shrink-0">
            <Logo />
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-50 text-brand-800"
                      : "text-warm-700 hover:text-warm-950 hover:bg-warm-100"
                  )}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden md:flex items-center gap-2">
            {profile ? (
              <Button
                as="link"
                href="/dashboard"
                variant="ghost"
                size="md"
                aria-label={`Открыть кабинет: ${profile.name}`}
              >
                {profile.name} →
              </Button>
            ) : (
              <Button as="link" href="/login" variant="ghost" size="md">
                Войти
              </Button>
            )}
            <Button as="link" href="/constructor" variant="primary" size="md" leftIcon={<Sparkles className="w-4 h-4" />}>
              Создать лист
            </Button>
          </div>

          <button
            type="button"
            className="md:hidden w-10 h-10 inline-flex items-center justify-center rounded-xl text-warm-700 hover:bg-warm-100"
            onClick={() => setOpen((v) => !v)}
            aria-label="Меню"
            aria-expanded={open}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-warm-100 bg-warm-50 animate-fade-in">
          <div className="container-tight py-3 flex flex-col gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 h-11 rounded-xl text-sm font-medium",
                    active
                      ? "bg-brand-50 text-brand-800"
                      : "text-warm-800 hover:bg-warm-100"
                  )}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {item.label}
                </Link>
              );
            })}
            <div className="grid grid-cols-2 gap-2 pt-2">
              {profile ? (
                <Button as="link" href="/dashboard" variant="secondary" size="md" fullWidth>
                  {profile.name}
                </Button>
              ) : (
                <Button as="link" href="/login" variant="secondary" size="md" fullWidth>
                  Войти
                </Button>
              )}
              <Button as="link" href="/constructor" variant="primary" size="md" fullWidth>
                Создать лист
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
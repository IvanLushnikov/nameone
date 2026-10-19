"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui/Button";
import { Menu, X, Sparkles, GraduationCap, Library, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { getProfile } from "@/lib/utils/storage";
import type { UserProfile } from "@/lib/types";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";

/**
 * Пункты меню.
 *
 * Аудит 11.10, Д-3: здесь был пункт «Кабинет», и рядом с ним — кнопка входа.
 * Два входа в одно место с одинаковым весом: гость видел «Кабинет» (которого у
 * него нет) рядом с «Войти», а залогиненный — «Кабинет» в меню и ещё одну
 * кнопку входа справа. Кабинет убран из списка меню.
 *
 * Возвращён 16.10.2026 как кнопка в шапке (ТЗ-32, D5), потому что с тех пор
 * кабинет стал открытым гостю: он читает материалы с устройства и входа не
 * требует. Правило прежнее — одна кнопка на состояние — не отменено: в списке
 * меню пункта «Кабинет» по-прежнему нет, и рядом с «Войти» гостя стоит не
 * второй вход, а ссылка на место, куда вход ведёт.
 */
const nav = [
  { href: "/constructor", label: "Генератор", icon: Sparkles },
  // «Банк материалов» убран из меню 12.10.2026 вместе с витриной на главной:
  // реального банка ещё нет, материалы должны появляться по ходу генерации.
  // Пункт в меню обещал учителю то, чего на сайте не лежало.
  { href: "/oge", label: "ОГЭ / ЕГЭ", icon: GraduationCap },
  { href: "/pricing", label: "Тарифы", icon: null },
  // Блог появился 14.10.2026. По обратной стороне правила выше («пункт в меню
  // обещает то, чего на сайте нет») в меню его класть можно: посты есть, они
  // в карте сайта, и без ссылки из меню блог достижим только через sitemap —
  // учитель на сайт попадает из поиска, а не из шапки.
  { href: "/blog", label: "Блог", icon: Newspaper },
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
      if (!e.key || e.key === "uchlist.profile") refresh();
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
        // no-print: шапка с меню и кнопкой «Создать лист» не должна попадать
        // на напечатанный рабочий лист. Обнаружено 03.10 при печати демо-заготовки.
        "no-print sticky top-0 z-40 transition-all duration-200",
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
            {/* Одна кнопка на состояние: гость — «Войти», свой кабинет —
                «Кабинет». Имя рядом с надписью оставлено намеренно: учителю
                полезно видеть, под кем он вошёл. */}
            {/* Правило шапки — одна кнопка на состояние. Залогиненному: «Кабинет»
                с именем, отдельного «Войти» нет. Гостю (ТЗ-32, D5): «Кабинет»
                РЯДОМ с «Войти», потому что это две разные вещи, а не два входа в
                одно место. Кабинету вход не нужен — он читает историю, избранное
                и шаблоны с устройства и гостю показывает пустые вкладки с
                действиями, а не требование зарегистрироваться. Проверено по коду
                (`src/app/dashboard/page.tsx`): стены входа нет, редиректа на
                `/login` нет, middleware для `/dashboard` не настроен.
                Порядок: «Войти» — вход, «Кабинет» — место, куда вход ведёт.
                Обратный порядок читался бы как «войди, чтобы увидеть кабинет». */}
            {profile ? (
              <Button
                as="link"
                href="/dashboard"
                variant="ghost"
                size="md"
                className="inline-flex items-center gap-2"
                aria-label={`Кабинет: ${profile.name}`}
              >
                {/* Аудит 18.10.2026 (BUG-002): имя и «Кабинет» склеивались без
                    зазора — на экране читалось «uchlist audit 1792297698Кабинет».
                    Причина в Button: он оборачивает содержимое в
                    `<span className="truncate">`, и `gap-2` на самой кнопке
                    раскладывал флексом КНОПКУ, а не эти два span'а внутри.
                    Поэтому зазор задаём здесь — своими flex-контейнером. */}
                <span className="inline-flex items-center gap-2">
                  <span className="max-w-[9rem] truncate text-warm-500">{profile.name}</span>
                  <span>Кабинет</span>
                </span>
              </Button>
            ) : (
              <>
                <Button
                  as="link"
                  href="/login"
                  variant="ghost"
                  size="md"
                  aria-current={pathname === "/login" ? "page" : undefined}
                  className={cn(
                    pathname === "/login" &&
                      "bg-brand-50 text-brand-800 hover:bg-brand-50 hover:text-brand-800"
                  )}
                >
                  Войти
                </Button>
                <Button
                  as="link"
                  href="/dashboard"
                  variant="ghost"
                  size="md"
                  aria-current={pathname === "/dashboard" ? "page" : undefined}
                  className={cn(
                    pathname === "/dashboard" &&
                      "bg-brand-50 text-brand-800 hover:bg-brand-50 hover:text-brand-800"
                  )}
                >
                  Кабинет
                </Button>
              </>
            )}
            {!pathname.startsWith("/constructor") && (
              <Button as="link" href="/constructor" variant="primary" size="md" leftIcon={<Sparkles className="w-4 h-4" />}>
                Создать лист
              </Button>
            )}
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
            {/* Гость видит три кнопки, поэтому сетка на 3 колонки, а не на 2:
                иначе «Кабинет» и «Создать лист» оказались бы в одной ячейке
                второго ряда и разъехались по ширине (ТЗ-32, D5). Залогиненному
                кнопок две, и они занимают первые две колонки из трёх — ряд
                остаётся ровным в обоих состояниях. */}
            <div className="grid grid-cols-3 gap-2 pt-2">
              {profile ? (
                <Button
                  as="link"
                  href="/dashboard"
                  variant="secondary"
                  size="md"
                  fullWidth
                  aria-label={`Кабинет: ${profile.name}`}
                >
                  Кабинет
                </Button>
              ) : (
                <>
                  <Button
                    as="link"
                    href="/login"
                    variant="secondary"
                    size="md"
                    fullWidth
                    aria-current={pathname === "/login" ? "page" : undefined}
                    className={cn(
                      pathname === "/login" &&
                        "bg-brand-500 text-white border-brand-500 hover:bg-brand-600 hover:border-brand-600"
                    )}
                  >
                    Войти
                  </Button>
                  <Button
                    as="link"
                    href="/dashboard"
                    variant="secondary"
                    size="md"
                    fullWidth
                    aria-current={pathname === "/dashboard" ? "page" : undefined}
                  >
                    Кабинет
                  </Button>
                </>
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
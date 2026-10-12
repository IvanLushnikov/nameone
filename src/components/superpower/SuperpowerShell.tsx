"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Каркас `/superpower`: заголовок и навигация по четырём экранам.
 *
 * Навигация без зависимостей — обычные ссылки. Активный пункт подсвечивается
 * по pathname: так видно, где ты находишься, даже если сеть легла и данные не
 * пришли.
 */
const TABS = [
  { href: "/superpower", label: "Светофор" },
  { href: "/superpower/screens", label: "Экраны" },
  { href: "/superpower/generations", label: "Генерации" },
  { href: "/superpower/money", label: "Деньги" },
  { href: "/superpower/security", label: "Безопасность" },
];

export function SuperpowerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-warm-50">
      <header className="border-b border-warm-200 bg-white">
        <div className="container-tight py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-warm-900">Суперадминка</h1>
              <p className="text-sm text-warm-600 mt-0.5">
                Продукт и деньги в одном месте. Данные — из своей базы и со счёта
                провайдера.
              </p>
            </div>
            <Link
              href="/"
              className="text-sm text-warm-600 hover:text-warm-900 transition-colors"
            >
              ← На сайт
            </Link>
          </div>

          <nav className="flex flex-wrap gap-1" aria-label="Разделы суперадминки">
            {TABS.map((tab) => {
              const active =
                tab.href === "/superpower" ? pathname === tab.href : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "px-3.5 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium"
                      : "px-3.5 py-2 rounded-lg text-warm-700 hover:bg-warm-100 text-sm font-medium transition-colors"
                  }
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="container-tight py-6">{children}</main>
    </div>
  );
}
"use client";

import * as React from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/api";

interface Props {
  children: React.ReactNode;
  /** Требуемая роль. Если не задано — любая админка. */
  roles?: string[];
}

/**
 * Охрана админки. До 12.10.2026 это была заглушка:
 *
 *   export function AdminGuard({ children }: Props) {
 *     return <>{children}</>;   // ← пропускает всех, включая анонимов
 *   }
 *
 * Теперь проверка настоящая, но важно понимать, ЧТО ИМЕННО она делает и чего
 * НЕ делает.
 *
 * ЧТО ДЕЛАЕТ
 * ----------
 * Не показывает содержимое тому, кто не администратор. То есть прячет вёрстку и
 * цифры от случайного посетителя и от учителя.
 *
 * ЧЕГО НЕ ДЕЛАЕТ — И ЭТО ГЛАВНОЕ
 * -----------------------------
 * НЕ ЯВЛЯЕТСЯ ЗАЩИТОЙ ДАННЫХ. `/superpower` — обычная страница статического
 * экспорта: её код отдаётся кому угодно, и спрятать её от интернета нельзя
 * (см. решение владельца: адрес внутри сайта, отдельный домен не делаем).
 * Все цифры запрашиваются с бэкенда, и там стоит `requireAdmin`. Убери эту
 * проверку на сервере — и никакая охрана на клиенте не поможет.
 *
 * Поэтому здесь намеренно НЕ пишем, что пользователь «авторизован»: клиент
 * этого не знает и знать не может. Он знает только одно — показывать ли ему
 * содержимое страницы.
 */

type State = "checking" | "allowed" | "denied" | "not-admin";

export function AdminGuard({ children }: Props) {
  const [state, setState] = React.useState<State>("checking");

  React.useEffect(() => {
    let cancelled = false;

    getCurrentUser()
      .then((user) => {
        if (cancelled) return;
        // Нет сессии — тихо уводим на вход. Есть сессия, но не админ — тоже
        // уводим: показывать пустую белую страницу «нужен администратор»
        // бессмысленно, её и так не должно быть видно.
        if (!user) setState("denied");
        else if (!user.isAdmin) setState("not-admin");
        else setState("allowed");
      })
      .catch(() => {
        if (!cancelled) setState("denied");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    // Пустой экран, а не «Загрузка…»: пока не выяснено, кто перед нами,
    // показывать формулировку «нет доступа» рано — человек мог просто
    // медленно открывать страницу.
    return <div className="min-h-screen bg-warm-50" aria-busy="true" />;
  }

  if (state !== "allowed") {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-warm-900 mb-3">
            {state === "not-admin" ? "Это не админский раздел" : "Нужен вход"}
          </h1>
          <p className="text-warm-600 mb-6">
            {state === "not-admin"
              ? "У этой учётной записи нет прав администратора."
              : "Войдите под учётной записью администратора."}
          </p>
          <Link
            href="/login"
            className="inline-block px-5 py-2.5 rounded-xl bg-brand-600 text-white font-medium hover:bg-brand-700 transition-colors"
          >
            Войти
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
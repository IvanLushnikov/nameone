"use client";

import * as React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Системная настройка «меньше движения».
 *
 * Возвращает true, если пользователь просил убрать анимации. Начальное
 * значение false, чтобы серверный рендер и первая отрисовка на клиенте
 * совпали (иначе React ругается на hydration mismatch); фактическое
 * значение приходит в effect. Подписка на `change` снимается при
 * размонтировании, поэтому смена настройки подхватывается на лету.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

"use client";

import * as React from "react";

interface Options {
  /** Сработать только один раз или каждый раз при появлении */
  once?: boolean;
  /** rootMargin для IntersectionObserver */
  margin?: string;
}

/**
 * Хук для scroll-triggered анимаций. Возвращает ref и флаг «в зоне видимости».
 */
export function useInView<T extends Element = HTMLDivElement>(
  options: Options = {}
): [React.RefObject<T>, boolean] {
  const { once = true, margin = "-10% 0px -10% 0px" } = options;
  const ref = React.useRef<T>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin: margin, threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once, margin]);

  return [ref, inView];
}

/**
 * Хук анимации счётчика: плавно считает от 0 до target за duration мс.
 */
export function useCountUp(target: number, options: { duration?: number; start?: boolean } = {}) {
  const { duration = 1500, start = true } = options;
  const [value, setValue] = React.useState(0);

  React.useEffect(() => {
    if (!start) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      // easing: easeOutCubic
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(target * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);

  return value;
}
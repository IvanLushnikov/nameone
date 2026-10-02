"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Масштабирование листа A4 под ширину экрана.
 *
 * Лист имеет фиксированную ширину 210mm ≈ 794px. На iPad в портретной
 * ориентации (768px) полезной ширины ~720px — лист уезжал за экран.
 * Обёртка измеряет свою ширину через ResizeObserver и пишет коэффициент
 * в CSS-переменную `--ws-scale`; саму трансформацию применяет
 * `.worksheet-scale .worksheet-page` в globals.css (см. @media print —
 * на печати масштаб принудительно сброшен в 1).
 *
 * Высота: transform не меняет layout-бокс, поэтому под отмасштабированным
 * листом осталось бы пустое место во всю высоту A4. Компенсирующая обёртка
 * `.worksheet-scale__box` получает высоту = offsetHeight × scale, а её
 * ширина считается в CSS через calc(210mm * var(--ws-scale)).
 *
 * SSR: первый рендер идёт с --ws-scale: 1 (гидрация не едет), замер —
 * в useEffect, то есть сразу после монтирования на клиенте.
 */

/** 210mm при 96dpi = 793.7px. */
export const WORKSHEET_PAGE_WIDTH_PX = 794;

/** Коэффициент масштаба: меньше 1 только если контейнер уже листа A4. */
export function computeWorksheetScale(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1;
  return Math.min(1, containerWidth / WORKSHEET_PAGE_WIDTH_PX);
}

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function WorksheetScale({ children, className }: Props) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState({ scale: 1, height: 0 });

  React.useEffect(() => {
    const root = rootRef.current;
    const sheet = sheetRef.current;
    if (!root || !sheet) return;

    const measure = () => {
      // clientWidth — без бордера/скроллбара, ровно то, что доступно листу.
      const scale = computeWorksheetScale(root.clientWidth);
      // offsetHeight в CSS-пикселях, до transform — то, что нужно умножить.
      const height = sheet.offsetHeight;
      setState((prev) =>
        Math.abs(prev.scale - scale) < 0.0005 && prev.height === height
          ? prev
          : { scale, height }
      );
    };

    measure();

    const observer = new ResizeObserver(measure);
    // Наблюдаем и контейнер (поворот планшета, ресайз окна), и сам лист
    // (переключение блока ответов, длинный контент).
    observer.observe(root);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn("worksheet-scale", className)}
      style={{ "--ws-scale": state.scale } as React.CSSProperties}
    >
      <div
        className="worksheet-scale__box"
        style={state.height > 0 ? { height: Math.round(state.height * state.scale) } : undefined}
      >
        <div ref={sheetRef} className="worksheet-scale__sheet">
          {children}
        </div>
      </div>
    </div>
  );
}

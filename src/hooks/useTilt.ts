"use client";

import * as React from "react";

/**
 * 3D-tilt на движение мыши: rotateX/rotateY относительно центра элемента.
 * Возвращает ref и style для transform.
 */
export function useTilt<T extends HTMLElement = HTMLDivElement>(
  options: { max?: number; perspective?: number; scale?: number } = {}
): [React.RefObject<T>, React.CSSProperties] {
  const { max = 8, perspective = 1000, scale = 1.01 } = options;
  const ref = React.useRef<T>(null);
  const [transform, setTransform] = React.useState<string>("");

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;

    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width; // 0..1
      const y = (e.clientY - rect.top) / rect.height; // 0..1
      const rotateY = (x - 0.5) * 2 * max; // -max..max
      const rotateX = -(y - 0.5) * 2 * max;

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setTransform(
          `perspective(${perspective}px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(${scale})`
        );
      });
    };

    const handleLeave = () => {
      cancelAnimationFrame(raf);
      setTransform("");
    };

    el.addEventListener("mousemove", handleMove);
    el.addEventListener("mouseleave", handleLeave);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("mousemove", handleMove);
      el.removeEventListener("mouseleave", handleLeave);
    };
  }, [max, perspective, scale]);

  const style: React.CSSProperties = {
    transform: transform || undefined,
    transition: transform ? "transform 0.1s ease-out" : "transform 0.4s ease-out",
    transformStyle: "preserve-3d",
    willChange: "transform",
  };

  return [ref, style];
}

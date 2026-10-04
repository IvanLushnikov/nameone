"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
};

interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Soft fallback — never break the UI just because Toaster isn't mounted
    return {
      toast: (t: Omit<Toast, "id">) => {
        // eslint-disable-next-line no-console
        console.warn("[toast]", t.title);
      },
    };
  }
  return ctx;
}

const tones: Record<ToastTone, { icon: React.ReactNode; bar: string; iconColor: string }> = {
  success: {
    icon: <CheckCircle2 className="w-5 h-5" />,
    bar: "bg-emerald-500",
    iconColor: "text-emerald-500",
  },
  error: {
    icon: <AlertCircle className="w-5 h-5" />,
    bar: "bg-rose-500",
    iconColor: "text-rose-500",
  },
  info: {
    icon: <Info className="w-5 h-5" />,
    bar: "bg-blue-500",
    iconColor: "text-blue-500",
  },
};

export function Toaster({ children }: { children?: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);

  const toast = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  const remove = (id: string) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {/* `children` обязателен: Provider живёт здесь, поэтому всё, что
          вызывает `useToast()`, должно быть ВНУТРИ Toaster. Раньше Toaster
          стоял соседом с <main>, и ни одна страница не попадала в контекст —
          `useToast()` всегда уходил в console.warn, то есть тосты не
          показывались вообще. */}
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-[60] flex flex-col gap-2 pointer-events-none">
        {items.map((t) => {
          const tone = tones[t.tone];
          return (
            <div
              key={t.id}
              className="pointer-events-auto relative bg-white rounded-2xl shadow-soft-lg border border-warm-100 overflow-hidden animate-fade-in"
              role="status"
            >
              <div className={cn("absolute left-0 top-0 bottom-0 w-1", tone.bar)} />
              <div className="flex items-start gap-3 p-4 pl-5">
                <div className={cn("shrink-0 mt-0.5", tone.iconColor)}>{tone.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-warm-950">{t.title}</p>
                  {t.description && (
                    <p className="mt-0.5 text-sm text-warm-600">{t.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-full text-warm-600 hover:text-warm-700 hover:bg-warm-100"
                  aria-label="Закрыть"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
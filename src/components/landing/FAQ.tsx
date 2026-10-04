"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
// Массив вопросов живёт в `src/lib/content/landing-seo.ts`, а не здесь:
// файл помечен "use client", и не-компонентный экспорт из client-модуля
// нельзя сериализовать в JSON-LD на сервере. Отсюда же главная собирает
// FAQPage — текст на странице и в разметке не разойдётся.
import { faqItems as items } from "@/lib/content/landing-seo";


export function FAQ() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <section className="py-20 sm:py-28 bg-warm-50 border-y border-warm-100">
      <div className="container-tight max-w-3xl">
        <div className="text-center mb-10">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
            FAQ
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Частые вопросы
          </h2>
        </div>

        <div className="space-y-2.5">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className={cn(
                  "bg-white rounded-2xl border transition-all",
                  isOpen ? "border-brand-300 shadow-soft" : "border-warm-100"
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-medium text-warm-950">{it.q}</span>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-warm-600 shrink-0 transition-transform",
                      isOpen && "rotate-180"
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pt-0">
                    <p className="text-sm text-warm-600 leading-relaxed">{it.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
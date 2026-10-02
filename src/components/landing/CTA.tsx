import { Button } from "@/components/ui/Button";
import { Sparkles, ArrowRight } from "lucide-react";

export function CTA() {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-tight">
        <div className="relative overflow-hidden rounded-3xl px-6 sm:px-12 py-14 sm:py-20 text-center text-white shadow-soft-lg">
          {/* Анимированный градиент. Компонент остаётся серверным: хук
           * useReducedMotion здесь не нужен, а CSS-правило
           * `[style*="shimmer"] { animation: none !important }` внутри
           * @media (prefers-reduced-motion: reduce) гасит анимацию и без JS. */}
          <div
            className="absolute inset-0 bg-gradient-to-br from-brand-400 via-brand-600 to-accent-500"
            style={{ backgroundSize: "200% 200%", animation: "shimmer 8s linear infinite" }}
          />
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-white/10 blur-3xl animate-bounce-subtle" />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-accent-400/30 blur-3xl animate-bounce-subtle" style={{ animationDelay: "1s" }} />
          <div className="absolute inset-0 bg-noise opacity-30" />

          <div className="relative">
            <Sparkles className="w-12 h-12 mx-auto mb-5 text-accent-100" />
            <h2 className="text-3xl sm:text-5xl font-display font-bold tracking-tight text-balance">
              Попробуйте прямо сейчас.
              <br />
              <span className="text-accent-100">3 листа бесплатно.</span>
            </h2>
            <p className="mt-5 text-lg sm:text-xl text-brand-50 max-w-xl mx-auto text-pretty">
              Без регистрации. Без карты. Готовый PDF за 30 секунд.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                as="link"
                href="/constructor"
                variant="accent"
                size="xl"
                rightIcon={<ArrowRight className="w-4 h-4" />}
                className="shadow-accent"
              >
                Создать первый лист
              </Button>
              <Button
                as="link"
                href="/pricing"
                variant="ghost"
                size="xl"
                className="text-white hover:bg-white/10 border border-white/20"
              >
                Посмотреть тарифы
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
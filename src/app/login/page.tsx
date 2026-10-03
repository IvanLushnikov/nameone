"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Mail, ArrowRight, Sparkles, Rocket } from "lucide-react";
import { trackEvent } from "@/lib/track";
import { requestMagicLink } from "@/lib/auth/api";
import { DEMO_USER_NAME, enterDemoMode, isDemoLoginEnabled } from "@/lib/dev/demo-login";

export default function LoginPage() {
  const { toast } = useToast();
  const router = useRouter();
  const demoEnabled = isDemoLoginEnabled();
  const [email, setEmail] = React.useState("");
  const [step, setStep] = React.useState<"email" | "sent">("email");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    trackEvent("login_view");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    const emailDomain = email.split("@")[1] ?? "unknown";
    trackEvent("login_submit", { emailDomain });

    setLoading(true);
    trackEvent("magic_link_requested", { emailDomain });
    const result = await requestMagicLink(email);
    setLoading(false);

    if (result.ok) {
      trackEvent("magic_link_sent", { emailDomain });
      toast({
        title: "Ссылка отправлена",
        description: `Проверьте ${email}`,
        tone: "success",
      });
      setStep("sent");
    } else {
      trackEvent("magic_link_failed", {
        emailDomain,
        reason: result.error,
      });
      toast({
        title: "Не получилось отправить ссылку",
        description: result.error,
        tone: "error",
      });
      // Остаёмся на шаге email, чтобы юзер мог попробовать снова или проверить адрес.
    }
  };

  const handleDemoLogin = () => {
    trackEvent("dev_demo_login");
    enterDemoMode();
    toast({
      title: "Демо-вход выполнен",
      description: `Вы вошли как ${DEMO_USER_NAME}. Кабинет открыт в демо-режиме.`,
      tone: "success",
    });
    router.push("/dashboard");
  };

  return (
    <div className="container-tight py-12 sm:py-20 max-w-md mx-auto">
      <Card>
        {step === "email" && (
          <>
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-xl bg-brand-500 text-white grid place-items-center mx-auto mb-4 shadow-brand">
                <Mail className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-semibold text-warm-950">Войти в УчЛист</h1>
              <p className="text-sm text-warm-500 mt-1">
                Magic link — без пароля. Откроем письмо, нажмёте кнопку — и готово.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                placeholder="teacher@school.ru"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                required
              />
              <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />}>
                Получить ссылку на почту
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-warm-100" />
              <span className="text-xs uppercase tracking-wider text-[color:var(--text-muted)]">или войти через</span>
              <div className="flex-1 h-px bg-warm-100" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "VK", title: "Скоро" },
                { label: "Яндекс", title: "Скоро" },
                { label: "Telegram", title: "Скоро" },
              ].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled
                  title={s.title}
                  aria-label={`${s.label} (${s.title})`}
                  className="h-11 rounded-xl border border-warm-200 bg-white text-sm font-medium text-[color:var(--text-muted)] cursor-not-allowed hover:bg-warm-50 transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>

            <p className="mt-6 text-xs text-warm-500 text-center">
              Регистрируясь, вы соглашаетесь с{" "}
              <Link href="/legal/offer" className="text-brand-600 hover:text-brand-700">
                публичной офертой
              </Link>{" "}
              и{" "}
              <Link href="/legal/privacy" className="text-brand-600 hover:text-brand-700">
                политикой конфиденциальности
              </Link>
              .
            </p>

            <div className="mt-6 pt-6 border-t border-warm-100 text-center">
              <Link
                href="/constructor"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 group"
              >
                <Sparkles className="w-4 h-4" />
                Создать лист без регистрации
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </Link>
            </div>

            {/* Локальный демо-вход: только в dev-сборке (см. lib/dev/demo-login.ts).
                Пишет профиль в localStorage и открывает /dashboard без почты. */}
            {demoEnabled && (
              <div className="mt-4 rounded-xl border border-dashed border-brand-300 bg-brand-50/50 p-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-700 mb-3">
                  <Rocket className="w-3.5 h-3.5" />
                  Локальная разработка
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={handleDemoLogin}
                  leftIcon={<Rocket className="w-4 h-4" />}
                >
                  Войти как {DEMO_USER_NAME}
                </Button>
                <p className="mt-2 text-xs text-warm-500">
                  Без регистрации и без письма. Демо-кабинет с историей, избранным и шаблонами.
                </p>
              </div>
            )}
          </>
        )}

        {step === "sent" && (
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-500 text-white grid place-items-center mx-auto mb-4">
              <Mail className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-semibold text-warm-950">Проверьте почту</h2>
            <p className="text-sm text-warm-600 mt-2">
              Отправили magic link на <strong>{email}</strong>. Откройте письмо и нажмите кнопку «Войти».
            </p>
            <p className="text-xs text-warm-500 mt-4">
              Не пришло? Проверьте папку «Спам» или повторите через минуту.
            </p>

            <button
              type="button"
              onClick={() => setStep("email")}
              className="mt-4 text-sm text-warm-500 hover:text-warm-900"
            >
              ← Другой email
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw, Mail } from "lucide-react";
import { setProfile } from "@/lib/utils/storage";
import type { UserProfile } from "@/lib/types";
import { trackEvent } from "@/lib/track";
import { verifyMagicLink, AuthApiError } from "@/lib/auth/api";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";

type State =
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "expired"; message: string }
  | { kind: "error"; message: string };

/**
 * Клиентский эквивалент /auth/callback — обёрнут в <Suspense> в page.tsx,
 * чтобы Next.js 14 при `output: "export"` не падал на useSearchParams() bailout.
 */
export function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = React.useState<State>({ kind: "loading" });

  const verify = React.useCallback(
    async (t: string) => {
      setState({ kind: "loading" });
      try {
        const result = await verifyMagicLink(t);
        if (result.ok) {
          const u = result.user;
          // Маппим AuthUser → UserProfile (поля соответствуют src/lib/types.ts:176-185).
          // generationsLimit: -1 у base/plus трактуется как безлимит — конструктор сам решит.
          const profile: UserProfile = {
            id: u.id,
            email: u.email,
            name: u.name,
            plan: u.plan,
            generationsTotal: u.generationsTotal ?? 0,
            generationsToday: u.generationsToday ?? 0,
            generationsLimit:
              u.generationsLimit ??
              (u.plan === "free" ? 3 : -1),
            createdAt: u.createdAt ?? new Date().toISOString(),
          };
          setProfile(profile);
          // Уведомляем Header (и другие компоненты в той же вкладке), что профиль появился,
          // чтобы переключить «Войти» → «{name} →» без перезагрузки.
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
          }
          trackEvent("auth_callback_success", {
            plan: u.plan,
          });
          setState({ kind: "success" });
          // Короткий flash, чтобы юзер увидел "Готово!" — иначе редирект выглядит миганием.
          setTimeout(() => router.push("/dashboard"), 600);
        } else {
          trackEvent("auth_callback_error", {
            reason: "invalid_token",
          });
          setState({
            kind: "expired",
            message: result.error,
          });
        }
      } catch (err) {
        const message =
          err instanceof AuthApiError
            ? err.isAuthError
              ? "Ссылка истекла или уже использована"
              : err.message
            : "Не получилось подтвердить вход";
        trackEvent("auth_callback_error", {
          reason: err instanceof AuthApiError ? err.code : "unknown",
        });
        setState({
          kind: err instanceof AuthApiError && err.isAuthError ? "expired" : "error",
          message,
        });
      }
    },
    [router],
  );

  React.useEffect(() => {
    trackEvent("auth_callback_view");
    if (!token) {
      trackEvent("auth_callback_error", { reason: "missing_token" });
      setState({
        kind: "error",
        message: "В ссылке нет токена. Откройте magic link из письма целиком.",
      });
      return;
    }
    void verify(token);
  }, [token, verify]);

  return (
    <div className="container-tight py-12 sm:py-20 max-w-md mx-auto">
      <Card>
        <div className="text-center" data-testid={`auth-callback-${state.kind}`}>
          {state.kind === "loading" && (
            <>
              <div className="w-12 h-12 rounded-xl bg-brand-500 text-white grid place-items-center mx-auto mb-4 shadow-brand">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <h1 className="text-xl font-semibold text-warm-950">
                Подтверждаем вход…
              </h1>
              <p className="text-sm text-warm-500 mt-2">
                Это занимает пару секунд.
              </p>
            </>
          )}

          {state.kind === "success" && (
            <>
              <div className="w-12 h-12 rounded-xl bg-emerald-500 text-white grid place-items-center mx-auto mb-4">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-semibold text-warm-950">Готово!</h1>
              <p className="text-sm text-warm-600 mt-2">
                Перенаправляем в личный кабинет…
              </p>
            </>
          )}

          {state.kind === "expired" && (
            <>
              <div className="w-12 h-12 rounded-xl bg-rose-500 text-white grid place-items-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-semibold text-warm-950">
                Ссылка истекла
              </h1>
              <p className="text-sm text-warm-600 mt-2">{state.message}</p>
              <p className="text-xs text-warm-500 mt-3">
                Magic link живёт 15 минут и используется только один раз.
              </p>
              <div className="mt-6">
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  as="link"
                  href="/login"
                  leftIcon={<Mail className="w-4 h-4" />}
                >
                  Запросить новую ссылку
                </Button>
              </div>
            </>
          )}

          {state.kind === "error" && (
            <>
              <div className="w-12 h-12 rounded-xl bg-rose-500 text-white grid place-items-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-semibold text-warm-950">
                Не получилось войти
              </h1>
              <p className="text-sm text-warm-600 mt-2">{state.message}</p>
              <div className="mt-6 space-y-2">
                {token && (
                  <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={() => verify(token)}
                    leftIcon={<RefreshCw className="w-4 h-4" />}
                  >
                    Попробовать ещё раз
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  as="link"
                  href="/login"
                  leftIcon={<Mail className="w-4 h-4" />}
                >
                  Запросить новую ссылку
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw, Mail, ShieldCheck } from "lucide-react";
import { setProfile } from "@/lib/utils/storage";
import type { UserProfile } from "@/lib/types";
import { trackEvent } from "@/lib/track";
import { verifyMagicLink, AuthApiError } from "@/lib/auth/api";
import type { AuthUser } from "@/lib/auth/api";
import { verifyLoginCode } from "@/lib/superpower-totp-api";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";

type State =
  | { kind: "loading" }
  | { kind: "mfa"; pendingToken: string }
  | { kind: "success" }
  | { kind: "expired"; message: string }
  | { kind: "error"; message: string };

/**
 * Клиентский эквивалент /auth/callback. Раньше был обёрнут в <Suspense> —
 * только ради `useSearchParams()`, который при `output: "export"` требует
 * границы, а её fallback закрывал страницу до гидратации. Сейчас токен
 * читается из `window.location.search` в useEffect.
 */
export function AuthCallbackInner() {
  const router = useRouter();
  // undefined = токен ещё не прочитан из URL. ВАЖНО: это НЕ `null` —
  // `URLSearchParams.get()` отдаёт null для отсутствующего параметра, и такой
  // заход обязан показать «В ссылке нет токена», а не крутить вечную загрузку.
  const [token, setToken] = React.useState<string | undefined>(undefined);
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const [mfaCode, setMfaCode] = React.useState("");
  const [mfaError, setMfaError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  /** Открыть кабинет и обновить шапку — общий хвост для обоих путей входа. */
  const openCabinet = React.useCallback(
    (u: AuthUser) => {
      // Маппим AuthUser → UserProfile (поля соответствуют src/lib/types.ts:176-185).
      // generationsLimit: -1 у base/plus трактуется как безлимит — конструктор сам решит.
      const profile: UserProfile = {
        id: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        generationsTotal: u.generationsTotal ?? 0,
        generationsToday: u.generationsToday ?? 0,
        generationsLimit: u.generationsLimit ?? (u.plan === "free" ? 3 : -1),
        createdAt: u.createdAt ?? new Date().toISOString(),
      };
      setProfile(profile);
      // Уведомляем Header (и другие компоненты в той же вкладке), что профиль
      // появился, чтобы переключить «Войти» → «{name} →» без перезагрузки.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
      }
      trackEvent("auth_callback_success", { plan: u.plan });
      setState({ kind: "success" });
      // Короткий flash, чтобы юзер увидел "Готово!" — иначе редирект выглядит миганием.
      setTimeout(() => router.push("/dashboard"), 600);
    },
    [router],
  );

  const verify = React.useCallback(
    async (t: string) => {
      setState({ kind: "loading" });
      try {
        const result = await verifyMagicLink(t);
        if (!result.ok) {
          trackEvent("auth_callback_error", { reason: "invalid_token" });
          setState({ kind: "expired", message: result.error });
          return;
        }
        // Администратору с кодом подтверждения ссылка — только первый шаг.
        if ("mfaRequired" in result) {
          setMfaCode("");
          setMfaError(null);
          setState({ kind: "mfa", pendingToken: result.pendingToken });
          trackEvent("auth_callback_mfa_required", {});
          return;
        }
        if ("user" in result) {
          openCabinet(result.user);
        }
      } catch (err) {
        const message =
          err instanceof AuthApiError
            ? err.isAuthError
              ? "Ссылка для входа не сработала"
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
    [openCabinet],
  );

  /**
   * Второй шаг: код из приложения. На ошибке экран НЕ сбрасывается — человеку
   * нужно просто ввести код заново, стирать введённое было бы наказанием за
   * опечатку.
   */
  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind !== "mfa" || mfaCode.length !== 6) return;

    setMfaError(null);
    const { data, error } = await verifyLoginCode(mfaCode, state.pendingToken);
    if (error || !data) {
      setMfaError(error ?? "Код не подошёл");
      setMfaCode("");
      return;
    }

    // Сессия выдана сервером и лежит в cookie. Профиль обновляем тем же путём,
    // что и после обычного входа, — иначе в шапке осталось бы имя из прошлой сессии.
    if (data.user) {
      openCabinet(data.user);
    } else {
      // Пользователя в ответе нет, но сессия уже выдана: идём в кабинет, а
      // шапка подтянет имя сама через /api/auth/me.
      trackEvent("auth_callback_success", {});
      setState({ kind: "success" });
      setTimeout(() => router.push("/dashboard"), 600);
    }
  };

  React.useEffect(() => {
    if (token === undefined) return;
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

          {state.kind === "mfa" && (
            <form onSubmit={handleMfaSubmit}>
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-12 h-12 rounded-xl bg-brand-500 text-white grid place-items-center mx-auto mb-4 shadow-brand">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h1 className="text-xl font-semibold text-warm-950">
                  Подтвердите вход кодом
                </h1>
                <p className="text-sm text-warm-600 mt-2">
                  Введите шесть цифр из приложения-аутентификатора. Подойдёт и
                  резервный код, если телефон недоступен.
                </p>
              </div>

              <input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-label="Код подтверждения"
                data-testid="auth-callback-mfa-code"
                className="w-full px-4 py-3 rounded-xl border border-warm-200 text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:border-brand-500 mb-3"
              />

              {mfaError && (
                <div
                  className="rounded-xl bg-accent-50 border border-accent-200 px-4 py-3 text-sm text-accent-800 mb-3"
                  data-testid="auth-callback-mfa-error"
                >
                  {mfaError}
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                fullWidth
                disabled={mfaCode.length !== 6}
              >
                Войти
              </Button>

              <p className="mt-4 text-xs text-warm-500 text-center">
                Вход подтверждается кодом, потому что это админский раздел.
              </p>
            </form>
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
                Не получилось войти
              </h1>
              <p className="text-sm text-warm-600 mt-2">{state.message}</p>
              <p className="text-xs text-warm-500 mt-3">
                Ссылка для входа действует 15 минут и срабатывает один раз.
                Запросите новую — она придёт на ту же почту.
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
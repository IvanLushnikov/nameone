"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Mail, ArrowRight, Sparkles, Rocket, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { trackEvent } from "@/lib/track";
import { requestMagicLink, loginWithPassword, LOGIN_REFUSED_TEXT } from "@/lib/auth/api";
import { verifyLoginCode } from "@/lib/superpower-totp-api";
import type { AuthUser } from "@/lib/auth/api";
import { MAGIC_LINK_READY } from "@/lib/auth/magic-link-status";
import { PROFILE_CHANGED_EVENT } from "@/lib/events";
import { setProfile } from "@/lib/utils/storage";
import type { UserProfile } from "@/lib/types";
import { DEMO_USER_NAME, enterDemoMode, isDemoLoginEnabled } from "@/lib/dev/demo-login";

/** Правила пароля (ТЗ §7.1): длина 8…128, обязательны буква и цифра. */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/** Подпись под полем, пока учитель ничего не нарушил. */
const PASSWORD_HINT = "От 8 до 128 символов, нужна буква и цифра";

/**
 * Проверка пароля ДО запроса (ТЗ §12.7): показывает требование у поля и
 * никуда не отправляет.
 *
 * Буква — любая, включая русскую: ТЗ §7.1 прямо говорит про русскую раскладку,
 * поэтому `\p{L}`, а не `[a-z]`. Цифра — тоже любая (`\p{N}`).
 * Возвращает текст нарушения или null, если пароль годится.
 */
function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Минимум ${PASSWORD_MIN_LENGTH} символов`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Максимум ${PASSWORD_MAX_LENGTH} символов`;
  }
  if (!/\p{L}/u.test(password)) return "Нужна хотя бы одна буква";
  if (!/\p{N}/u.test(password)) return "Нужна хотя бы одна цифра";
  return null;
}


export default function LoginPage() {
  const { toast } = useToast();
  const router = useRouter();
  const demoEnabled = isDemoLoginEnabled();
  const [email, setEmail] = React.useState("");
  const [step, setStep] = React.useState<"email" | "sent">("email");
  const [loading, setLoading] = React.useState(false);
  // Два пути входа рядом (ТЗ §6). Переключатель ничего не спрашивает у бэка про
  // введённый адрес — иначе форма проверяла бы, зарегистрирован ли он.
  const [mode, setMode] = React.useState<"link" | "password">("link");
  const [password, setPassword] = React.useState("");
  /** Нарушение правил пароля — показываем у поля, запрос не уходит. */
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  /**
   * Второй шаг входа администратора (ТЗ-24 §8.1).
   *
   * Здесь и живёт экран с шестью цифрами: пароль уже проверен, но сессия ещё
   * не выдана. Отдельное состояние, а не «ещё один шаг» в общей машине, —
   * потому что у этого шага другая природа: код живёт 30 секунд, и счётчик
   * ошибок у него свой.
   */
  const [mfaPending, setMfaPending] = React.useState<string | null>(null);
  const [mfaCode, setMfaCode] = React.useState("");
  const [mfaError, setMfaError] = React.useState<string | null>(null);
  /** Отказ сервера или сети. Текст единственный — см. loginWithPassword. */
  const [loginError, setLoginError] = React.useState<string | null>(null);
  // С 01.09.2025 (156-ФЗ, ч. 4 ст. 9 152-ФЗ) согласие на обработку ПДн —
  // отдельный документ, а не строчка в оферте. Без явной отметки magic link
  // не отправляем: это и есть отправка ПДн за границу без согласия.
  const [consentPdn, setConsentPdn] = React.useState(false);

  React.useEffect(() => {
    trackEvent("login_view");
  }, []);

  /**
   * Профиль → событие для шапки → /dashboard. Тот же путь, что после входа по
   * ссылке из письма (AuthCallbackInner), чтобы оба способа давали одинаковое
   * состояние кабинета.
   */
  const openCabinet = (u: AuthUser) => {
    const profile: UserProfile = {
      id: u.id,
      email: u.email,
      name: u.name,
      plan: u.plan,
      generationsTotal: u.generationsTotal ?? 0,
      generationsToday: u.generationsToday ?? 0,
      // generationsLimit: -1 у base/plus трактуется как безлимит.
      generationsLimit: u.generationsLimit ?? (u.plan === "free" ? 3 : -1),
      createdAt: u.createdAt ?? new Date().toISOString(),
    };
    setProfile(profile);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
    }
    setPassword("");
    router.push("/dashboard");
  };

  const switchMode = (next: "link" | "password") => {
    setMode(next);
    // Старое сообщение относится к прошлому пути и только путает.
    setLoginError(null);
    setPasswordError(null);
  };

  /** Одно требование согласия на оба пути: текст зависит от выбранного пути. */
  const consentToast = () =>
    toast({
      title: "Нужно согласие на обработку данных",
      description:
        mode === "password"
          ? "Отметьте согласие на обработку персональных данных — без него мы не пустим в кабинет."
          : "Отметьте согласие на обработку персональных данных — без него мы не можем отправить ссылку на почту.",
      tone: "error",
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "password") {
      await submitPassword();
      return;
    }
    if (!email.includes("@")) {
      toast({
        title: "Проверьте адрес",
        description: "Похоже, в адресе опечатка — письмо туда не придёт.",
        tone: "error",
      });
      return;
    }
    if (!consentPdn) {
      consentToast();
      return;
    }
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

  /**
   * Вход по паролю (ТЗ §6).
   *
   * Порядок проверок: правила пароля → адрес → согласие. Первые две не уходят
   * в сеть, поэтому экран не может превратиться в способ проверить, заведён ли
   * этот адрес (ТЗ §3, разрыв 4).
   */
  const submitPassword = async () => {
    const problem = passwordProblem(password);
    if (problem) {
      setPasswordError(problem);
      return;
    }
    if (!email.includes("@")) {
      // Тот же единый отказ: адрес не дописан, и проверить его нечем.
      setLoginError(LOGIN_REFUSED_TEXT);
      return;
    }
    if (!consentPdn) {
      consentToast();
      return;
    }

    setPasswordError(null);
    setLoginError(null);
    setLoading(true);
    const emailDomain = email.split("@")[1] ?? "unknown";
    trackEvent("login_password_submit", { emailDomain });
    const result = await loginWithPassword(email, password);
    setLoading(false);

    if (result.ok) {
      // Пароль верен, но у администратора включён код подтверждения: второй шаг.
      if ("mfaRequired" in result && result.mfaRequired) {
        setMfaPending(result.pendingToken);
        setMfaCode("");
        setMfaError(null);
        return;
      }
      // Дальше по типу остаётся только ветка с пользователем: ветка с
      // mfaRequired выше уже вернулась.
      if (!("user" in result)) return;
      trackEvent("login_password_success", { emailDomain });
      openCabinet(result.user);
      return;
    }
    // Причина отказа в аналитику не пишется: текст единственный, разбирать
    // причины по нему бессмысленно, а в базе опаснее.
    trackEvent("login_password_failed", { emailDomain });
    setLoginError(result.error);
  };

  /**
   * Второй шаг: отправить код из приложения.
   *
   * На ошибке экран НЕ сбрасывается — человеку нужно просто ввести код заново,
   * стирать введённое было бы наказанием за опечатку. Сбрасывается только код.
   */
  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaPending || mfaCode.length !== 6) return;

    setLoading(true);
    setMfaError(null);
    const { data, error: err } = await verifyLoginCode(mfaCode, mfaPending);
    setLoading(false);

    if (err || !data) {
      setMfaError(err ?? "Код не подошёл");
      setMfaCode("");
      return;
    }

    // Сессия выдана сервером и лежит в cookie. Дальше кабинет открывается
    // обычным путём — как после обычного входа.
    setMfaPending(null);
    trackEvent("login_password_success", {});
    router.push("/dashboard");
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
        {step === "email" && mfaPending === null && (
          <>
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-xl bg-brand-500 text-white grid place-items-center mx-auto mb-4 shadow-brand">
                <Mail className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-semibold text-warm-950">Войти в УчЛист</h1>
              <p className="text-sm text-warm-500 mt-1">
                {MAGIC_LINK_READY
                  ? mode === "password"
                    ? "Введите почту и пароль — кабинет откроется сразу, письмо не понадобится."
                    : "Пришлём письмо со ссылкой — откроете её и войдёте в кабинет."
                  : "Кабинет сохраняет ваши листы, избранное и историю. Пока его можно начать без регистрации."}
              </p>
            </div>

            {MAGIC_LINK_READY ? (
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

                {/* Второй путь входа. Поле появляется только по выбору учителя и
                    не спрашивает у бэка, задан ли пароль у этой почты. */}
                {mode === "password" && (
                  <Input
                    label="Пароль"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Не короче 8 символов, буква и цифра"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    leftIcon={<Lock className="w-4 h-4" />}
                    hint={PASSWORD_HINT}
                    error={passwordError ?? undefined}
                    data-testid="login-password"
                    required
                  />
                )}

                {/* Согласие на обработку ПДн — отдельная форма, отдельный документ.
                    Не прячем в текст оферты: так требует ч. 4 ст. 9 152-ФЗ. */}
                <div className="rounded-xl border border-warm-200 bg-warm-50/60 p-3.5">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consentPdn}
                      onChange={(e) => setConsentPdn(e.target.checked)}
                      data-testid="login-consent-pdn"
                      className="w-5 h-5 mt-0.5 accent-brand-500 shrink-0"
                    />
                    <span className="text-sm text-warm-700">
                      Согласен на обработку персональных данных
                      <span className="block text-xs text-warm-600 mt-1">
                        {/* Формулировка общая для обоих путей: почта нужна и чтобы
                            получить ссылку, и чтобы войти по паролю. */}
                        Мы используем адрес электронной почты, чтобы войти
                        в кабинет и сохранить вашу историю генераций. Текст
                        согласия — отдельный документ,{" "}
                        <Link
                          href="/legal/consent"
                          className="text-brand-600 hover:text-brand-700 underline"
                        >
                          прочитать
                        </Link>
                        . Отозвать согласие можно в любой момент.
                      </span>
                    </span>
                  </label>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={loading}
                  disabled={!consentPdn}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                  data-testid="login-submit"
                >
                  {mode === "password"
                    ? "Войти по паролю"
                    : "Получить ссылку на почту"}
                </Button>

                {/* Отказ живёт под кнопкой, а не в тосте: учителю нужно ввести
                    пароль заново, а тост через четыре секунды исчезает. */}
                {mode === "password" && loginError && (
                  <p
                    role="alert"
                    data-testid="login-password-error"
                    className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3.5 py-3 text-sm text-rose-700"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{loginError}</span>
                  </p>
                )}
              </form>
            ) : (
              /* Входа по почте нет: домен для писем ещё не подтверждён (см.
                 lib/auth/magic-link-status.ts). Показываем честное объяснение
                 вместо формы, которая обещает несуществующее письмо. */
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-center">
                <p className="text-sm font-semibold text-warm-900">
                  Вход по ссылке из письма — пока недоступен
                </p>
                <p className="mt-1.5 text-sm text-warm-600">
                  Мы подтверждаем адрес, с которого отправляем письма. Это займёт
                  несколько дней. Листы можно создавать уже сейчас — регистрация для
                  этого не нужна.
                </p>
              </div>
            )}

            {/* Два пути входа рядом (ТЗ §6). Показывается только когда вход по
                ссылке включён: если письма не уходят, один из двух пунктов
                вёл бы в никуда. */}
            {MAGIC_LINK_READY && (
              <div className="mt-6 pt-6 border-t border-warm-100">
                <p className="mb-3 text-center text-xs uppercase tracking-wider text-[color:var(--text-muted)]">
                  Как войти
                </p>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Способ входа">
                  <button
                    type="button"
                    onClick={() => switchMode("link")}
                    aria-pressed={mode === "link"}
                    data-testid="login-mode-link"
                    className={cn(
                      "min-h-11 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      mode === "link"
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-warm-200 bg-white text-warm-600 hover:border-warm-300 hover:text-warm-900",
                    )}
                  >
                    Получить ссылку на почту
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("password")}
                    aria-pressed={mode === "password"}
                    data-testid="login-mode-password"
                    className={cn(
                      "min-h-11 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      mode === "password"
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-warm-200 bg-white text-warm-600 hover:border-warm-300 hover:text-warm-900",
                    )}
                  >
                    Войти по паролю
                  </button>
                </div>
                {mode === "password" && (
                  <p className="mt-2.5 text-center text-xs text-warm-500">
                    Забыли пароль? Выберите «Получить ссылку на почту» — письмо придёт на
                    эту почту.
                  </p>
                )}
              </div>
            )}

            <div className="my-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-warm-100" />
              <span className="text-xs uppercase tracking-wider text-[color:var(--text-muted)]">
                {MAGIC_LINK_READY ? "или войти через" : "скоро вход через"}
              </span>
              <div className="flex-1 h-px bg-warm-100" />
            </div>

            {/* Вход через соцсети ещё не подключён (нет OAuth-обработчиков и
                приложений). Кнопки оставлены как витрина, но с подписью
                «скоро» на самой кнопке: disabled без подписи выглядит как
                сломавшаяся кнопка, и человек жмёт по ней впустую. */}
            <div className="grid grid-cols-3 gap-2">
              {["VK", "Яндекс", "Telegram"].map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled
                  title={`${s} — вход пока не подключён`}
                  aria-label={`${s} — вход пока не подключён`}
                  className="flex flex-col items-center justify-center gap-0.5 h-16 rounded-xl border border-warm-200 bg-white text-sm font-medium text-[color:var(--text-muted)] cursor-not-allowed transition-colors"
                >
                  <span>{s}</span>
                  <span className="text-[10px] uppercase tracking-wide text-warm-400">
                    скоро
                  </span>
                </button>
              ))}
            </div>

            <p className="mt-6 text-xs text-warm-500 text-center">
              {MAGIC_LINK_READY ? "Оформляя вход" : "Используя сервис"}, вы
              принимаете{" "}              <Link href="/legal/offer" className="text-brand-600 hover:text-brand-700">
                публичную оферту
              </Link>{" "}
              и{" "}
              <Link href="/legal/privacy" className="text-brand-600 hover:text-brand-700">
                политику конфиденциальности
              </Link>
              . Согласие на обработку персональных данных даётся отдельной
              отметкой в форме входа — это самостоятельный документ, а не часть
              оферты.            </p>

            {/* Пока входа нет, это главное действие страницы — поэтому кнопка
                во всю ширину, а не мелкая ссылка внизу. */}
            {MAGIC_LINK_READY ? (
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
            ) : (
              <Button
                as="link"
                href="/constructor"
                variant="primary"
                size="lg"
                fullWidth
                leftIcon={<Sparkles className="w-4 h-4" />}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Создать лист без регистрации
              </Button>
            )}

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

        {/* Второй шаг входа администратора (ТЗ-24 §8.1). Показывается вместо
            формы пароля: пароль уже проверен, осталось подтвердить вход кодом. */}
        {mfaPending !== null && (
          <form onSubmit={handleMfaSubmit}>
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center mb-4">
                <Mail className="w-6 h-6 text-brand-600" />
              </div>
              <h1 className="text-xl font-semibold text-warm-900 mb-2">
                Подтвердите вход кодом
              </h1>
              <p className="text-warm-600 text-sm max-w-xs">
                Введите шесть цифр из приложения-аутентификатора. Подойдёт и резервный
                код, если телефон недоступен.
              </p>
            </div>

            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="Код подтверждения"
              className="w-full px-4 py-3 rounded-xl border border-warm-200 text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:border-brand-500 mb-3"
            />

            {mfaError && (
              <div className="rounded-xl bg-accent-50 border border-accent-200 px-4 py-3 text-sm text-accent-800 mb-3">
                {mfaError}
              </div>
            )}

            <Button type="submit" size="lg" fullWidth disabled={loading || mfaCode.length !== 6}>
              {loading ? "Проверяю…" : "Войти"}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMfaPending(null);
                setMfaCode("");
                setMfaError(null);
              }}
              className="mt-4 w-full text-sm text-warm-600 hover:text-warm-900"
            >
              Вернуться ко входу
            </button>
          </form>
        )}

        {step === "sent" && (
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-500 text-white grid place-items-center mx-auto mb-4">
              <Mail className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-semibold text-warm-950">Проверьте почту</h2>
            <p className="text-sm text-warm-600 mt-2">
              Отправили письмо на <strong>{email}</strong>. Откройте его и нажмите «Войти в УчЛист».
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
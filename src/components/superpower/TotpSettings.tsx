"use client";

import * as React from "react";
import {
  loadTotpState,
  startTotpSetup,
  confirmTotpSetup,
  regenerateBackupCodes,
  disableTotp,
  formatSecretForDisplay,
  type TotpState,
} from "@/lib/superpower-totp-api";
import { Panel } from "@/components/superpower/Primitives";

/**
 * Настройка кода подтверждения — внутри самой суперадминки.
 *
 * Решение владельца от 12.10.2026: код нужен только администратору, и он
 * настраивает его себе сам. Поэтому сценарий здесь и начинается с входа по
 * паролю — тем же, каким администратор уже вошёл на эту страницу.
 *
 * ШАГИ ПОКАЗЫВАЮТСЯ ПО ОДНОМУ
 * --------------------------
 * Ключ, потом подтверждение, потом резервные коды. Показать всё сразу — значит
 * человек уйдёт с ключом на руках и не подтвердит, а потом не вспомнит, что
 * настройка начата. Каждый шаг ждёт действия.
 *
 * РЕЗЕРВНЫЕ КОДЫ ПОКАЗЫВАЮТСЯ ОДИН РАЗ
 * ------------------------------------
 * После подтверждения и после каждого перевыпуска. В базе их нет — только
 * хеши. Об этом говорим прямо под списком, иначе человек решит, что сможет
 * посмотреть их в кабинете позже, и не сохранит.
 */
type Step = "idle" | "key" | "confirm" | "backup-codes";

export function TotpSettings() {
  const [state, setState] = React.useState<TotpState | null>(null);
  const [step, setStep] = React.useState<Step>("idle");
  const [secret, setSecret] = React.useState<string>("");
  const [code, setCode] = React.useState("");
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    loadTotpState().then(({ data, error: err }) => {
      if (err) setError(err);
      else if (data) setState(data);
    });
  }, []);

  const beginSetup = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await startTotpSetup();
    setBusy(false);
    if (err || !data) {
      setError(err ?? "Не удалось начать настройку");
      return;
    }
    setSecret(data.secret);
    setStep("key");
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await confirmTotpSetup(code);
    setBusy(false);
    if (err || !data) {
      setError(err ?? "Код не подошёл");
      return;
    }
    setBackupCodes(data.backupCodes);
    setStep("backup-codes");
    setCode("");
    const refreshed = await loadTotpState();
    if (refreshed.data) setState(refreshed.data);
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await regenerateBackupCodes();
    setBusy(false);
    if (err || !data) {
      setError(err ?? "Не удалось перевыпустить коды");
      return;
    }
    setBackupCodes(data.backupCodes);
    setStep("backup-codes");
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await disableTotp();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setState((prev) => (prev ? { ...prev, enabled: false, unusedBackupCodes: 0 } : prev));
    setStep("idle");
    setBackupCodes(null);
  };

  if (!state) {
    return (
      <Panel title="Код подтверждения">
        <div className="text-warm-500 py-4">{error ?? "Загружаю настройки…"}</div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Код подтверждения"
        hint="Второй шаг входа: пароль, а затем шесть цифр из приложения. Учителей это не касается."
      >
        {state.enabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-brand-700">
              <span aria-hidden="true">✓</span>
              <span className="font-medium">Включён</span>
            </div>
            <p className="text-sm text-warm-600">
              Неиспользованных резервных кодов: {state.unusedBackupCodes}. Они нужны,
              если телефон недоступен.
            </p>
            {state.unusedBackupCodes === 0 ? (
              <div className="rounded-xl bg-accent-50 border border-accent-200 p-3 text-sm text-accent-800">
                Резервные коды кончились. Перевыпустите их: без них потерянный
                телефон равен потере доступа.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={regenerate}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-warm-200 text-sm font-medium text-warm-700 hover:bg-warm-100 disabled:opacity-50"
              >
                Перевыпустить резервные коды
              </button>
              <button
                type="button"
                onClick={turnOff}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-accent-200 text-sm font-medium text-accent-700 hover:bg-accent-50 disabled:opacity-50"
              >
                Выключить код подтверждения
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-warm-600">
              Сейчас вход только по паролю. На экране с деньгами это единственный
              слой, кроме пароля.
            </p>
            {!state.encryptionConfigured ? (
              <div className="rounded-xl bg-accent-50 border border-accent-200 p-3 text-sm text-accent-800">
                На сервере не задан ключ шифрования, поэтому включить код
                подтверждения нельзя: секрет пришлось бы хранить открытым текстом.
                Задайте TOTP_ENCRYPTION_KEY на сервере.
              </div>
            ) : (
              <button
                type="button"
                onClick={beginSetup}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                Включить код подтверждения
              </button>
            )}
          </div>
        )}
      </Panel>

      {step === "key" ? (
        <Panel title="Шаг 1. Внесите ключ в приложение" hint="Приложение назовём любой, который показывает такие коды: Google Authenticator, 1Password и другие.">
          <ol className="space-y-2 text-sm text-warm-700 list-decimal list-inside mb-4">
            <li>Откройте в приложении добавление аккаунта.</li>
            <li>Выберите ввод ключа вручную.</li>
            <li>Вставьте ключ ниже.</li>
            <li>В приложении появится шестизначный код — введите его на следующем шаге.</li>
          </ol>
          <code className="block break-all rounded-xl bg-warm-100 border border-warm-200 p-3 text-sm font-mono">
            {formatSecretForDisplay(secret)}
          </code>
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
            >
              Ключ внесён, дальше
            </button>
          </div>
        </Panel>
      ) : null}

      {step === "confirm" ? (
        <Panel title="Шаг 2. Подтвердите кодом из приложения">
          <form onSubmit={confirm} className="max-w-xs">
            <label className="block text-sm text-warm-700 mb-1" htmlFor="totp-code">
              Шесть цифр из приложения
            </label>
            <input
              id="totp-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-full px-3 py-2.5 rounded-lg border border-warm-200 text-lg tracking-[0.3em] font-mono focus:outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="mt-3 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              Подтвердить
            </button>
          </form>
        </Panel>
      ) : null}

      {step === "backup-codes" && backupCodes ? (
        <Panel title="Резервные коды" hint="Сохраните сейчас — они показываются один раз.">
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {backupCodes.map((c) => (
              <li key={c} className="rounded-lg bg-warm-100 border border-warm-200 px-3 py-2">
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl bg-accent-50 border border-accent-200 p-3 text-sm text-accent-800">
            В базе хранится только зашифрованная копия: сами коды после этого
            экрана нигде не посмотреть. Перепишите их на бумагу или сохраните в
            менеджере паролей.
          </div>
          <button
            type="button"
            onClick={() => setStep("idle")}
            className="mt-4 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            Готово
          </button>
        </Panel>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-accent-50 border border-accent-200 p-3 text-sm text-accent-800">
          {error}
        </div>
      ) : null}
    </div>
  );
}
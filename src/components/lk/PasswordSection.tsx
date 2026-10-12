"use client";

/**
 * Карточка «Вход по паролю» (ТЗ-23, §5).
 *
 * Стоит между «Профилем» и «Устройствами» не по алфавиту, а по смыслу: учитель
 * пришёл закрыть доступ на чужом компьютере — пароль и список устройств это
 * один разговор про «кто ещё может зайти».
 *
 * Три состояния, ровно по ТЗ:
 *   * пароля нет → «Придумать пароль», два поля, кнопка;
 *   * пароль задан → дата, кнопки «Изменить» и «Убрать пароль»;
 *   * кабинет без аккаунта (`source === "device"`) → честное объяснение и
 *     ссылка на вход. Форму в этом состоянии не показываем: аккаунта на
 *     сервере нет, сохранять некуда, и форма «которая всё равно не сохранится»
 *     была бы враньём.
 *
 * Пароль — дополнение, а не замена: вход по ссылке из письма продолжает
 * работать всегда, и карточка говорит об этом прямо.
 */

import * as React from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/utils/cn";
import {
  removePassword,
  setPassword,
  type ProfileApiError,
  type TeacherProfileView,
} from "@/lib/lk/profile-api";

interface Props {
  view: TeacherProfileView;
  onChange: (view: TeacherProfileView) => void;
  /**
   * Пока сервер не ответил, источник данных ещё неизвестен: экран сначала
   * показывает устройство и только потом узнаёт, вошёл ли учитель. Без этого
   * карточка на секунду сказала бы «войдите по почте» тому, кто уже вошёл.
   */
  ready: boolean;
}

/** Правила пароля из ТЗ §7.1: 8…128 символов, минимум одна буква и одна цифра. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const PASSWORD_RULES = `От ${PASSWORD_MIN} до ${PASSWORD_MAX} символов, нужна хотя бы одна буква и одна цифра.`;

export function PasswordSection({ view, onChange, ready }: Props) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const hasPassword = view.hasPassword;

  const save = async (input: { password: string; currentPassword?: string }) => {
    setBusy(true);
    try {
      const res = await setPassword(input);
      if (!res.ok) {
        // Подсвечивать поле «Сейчас пароль» нельзя: 401 приходит и на неверный
        // старый пароль, и на истёкший вход, а различать их учителю нельзя
        // (контракт §5). Поэтому один текст и без намёка, какое поле виновато.
        toast({ tone: "error", title: saveErrorText(res.error) });
        return;
      }
      // Дату берём из ответа сервера; если её нет — карточка не покажет дату,
      // но покажет «Пароль задан». Выдумывать сегодняшнее число нельзя.
      onChange({ ...view, hasPassword: true, passwordSetAt: res.setAt });
      setEditing(false);
      toast({
        tone: "success",
        title: "Пароль сохранён",
        description: "Теперь на этот компьютер можно зайти по паролю, не дожидаясь письма.",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await removePassword();
      if (!res.ok) {
        toast({ tone: "error", title: removeErrorText(res.error) });
        return;
      }
      onChange({ ...view, hasPassword: false, passwordSetAt: null });
      setRemoving(false);
      toast({
        tone: "info",
        title: "Пароль убран",
        description: "Вход по ссылке из письма работает как раньше.",
      });
    } finally {
      setBusy(false);
    }
  };

  const setAt = formatSetAt(view.passwordSetAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Вход по паролю</CardTitle>
        <CardDescription>
          Второй способ войти, когда письма под рукой нет: например, на компьютере в
          учительской. Пароль дополняет вход по ссылке из письма, а не заменяет его.
        </CardDescription>
      </CardHeader>

      {!ready ? (
        <p className="text-sm text-warm-600" aria-busy>
          Проверяем, задан ли пароль…
        </p>
      ) : view.source !== "account" ? (
        <div className="flex gap-3">
          <div className="w-11 h-11 rounded-xl bg-warm-50 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-warm-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warm-950">
              Пароль появится, когда вы войдёте по почте
            </p>
            <p className="text-sm text-warm-600 mt-1">
              Сейчас кабинет работает без аккаунта, а пароль живёт только на сервере —
              сохранить его здесь некуда. Остальные настройки от этого не перестают
              работать: они хранятся на этом устройстве.
            </p>
            <Button as="link" href="/login" variant="secondary" size="sm" className="mt-3">
              Войти по почте
            </Button>
          </div>
        </div>
      ) : hasPassword && !editing ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-brand-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-warm-950">
                {setAt ? `Пароль задан ${setAt}` : "Пароль задан"}
              </p>
              <p className="text-xs text-warm-500">
                {setAt
                  ? "Вход по ссылке из письма продолжает работать."
                  : "Дату установки сервер не прислал — она появится после перезагрузки страницы."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={busy}>
                Изменить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRemoving((v) => !v)}
                leftIcon={<Trash2 className="w-4 h-4" />}
                aria-expanded={removing}
              >
                Убрать пароль
              </Button>
            </div>
          </div>

          {removing ? (
            <div className="mt-4 rounded-xl border border-warm-200 p-4 space-y-3">
              <p className="text-sm text-warm-800">
                После удаления вход по паролю перестанет работать. Останется вход по ссылке
                из письма — тот, который работает и сейчас.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void remove()}
                  loading={busy}
                >
                  Убрать пароль
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRemoving(false)} disabled={busy}>
                  Оставить
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <PasswordForm
          key={hasPassword ? "change" : "create"}
          mode={hasPassword ? "change" : "create"}
          busy={busy}
          onSubmit={save}
          onCancel={hasPassword ? () => setEditing(false) : undefined}
        />
      )}
    </Card>
  );
}

/**
 * Форма. `create` — два поля (пароль и повтор), `change` — три: к старым двум
 * добавляется текущий пароль, без которого смена невозможна (ТЗ §5).
 */
function PasswordForm({
  mode,
  busy,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "change";
  busy: boolean;
  onSubmit: (input: { password: string; currentPassword?: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = React.useState("");
  const [password, setPasswordValue] = React.useState("");
  const [repeat, setRepeat] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  const problem = passwordProblem(password);
  const mismatch = password !== repeat;
  const emptyPassword = !password;

  // Требования всплывают у поля, когда учитель от него ушёл или нажал кнопку:
  // раньше времени подсвечивать пустое поле — просто шум. Пустой пароль — тоже
  // требование, просто другое, и о нём тоже надо сказать.
  const passwordError = tried
    ? emptyPassword
      ? "Введите пароль"
      : problem
    : touched.password
      ? problem
      : null;
  const repeatError = (tried || touched.repeat) && mismatch ? "Пароли не совпадают" : null;
  const currentError = tried && !current ? "Введите текущий пароль" : null;

  const submit = async () => {
    setTried(true);
    // Правила проверяются ДО запроса: короткий пароль подсвечивается у поля,
    // и на сервер ничего не уходит (ТЗ §12.7). Пустой пароль — тоже: без этой
    // проверки запрос ушёл бы с паролем "", и учитель получил бы отказ,
    // которого сам не мог предвидеть.
    if (emptyPassword || problem || mismatch || (mode === "change" && !current)) return;
    await onSubmit({ password, currentPassword: mode === "change" ? current : undefined });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-warm-950">
          {mode === "create" ? "Придумать пароль" : "Новый пароль"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisible((v) => !v)}
          leftIcon={visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        >
          {visible ? "Скрыть" : "Показать"}
        </Button>
      </div>

      {mode === "change" ? (
        <Input
          id="lk-password-current"
          type={visible ? "text" : "password"}
          label="Сейчас пароль"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, current: true }))}
          autoComplete="current-password"
          maxLength={PASSWORD_MAX}
          hint="Нужен, чтобы подтвердить, что это вы. Без него пароль на чужом компьютере сменил бы кто угодно."
          error={currentError ?? undefined}
        />
      ) : null}

      <Input
        id="lk-password-new"
        type={visible ? "text" : "password"}
        label={mode === "create" ? "Пароль" : "Новый пароль"}
        value={password}
        onChange={(e) => setPasswordValue(e.target.value)}
        onBlur={() => setTouched((t) => ({ ...t, password: true }))}
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        hint={PASSWORD_RULES}
        error={passwordError ?? undefined}
      />

      <Input
        id="lk-password-repeat"
        type={visible ? "text" : "password"}
        label="Повторите пароль"
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
        onBlur={() => setTouched((t) => ({ ...t, repeat: true }))}
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        hint="Повторяйте, чтобы не опечататься: забытый пароль придётся убрать и задать заново."
        error={repeatError ?? undefined}
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void submit()} loading={busy}>
          {mode === "create" ? "Сохранить пароль" : "Сменить пароль"}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Правила пароля до отправки. Пустое поле — не ошибка: пока учитель не нажал
 * кнопку, подсказка про требования и есть вся помощь.
 *
 * Буквы и цифры ловим по Unicode: учитель набирает на русской раскладке, и
 * требование «буква» не должно превращаться в «латинская буква». Итоговое
 * решение всё равно остаётся за сервером — его отказ показывается честно.
 */
function passwordProblem(value: string): string | null {
  if (!value) return null;
  if (value.length < PASSWORD_MIN) return `Минимум ${PASSWORD_MIN} символов`;
  if (value.length > PASSWORD_MAX) return `Максимум ${PASSWORD_MAX} символов`;
  if (!/\p{L}/u.test(value)) return "Нужна хотя бы одна буква";
  if (!/\p{Nd}/u.test(value)) return "Нужна хотя бы одна цифра";
  return null;
}

/** Дата установки — только если сервер прислал разбираемую. Иначе не показываем. */
function formatSetAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date);
}

/**
 * Один текст на оба случая 401 — «не тот старый пароль» и «вход истёк».
 * Разные слова означали бы разную подсказку по устройству (контракт §5).
 */
function saveErrorText(error: ProfileApiError): string {
  switch (error) {
    case "unauthorized":
      return "Старый пароль не подошёл или вход истёк — войдите заново и повторите";
    case "rate_limited":
      return "Слишком много попыток. Подождите и повторите";
    case "network":
      return "Нет связи с сервером — пароль не сохранён";
    case "validation":
      return "Сервер не принял пароль — проверьте требования";
    default:
      return "Не удалось сохранить пароль";
  }
}

function removeErrorText(error: ProfileApiError): string {
  switch (error) {
    case "unauthorized":
      return "Вход истёк — войдите заново, чтобы убрать пароль";
    case "rate_limited":
      return "Слишком много попыток. Подождите и повторите";
    case "network":
      return "Нет связи с сервером — пароль не убран";
    default:
      return "Не удалось убрать пароль";
  }
}
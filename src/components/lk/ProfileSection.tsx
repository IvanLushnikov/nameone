"use client";

/**
 * Настройки профиля: имя и почта (ТЗ-21, блок 5).
 *
 * Два принципа, из которых построен экран:
 *
 * 1. **АНОНИМ — ПОЛНОПРАВНЫЙ.** Экран не начинается с «войдите». Без аккаунта
 *    имя и почта сохраняются на устройстве и работают ровно так же; меняется
 *    только честная подпись «хранится на этом устройстве».
 *
 * 2. **ПОЧТА МЕНЯЕТСЯ ТОЛЬКО ЧЕРЕЗ НОВЫЙ АДРЕС.** Ни одна кнопка в этом файле
 *    не меняет почту сразу. Запрос уходит на новый адрес, и менять её дальше
 *    можно только по ссылке из письма. Если письмо отправить нечем (домен не
 *    подтверждён — сейчас именно так), интерфейс говорит об этом прямо и НЕ
 *    показывает «письмо отправлено»: обещать письмо, которого не будет, хуже
 *    явного отказа.
 */

import * as React from "react";
import { Mail, ShieldCheck, User } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import {
  saveLocalProfile,
  patchServerProfile,
  requestEmailChange,
  confirmEmailChange,
  cancelEmailChangeRequest,
  type TeacherProfileView,
} from "@/lib/lk/profile-api";

interface Props {
  view: TeacherProfileView;
  onChange: (view: TeacherProfileView) => void;
  /** id запроса смены почты из ссылки в письме (?email_confirm=…). */
  emailConfirmId?: string | null;
}

export function ProfileSection({ view, onChange, emailConfirmId }: Props) {
  const { toast } = useToast();
  const [name, setName] = React.useState(view.name);
  const [saving, setSaving] = React.useState(false);

  const isServer = view.source === "account";

  // Имя подставляем заново, когда источник сменился (учитель вошёл).
  React.useEffect(() => {
    setName(view.name);
  }, [view.name, view.source]);

  const saveName = async () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) {
      toast({ tone: "error", title: "Имя не может быть пустым" });
      return;
    }
    if (clean === view.name) return;

    setSaving(true);
    try {
      if (isServer) {
        const res = await patchServerProfile({ name: clean });
        if (!res.ok) {
          toast({ tone: "error", title: errorTitle(res.error) });
          return;
        }
        onChange({ ...view, name: res.profile.name });
        toast({ tone: "success", title: "Имя сохранено" });
      } else {
        const local = saveLocalProfile({ name: clean });
        onChange(local);
        toast({ tone: "success", title: "Имя сохранено на этом устройстве" });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Профиль</CardTitle>
        <CardDescription>
          {isServer
            ? "Имя и почта хранятся в аккаунте и видны на любом устройстве."
            : "Хранится на этом устройстве. Это полноценные настройки — просто без переноса между устройствами."}
        </CardDescription>
      </CardHeader>

      <div className="space-y-5">
        <div>
          <label htmlFor="lk-name" className="block mb-1.5 text-sm font-medium text-warm-700">
            Как вас зовут
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="lk-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, Иван Лушников"
              className="flex-1 min-w-[220px]"
              maxLength={120}
            />
            <Button variant="primary" onClick={saveName} loading={saving} disabled={!name.trim()}>
              Сохранить
            </Button>
          </div>
        </div>

        <div className="pt-2 border-t border-warm-100">
          <EmailRow view={view} onChange={onChange} emailConfirmId={emailConfirmId} />
        </div>
      </div>
    </Card>
  );
}

function EmailRow({
  view,
  onChange,
  emailConfirmId,
}: {
  view: TeacherProfileView;
  onChange: (view: TeacherProfileView) => void;
  emailConfirmId?: string | null;
}) {
  const [editing, setEditing] = React.useState(false);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
          <Mail className="w-5 h-5 text-brand-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-warm-500">Почта для входа</span>
            {view.source === "account" ? (
              <Badge tone="brand">в аккаунте</Badge>
            ) : (
              <Badge tone="warm">только на этом устройстве</Badge>
            )}
          </div>
          <p className="font-medium text-warm-950 truncate">
            {view.email || "не указана"}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setEditing((v) => !v)}
          disabled={view.source !== "account"}
          title={
            view.source === "account"
              ? undefined
              : "Смена почты появится, когда появится аккаунт"
          }
        >
          Сменить почту
        </Button>
      </div>

      {view.source !== "account" ? (
        <p className="mt-2 text-sm text-warm-600">
          Без аккаунта почту подтвердить некому и некому её проверять — поэтому она просто
          хранится здесь. Остальные настройки работают как обычно.
        </p>
      ) : null}

      {view.pendingEmailChange ? (
        <PendingEmailChange
          view={view}
          onChange={onChange}
          confirmId={emailConfirmId ?? null}
        />
      ) : null}

      {editing && view.source === "account" ? (
        <EmailChangeForm
          onRequested={(newEmail, expiresAtSec) => {
            setEditing(false);
            onChange({
              ...view,
              pendingEmailChange: {
                newEmail,
                createdAt: Math.floor(Date.now() / 1000),
                expiresAt: expiresAtSec,
              },
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** Незавершённый запрос: либо учитель открыл ссылку из письма, либо ждёт. */
function PendingEmailChange({
  view,
  onChange,
  confirmId,
}: {
  view: TeacherProfileView;
  onChange: (view: TeacherProfileView) => void;
  confirmId: string | null;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const pending = view.pendingEmailChange!;

  const apply = async () => {
    if (!confirmId) return;
    setBusy(true);
    try {
      const res = await confirmEmailChange(confirmId);
      if (!res.ok) {
        toast({ tone: "error", title: "Ссылка не сработала" });
        return;
      }
      // Зеркалим новую почту в локальный профиль: кабинет на этом устройстве
      // должен показывать ту же почту, что и в аккаунте.
      saveLocalProfile({ email: res.email });
      onChange({ ...view, email: res.email, pendingEmailChange: null, source: "account" });
      toast({ tone: "success", title: "Почта изменена", description: res.email });
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    setBusy(true);
    try {
      const res = await cancelEmailChangeRequest();
      if (res.ok) {
        onChange({ ...view, pendingEmailChange: null });
        toast({ tone: "info", title: "Запрос отменён" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-4 space-y-3">
      <div className="flex gap-2">
        <ShieldCheck className="w-4 h-4 text-brand-700 shrink-0 mt-0.5" />
        <div className="text-sm text-warm-800 space-y-1">
          <p>
            Запрошена смена почты на <b>{pending.newEmail}</b>. Пока вы не подтвердите её по
            ссылке из письма, вход остаётся на старом адресе.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {confirmId ? (
          <Button variant="primary" size="sm" onClick={apply} loading={busy}>
            Подтвердить смену
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={drop} disabled={busy}>
          Отменить запрос
        </Button>
      </div>
      {!confirmId ? (
        <p className="text-xs text-warm-600">
          Откройте письмо, которое пришло на {pending.newEmail}, и перейдите по ссылке в нём.
        </p>
      ) : null}
    </div>
  );
}

function EmailChangeForm({
  onRequested,
}: {
  /** Вызывается только когда сервер РЕАЛЬНО принял письмо. */
  onRequested: (newEmail: string, expiresAtSeconds: number) => void;
}) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState<string | null>(null);

  const submit = async () => {
    const email = value.trim();
    if (!email) return;
    setBusy(true);
    setUnavailable(null);
    try {
      const res = await requestEmailChange(email);
      if (!res.ok) {
        if (res.error === "email_unavailable") {
          // Честная причина вместо фразы «мы отправили письмо».
          setUnavailable(
            "Сейчас мы не можем отправить письмо для подтверждения: почтовый адрес ещё не подтверждён у почтового сервиса. Почта не изменена — попробуйте позже.",
          );
          return;
        }
        setUnavailable(
          res.error === "conflict"
            ? "На этот адрес уже есть аккаунт."
            : "Не удалось отправить письмо. Почта не изменена.",
        );
        return;
      }
      setValue("");
      onRequested(res.newEmail, res.expiresAt);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-warm-200 p-4 space-y-3">
      <div>
        <label htmlFor="lk-email-new" className="block mb-1.5 text-sm font-medium text-warm-700">
          Новый адрес
        </label>
        <Input
          id="lk-email-new"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="teacher@example.ru"
          hint="Письмо с подтверждением придёт на новый адрес. Старая почта перестанет работать только после подтверждения."
        />
      </div>
      {unavailable ? (
        <p className="text-sm text-warm-700 bg-warm-50 border border-warm-200 rounded-lg p-3">
          {unavailable}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={submit} loading={busy} disabled={!value.trim()}>
          Отправить письмо
        </Button>
      </div>
    </div>
  );
}

function errorTitle(error: string): string {
  switch (error) {
    case "network":
      return "Нет связи с сервером — попробуйте ещё раз";
    case "unauthorized":
      return "Вход истёк, войдите заново";
    case "validation":
      return "Проверьте введённое значение";
    default:
      return "Не удалось сохранить";
  }
}

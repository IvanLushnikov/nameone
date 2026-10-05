"use client";

/**
 * Активные устройства и завершение сессий (ТЗ-21, блок 5).
 *
 * Закрывает две дырки из ревью: нельзя было посмотреть, где ещё есть вход, и
 * нельзя было выйти на чужом устройстве, не заходя на это устройство.
 *
 * Без аккаунта блок не показывается целиком — и это ЕДИНСТВЕННОЕ место, где
 * «войдите» уместно: устройств на сервере нет физически, врать про них нельзя.
 * Всё остальное (имя, классы, подписка) работает и без входа.
 *
 * Токены сессий намеренно не отдаются: клиент получает короткий суффикс,
 * которого недостаточно для входа (см. backend/src/services/account.ts).
 */

import * as React from "react";
import { Laptop, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { formatDate, timeAgo } from "@/lib/utils/cn";
import {
  listServerSessions,
  revokeOtherServerSessions,
  revokeServerSession,
  type ServerSession,
} from "@/lib/lk/profile-api";

interface Props {
  /** Есть ли аккаунт. Без него раздел не рисуется. */
  hasAccount: boolean;
}

export function SessionsSection({ hasAccount }: Props) {
  const { toast } = useToast();
  const [sessions, setSessions] = React.useState<ServerSession[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    const res = await listServerSessions();
    if (!res.ok) {
      setSessions([]);
      setError(
        res.error === "unauthorized"
          ? "Вход истёк — войдите заново, чтобы увидеть устройства."
          : "Не удалось загрузить список устройств.",
      );
      return;
    }
    setSessions(res.sessions);
  }, []);

  React.useEffect(() => {
    if (!hasAccount) return;
    void load();
  }, [hasAccount, load]);

  if (!hasAccount) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Устройства</CardTitle>
          <CardDescription>
            Список устройств, где вы вошли, появится вместе с аккаунтом. Настройки профиля и
            классы от этого не перестают работать — они хранятся на этом устройстве.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      const res = await revokeServerSession(id);
      if (!res.ok) {
        toast({ tone: "error", title: "Не удалось завершить сессию" });
        return;
      }
      setSessions((list) => (list ?? []).filter((s) => s.id !== id));
      toast({ tone: "info", title: "Сессия завершена" });
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    setBusyId("__all__");
    try {
      const res = await revokeOtherServerSessions();
      if (!res.ok) {
        toast({ tone: "error", title: "Не удалось завершить остальные сессии" });
        return;
      }
      setSessions((list) => (list ?? []).filter((s) => s.current));
      toast({
        tone: "success",
        title:
          res.revoked > 0
            ? `Завершено сессий: ${res.revoked}`
            : "Других активных сессий не было",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Устройства</CardTitle>
        <CardDescription>
          Где ещё есть вход в ваш аккаунт. Любую сессию можно завершить отсюда — на том
          устройстве придётся войти заново.
        </CardDescription>
      </CardHeader>

      {error ? (
        <div className="rounded-xl border border-warm-200 bg-warm-50 p-4 space-y-3">
          <p className="text-sm text-warm-700">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Попробовать ещё раз
          </Button>
        </div>
      ) : sessions === null ? (
        <div className="space-y-2" aria-busy>
          <div className="h-14 rounded-xl bg-warm-100 animate-pulse" />
          <div className="h-14 rounded-xl bg-warm-100 animate-pulse" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-warm-600">
          Активных сессий не найдено. Если вход был, но список пуст — обновите страницу.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-warm-200 p-3"
            >
              <div className="w-10 h-10 rounded-xl bg-warm-50 flex items-center justify-center shrink-0">
                {s.current ? (
                  <Laptop className="w-5 h-5 text-brand-600" />
                ) : (
                  <Smartphone className="w-5 h-5 text-warm-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-warm-950">
                    {s.current ? "Текущее устройство" : "Другое устройство"}
                  </span>
                  {s.current ? <Badge tone="brand">здесь</Badge> : null}
                </div>
                <p className="text-xs text-warm-500">
                  Вход {timeAgo(new Date(s.createdAt * 1000))} · действует до{" "}
                  {formatDate(new Date(s.expiresAt * 1000))}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void revoke(s.id)}
                loading={busyId === s.id}
              >
                Завершить
              </Button>
            </li>
          ))}
        </ul>
      )}

      {sessions && sessions.filter((s) => !s.current).length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void revokeOthers()}
            loading={busyId === "__all__"}
          >
            <LogOut className="w-4 h-4" />
            Выйти на всех остальных устройствах
          </Button>
          <span className="inline-flex items-center gap-1.5 text-xs text-warm-500">
            <ShieldCheck className="w-3.5 h-3.5" />
            Здесь вы останетесь в системе
          </span>
        </div>
      ) : null}
    </Card>
  );
}

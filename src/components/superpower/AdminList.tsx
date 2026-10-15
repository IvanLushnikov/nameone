/**
 * Кто может заходить в суперадминку.
 *
 * ЗАЧЕМ ЭТОТ БЛОК (15.10.2026)
 * ----------------------------
 * Права администратора выдавались один раз — в момент первой регистрации, если
 * адрес совпал со списком ADMIN_EMAILS на сервере — и держались навсегда. Снять
 * их было нечем: снять можно было только правкой базы руками. Практический
 * случай: адрес из списка освободился, его занял другой человек и зарегистрировался
 * — и получил доступ ко всей финансовой информации. И заметить это было негде:
 * список прав никто не показывал.
 *
 * ЧТО ЗДЕСЬ ВИДНО
 * --------------
 * 1. Все аккаунты с правами администратора.
 * 2. У каждого — включён ли код подтверждения. Без него ссылка из письма сама по
 *    себе пускает в суперадминку, поэтому «нет кода» — это не мелочь, а половина
 *    защиты.
 * 3. Кнопка «Снять права» у чужого аккаунта. У своего — её нет и быть не может:
 *    снявший с себя права администратор теряет доступ к разделу навсегда.
 *
 * ПОЧЕМУ НЕТ КНОПКИ «ПОЧИСТИТЬ МУСОР»
 * ----------------------------------
 * Список показывает только тех, у кого права есть. Остальные 27 аккаунтов в
 * пересчёт не идут: список прав — это про безопасность, а не про гигиену базы.
 */

"use client";

import * as React from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Panel, Loading } from "@/components/superpower/Primitives";
import { loadAdmins, setAdminRights, type AdminUser } from "@/lib/superpower-admins-api";

export function AdminList() {
  const [admins, setAdmins] = React.useState<AdminUser[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const { data, error: err } = await loadAdmins();
    if (err) setError(err);
    else if (data) setAdmins(data.admins);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (user: AdminUser) => {
    setBusyId(user.id);
    setError(null);
    const { data, error: err } = await setAdminRights(user.id, false);
    setBusyId(null);
    if (err || !data) {
      setError(err ?? "Не удалось снять права");
      return;
    }
    // Права сняты — перечитываем список, чтобы человек увидел результат.
    await refresh();
  };

  if (!admins && !error) return <Loading />;
  if (!admins) {
    // Свою ошибку показываем текстом: LoadError различает четыре вида сбоя
    // сети, а здесь нужен ответ сервера по-русски — «связались, но он отказал».
    return (
      <Panel title="Кто может заходить в суперадминку">
        <div className="rounded-xl bg-accent-50 border border-accent-200 px-4 py-3 text-sm text-accent-800">
          {error}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Кто может заходить в суперадминку"
      hint="Права выдаются при первой регистрации и держатся, пока их не снимут здесь."
    >
      <div className="space-y-3">
        {admins.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warm-200 px-4 py-3"
            data-testid={`admin-row-${a.id}`}
          >
            <div className="min-w-0">
              <div className="font-medium text-warm-900 truncate">
                {a.email}
                {a.isSelf && <span className="ml-2 text-warm-500 text-sm">это вы</span>}
              </div>
              <div className="text-sm text-warm-600 flex items-center gap-1 mt-0.5">
                {a.totpEnabled ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Код подтверждения включён
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4 text-accent-600" />
                    Код подтверждения не включён — вход по ссылке из письма открывает
                    суперадминку сразу
                  </>
                )}
              </div>
            </div>

            {a.isSelf ? (
              <span className="text-sm text-warm-500">
                Свои права снять нельзя
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void revoke(a)}
                disabled={busyId === a.id}
                className="text-sm font-medium text-accent-700 hover:text-accent-800 disabled:opacity-50"
                data-testid={`revoke-${a.id}`}
              >
                {busyId === a.id ? "Снимаю…" : "Снять права"}
              </button>
            )}
          </div>
        ))}

        {error && (
          <div className="rounded-xl bg-accent-50 border border-accent-200 px-4 py-3 text-sm text-accent-800">
            {error}
          </div>
        )}
      </div>
    </Panel>
  );
}

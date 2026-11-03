/**
 * Согласия на экране входа: контракт с бэком `/api/auth/*`.
 *
 * Версии документов живут в `site.ts` (и зеркально в backend/src/lib/consents.ts).
 * Клиент передаёт только флаги; номер версии подставляет сервер из своих
 * констант — иначе подделанный клиент мог бы «согласиться» со старой редакцией.
 */

export interface AuthConsentsPayload {
  /** Акцепт публичной оферты — обязателен. */
  offer: true;
  /** Согласие на обработку ПДн — обязательно. */
  pdn: true;
  /** Реклама (38-ФЗ): необязательно, default false; отказ тоже уходит на бэк. */
  marketing: boolean;
}

/** Ключ sessionStorage: перенос согласий с /login на /auth/callback. */
export const PENDING_CONSENTS_KEY = "uchlist.pendingConsents";

/** Собрать тело для API: оферта и ПДн всегда true, marketing — как отметил учитель. */
export function buildAuthConsents(marketing: boolean): AuthConsentsPayload {
  return { offer: true, pdn: true, marketing };
}

/** Сохранить согласия перед уходом на письмо — callback прочитает и отправит. */
export function stashPendingConsents(consents: AuthConsentsPayload): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_CONSENTS_KEY, JSON.stringify(consents));
  } catch {
    /* private mode / quota — callback ответит 400, учитель запросит ссылку снова */
  }
}

/** Прочитать и (по желанию) снять отложенные согласия после verifyMagicLink. */
export function readPendingConsents(opts?: {
  clear?: boolean;
}): AuthConsentsPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_CONSENTS_KEY);
    if (!raw) return null;
    if (opts?.clear) sessionStorage.removeItem(PENDING_CONSENTS_KEY);
    const parsed = JSON.parse(raw) as Partial<AuthConsentsPayload>;
    if (parsed.offer !== true || parsed.pdn !== true) return null;
    return {
      offer: true,
      pdn: true,
      marketing: Boolean(parsed.marketing),
    };
  } catch {
    return null;
  }
}

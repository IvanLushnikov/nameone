/**
 * Клиент управления правами администратора (ТЗ-24 §8, добавлено 15.10.2026).
 *
 * Отдельный файл от `superpower-totp-api.ts`: там человек настраивает код
 * подтверждения себе, здесь — решает, кто ещё может заходить в суперадминку.
 * Действия разные и последствия разные, поэтому и файлы разные.
 *
 * Что показываем и зачем: у каждого аккаунта с правами администратора видно,
 * включён ли код подтверждения. Без него вход по ссылке из письма даёт полный
 * доступ — раньше это было известно только тем, кто копается в базе.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ data: T | null; error: string | null }> {
  if (!API_URL) return { data: null, error: "Адрес бэкенда не задан" };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message = typeof json.error === "string" ? json.error : `Ошибка ${res.status}`;
      return { data: null, error: message };
    }
    return { data: json as T, error: null };
  } catch {
    return { data: null, error: "Не удалось связаться с сервером" };
  }
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  /** Включён ли код подтверждения. */
  totpEnabled: boolean;
  createdAt: string;
  /** Это текущий аккаунт — свои права снять нельзя. */
  isSelf: boolean;
}

export const loadAdmins = () => request<{ ok: true; admins: AdminUser[] }>("/api/admin/admins");

export const setAdminRights = (userId: string, isAdmin: boolean) =>
  request<{ ok: true; userId: string; isAdmin: boolean }>("/api/admin/admins", {
    method: "POST",
    body: { userId, isAdmin },
  });

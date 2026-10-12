/**
 * Клиент кода подтверждения администратора (ТЗ-24 §8.1).
 *
 * Отдельный файл от `superpower-api.ts` намеренно: там читают цифры, здесь
 * меняют настройку безопасности. Смешивать «посмотреть» и «перенастроить» в
 * одном клиенте не стоит — у них разные последствия при ошибке.
 *
 * КАК ЭТО ВЫГЛЯДИТ ДЛЯ ПОЛЬЗОВАТЕЛЯ
 * --------------------------------
 *   1. Закрыл суперадминку, тот же вход по паролю — так настройку и делаем.
 *   2. Нажал «Включить код подтверждения» — получил ключ (base32).
 *   3. Внёс ключ в приложение-аутентификатор.
 *   4. Ввёл код из приложения — настройка подтверждена, выданы резервные коды.
 *   5. Резервные коды сохранил. Показаны один раз и больше не показываются.
 *
 * ПОЧЕМУ НЕ QR-КОД, А ТЕКСТОВЫЙ КЛЮЧ
 * -----------------------------------
 * Ключ вставляется вручную. Пакет для отрисовки QR на фронте — отдельная
 * зависимость ради одного словаря, который на листе ТЗ-24 приведён словами
 * «отсканировал код»; текстовый ключ работает на любом устройстве и грузится
 * без ничего.
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

export interface TotpState {
  enabled: boolean;
  unusedBackupCodes: number;
  encryptionConfigured: boolean;
}

export const loadTotpState = () =>
  request<{ ok: true } & TotpState>("/api/admin/totp");

export const startTotpSetup = () =>
  request<{ ok: true; secret: string; next: string }>("/api/admin/totp/setup", {
    method: "POST",
  });

export const confirmTotpSetup = (code: string) =>
  request<{ ok: true; backupCodes: string[]; warning: string }>("/api/admin/totp/confirm", {
    method: "POST",
    body: { code },
  });

export const regenerateBackupCodes = () =>
  request<{ ok: true; backupCodes: string[]; warning: string }>(
    "/api/admin/totp/backup-codes",
    { method: "POST" },
  );

export const disableTotp = () =>
  request<{ ok: true; enabled: false }>("/api/admin/totp", { method: "DELETE" });

/** Второй шаг входа: проверка кода и получение сессии. */
export const verifyLoginCode = (code: string, pendingToken: string) =>
  request<{ ok: true; method: "totp" | "backup"; token: string }>(
    "/api/admin/totp/verify",
    { method: "POST", body: { code, pendingToken } },
  );

/**
 * Ключ для ручного ввода в приложение — четырьмя группами по четыре.
 * Приложение принимает ключ и со строчными, и без дефисов; с дефисами
 * человек не перепутает, на каком символе остановился.
 */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
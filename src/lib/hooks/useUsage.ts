"use client";

/**
 * React-хук для счётчика генераций.
 *
 * На mount дёргает `/api/users/usage` (GET). Семантика:
 *   - 401 (unauthorized) → `usage = null` — юзер не залогинен, виджет не показываем.
 *     Используем localStorage fallback (`src/lib/utils/limit.ts`) для анонимов.
 *   - 2xx → `usage = { generationsToday, generationsLimit, plan }`.
 *   - 5xx / network → `usage = null`, ошибку НЕ бросаем (mock-fallback работает).
 *
 * `refresh()` — повторный fetch после успешной генерации (`saveWorksheet({ok:true})`)
 * чтобы виджет обновился без перезагрузки страницы.
 *
 * Сам хук не делает никаких сайд-эффектов кроме одного fetch на mount.
 * За прогрессом / refresh'ем после generation следит caller (конструктор / дашборд).
 */

import * as React from "react";
import { getUsage, type UsageInfo } from "@/lib/auth/api";

export interface UseUsageResult {
  usage: { generationsToday: number; generationsLimit: number; plan: UsageInfo["plan"] } | null;
  refresh: () => Promise<void>;
  isLoading: boolean;
}

/**
 * useUsage — реактивный счётчик генераций на сегодня.
 *
 * На mount делает один GET /api/users/usage. При 401 (анонимный юзер) — usage = null,
 * чтобы виджет лимита не показывался для анонимных визитёров.
 *
 * @example
 *   const { usage, refresh, isLoading } = useUsage();
 *   // После успешного saveWorksheet: await refresh();
 */
export function useUsage(): UseUsageResult {
  const [usage, setUsage] = React.useState<UseUsageResult["usage"]>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Stable refresh — иначе effect-зависимости рвутся.
  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const info = await getUsage();
      setUsage({
        generationsToday: info.generationsToday,
        generationsLimit: info.generationsLimit,
        plan: info.plan,
      });
    } catch {
      // 401 → анонимный юзер → usage = null (UI прячет виджет).
      // 5xx / network → usage = null (UI пусть покажет localStorage-fallback).
      setUsage(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { usage, refresh, isLoading };
}

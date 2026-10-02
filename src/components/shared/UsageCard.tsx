"use client";

/**
 * Показ остатка нормы тарифа.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ПОКАЗЫВАЕМ И ПОЧЕМУ ИМЕННО ТАК
 * ─────────────────────────────────────────────────────────────────────────────
 * Решение владельца продукта: единица потребления — ТОКЕНЫ, не листы.
 * Взвешенный токен = токен Luna-эквивалента, поэтому счёт совпадает с
 * себестоимостью до копейки (backend/src/services/usage.ts).
 *
 * Рядом с токенами ОБЯЗАТЕЛЬНО идёт «≈ N листов». Не украшение: учитель не
 * обязан понимать внутреннюю единицу, а «1,44 млн токенов» без пояснения
 * читается как «очень много» и тревожит раньше времени. Подпись переводит
 * внутреннее в понятное и стоит одну строку кода.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОРОГ МЯГКИЙ
 * ─────────────────────────────────────────────────────────────────────────────
 * При превышении нормы генерация НЕ прекращается. Поэтому баннер здесь —
 * не «вы не можете», а «вы вышли за объём тарифа, вот варианты»:
 *   * кнопка не блокирует и не меняет поведение генерации;
 *   * переход на «Плюс» — предложение, а не требование;
 *   * нигде нет формулировок «лимит исчерпан», «доступ заблокирован».
 *
 * Учитель сдаёт урок посреди дня. Слово «блокировка» в этот момент —
 * самая дорогая ошибка, которую можно сделать в интерфейсе.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  PLANS,
  formatTokens,
  tokensToWorksheetsLabel,
  normLabel,
  FREE_GENERATIONS,
  type PlanId,
} from "@/lib/content/plans";
import { syncFromServer } from "@/lib/utils/limit";

/** Форма ответа /api/users/usage (backend/src/routes/users.ts). */
export interface UsagePayload {
  plan: "free" | "base" | "plus";
  norm: number | null;
  weightedTokensUsed: number;
  over: boolean;
  remaining: number | null;
  periodEndsAt: string | null;
  worksheetsEquivalent: number;
  freeRemaining: number | null;
  requiresChallenge: boolean;
  /** Старые поля, бэк их ещё отдаёт. */
  generationsToday: number;
  generationsLimit: number;
}

interface Props {
  usage: UsagePayload | null;
  loading?: boolean;
}

function progressPercent(used: number, norm: number | null): number {
  if (norm == null || norm <= 0) return 0;
  return Math.min(100, Math.round((used / norm) * 100));
}

export function UsageCard({ usage, loading }: Props) {
  const router = useRouter();
  const go = (href: string) => router.push(href);

  // Счётчик на сервере — источник правды. Синхронизируем оптимистичный
  // клиентский, чтобы конструктор правильно показывал кнопку до похода в сеть.
  React.useEffect(() => {
    if (!usage || usage.plan !== "free") return;
    if (usage.freeRemaining == null) return;
    syncFromServer(FREE_GENERATIONS - usage.freeRemaining);
  }, [usage]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-warm-200 bg-white p-5">
        <div className="h-4 w-40 rounded bg-warm-100 animate-pulse" />
        <div className="mt-4 h-2 w-full rounded bg-warm-100 animate-pulse" />
      </div>
    );
  }

  if (!usage) {
    // Не показываем ничего: неизвестное состояние не повод пугать учителя
    // сообщением о неизвестной ошибке на главной странице профиля.
    return null;
  }

  // ── Бесплатный тариф: считаем в штуках генераций ──
  if (usage.plan === "free") {
    const left = usage.freeRemaining ?? FREE_GENERATIONS;
    const used = FREE_GENERATIONS - left;
    const done = left === 0;
    return (
      <div className="rounded-2xl border border-warm-200 bg-white p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-warm-900">Бесплатные генерации</h3>
            <p className="text-sm text-warm-500 mt-0.5">
              {FREE_GENERATIONS} генерации на весь период — без сброса по суткам
            </p>
          </div>
          <Badge tone={done ? "accent" : "brand"}>
            {left > 0 ? `Осталось ${left} из ${FREE_GENERATIONS}` : "Исчерпано"}
          </Badge>
        </div>

        <div className="h-2 rounded-full bg-warm-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${done ? "bg-accent-500" : "bg-brand-500"}`}
            style={{ width: `${progressPercent(used, FREE_GENERATIONS)}%` }}
          />
        </div>

        {done ? (
          <div className="rounded-xl bg-accent-50 border border-accent-200 p-4 space-y-3">
            <div className="flex gap-2">
              <Sparkles className="w-4 h-4 text-accent-600 shrink-0 mt-0.5" />
              <p className="text-sm text-warm-800">
                Бесплатные генерации закончились. Подписка продолжит работу без
                ограничения по суткам.
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={() => go("/pricing")}>
              Посмотреть тарифы
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Платный тариф: считаем во взвешенных токенах ──
  const planId = usage.plan as PlanId;
  const norm = usage.norm;
  const used = usage.weightedTokensUsed;
  const percent = progressPercent(used, norm);
  const nearLimit = norm != null && percent >= 80 && !usage.over;

  return (
    <div className="rounded-2xl border border-warm-200 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-warm-900">
            Объём тарифа {PLANS[planId].name}
          </h3>
          <p className="text-sm text-warm-500 mt-0.5">
            {normLabel(planId)} · {tokensToWorksheetsLabel(used)} сделано
          </p>
        </div>
        <Badge tone={usage.over ? "accent" : nearLimit ? "warm" : "brand"}>
          {usage.over ? "Объём превышен" : nearLimit ? "Почти весь объём" : `${percent}%`}
        </Badge>
      </div>

      <div className="h-2 rounded-full bg-warm-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            usage.over ? "bg-accent-500" : nearLimit ? "bg-amber-500" : "bg-brand-500"
          }`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>

      {norm != null ? (
        <div className="flex items-center justify-between text-xs text-warm-500">
          <span>
            {formatTokens(used)} из {formatTokens(norm)} токенов
          </span>
          {usage.periodEndsAt ? (
            <span>
              до {new Date(usage.periodEndsAt).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {usage.over ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
          <div className="flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-warm-800 space-y-1">
              <p>
                Вы вышли за объём, включённый в тариф. <b>Генерация при этом не
                останавливается</b> — материалы продолжают выдаваться как обычно.
              </p>
              <p className="text-warm-600">
                Если такая нагрузка станет постоянной, возьмите «Плюс» с запасом
                или докупите объём — тогда и стоимость каждого листа останется прежней.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => go("/pricing")}>
              Перейти на «Плюс»
            </Button>
            <Button variant="ghost" size="sm" onClick={() => go("/pricing")}>
              Докупить объём
            </Button>
          </div>
        </div>
      ) : nearLimit ? (
        <div className="rounded-xl bg-warm-50 border border-warm-200 p-3 flex gap-2">
          <Zap className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-warm-700">
            Израсходовано {percent}% объёма тарифа. Если планируете больше —
            возьмите «Плюс», там объём в {Math.round(
              ((PLANS.plus.normPerMonth ?? 1) / (PLANS.base.normPerMonth ?? 1)),
            )} раза больше.
          </p>
        </div>
      ) : null}
    </div>
  );
}

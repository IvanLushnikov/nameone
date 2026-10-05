"use client";

import * as React from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Check, Sparkles, Lock } from "lucide-react";
import { trackEvent } from "@/lib/track";
import {
  PLANS,
  academicYearSaving,
  formatRub,
  priceFor,
  priceShort,
  normLabel,
  FREE_GENERATIONS,
  type PlanId,
} from "@/lib/content/plans";

interface Props {
  open: boolean;
  onClose: () => void;
  remaining: number;
}

/**
 * Цены, названия и списки возможностей — из plans.ts (единый источник).
 *
 * Обещания пробного периода здесь НЕТ намеренно: кнопка оплаты пока ничего
 * не делает (ЮKassa-webhook в TODO), обещание живёт только в FAQ тарифов.
 * Раньше в футере модалки было ещё и обещание «первый месяц Базового — один
 * рубль» — второе конфликтующее обещание, удалено.
 *
 * КАК ЭТА МОДАЛКА СОПРОВОЖДАЕТ НОРМУ (2026-10-02). Платный порог МЯГКИЙ: при
 * превышении нормы генерация продолжается, а эта модалка — предложение
 * докупить, а не запрет. Поэтому здесь нет слова «заблокировано» и нет
 * иконки замка на платном тарифе: показываем вред и стоимость, решение
 * оставляем учителю.
 */
// ТЗ-21 п.4: между base и plus появился тариф «Оптимальный». Он в списке
// обязателен — иначе учитель с 3–4 предметами в модалке увидит только два
// крайних варианта и решит, что промежуточного нет.
const planIds: PlanId[] = ["base", "standard", "plus"];

export function PaywallModal({ open, onClose, remaining }: Props) {
  // Трекаем только переход `false -> true` (не повторно при каждом ререндере).
  const prevOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !prevOpen.current) {
      trackEvent("paywall_open", { remaining });
    }
    prevOpen.current = open;
  }, [open, remaining]);

  /**
   * Клик по тарифу.
   *
   * Раньше здесь был только `trackEvent` — кнопка «Оформить» не делала
   * ничего, и самый горячий момент воронки (учитель уже решил платить)
   * заканчивался тишиной. ЮKassa-webhook ещё не подключён, поэтому вместо
   * фальшивого «оплачено» ведём на страницу тарифов: там все условия,
   * цены и способы оплаты, и учитель принимает осознанное решение.
   *
   * Когда появится `POST /api/billing/create` с `confirmation_url`,
   * заменить этот переход на `window.location.href = confirmation_url`.
   */
  const handlePlanClick = (planId: PlanId) => () => {
    trackEvent("paywall_plan_click", { planId });
    onClose();
    window.location.href = `/pricing`;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-accent-500" />
          Лимит бесплатных генераций
        </span>
      }
      description={`Бесплатные генерации закончились (${FREE_GENERATIONS} на весь период). Подписка продолжит работу без ограничения по суткам. Отменить можно в любой момент.`}
    >
      {/* sm:grid-cols-3, а не 2: с добавлением «Оптимального» тарифов стало
          три, и в двухколоночной сетке третий уезжал на вторую строку один,
          ломая ряд. */}
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        {planIds.map((id) => {
          const plan = PLANS[id];
          const month = priceFor(id, "month");
          const year = priceFor(id, "academicYear");
          const saving = academicYearSaving(id);
          return (
            <div
              key={plan.id}
              className={
                plan.paywallAccent
                  ? "relative p-5 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand"
                  : "p-5 rounded-2xl border border-warm-200 bg-white"
              }
            >
              {plan.paywallAccent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-accent-500 text-white text-xs font-semibold flex items-center gap-1 shadow-accent">
                  <Sparkles className="w-3 h-3" />
                  Популярный
                </div>
              )}
              <div className="text-sm font-semibold uppercase tracking-wider opacity-80 mb-2">
                {plan.name}
              </div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold">{formatRub(month.amount)}</span>
                <span className="text-sm opacity-80">{month.unit}</span>
              </div>
              <div className="text-xs opacity-70 mb-2">
                или {formatRub(year.amount)} {year.unit}
                {saving ? ` — ${saving}` : ""}
              </div>
              <div className="text-xs opacity-70 mb-2">{normLabel(id)}</div>
              <div className="text-sm opacity-90 mb-4">{plan.shortDescription}</div>
              <ul className="space-y-1.5 text-sm">
                {plan.features.slice(0, 4).map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="opacity-90">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="space-y-2.5">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          leftIcon={<Sparkles className="w-4 h-4" />}
          onClick={handlePlanClick("base")}
        >
          Оформить Базовый · {priceShort("base", "month")}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={handlePlanClick("standard")}
        >
          Оформить Оптимальный · {priceShort("standard", "month")}
        </Button>
        <Button
          variant="accent"
          size="lg"
          fullWidth
          onClick={handlePlanClick("plus")}
        >
          Оформить Плюс · {priceShort("plus", "month")}
        </Button>
        <Button variant="ghost" size="md" fullWidth onClick={onClose}>
          Вернуться в генератор
        </Button>
      </div>

      <p className="mt-5 text-center text-xs text-warm-500">
        Оплата картой РФ и СБП. Подписку можно отменить в любой момент.
      </p>
    </Modal>
  );
}

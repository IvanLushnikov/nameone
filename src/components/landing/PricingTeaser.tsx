"use client";

import Link from "next/link";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Check, Sparkles } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils/cn";
import {
  ACADEMIC_YEAR_NOTE,
  DEFAULT_PERIOD,
  PERIODS,
  PERIOD_IDS,
  PLANS,
  academicYearSaving,
  maxAcademicYearDiscount,
  priceFor,
  formatRub,
  type PeriodId,
  type Plan,
} from "@/lib/content/plans";
import { createPayment } from "@/lib/lk/subscription-api";
import { getCurrentUser } from "@/lib/auth/api";

const teaserPlans = Object.values(PLANS).filter((p) => p.inTeaser);

/**
 * Появление карточек включается только после монтирования на клиенте:
 * `opacity: inView ? 1 : 0` попадал в статический HTML, и без JS (и у
 * поисковика) тарифы выглядели пустыми. В разметке теперь всегда opacity 1.
 */
function useReveal(inView: boolean) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return !mounted || inView;
}

export function PricingTeaser({ headingLevel: Heading = "h2" }: { headingLevel?: "h1" | "h2" }) {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  const [period, setPeriod] = React.useState<PeriodId>(DEFAULT_PERIOD);
  const show = useReveal(inView);

  return (
    <section
      ref={ref}
      className="py-20 sm:py-28 bg-gradient-to-b from-white to-warm-50 border-t border-warm-100"
    >
      <div className="container-tight">
        <div className="max-w-2xl mx-auto text-center mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
            Тарифы
          </p>
          <Heading className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Начните бесплатно. Платите, когда&nbsp;удобно.
          </Heading>
          <p className="mt-3 text-warm-600">
            Без скрытых платежей. Подписку можно отменить в любой момент.
          </p>
        </div>

        {/* Переключатель периода: только «Учебный год» и «Помесячно».
            Календарного года (12 месяцев) нет — платить летом не нужно. */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="inline-flex p-1 rounded-full bg-warm-100 border border-warm-200">
            {PERIOD_IDS.map((id) => {
              const p = PERIODS[id];
              const isActive = period === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPeriod(id)}
                  aria-pressed={isActive}
                  className={cn(
                    id === "academicYear"
                      ? // pl-5 pr-4 — бейдж со скидкой не должен вылезать за pill.
                        "pl-5 pr-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2"
                      : "px-4 sm:px-5 py-2 rounded-full text-sm font-medium transition-all",
                    isActive
                      ? "bg-white text-warm-950 shadow-soft"
                      : "text-warm-600 hover:text-warm-900"
                  )}
                >
                  {p.label}
                  {id === "academicYear" && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold whitespace-nowrap">
                      // Аудит 18.10.2026 (BUG-011): здесь стояло «− 18,5 %», и это
                      // выглядело как общая скидка на тарифы. На деле 18,5 % —
                      // только у «Плюса», у «Базового» 15,7 %, у «Оптимального»
                      // 14,7 %. «До» — единственная честная формулировка.
                      − до {maxAcademicYearDiscount()} %
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-warm-500 text-center max-w-md">
            {ACADEMIC_YEAR_NOTE}
          </p>
        </div>

        {/* ТЗ-21 п.4: с добавлением «Оптимального» карточек стало четыре.
            Сетка 2×2 на планшете и десктопе: в три колонки четвёртая уезжала
            на вторую строку одна и ряд читался как «три тарифа + ошибка»,
            а именно на этом блоке учитель выбирает тариф. */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 max-w-6xl mx-auto">
          {teaserPlans.map((p, i) => (
            <PricingCard
              key={p.id}
              plan={p}
              index={i}
              show={show}
              period={period}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-warm-500">
          {/* Точки стоят вплотную к ссылке: JSX срезает перенос строки между
              </Link> и «.», поэтому лишнего пробела в HTML не остаётся. */}
          Все условия и скидки —{" "}
          <Link
            href="/pricing"
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            на странице тарифов
          </Link>
          . Есть вариант{" "}
          <Link
            href="/pricing#b2b"
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            для класса
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

function PricingCard({
  plan,
  index,
  show,
  period,
}: {
  plan: Plan;
  index: number;
  show: boolean;
  period: PeriodId;
}) {
  const reducedMotion = useReducedMotion();
  const isHighlight = plan.highlight;
  const price = priceFor(plan.id, period);
  const saving = period === "academicYear" ? academicYearSaving(plan.id) : null;

  /**
   * Кнопка тарифа — РАБОЧАЯ (08.10.2026).
   *
   * Что было: `<Button as="link" href={plan.href}>` с `href: "/pricing"`.
   * То есть на главной кнопка «Оформить подписку» вела на страницу тарифов,
   * а на самой странице тарифов — на саму себя. Учительница написала ровно
   * про это: «они не нажимаются, не могу выбрать другой тариф и оформить
   * подписку не активно». Кнопка выглядела как кнопка и никуда не вела.
   *
   * Теперь: клик создаёт платёж на бэке (`POST /api/billing/create`) и
   * уводит на страницу платёжного сервиса. Неавторизованному — сначала
   * вход: платёж привязан к аккаунту, иначе он ушёл бы в никуда.
   *
   * Ошибки НЕ прячем: если платёжный сервис не настроен, говорим прямо —
   * молчаливая кнопка хуже неработающей.
   */
  const [busy, setBusy] = React.useState(false);
  const [payError, setPayError] = React.useState<string | null>(null);

  const isFree = plan.id === "free";

  /**
   * Согласие на автопродление (ТЗ-20).
   *
   * СОСТОЯНИЕ ПО УМОЛЧАНИЮ ВСЕГДА false. Не «включим для удобства учителя» и
   * не «включим у тех, кто платит помесячно»: отсутствие явной галочки должно
   * означать отсутствие согласия, иначе платёж уходит с безакцептным списанием,
   * на которое никто не подписывался.
   *
   * Показывается ТОЛЬКО там, где автопродление вообще возможно: платный тариф с
   * помесячной оплатой. Учебного года это не касается — оплатив 9 месяцев,
   * учитель не должен получить списание через 9 месяцев (ТЗ-20 §2.6), поэтому
   * для периода «учебный год» галочки нет и согласие не отправляется вовсе.
   *
   * Что происходит с отмеченной галочкой дальше: значение уходит в запрос
   * оплаты полем `autoRenew`, бэк передаёт его в createPayment как
   * `autoRenewConsent`, и там оно применяется только при помесячном периоде И
   * включённом флаге RECURRING_BILLING_ENABLED. Флаг в проде выключен (решение
   * владельца после теста на реальной карте) — то есть согласие сейчас просто
   * записывается, способ оплаты не сохраняется и списаний не происходит. Текст
   * рядом с галочкой поэтому говорит, НА ЧТО учитель СОГЛАШАЕТСЯ, а не то, что
   * списание уже включено.
   */
  const [autoRenew, setAutoRenew] = React.useState(false);
  const canAutoRenew = !isFree && period === "month";
  const consentId = `auto-renew-${plan.id}`;
  const consentNoteId = `${consentId}-note`;

  // Галочка скрыта (учебный год или бесплатный тариф) — значит отправлять нечего.
  // Сбрасываем выбор, чтобы вернувшись к помесячной оплате учитель увидел
  // ПУСТУЮ галочку и поставил её снова, а не получил согласие, оставшееся от
  // прошлого периода. Договорённость простая: отправляется ровно то, что видит.
  React.useEffect(() => {
    if (!canAutoRenew) setAutoRenew(false);
  }, [canAutoRenew]);

  async function subscribe() {
    if (isFree) {
      window.location.assign("/constructor");
      return;
    }
    setBusy(true);
    setPayError(null);
    try {
      const user = await getCurrentUser();
      if (!user) {
        window.location.assign("/login?next=%2Fpricing");
        return;
      }
      const res = await createPayment({
        plan: plan.id,
        period,
        returnUrl: `${window.location.origin}/dashboard/settings?paid=1`,
        // Ровно то, что учитель видит на экране: галочка снята или её нет.
        autoRenew: canAutoRenew && autoRenew,
      });
      if (!res.ok) {
        setPayError(
          res.error === "payment_unavailable"
            ? "Приём платежей сейчас не настроен, оплатить нельзя. Попробуйте позже."
            : res.error === "unauthorized"
              ? "Вход истёк — войдите заново, чтобы оплатить."
              : "Не удалось создать платёж. Попробуйте ещё раз.",
        );
        return;
      }
      window.location.assign(res.confirmationUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="relative h-full"
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(20px)",
        transitionProperty: "opacity, transform",
        transitionDuration: "500ms",
        transitionDelay: `${index * 100}ms`,
      }}
    >
      {/* Rotating glow for highlight card */}
      {isHighlight && (
        <div
          className={`absolute -inset-[2px] rounded-3xl bg-gradient-to-br ${plan.accent} opacity-60 blur-lg animate-fade-in`}
          style={{
            animation: reducedMotion ? "none" : "shimmer 4s linear infinite",
            backgroundSize: "200% 200%",
          }}
        />
      )}
      <Card
        className={`relative h-full flex flex-col transition-all duration-300 hover:-translate-y-1 ${
          isHighlight ? "ring-2 ring-brand-400 shadow-soft-lg" : ""
        }`}
      >
        {/* Плашка «Популярный» — только в фирменной гамме. Раньше была
            градиентом brand→accent, и коралловый край на зелёной карточке
            читался как предупреждение, а не как рекомендация.
            Шаги 600/700 выбраны по контрасту: белый на них даёт 4,03:1 и 5,75:1
            (brand-500 давал 2,69:1). */}
        {isHighlight && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-brand-700 to-brand-600 text-white text-xs font-semibold flex items-center gap-1 shadow-accent z-10">
            <Sparkles className="w-3 h-3" />
            Популярный
          </div>
        )}
        <div className="mb-4">
          <div className="text-sm font-semibold uppercase tracking-wider text-warm-500 mb-2">
            {plan.name}
          </div>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="text-3xl font-bold text-warm-950 whitespace-nowrap">
              {formatRub(price.amount)}
            </span>
            <span className="text-sm text-warm-500">{price.unit}</span>
          </div>
          {saving && (
            <p className="mt-1.5 text-xs font-medium text-emerald-700">{saving}</p>
          )}
          <p className="mt-2 text-sm text-warm-600">{plan.description}</p>
        </div>

        <ul className="space-y-2.5 mb-6">
          {plan.features.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-warm-700"
            >
              <Check
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  isHighlight ? "text-brand-600" : "text-brand-500"
                }`}
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        {/* mt-auto прижимает блок оплаты к низу карточки: без него у тарифа с коротким
            списком он висел выше, чем у соседей, и ряд читался как три
            разных предложения, а не как один тарифный ряд.

            Кнопка вызывает `subscribe()` — реальное создание платежа.
            Раньше это была ссылка `href={plan.href}` на `/pricing`, то есть
            кнопка на странице тарифов вела на эту же страницу и ничего
            не делала.

            Галочка согласия лежит ВНУТРИ этого блока и прямо над кнопкой:
            отдельный «плавающий» переключатель периода выше по карточке от
            кнопки отвалился бы визуально и читался как настройка интерфейса,
            а не как согласие на списание. */}
        <div className="mt-auto">
          {canAutoRenew && (
            <div className="mb-3">
              <div className="flex items-start gap-2">
                {/* Настоящий <input type="checkbox">: пробелом и стрелками
                    управляется сам, скринридер читает подпись как имя
                    переключателя, состояние видно без цвета. Клик по подписи
                    тоже переключает (htmlFor). Никаких <div onClick> — их не
                    видно с клавиатуры. */}
                <input
                  id={consentId}
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(e) => setAutoRenew(e.target.checked)}
                  aria-describedby={consentNoteId}
                  data-testid={`auto-renew-${plan.id}`}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                />
                <label
                  htmlFor={consentId}
                  className="text-xs font-medium leading-relaxed text-warm-800 cursor-pointer"
                >
                  Продлевать автоматически
                </label>
              </div>
              {/* Пояснение — то, что учитель обязан знать ДО оплаты: сумма
                  одного списания, период и как это отменить. Сумма берётся из
                  plans.ts (тот же источник, что и цена на карточке), поэтому
                  после смены цен текст не разойдётся с ценой.
                  Текст короткий намеренно: карточка в сетке 2×2 узкая, и
                  абзац в четыре строки читался бы как «мелкий шрифт про
                  условия», который никто не прочитает. */}
              <p id={consentNoteId} className="mt-1 pl-6 text-xs leading-relaxed text-warm-500">
                Списание {formatRub(priceFor(plan.id, "month").amount)} раз в месяц. Отменить
                можно в любой момент в личном кабинете.
              </p>
            </div>
          )}
          <Button
            type="button"
            onClick={subscribe}
            disabled={busy}
            variant={isHighlight ? "primary" : "secondary"}
            size="md"
            fullWidth
            data-testid={`subscribe-${plan.id}`}
          >
            {busy ? "Готовим платёж…" : isFree ? "Попробовать бесплатно" : plan.cta}
          </Button>
        </div>
        {payError && (
          <p className="mt-2 text-xs text-red-600 text-center leading-relaxed" role="alert">
            {payError}
          </p>
        )}
      </Card>
    </div>
  );
}

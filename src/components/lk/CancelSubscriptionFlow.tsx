"use client";

/**
 * Отмена подписки — три шага, спокойным тоном (ТЗ-21, блок 4, пункт 3 и 6).
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ:
 *   * модалки «вы уверены?!» с красной кнопкой и восклицательными знаками —
 *     учитель отменяет подписку по делу, а не в панике;
 *   * «Вы потеряете историю, избранное и все листы!» — этого не происходит,
 *     и обещать потерю, которой нет, подло;
 *   * навязчивого «остаться с нами ещё месяц» — причина отмены фиксируется
 *     молча (отправляется с запросом), а не выпрашивается.
 *
 * ЧТО ЕСТЬ:
 *   1. «Что отменяем» — автопродление (доступ доигрывается) — единственный
 *      вариант: отменить подписку «насовсем» = отменить автопродление, потому
 *      что доступ до конца оплаченного периода мы не отбираем;
 *   2. «Когда это вступит в силу» — сразу, и с датой, до которой всё работает;
 *   3. «Почему» — необязательно, один клик, без объяснений вслух.
 *
 * Итог на третьем шаге — обычное подтверждение в две строки: что произойдёт и
 * что останется доступным.
 */

import * as React from "react";
import { Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cancelSubscription, type SubscriptionView } from "@/lib/lk/subscription-api";
import { formatChargeDate } from "@/components/lk/SubscriptionCard";

/** Причины — короткие, без «вы плохой клиент». Чисто для тихого разбора. */
const REASONS = [
  "Не успеваю пользоваться",
  "Дорого",
  "Мало материала",
  "Ушёл в другой сервис",
  "Другое",
];

interface Props {
  open: boolean;
  onClose: () => void;
  subscription: SubscriptionView;
  onDone: () => void;
}

export function CancelSubscriptionFlow({ open, onClose, subscription, onDone }: Props) {
  const [step, setStep] = React.useState(1);
  const [reason, setReason] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // При каждом открытии начинаем с первого шага: «вы уверены?» на пятом шаге —
  // признак сбившегося сценария.
  React.useEffect(() => {
    if (open) {
      setStep(1);
      setReason(null);
      setError(null);
    }
  }, [open]);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await cancelSubscription(reason ?? undefined);
      if (!res.ok) {
        setError(
          res.error === "network"
            ? "Нет связи с сервером. Подписка не отменена — попробуйте ещё раз."
            : "Не удалось отменить подписку. Попробуйте ещё раз.",
        );
        return;
      }
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const endsAt = subscription.periodEndsAt;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Отменить автопродление"
      description={
        step === 1
          ? "Один вопрос, чтобы мы поняли, что улучшить."
          : step === 2
            ? "И последнее — когда это вступит в силу."
            : "Проверьте, что всё верно, и всё."
      }
      footer={
        <div className="flex flex-wrap gap-2 justify-end">
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              Назад
            </Button>
          ) : null}
          {step < 3 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
              Дальше
            </Button>
          ) : (
            <Button variant="secondary" onClick={finish} loading={busy}>
              <Check className="w-4 h-4" />
              Отменить автопродление
            </Button>
          )}
        </div>
      }
    >
      {step === 1 ? (
        <div className="space-y-4">
          <p className="text-sm text-warm-700">
            Что отменяем? Автоматическое списание в следующем периоде. Оплаченный доступ до{" "}
            <b>{endsAt ? formatChargeDate(endsAt) : "конца периода"}</b> при этом никуда не денется.
          </p>
          <fieldset>
            <legend className="text-sm font-medium text-warm-700 mb-2">
              Почему отменяете? Необязательно
            </legend>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(reason === r ? null : r)}
                  className={
                    reason === r
                      ? "px-3 h-9 rounded-lg border border-brand-400 bg-brand-50 text-sm text-brand-800"
                      : "px-3 h-9 rounded-lg border border-warm-200 text-sm text-warm-700 hover:border-warm-300"
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}

      {step === 2 ? (
        <ul className="space-y-2 text-sm text-warm-700">
          <li>• Автопродление выключается сразу — следующего списания не будет.</li>
          <li>
            • Доступ «{subscription.planName}» работает до{" "}
            {endsAt ? formatChargeDate(endsAt) : "конца оплаченного периода"}.
          </li>
          <li>• Материалы, история и избранное остаются в кабинете.</li>
          <li>• Если захотите вернуться — оплатите заново, один клик.</li>
        </ul>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-warm-200 bg-warm-50 p-4 text-sm text-warm-800 space-y-1">
            <p>
              Тариф: <b>«{subscription.planName}»</b>, {subscription.priceLabel}
            </p>
            <p>
              Доступ до: <b>{endsAt ? formatChargeDate(endsAt) : "конца периода"}</b>, дальше
              автоматических списаний не будет
            </p>
            {reason ? <p>Причина: {reason.toLowerCase()}</p> : null}
          </div>
          <p className="text-sm text-warm-600">
            Ничего не пропадёт: листы, шаблоны и история останутся в кабинете.
          </p>
          {error ? (
            <p className="text-sm text-warm-800 bg-warm-50 border border-warm-200 rounded-lg p-3">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

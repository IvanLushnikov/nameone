"use client";

/**
 * Панель прогресса + кнопка «Отправить» (TZ-12, этап 3, сценарий Б, шаг 4).
 *
 * Кнопка активна **всегда** — это осознанное решение, а не недосмотр:
 * ученик в классе не дочитал последнее задание, времени мало, а ждать «я всё
 * проверил» нельзя. Присылает неполным — учитель в сводке видит, что задание
 * пропущено (в сводке такие строки помечены, балл 0).
 *
 * Кнопка блокируется ровно в одном случае — `submitting`, идёт запрос. Защита от
 * двойного сабмита: одна отправка = одна попытка (ТЗ §5 «Античит»).
 *
 * `message` — неблокирующая подсказка (например, «сервер недоступен, попробуйте
 * ещё раз»). Ученик остаётся на заполненном листе со всеми ответами и жмёт
 * кнопку снова. Если форму закрыли во время работы, FormRunner уводит на экран
 * ошибки, а не блокирует кнопку под сомнительной подписью.
 */

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { plural } from "@/lib/utils/cn";

export interface ProgressBarProps {
  answered: number;
  total: number;
  onSubmit: () => void;
  submitting?: boolean;
  message?: string | null;
}

export function ProgressBar({
  answered,
  total,
  onSubmit,
  submitting = false,
  message = null,
}: ProgressBarProps) {
  const percent = total > 0 ? Math.round((answered / total) * 100) : 0;

  return (
    <div
      className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-warm-100 bg-white/95 backdrop-blur px-4 py-3"
      data-testid="form-progress"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm text-warm-600" data-testid="form-progress-text">
          Отвечено {answered} из {total}
        </span>
        <span className="text-sm font-medium text-warm-950">{percent}%</span>
      </div>

      <div
        className="h-2 w-full rounded-full bg-warm-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={answered}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`Отвечено ${answered} из ${total}`}
      >
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {message && <p className="mt-2 text-sm text-rose-600">{message}</p>}

      <Button
        className="mt-3 w-full"
        size="lg"
        fullWidth
        loading={submitting}
        onClick={onSubmit}
        data-testid="form-submit"
      >
        {submitting
          ? "Отправляем…"
          : answered < total
            ? `Отправить (${answered} из ${total})`
            : "Отправить"}
      </Button>

      {answered < total && total > 0 && (
        <p className="mt-1.5 text-xs text-warm-500 text-center">
          Можно отправить неполным — без ответа{" "}
          {plural(total - answered, "задание", "задания", "заданий")}
        </p>
      )}
    </div>
  );
}

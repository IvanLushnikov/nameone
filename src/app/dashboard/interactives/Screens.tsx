"use client";

/**
 * Общие экраны ЛК для списка и деталки интерактивов.
 *
 * Вынесены отдельным файлом, а не внутрь `InteractivesView`: список и деталка
 * сами `InteractivesView` импортируют, и держать экраны там же — циклический
 * импорт (ESM его переживёт, но ловить баг в этом месте не хочется).
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, User } from "lucide-react";

/** Общие экраны ошибки для списка и деталки. */
export function ScreenError({
  message,
  onRetry,
  testId,
}: {
  message: string;
  onRetry: () => void;
  testId: string;
}) {
  return (
    <Card className="text-center py-10" data-testid={testId}>
      <div className="w-12 h-12 rounded-2xl bg-warm-100 text-warm-600 grid place-items-center mx-auto mb-3">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h3 className="font-semibold text-warm-950">Не удалось загрузить</h3>
      <p className="text-sm text-warm-600 mt-1.5">{message}</p>
      <Button variant="secondary" size="md" className="mt-4" onClick={onRetry}>
        Попробовать ещё раз
      </Button>
    </Card>
  );
}

/** Экран «войдите» — общий для обоих списков. */
export function ScreenUnauthorized() {
  return (
    <Card className="text-center py-10" data-testid="interactives-unauthorized">
      <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 grid place-items-center mx-auto mb-3">
        <User className="w-6 h-6" />
      </div>
      <h3 className="font-semibold text-warm-950">Войдите, чтобы видеть интерактивы</h3>
      <p className="text-sm text-warm-600 mt-1.5">
        Интерактивы и результаты учеников привязаны к вашему аккаунту — в браузере
        их не храним.
      </p>
      <Button
        as="link"
        href="/login"
        variant="primary"
        size="md"
        className="mt-4"
        leftIcon={<User className="w-4 h-4" />}
      >
        Войти по email
      </Button>
    </Card>
  );
}

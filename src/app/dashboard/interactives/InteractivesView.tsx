"use client";

/**
 * Экран учителя «Интерактивы» (TZ-13 §3, сценарий C).
 *
 * Одно состояние на два экрана, переключается query-параметром `?id=`:
 *   - без `id` → список выданных, по каждому «N из M выполнили»;
 *   - с `id`   → сводка по попыткам: кто, сколько, топ-3 проваленных вопросов,
 *                кнопка «Выгрузить в CSV».
 *
 * Почему так, а не `[id]/` в пути — комментарий в `page.tsx`: при
 * `output: "export"` динамический сегмент требует `generateStaticParams()`,
 * а id интерактивов появляются в рантайме, и сборка бы упала.
 *
 * Честно обрабатываем ровно четыре состояния (как `FormsTab` у TZ-12):
 *   загрузка / не залогинен (401) / API недоступен (сеть, 5xx) / список.
 * Пустого белого экрана не бывает ни в одном.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ArrowLeft } from "lucide-react";
import { InteractiveList } from "./InteractiveList";
import { InteractiveDetail } from "./InteractiveDetail";

export function InteractivesView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get("id");

  return (
    <div className="container-tight py-8 sm:py-10" data-testid="interactives-view">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-warm-950">Интерактивы</h1>
          <p className="text-sm text-warm-500 mt-0.5">
            Что вы выдали классу и кто что прошёл
          </p>
        </div>
        {id && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => router.replace("/dashboard/interactives/")}
            data-testid="interactives-back"
          >
            Ко всем
          </Button>
        )}
      </div>

      {id ? <InteractiveDetail id={id} /> : <InteractiveList />}
    </div>
  );
}

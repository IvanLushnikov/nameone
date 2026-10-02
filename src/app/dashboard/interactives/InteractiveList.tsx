"use client";

/**
 * Список выданных интерактивов (ТЗ §3, сценарий C, шаг 1).
 *
 * Главное, что спрашивает учитель, открывая этот экран: «кто не сделал».
 * Поэтому сводка «14 из 28 выполнили» стоит на карточке крупно, а не в
 * подписи мелким шрифтом.
 *
 * «Сколько всего» продукт не знает: список класса мы не собираем (ТЗ §7 —
 * список учеников вне продукта). Учитель задаёт ожидаемое число сам на карточке
 * (см. `expectedStudents` в деталке), поэтому здесь показываем только то, что
 * посчитали точно: сколько попыток прислали и сколько закончили.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Send, Sparkles } from "lucide-react";
import { listInteractives } from "@/lib/interactives/api";
import { INTERACTIVE_ERROR_MESSAGE, type InteractiveListItem } from "@/lib/interactives/types";
import { formatDate } from "@/lib/utils/cn";
import { formatMeta } from "@/lib/interactives/formats";
import { ScreenError, ScreenUnauthorized } from "./Screens";

type State =
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "unavailable"; message: string }
  | { kind: "list"; items: InteractiveListItem[] };

export function InteractiveList() {
  const router = useRouter();
  const [state, setState] = React.useState<State>({ kind: "loading" });

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const res = await listInteractives();
    if (!res.ok) {
      if (res.error === "unauthorized") {
        setState({ kind: "unauthorized" });
        return;
      }
      setState({ kind: "unavailable", message: INTERACTIVE_ERROR_MESSAGE[res.error] });
      return;
    }
    setState({ kind: "list", items: res.interactives });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Card className="text-center py-10" aria-busy="true" data-testid="interactives-loading">
        <p className="text-sm text-warm-500">Загружаем выданные интерактивы…</p>
      </Card>
    );
  }

  if (state.kind === "unauthorized") return <ScreenUnauthorized />;

  if (state.kind === "unavailable") {
    return (
      <ScreenError
        message={state.message}
        onRetry={() => void load()}
        testId="interactives-unavailable"
      />
    );
  }

  if (state.items.length === 0) {
    return (
      <Card className="text-center py-10" data-testid="interactives-empty">
        <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 grid place-items-center mx-auto mb-3">
          <Send className="w-6 h-6" />
        </div>
        <h3 className="font-semibold text-warm-950">Выданных интерактивов пока нет</h3>
        <p className="text-sm text-warm-600 mt-1.5">
          Сделайте рабочий лист и нажмите «Оживить урок» — здесь появятся ссылка,
          QR и результаты класса.
        </p>
        <Button
          as="link"
          href="/constructor"
          variant="primary"
          size="md"
          className="mt-4"
          leftIcon={<Sparkles className="w-4 h-4" />}
        >
          В конструктор
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3 sm:gap-4" data-testid="interactives-list">
      {state.items.map((item) => {
        const meta = formatMeta(item.format);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => router.push(`/dashboard/interactives/?id=${encodeURIComponent(item.id)}`)}
            className="text-left"
            data-testid={`interactive-card-${item.id}`}
          >
            <Card hover className="h-full">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-warm-950 break-words">
                    {item.title}
                  </h3>
                  <p className="text-xs text-warm-500 mt-0.5">
                    {meta.emoji} {meta.title}
                    {item.grade ? ` · ${item.grade} класс` : ""} ·{" "}
                    {formatDate(item.createdAt * 1000)}
                  </p>
                </div>
                <Badge tone={item.status === "active" ? "success" : "neutral"}>
                  {item.status === "active" ? "Открыт" : "В архиве"}
                </Badge>
              </div>

              <p className="mt-3 text-sm text-warm-700">
                Выполнили{" "}
                <span className="font-semibold text-warm-950">{item.attemptsCount}</span>
                {item.percentAvg !== null && (
                  <>
                    {" "}
                    · средний{" "}
                    <span className="font-semibold text-warm-950">{item.percentAvg}%</span>
                  </>
                )}
              </p>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

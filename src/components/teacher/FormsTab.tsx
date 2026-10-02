"use client";

/**
 * Вкладка «Выданное» личного кабинета (TZ-12, этап 5).
 *
 * Первая **серверная** вкладка в /dashboard: остальные («История», «Избранное»,
 * «Шаблоны») живут целиком в localStorage, формы живут на сервере. Смешивать их
 * в одну ленту нельзя — localStorage-история переживает очистку куки, а формы
 * привязаны к user_id в D1. Поэтому отдельная вкладка и отдельная загрузка.
 *
 * Честно обрабатываем ровно три состояния (ТЗ §4.4, последний абзац):
 *   1. не залогинен (401)        → предложить вход;
 *   2. API недоступен / 5xx      → «не удалось загрузить, попробуйте позже»
 *                                  + кнопка «Попробовать ещё раз»;
 *   3. список форм (возможно пустой) → карточки, клик открывает сводку.
 * Пустого белого экрана не бывает ни в одном из них.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FormSummary } from "./FormSummary";
import { listForms } from "@/lib/forms/api";
import { FORM_ERROR_MESSAGE, type FormListItem } from "@/lib/forms/types";
import { formatDate } from "@/lib/utils/cn";
import { Send, User, AlertTriangle } from "lucide-react";

type State =
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "unavailable"; message: string }
  | { kind: "list"; forms: FormListItem[] };

export function FormsTab() {
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const [openId, setOpenId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const res = await listForms();
    if (!res.ok) {
      if (res.error === "unauthorized") {
        setState({ kind: "unauthorized" });
        return;
      }
      setState({ kind: "unavailable", message: FORM_ERROR_MESSAGE[res.error] });
      return;
    }
    setState({ kind: "list", forms: res.forms });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    return <FormSummary formId={openId} onBack={() => setOpenId(null)} />;
  }

  if (state.kind === "loading") {
    return (
      <Card className="text-center py-10" aria-busy="true" data-testid="forms-tab-loading">
        <p className="text-sm text-warm-500">Загружаем выданные формы…</p>
      </Card>
    );
  }

  if (state.kind === "unauthorized") {
    return (
      <Card className="text-center py-10" data-testid="forms-tab-unauthorized">
        <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 grid place-items-center mx-auto mb-3">
          <User className="w-6 h-6" />
        </div>
        <h3 className="font-semibold text-warm-950">Войдите, чтобы видеть выданные формы</h3>
        <p className="text-sm text-warm-600 mt-1.5">
          Формы и ответы учеников привязаны к вашему аккаунту — в браузере их не храним.
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

  if (state.kind === "unavailable") {
    return (
      <Card className="text-center py-10" data-testid="forms-tab-unavailable">
        <div className="w-12 h-12 rounded-2xl bg-warm-100 text-warm-600 grid place-items-center mx-auto mb-3">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="font-semibold text-warm-950">Не удалось загрузить</h3>
        <p className="text-sm text-warm-600 mt-1.5">{state.message}</p>
        <Button variant="secondary" size="md" className="mt-4" onClick={() => void load()}>
          Попробовать ещё раз
        </Button>
      </Card>
    );
  }

  if (state.forms.length === 0) {
    return (
      <Card className="text-center py-10" data-testid="forms-tab-empty">
        <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 grid place-items-center mx-auto mb-3">
          <Send className="w-6 h-6" />
        </div>
        <h3 className="font-semibold text-warm-950">Выданных форм пока нет</h3>
        <p className="text-sm text-warm-600 mt-1.5">
          Сделайте рабочий лист в конструкторе и нажмите «Выдать классу» — здесь появятся
          QR, ссылка и ответы учеников.
        </p>
        <Button
          as="link"
          href="/constructor"
          variant="primary"
          size="md"
          className="mt-4"
        >
          В конструктор
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3 sm:gap-4" data-testid="forms-tab-list">
      {state.forms.map((f) => {
        const percent =
          f.scoreMaxAvg && f.scoreAvg !== null
            ? Math.round((f.scoreAvg / f.scoreMaxAvg) * 100)
            : null;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => setOpenId(f.id)}
            className="text-left"
            data-testid={`form-card-${f.id}`}
          >
            <Card hover className="h-full">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-warm-950 break-words min-w-0">{f.title}</h3>
                <Badge tone={f.status === "open" ? "success" : "neutral"}>
                  {f.status === "open" ? "Открыта" : "Закрыта"}
                </Badge>
              </div>
              <p className="text-sm text-warm-500 mt-0.5">
                {f.subject} · {f.grade} класс ·{" "}
                {formatDate(new Date(f.createdAt * 1000))}
              </p>
              <p className="mt-3 text-sm text-warm-700">
                Ответили <span className="font-semibold text-warm-950">{f.responsesCount}</span>
                {percent !== null && (
                  <>
                    {" "}· средний{" "}
                    <span className="font-semibold text-warm-950">{percent}%</span>
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

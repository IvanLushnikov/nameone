"use client";

/**
 * Журнал проверок (ТЗ-19 §5.1).
 *
 * Закрывает вопрос из ТЗ: «отметка из фото-проверки никуда не пишется, даже
 * автоматическая». До этой страницы результат жил только в открытой вкладке —
 * закрыл браузер, и работы больше нет нигде.
 *
 * ОДНА страница, два состояния, а не список и отдельная страница проверки:
 * сайт собирается статически (`output: "export"`), и маршрут
 * `/journal/[checkId]` без `generateStaticParams` в выгрузку не попадает —
 * учитель получил бы 404 по ссылке «Открыть». Открытая проверка приходит
 * параметром `?check=<id>`, так же как конструктор открывается по `?photo=1`.
 *
 * Честно обрабатываем ровно четыре состояния списка, ни одного «пустого экрана»:
 *   1. грузимся      → «Загружаем…»;
 *   2. не залогинен  → предложение войти;
 *   3. API упал      → причина + кнопка «Попробовать ещё раз»;
 *   4. пусто         → объяснение, когда журнал появится.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CheckJournal } from "@/components/f06/CheckJournal";
import { JournalCheckView } from "@/components/f06/JournalCheckView";
import { loadJournal, type JournalEntry } from "@/lib/photo-check/journal";
import { ERROR_TEXT } from "@/lib/photo-check/api";

type State =
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "unavailable"; message: string }
  | { kind: "list"; entries: JournalEntry[] };

/**
 * `useSearchParams()` при `output: "export"` требует границы <Suspense> выше
 * себя, иначе Next не может пререндерить страницу. Обёртка вынесена в
 * отдельную функцию именно поэтому — так же сделано в `app/form` и
 * `app/oge`.
 */
function JournalView() {
  const searchParams = useSearchParams();
  const checkId = searchParams.get("check");
  const [state, setState] = React.useState<State>({ kind: "loading" });

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    const res = await loadJournal(20);
    if (res.ok) {
      setState({ kind: "list", entries: res.entries });
      return;
    }
    if (res.error === "unauthorized") {
      setState({ kind: "unauthorized" });
      return;
    }
    setState({ kind: "unavailable", message: res.message ?? ERROR_TEXT[res.error] });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Открытая проверка — это другая задача экрана, поэтому список под ней не
  // грузим: лишний запрос, который учителю ничего не покажет.
  if (checkId) {
    return <JournalCheckView checkId={checkId} />;
  }

  return (
    <div className="container-tight py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-display font-bold text-warm-950">Журнал проверок</h1>
        <p className="text-sm text-warm-600 mt-1">
          Все работы, проверенные по фото, с отметкой и пометкой, кто её поставил.
        </p>
      </header>

      {state.kind === "loading" && (
        <p className="text-sm text-warm-600" role="status">
          Загружаем журнал…
        </p>
      )}

      {state.kind === "unauthorized" && (
        <Card>
          <p className="text-sm text-warm-900">Журнал доступен после входа в аккаунт.</p>
          <Button as="link" href="/login" variant="primary" size="md" className="mt-3">
            Войти
          </Button>
        </Card>
      )}

      {state.kind === "unavailable" && (
        <Card>
          <p className="text-sm text-rose-700" role="alert">
            Не удалось загрузить журнал. {state.message}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            className="mt-3"
          >
            Попробовать ещё раз
          </Button>
        </Card>
      )}

      {state.kind === "list" && state.entries.length === 0 && (
        <Card>
          <p className="text-sm text-warm-900">Журнал пока пуст.</p>
          <p className="text-sm text-warm-600 mt-1">
            Здесь появятся работы, которые вы проверили по фото, — с отметкой и
            пометкой, поставил её ИИ или вы сами.
          </p>
          <Button as="link" href="/constructor?photo=1" variant="primary" size="md" className="mt-4">
            Проверить первую работу
          </Button>
        </Card>
      )}

      {state.kind === "list" && state.entries.length > 0 && (
        <CheckJournal entries={state.entries} />
      )}
    </div>
  );
}

export default function JournalPage() {
  return (
    <React.Suspense
      fallback={
        <div className="container-tight py-8 sm:py-12">
          <p className="text-sm text-warm-600" role="status">
            Открываем журнал…
          </p>
        </div>
      }
    >
      <JournalView />
    </React.Suspense>
  );
}

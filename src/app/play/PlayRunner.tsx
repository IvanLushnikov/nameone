"use client";

/**
 * Клиентская часть `/play/` (TZ-13 §4.6).
 *
 * Обёрнута в `<Suspense>` в `page.tsx` — Next.js 14 при `output: "export"`
 * не даёт пререндерить компонент с `useSearchParams()` без границы. Ровно тот
 * же приём, что в `src/app/form/FormRunner.tsx`.
 *
 * Состояния (все четыре обязательны по ТЗ §4.6):
 *   1. токена в ссылке нет → понятный экран «Откройте ссылку целиком»;
 *   2. загрузка          → скелетоны (мобильный интернет: пустота выглядит
 *                          как «сломанная ссылка»);
 *   3. 404 / 410 / 429   → «Интерактив не найден или уже закрыт учителем»
 *                          + кнопка «Попробовать ещё раз»;
 *   4. сеть / 5xx        → то же самое, но с явным «проверьте интернет»;
 *      восстановление    → прогресс из `localStorage` по `attemptToken`
 *                          подхватывает оболочка (здесь мы её не дублируем).
 *
 * Правила, которые нельзя нарушать:
 *   - страница никогда не рендерит плеер с недозагруженным конфигом: неизвестный
 *     формат или битые items → аккуратная ошибка, а не пустой экран (ТЗ Р-3);
 *   - `token` кодируется в URL — он приходит из ссылки учителя, а не из кода.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { InteractiveShell } from "@/components/interactives/InteractiveShell";
import { loadPublicInteractive } from "@/lib/interactives/api";
import { INTERACTIVE_ERROR_MESSAGE, type PublicInteractive } from "@/lib/interactives/types";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; interactive: PublicInteractive }
  | { kind: "error"; message: string; missingToken?: boolean };

export function PlayRunner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("t") ?? "";

  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });

  const load = React.useCallback(async () => {
    if (!token) {
      setPhase({
        kind: "error",
        missingToken: true,
        message:
          "Ссылка неполная — не хватает кода интерактива. Откройте ссылку целиком или попросите учителя прислать её ещё раз",
      });
      return;
    }
    setPhase({ kind: "loading" });
    const res = await loadPublicInteractive(token);
    if (!res.ok) {
      setPhase({ kind: "error", message: INTERACTIVE_ERROR_MESSAGE[res.error] });
      return;
    }
    setPhase({ kind: "ready", interactive: res.interactive });
  }, [token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (phase.kind === "loading") return <LoadingScreen />;

  if (phase.kind === "error") {
    return (
      <div className="container-tight py-12 max-w-md mx-auto">
        <Card className="text-center" data-testid="play-error">
          <h1 className="text-xl font-semibold text-warm-950">
            {phase.missingToken ? "Ссылка неполная" : "Не получилось открыть"}
          </h1>
          <p className="mt-2 text-sm text-warm-600">{phase.message}</p>
          <div className="mt-5 flex flex-col sm:flex-row justify-center gap-2">
            {!phase.missingToken && (
              <Button variant="secondary" onClick={() => void load()} data-testid="play-retry">
                Попробовать ещё раз
              </Button>
            )}
            <Button as="link" href="/" variant="primary" data-testid="play-home">
              На главную
            </Button>
          </div>
        </Card>
        <noscript>
          <p className="mt-6 text-sm text-warm-600 text-center">
            Для прохождения интерактива нужен браузер с включённым JavaScript.
          </p>
        </noscript>
      </div>
    );
  }

  return <InteractiveShell token={token} interactive={phase.interactive} />;
}

/** Скелетон первой секунды. */
function LoadingScreen() {
  return (
    <div className="container-tight py-6 sm:py-10 max-w-2xl mx-auto">
      <div className="space-y-3" data-testid="play-loading" aria-busy="true">
        <p className="text-center text-sm text-warm-500 mb-2">Загружаем игру…</p>
        {[0, 1, 2].map((i) => (
          <Card key={i} className="animate-pulse">
            <div className="h-4 w-2/3 rounded bg-warm-100 mb-3" />
            <div className="h-12 w-full rounded-xl bg-warm-100" />
          </Card>
        ))}
      </div>
    </div>
  );
}

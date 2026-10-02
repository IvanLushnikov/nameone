"use client";

/**
 * Создание интерактива из готового листа (TZ-13 §3 сценарий A, шаги 3–8).
 *
 * ─── Зачем эта панель отдельным экраном ───
 * До неё фича была недостижима: `POST /api/interactives` не вызывался из
 * интерфейса ниоткуда, а конструктор параметр `?interactiveFormat=` принимал,
 * но не использовал. То есть учитель не мог получить ссылку и QR — то самое,
 * ради чего фича и делалась.
 *
 * ─── Почему нужен id листа В БАЗЕ ───
 * `POST /api/interactives` достаёт `payload_json` листа по его серверному id,
 * который вернул `POST /api/worksheets/save` после генерации. Клиентский id из
 * localStorage бэк не знает. Поэтому панель просит лист, а не берёт «что есть».
 *
 * ─── Состояния ───
 * Пустой лист → понятное объяснение вместо кнопки, которая упрётся в 400.
 * Ошибка → текст из ответа API, а не «что-то пошло не так».
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FormQrBlock } from "@/components/teacher/FormQrBlock";
import { createInteractive, type CreateInteractiveOk } from "@/lib/interactives/api";
import {
  FORMAT_META,
  DEFAULT_OPTIONS,
  validateFormatOptions,
  isInteractiveFormat,
} from "@/lib/interactives/formats";
import type { InteractiveFormat, InteractiveOptions } from "@/lib/interactives/types";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";

export interface InteractiveCreatePanelProps {
  /** id листа В БАЗЕ. Пусто — лист ещё не сохранён сервером. */
  worksheetId: string | null;
  /** Формат, выбранный в блоке «Оживить урок» (или в конструкторе). */
  format: InteractiveFormat;
  title: string;
  subject: string;
  grade: number;
  /** Сколько заданий взять в интерактив. */
  itemCount?: number;
}

type State =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "error"; message: string }
  | { kind: "done"; interactive: CreateInteractiveOk };

/** Тексты ошибок из `InteractiveApiError` — свои, без сырых кодов. */
function errorMessage(error: string): string {
  switch (error) {
    case "unauthorized":
      return "Войдите в личный кабинет, чтобы выдать игру классу.";
    case "not_found":
      return "Лист не найден на сервере. Сгенерируйте лист заново.";
    case "rate_limited":
      return "Слишком много запросов. Подождите минуту и попробуйте ещё раз.";
    case "validation":
      return "Задания листа не подошли для этого формата. Попробуйте другой формат.";
    case "network":
      return "Нет связи с сервером. Проверьте подключение.";
    default:
      return "Не удалось создать игру. Попробуйте ещё раз.";
  }
}

export function InteractiveCreatePanel(props: InteractiveCreatePanelProps) {
  const { worksheetId, format, title, subject, grade, itemCount = 10 } = props;
  const [state, setState] = React.useState<State>({ kind: "idle" });

  const meta = FORMAT_META[format];
  // Показываем учителю заранее, если его параметры будут подрезаны
  // (normalizeOptions молча зажимает значения, а валидатор говорит почему).
  // Валидатор ждёт `InteractiveOptions` — дефолты формата плюс наш itemCount.
  const issues = React.useMemo(
    () =>
      validateFormatOptions(format, {
        ...(DEFAULT_OPTIONS[format] as InteractiveOptions),
        itemCount,
      }),
    [format, itemCount],
  );

  const canCreate = Boolean(worksheetId);

  const create = async () => {
    if (!worksheetId) return;
    setState({ kind: "creating" });
    const res = await createInteractive({
      worksheetId,
      format,
      options: { ...(DEFAULT_OPTIONS[format] as Record<string, unknown>), itemCount },
    });
    setState(
      res.ok
        ? { kind: "done", interactive: res.interactive }
        : { kind: "error", message: errorMessage(res.error) },
    );
  };

  if (!isInteractiveFormat(format)) {
    return (
      <Card className="no-print border-rose-200 bg-rose-50/40">
        <p className="text-sm text-rose-800">
          Неизвестный формат интерактива: <code>{String(format)}</code>. Выберите формат заново.
        </p>
      </Card>
    );
  }

  if (state.kind === "done") {
    return (
      <Card className="no-print" data-testid="interactive-create-done">
        <h2 className="text-lg font-semibold text-warm-950 mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-500" aria-hidden />
          Игра готова — отдайте ссылку классу
        </h2>
        <p className="text-sm text-warm-600 mb-4">
          Ученик открывает ссылку с телефона, проходит игру и сдаёт результат.
          Баллы и разбор ошибок появятся в разделе «Интерактивы».
        </p>
        <FormQrBlock
          url={state.interactive.url}
          title={title}
          subject={subject}
          grade={grade}
        />
      </Card>
    );
  }

  return (
    <Card className="no-print" data-testid="interactive-create-panel">
      <h2 className="text-lg font-semibold text-warm-950 mb-1 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent-500" aria-hidden />
        {meta.title}
      </h2>
      <p className="text-sm text-warm-600 mb-4">
        Упакуем {itemCount} заданий из листа «{title}» в формат «{meta.title}». Займёт
        20–40 секунд. Ученик пройдёт с телефона по ссылке или QR.
      </p>

      {!canCreate && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2"
        >
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden />
          <p className="text-sm text-amber-900">
            Лист ещё не сохранён на сервере, а игра строится именно по его заданиям.
            Сгенерируйте лист в конструкторе и вернитесь сюда — тогда игра соберётся
            автоматически.
          </p>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="mb-4 space-y-1">
          {issues.map((issue) => (
            <li key={issue} className="text-xs text-warm-600">
              • {issue}
            </li>
          ))}
        </ul>
      )}

      {state.kind === "error" && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800"
        >
          {state.message}
        </p>
      )}

      <Button
        variant="primary"
        size="md"
        onClick={create}
        disabled={!canCreate || state.kind === "creating"}
        data-testid="interactive-create-button"
        data-interactive-create=""
      >
        {state.kind === "creating" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            Собираем игру…
          </>
        ) : (
          "Создать игру и получить QR"
        )}
      </Button>
    </Card>
  );
}

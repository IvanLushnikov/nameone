"use client";

/**
 * Детальная сводка по интерактиву (ТЗ §3, сценарий C, шаги 2–3).
 *
 * Три вещи, ради которых экран существует:
 *   1. таблица попыток: ученик, балл, процент, время;
 *   2. ТОП-3 ПРОВАЛЕННЫХ ВОПРОСОВ — главная ценность: учителю нужно знать, что
 *      объяснять в следующий раз, а не кто именно нажал не ту кнопку;
 *   3. «Выгрузить в CSV» — для журнала.
 *
 * Про «14 из 28 выполнили»: сколько ВСЕГО учеников, продукт не знает (список
 * класса не собираем, ТЗ §7). Учитель вводит ожидаемое число сам, оно
 * сохраняется через `PATCH /api/interactives/:id` (`expectedStudents`).
 * Пока число не задано, показываем честное «N выполнили» без выдуманной
 * второй цифры — придумывать «из 28» нельзя.
 *
 * Попытка без результата (`completed = false`) показывается отдельно: это
 * ученик, который закрыл вкладку, а не «ноль баллов». Разница принципиальная.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Download, TrendingDown } from "lucide-react";
import {
  fetchInteractiveCsv,
  getInteractive,
  getInteractiveAttempts,
  patchInteractive,
} from "@/lib/interactives/api";
import {
  INTERACTIVE_ERROR_MESSAGE,
  type AttemptRow,
  type InteractiveRecord,
  type ItemStat,
} from "@/lib/interactives/types";
import { formatDate } from "@/lib/utils/cn";
import { formatMeta } from "@/lib/interactives/formats";
import { trackEvent } from "@/lib/track";
import { ScreenError, ScreenUnauthorized } from "./Screens";

export function InteractiveDetail({ id }: { id: string }) {
  const [record, setRecord] = React.useState<InteractiveRecord | null>(null);
  const [attempts, setAttempts] = React.useState<AttemptRow[]>([]);
  const [hardest, setHardest] = React.useState<ItemStat[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [unauthorized, setUnauthorized] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [expected, setExpected] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const [info, list] = await Promise.all([getInteractive(id), getInteractiveAttempts(id)]);

    if (!info.ok) {
      setUnauthorized(info.error === "unauthorized");
      if (info.error !== "unauthorized") setError(INTERACTIVE_ERROR_MESSAGE[info.error]);
      setLoading(false);
      return;
    }
    setRecord(info.record);
    setExpected(
      info.record.expectedStudents !== null ? String(info.record.expectedStudents) : "",
    );
    if (list.ok) {
      setAttempts(list.attempts);
      setHardest(list.hardestItems);
    }
    setLoading(false);
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSaveExpected = async () => {
    if (!record || busy) return;
    const value = Number(expected);
    if (!Number.isFinite(value) || value < 0) {
      setError("Ожидаемое число учеников — целое число от 0");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await patchInteractive(record.id, "expected", {
      expectedStudents: Math.round(value),
    });
    setBusy(false);
    if (!res.ok) {
      setError(INTERACTIVE_ERROR_MESSAGE[res.error]);
      return;
    }
    setRecord({ ...record, expectedStudents: Math.round(value) });
  };

  const handleExport = async () => {
    if (!record || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetchInteractiveCsv(record.id);
    setBusy(false);
    if (!res.ok) {
      setError(INTERACTIVE_ERROR_MESSAGE[res.error]);
      return;
    }
    // Текст отдаём как есть: бэк кладёт UTF-8 BOM и разделитель `;` ради
    // русского Excel, перекодировать — значит сломать.
    const blob = new Blob([res.text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    trackEvent("interactive_csv_downloaded", { interactiveId: record.id });
  };

  if (loading) {
    return (
      <Card className="text-center py-10" aria-busy="true" data-testid="interactive-detail-loading">
        <p className="text-sm text-warm-500">Загружаем результаты…</p>
      </Card>
    );
  }

  if (unauthorized) return <ScreenUnauthorized />;

  if (!record) {
    return (
      <ScreenError
        message={error ?? INTERACTIVE_ERROR_MESSAGE.internal}
        onRetry={() => void load()}
        testId="interactive-detail-error"
      />
    );
  }

  const completed = attempts.filter((a) => a.completed);
  const percentAvg =
    completed.length > 0
      ? Math.round(completed.reduce((sum, a) => sum + a.percent, 0) / completed.length)
      : null;
  const expectedCount = record.expectedStudents;
  const meta = formatMeta(record.format);

  return (
    <div className="space-y-4" data-testid="interactive-detail">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-warm-950 break-words">{record.title}</h2>
            <p className="text-sm text-warm-500 mt-0.5">
              {meta.emoji} {meta.title} · выдан {formatDate(record.createdAt * 1000)}
            </p>
          </div>
          <Badge tone={record.status === "active" ? "success" : "neutral"}>
            {record.status === "active" ? "Открыт" : "В архиве"}
          </Badge>
        </div>

        {/* «14 из 28 выполнили» — вторая цифра только если учитель её назвал. */}
        <p className="mt-4 text-warm-800" data-testid="interactive-progress">
          Выполнили{" "}
          <span className="text-xl font-semibold text-warm-950">
            {completed.length}
          </span>{" "}
          {expectedCount !== null ? (
            <>
              из <span className="text-xl font-semibold text-warm-950">{expectedCount}</span>
            </>
          ) : (
            <span className="text-sm text-warm-500">
              {" "}
              — сколько всего учеников, укажите ниже
            </span>
          )}
          {percentAvg !== null && (
            <span className="ml-3 text-sm text-warm-600">
              средний {percentAvg}%
            </span>
          )}
        </p>

        {attempts.length > completed.length && (
          <p className="mt-1 text-xs text-amber-700">
            {attempts.length - completed.length}{" "}
            {attempts.length - completed.length === 1 ? "попытка не закончена" : "попытки не закончены"}
            : ученик закрыл вкладку, а не ответил неверно.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Input
              label="Учеников в классе"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              inputMode="numeric"
              placeholder="28"
              hint="Для сводки «14 из 28»"
            />
          </div>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void handleSaveExpected()}
          >
            Сохранить
          </Button>
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            leftIcon={<Download className="w-4 h-4" />}
            onClick={() => void handleExport()}
            data-testid="interactive-export-csv"
          >
            Выгрузить в CSV
          </Button>
          {record.shareUrl && (
            <Button
              as="link"
              href={record.shareUrl}
              variant="ghost"
              size="sm"
              target="_blank"
              rel="noreferrer"
            >
              Открыть ссылку для учеников
            </Button>
          )}
        </div>
      </Card>

      {/* Топ-3 проваленных вопросов — то, ради чего открывают этот экран. */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-4 h-4 text-warm-600" aria-hidden />
          <h3 className="font-semibold text-warm-950">Топ-3 вопроса, которые не зашли</h3>
        </div>
        {hardest.length === 0 ? (
          <p className="text-sm text-warm-500">
            Пока нет попыток, которые можно разобрать. Покажите QR на уроке или
            отправьте ссылку в классный чат.
          </p>
        ) : (
          <ol className="space-y-2">
            {hardest.slice(0, 3).map((stat, index) => (
              <li key={stat.itemId} className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-lg bg-warm-100 text-warm-700 grid place-items-center text-xs font-semibold">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-warm-950 break-words">{stat.prompt}</p>
                  <p className="text-xs text-warm-500 mt-0.5">
                    Верно {stat.correct} из {stat.answered} ·{" "}
                    {Math.round(stat.ratio * 100)}%
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card padded={false}>
        {attempts.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-warm-600">Попыток пока нет</p>
          </div>
        ) : (
          <ul className="divide-y divide-warm-100">
            {attempts.map((a) => (
              <li
                key={a.id}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
                data-testid={`attempt-row-${a.id}`}
              >
                <div className="min-w-0">
                  <span className="font-medium text-warm-950">{a.studentName}</span>
                  {a.studentClass && <Badge tone="info" className="ml-2">{a.studentClass}</Badge>}
                  {!a.completed && (
                    <span className="ml-2 text-xs text-amber-700">не закончил</span>
                  )}
                </div>
                <div className="text-sm text-warm-600 flex items-center gap-3">
                  <span>
                    {a.score} из {a.maxScore} · {a.percent}%
                  </span>
                  <span className="text-[color:var(--text-muted)]">
                    {a.durationS === null ? "—" : formatDuration(a.durationS)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Секунды → «3 мин 12 с». Дублируем из оболочки специально: разные слои. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} с`;
  const min = Math.floor(total / 60);
  const rest = total % 60;
  return rest > 0 ? `${min} мин ${rest} с` : `${min} мин`;
}

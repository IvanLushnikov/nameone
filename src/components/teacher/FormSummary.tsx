"use client";

/**
 * Сводка по выданной форме (TZ-12, этап 5, сценарий А, шаги 7–10).
 *
 * Ответ на вопрос учителя: «кто не сделал» — поэтому по умолчанию экран
 * «по ученикам» (ТЗ Решение 2, вариант А для этапа 5). Вкладка «по заданиям»
 * (гистограмма) сознательно отложена на этап 8.
 *
 * Что видно по ученику (DoD фронта): имя, код класса, балл, % верных, время
 * выполнения. Ответы раскрываются по клику на строку — рядом с каждым номером
 * задания зелёный/красный/жёлтый знак, где жёлтый = `needs_review`
 * (автосверка не смогла решить, ТЗ Решение 1). Мы не гадаем.
 *
 * ⚠️ подозрительно быстро — тот же античит-сигнал, что в ТЗ §5.3: фиксируем
 * `duration_sec` и помечаем работы быстрее 60 секунд. Это **не** блокировка и не
 * оценка: ученик просто идёт в конец очереди на ручную проверку.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { getForm, patchForm, fetchFormCsv } from "@/lib/forms/api";
import { FORM_ERROR_MESSAGE, type FormRecord, type FormResponse } from "@/lib/forms/types";
import { formatDate } from "@/lib/utils/cn";
import { trackEvent } from "@/lib/track";

/** Порог «подозрительно быстро», ТЗ §5.3. */
const SUSPICIOUS_SEC = 60;

export interface FormSummaryProps {
  formId: string;
  /** Кнопка «Назад к списку» — её рисует владелец экрана «Выданное». */
  onBack?: () => void;
}

export function FormSummary({ formId, onBack }: FormSummaryProps) {
  const [form, setForm] = React.useState<FormRecord | null>(null);
  const [responses, setResponses] = React.useState<FormResponse[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getForm(formId);
    if (!res.ok) {
      setError(FORM_ERROR_MESSAGE[res.error]);
      setLoading(false);
      return;
    }
    setForm(res.form);
    setResponses(res.responses);
    setLoading(false);
  }, [formId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleToggleStatus = async () => {
    if (!form || busy) return;
    setBusy(true);
    const action = form.status === "open" ? "close" : "reopen";
    const res = await patchForm(form.id, action);
    setBusy(false);
    if (!res.ok) {
      setError(FORM_ERROR_MESSAGE[res.error]);
      return;
    }
    trackEvent("form_status_changed", { action });
    void load();
  };

  const handleExport = async () => {
    if (!form || busy) return;
    setBusy(true);
    const res = await fetchFormCsv(form.id);
    setBusy(false);
    if (!res.ok) {
      setError(FORM_ERROR_MESSAGE[res.error]);
      return;
    }
    // Отдаём текст как есть: бэк уже положил UTF-8 BOM и разделитель `;`,
    // ради которых файл и делается (без «кракозябр» в русском Excel).
    const blob = new Blob([res.text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    trackEvent("form_csv_downloaded", { formId: form.id });
  };

  if (loading) {
    return (
      <Card className="text-center py-10" aria-busy="true" data-testid="form-summary-loading">
        <p className="text-sm text-warm-500">Загружаем ответы…</p>
      </Card>
    );
  }

  if (error && !form) {
    return (
      <Card className="text-center py-10" data-testid="form-summary-error">
        <p className="text-sm text-warm-600">{error}</p>
        <div className="mt-4 flex justify-center gap-2">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              К списку
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Попробовать ещё раз
          </Button>
        </div>
      </Card>
    );
  }

  if (!form) return null;

  const withScore = responses.filter((r) => r.scoreMax > 0);
  const avgPercent = withScore.length
    ? Math.round(
        withScore.reduce((acc, r) => acc + (r.scoreTotal / r.scoreMax) * 100, 0) /
          withScore.length,
      )
    : null;
  const needsReviewTotal = responses.reduce(
    (acc, r) => acc + r.answers.filter((a) => a.needsReview).length,
    0,
  );

  return (
    <div className="space-y-4" data-testid="form-summary">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-warm-950 break-words">{form.title}</h2>
            <p className="text-sm text-warm-500 mt-0.5">
              {form.subject} · {form.grade} класс · выдана{" "}
              {formatDate(new Date(form.createdAt * 1000))}
            </p>
          </div>
          <Badge tone={form.status === "open" ? "success" : "neutral"}>
            {form.status === "open" ? "Открыта" : "Закрыта"}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Отправили" value={String(responses.length)} />
          <Stat label="Средний %" value={avgPercent === null ? "—" : `${avgPercent}%`} />
          <Stat
            label="Ждут проверки"
            value={String(needsReviewTotal)}
            tone={needsReviewTotal > 0 ? "warm" : "neutral"}
          />
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant={form.status === "open" ? "secondary" : "primary"}
            size="sm"
            loading={busy}
            onClick={() => void handleToggleStatus()}
            data-testid="form-toggle-status"
          >
            {form.status === "open" ? "Закрыть форму" : "Открыть снова"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => void handleExport()}
            data-testid="form-export-csv"
          >
            Скачать в Excel
          </Button>
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Ко всем формам
            </Button>
          )}
        </div>
        {form.status === "open" && (
          <p className="mt-2 text-xs text-warm-500">
            После закрытия ученики не смогут отправить ответы, собранные ответы останутся.
          </p>
        )}
      </Card>

      {responses.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-sm text-warm-600">Ответов пока нет</p>
          <p className="text-sm text-warm-500 mt-1">
            Покажите QR на уроке или отправьте ссылку в классный чат.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-warm-100">
            {responses.map((r) => (
              <ResponseRow
                key={r.id}
                response={r}
                open={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warm";
}) {
  return (
    <div
      className={
        "rounded-xl px-3 py-2 " +
        (tone === "warm" ? "bg-warm-50" : "bg-warm-50/60")
      }
    >
      <div className="text-xs text-warm-500">{label}</div>
      <div className="text-lg font-semibold text-warm-950">{value}</div>
    </div>
  );
}

function ResponseRow({
  response,
  open,
  onToggle,
}: {
  response: FormResponse;
  open: boolean;
  onToggle: () => void;
}) {
  const percent =
    response.scoreMax > 0 ? Math.round((response.scoreTotal / response.scoreMax) * 100) : 0;
  const suspicious =
    response.durationSec !== null && response.durationSec < SUSPICIOUS_SEC;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-4 py-3 hover:bg-warm-50 transition-colors"
        data-testid={`response-row-${response.id}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-warm-950 truncate">{response.studentName}</span>
            {response.studentLabel && (
              <Badge tone="info">{response.studentLabel}</Badge>
            )}
            {suspicious && <span title="Подозрительно быстро">⚠️</span>}
          </div>
          <div className="text-sm text-warm-600 flex items-center gap-3">
            <span>
              {response.scoreTotal} из {response.scoreMax} · {percent}%
            </span>
            <span className="text-[color:var(--text-muted)]">
              {response.durationSec === null
                ? "—"
                : `${Math.max(1, Math.round(response.durationSec / 60))} мин`}
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 -mt-1">
          <ul className="grid gap-1">
            {response.answers.map((a) => (
              <li
                key={a.taskNumber}
                className="flex items-start gap-2 text-sm py-1 border-b border-warm-50 last:border-0"
              >
                <span className="shrink-0 w-6 text-[color:var(--text-muted)]">{a.taskNumber}.</span>
                <span className="flex-1 min-w-0 break-words text-warm-700">
                  {a.studentAnswer?.trim() ? a.studentAnswer : <em className="text-[color:var(--text-muted)]">без ответа</em>}
                </span>
                <span className="shrink-0">
                  {a.needsReview ? (
                    <span className="text-warm-600" title="Учитель проверит сам">
                      ?
                    </span>
                  ) : a.isCorrect ? (
                    <span className="text-emerald-600">✓</span>
                  ) : (
                    <span className="text-rose-600">✗</span>
                  )}
                </span>
                <span className="shrink-0 w-16 text-right text-[color:var(--text-muted)]">
                  {a.pointsAwarded} / {a.pointsMax}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

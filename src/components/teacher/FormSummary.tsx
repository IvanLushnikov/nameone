"use client";

/**
 * Сводка по выданной форме (ТЗ-12, этап 5, сценарий А, шаги 7–10; этап 8 — лист 6.1.7).
 *
 * Два вопроса учителя и два блока, в этом порядке:
 *   1. «где класс спотыкается, что переобъяснить» — блок «По заданиям» СВЕРХУ.
 *      Это то, ради чего учитель вообще открывает разбор: иначе он читает 30
 *      работ подряд и считает в уме. Считает `src/lib/lk/form-summary.ts`,
 *      здесь только рисуем.
 *   2. «кто не сделал» — список по ученикам (ТЗ Решение 2, вариант А).
 *
 * Честность блока «По заданиям» (лист 6.1.7):
 *   - «попыток не было» — отдельная секция, а НЕ «0 %». Пусто ≠ не усвоено.
 *   - «не уверен» (needsReview) — третье состояние: ни ошибка, ни успех.
 *   - рядом с процентом всегда сырые числа «N из M», чтобы порог экрана
 *     нельзя было принять за измерение.
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
import { getForm, patchForm, fetchFormCsv, reviewAnswer } from "@/lib/forms/api";
import {
  FORM_ERROR_MESSAGE,
  type FormRecord,
  type FormResponse,
  type FormResponseAnswer,
  type FormSourceTask,
} from "@/lib/forms/types";
import {
  buildTaskSummary,
  countsLabel,
  readTaskSnapshot,
  type TaskStats,
} from "@/lib/lk/form-summary";
import { formatDate } from "@/lib/utils/cn";
import { splitLatexBlocks } from "@/lib/math/latex";
import { trackEvent } from "@/lib/track";
import { Check, X } from "lucide-react";

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

  // Снимок заданий с эталонами по номеру: без него учитель в раскрытом ответе
  // видит только номера заданий и не понимает, что именно он проверяет.
  // Хук стоит ДО ранних возвратов — иначе порядок хуков «едет» между рендерами.
  const taskByNumber = React.useMemo(() => {
    const map = new Map<number, FormSourceTask>();
    for (const t of form?.tasks ?? []) map.set(t.number, t);
    return map;
  }, [form]);

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
  // Снимок заданий бэк отдаёт, но тип `FormRecord` его не объявляет — читаем
  // осторожно, через `readTaskSnapshot` (битый снимок = «данных пока нет»).
  const summary = buildTaskSummary({
    responses,
    tasks: readTaskSnapshot(form),
  });

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

      {/* Слабое место видно ДО списка работ: учитель не должен открывать 30 работ,
          чтобы узнать, что класс спотыкается на третьем задании. */}
      <TaskBreakdown summary={summary} />

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
                formId={form.id}
                response={r}
                tasks={taskByNumber}
                open={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                onReviewed={() => void load()}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * «По заданиям» — ответ на вопрос «что переобъяснить» (ТЗ-12, этап 8).
 *
 * Порядок блоков внутри карточки тоже продуктовый:
 *   1. что делать (худшие задания),
 *   2. задания без единой попытки — ОТДЕЛЬНО и в конце, с явным «это не
 *      значит, что тема не усвоена»,
 *   3. задания, где всё в порядке, — короткой строкой.
 */
/**
 * Текст задания одной строкой: формулы — читаемым текстом, без `$\frac…$`.
 *
 * В сводке формулу рисовать негде (строка короткая, это не лист), а показать
 * учителю `$\frac{1}{2}$` — значит заставить его читать исходник. Берём
 * `splitLatexBlocks`: в ответе бэк у задания может не быть `text_latex`, а
 * `parseMathText` в этом случае уходит в legacy-режим и `$...$` не трогает.
 */
function readableTaskText(raw: string): string {
  const flat = splitLatexBlocks(raw)
    .map((s) => (s.type === "math" ? s.fallback : s.value))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 90 ? `${flat.slice(0, 89).trimEnd()}…` : flat;
}

function TaskBreakdown({ summary }: { summary: ReturnType<typeof buildTaskSummary> }) {
  return (
    <Card data-testid="form-task-summary">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-warm-950">По заданиям</h3>
        {summary.reteach.length > 0 ? (
          <Badge tone="danger">
            переобъяснить: {summary.reteach.length}
          </Badge>
        ) : null}
      </div>

      <p className="mt-2 text-sm font-medium text-warm-950">{summary.headline}</p>
      <p className="mt-1 text-sm text-warm-600">{summary.detail}</p>

      {summary.dataNote && (
        <p className="mt-3 rounded-lg bg-warm-50 px-3 py-2 text-xs text-warm-600">
          {summary.dataNote}
        </p>
      )}

      {summary.reteach.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {summary.reteach.map((row) => (
            <TaskRow key={row.taskNumber} row={row} />
          ))}
        </ul>
      )}

      {summary.fewAttempts.length > 0 && (
        <div className="mt-4 rounded-xl border border-warm-100 p-3">
          <div className="text-xs font-medium text-warm-700">
            Ответов мало — смотрите работы сами ({summary.fewAttempts.length})
          </div>
          <ul className="mt-2 grid gap-1.5">
            {summary.fewAttempts.map((row) => (
              <li key={row.taskNumber} className="text-xs text-warm-600">
                <span className="font-medium text-warm-800">{row.label}</span>
                {row.text ? ` — ${readableTaskText(row.text)}` : ""}
                {`: ответили ${row.attempts}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.noAttempts.length > 0 && (
        <div className="mt-4 rounded-xl border border-warm-100 p-3">
          <div className="text-xs font-medium text-warm-700">
            Попыток не было ({summary.noAttempts.length}) — это не «не усвоено»
          </div>
          <ul className="mt-2 grid gap-1.5">
            {summary.noAttempts.map((row) => (
              <li key={row.taskNumber} className="text-xs text-warm-600">
                <span className="font-medium text-warm-800">{row.label}</span>
                {row.text ? ` — ${readableTaskText(row.text)}` : ""}
                {row.skipped > 0 ? `: оставили пустым ${row.skipped}` : ": никто не открывал"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.ok.length > 0 && (
        <details className="mt-3" data-testid="form-task-ok">
          <summary className="cursor-pointer text-xs text-warm-500 hover:text-warm-700">
            Задания, где всё в порядке ({summary.ok.length})
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {summary.ok.map((row) => (
              <TaskRow key={row.taskNumber} row={row} compact />
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function TaskRow({ row, compact = false }: { row: TaskStats; compact?: boolean }) {
  const percent = row.successPercent;
  const barColor =
    row.verdict === "reteach"
      ? "bg-rose-400"
      : row.verdict === "few_attempts"
        ? "bg-warm-300"
        : "bg-emerald-400";

  return (
    <li
      className={
        compact
          ? "text-xs text-warm-700 border-b border-warm-50 pb-2 last:border-0"
          : "rounded-xl bg-warm-50/60 px-3 py-2.5"
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={compact ? "" : "text-sm font-medium text-warm-950"}>{row.label}</span>
        <span className="text-xs text-warm-600 tabular-nums">
          {countsLabel(row)}
          {percent === null ? "" : ` · ${percent}%`}
        </span>
      </div>

      {row.text && (
        <p className={compact ? "mt-0.5 line-clamp-2" : "mt-0.5 text-sm text-warm-700"}>
          {readableTaskText(row.text)}
        </p>
      )}

      {!compact && row.attempts > 0 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-warm-100">
          <div className={`h-full ${barColor}`} style={{ width: `${percent ?? 0}%` }} />
        </div>
      )}

      <div className={compact ? "mt-1 text-warm-500" : "mt-2 text-xs text-warm-600"}>
        {row.action}
      </div>

      {!compact && row.unsure > 0 && (
        <p className="mt-1 text-xs text-warm-600">
          Не уверены: {row.unsure} — модель не смогла решить, это не ошибка и не «верно».
          Смотрите сами.
        </p>
      )}
    </li>
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

/**
 * Как показать ответ ученика учителю.
 *
 * Для заданий с выбором ученик отправляет ИНДЕКС варианта («2»), а учителю
 * показывать индекс бессмысленно — он не знает, что за «2» стоит, и сверяет
 * работу по невидимому правильному ответу. Показываем текст выбранного
 * варианта. Если вариантов в снимке нет или индекс не в границах — оставляем
 * как есть: лучше показать сырое значение, чем ничего.
 */
function formatStudentAnswer(
  task: FormSourceTask | undefined,
  studentAnswer: string | null | undefined,
): string | null {
  const raw = studentAnswer?.trim() ? studentAnswer : null;
  if (!raw || !task || task.type !== "multiple-choice" || !task.options?.length) return raw;
  const idx = Number.parseInt(raw, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= task.options.length) return raw;
  return task.options[idx] ?? raw;
}

/**
 * Эталон так же: у multiple-choice он хранится индексом, и «Правильный ответ: 2»
 * для учителя — тоже мусор. Показываем текст варианта.
 */
function formatExpectedAnswer(task: FormSourceTask | undefined): string | null {
  const raw = task?.answer?.trim() ? task.answer : null;
  if (!raw || !task || task.type !== "multiple-choice" || !task.options?.length) return raw;
  const idx = Number.parseInt(raw, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= task.options.length) return raw;
  return task.options[idx] ?? raw;
}

function ResponseRow({
  formId,
  response,
  tasks,
  open,
  onToggle,
  onReviewed,
}: {
  formId: string;
  response: FormResponse;
  tasks: Map<number, FormSourceTask>;
  open: boolean;
  onToggle: () => void;
  onReviewed: () => void;
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
            {response.answers.map((a) => {
              const task = tasks.get(a.taskNumber);
              const shownAnswer = formatStudentAnswer(task, a.studentAnswer);
              /**
               * Панель проверки нужна в двух случаях, а не в одном:
               *  - ответ ждёт учителя (эссе, нет эталона);
               *  - автосверка поставила минус. Это тот же «тупик», который
               *    починили: система честно говорит «не совпало», но если
               *    формулировка верная, а записана иначе, учитель обязан суметь
               *    поставить балл. Без панели такой ответ закрывался навсегда.
               */
              const needsAttention =
                a.needsReview || (a.checkMethod === "auto" && !a.isCorrect);
              return (
              <li
                key={a.taskNumber}
                className="text-sm py-1 border-b border-warm-50 last:border-0"
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 w-6 text-[color:var(--text-muted)]">{a.taskNumber}.</span>
                  <span className="flex-1 min-w-0 break-words text-warm-700">
                    {shownAnswer ?? <em className="text-[color:var(--text-muted)]">без ответа</em>}
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
                </div>

                {needsAttention ? (
                  <ReviewBox
                    formId={formId}
                    responseId={response.id}
                    answer={a}
                    task={task}
                    mode={a.needsReview ? "review" : "fix"}
                    onSaved={onReviewed}
                  />
                ) : (
                  a.teacherComment && (
                    <p className="ml-8 mt-1 text-xs text-warm-600 border-l-2 border-warm-200 pl-2">
                      {a.teacherComment}
                    </p>
                  )
                )}
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * Ручная проверка одного ответа (12.10.2026).
 *
 * Это блок, которого не было: сводка писала «ждут проверки 3» и на этом
 * заканчивалась — поставить балл было нечем, флоу учителя упирался в тупик.
 *
 * Что видит учитель и почему именно это:
 *   - текст задания и правильный ответ — без них он проверяет «номер 3», а не
 *     задание; раньше в сводке их не было вовсе;
 *   - «Верно» / «Неверно» — закрывают задание в один клик для 90% случаев;
 *   - поле балла появляется ТОЛЬКО когда за задание больше одного балла: при
 *     одном балле «верно» и «1 балл» — одно и то же, лишнее поле только
 *     мешает;
 *   - комментарий необязательный: он остаётся в кабинете и виден учителю,
 *     ученику не показывается.
 */
function ReviewBox({
  formId,
  responseId,
  answer,
  task,
  mode = "review",
  onSaved,
}: {
  formId: string;
  responseId: string;
  answer: FormResponseAnswer;
  task: FormSourceTask | undefined;
  /** `review` — ответ ждал учителя. `fix` — автоматика поставила минус, учитель его перебивает. */
  mode?: "review" | "fix";
  onSaved: () => void;
}) {
  const [verdict, setVerdict] = React.useState<boolean | null>(null);
  const [points, setPoints] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const maxPoints = answer.pointsMax;
  const showPointsField = maxPoints > 1;

  const save = async () => {
    if (verdict === null || saving) return;

    let pointsAwarded: number | undefined;
    if (showPointsField) {
      // Пустое поле — это не «ноль баллов». Учитель нажал «Верно» и просто не
      // стал трогать поле: Number("") даёт 0, и раньше ответ уезжал как
      // «верно, 0 баллов». Пустое = полный балл при «Верно», ноль при «Неверно».
      const trimmed = points.trim();
      if (trimmed !== "") {
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxPoints) {
          setError(`Балл должен быть целым числом от 0 до ${maxPoints}`);
          return;
        }
        pointsAwarded = parsed;
      }
    }

    setSaving(true);
    setError(null);
    const res = await reviewAnswer({
      formId,
      responseId,
      taskNumber: answer.taskNumber,
      isCorrect: verdict,
      ...(pointsAwarded === undefined ? {} : { pointsAwarded }),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
    setSaving(false);

    if (!res.ok) {
      setError(FORM_ERROR_MESSAGE[res.error]);
      return;
    }
    trackEvent("form_answer_reviewed", {
      isCorrect: verdict,
      hasComment: Boolean(comment.trim()),
    });
    onSaved();
  };

  return (
    <div
      className="ml-8 mt-2 mb-2 rounded-xl border border-warm-200 bg-warm-50/50 p-3"
      data-testid={`review-box-${answer.taskNumber}`}
    >
      {task?.text && (
        <p className="text-sm text-warm-800 break-words">{task.text}</p>
      )}
      {formatExpectedAnswer(task) && (
        <p className="mt-1 text-xs text-warm-600">
          Правильный ответ: <span className="text-warm-800">{formatExpectedAnswer(task)}</span>
        </p>
      )}
      {mode === "fix" && (
        <p className="mt-1 text-xs text-warm-600">
          Автопроверка не засчитала ответ. Если ученик прав, а записал иначе —
          поставьте балл здесь.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={verdict === true ? "primary" : "secondary"}
          aria-pressed={verdict === true}
          onClick={() => setVerdict(true)}
          leftIcon={<Check className="w-4 h-4" />}
          data-testid={`review-yes-${answer.taskNumber}`}
        >
          Верно
        </Button>
        <Button
          type="button"
          size="sm"
          variant={verdict === false ? "dark" : "secondary"}
          aria-pressed={verdict === false}
          onClick={() => setVerdict(false)}
          leftIcon={<X className="w-4 h-4" />}
          data-testid={`review-no-${answer.taskNumber}`}
        >
          Неверно
        </Button>

        {showPointsField && (
          <label className="flex items-center gap-2 text-sm text-warm-700">
            Балл
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={maxPoints}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="0"
              className="w-16 h-9 px-2 text-sm bg-white border border-warm-200 rounded-lg text-warm-950 focus:outline-none focus:border-brand-500"
              data-testid={`review-points-${answer.taskNumber}`}
            />
            <span className="text-[color:var(--text-muted)]">из {maxPoints}</span>
          </label>
        )}
      </div>

      <input
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Комментарий учителя (необязательно)"
        maxLength={500}
        className="mt-3 w-full h-9 px-3 text-sm bg-white border border-warm-200 rounded-lg text-warm-950 placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-brand-500"
        data-testid={`review-comment-${answer.taskNumber}`}
      />

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={verdict === null}
          loading={saving}
          onClick={() => void save()}
          data-testid={`review-save-${answer.taskNumber}`}
        >
          Сохранить оценку
        </Button>
        {verdict === null && (
          <span className="text-xs text-[color:var(--text-muted)]">
            Выберите «Верно» или «Неверно»
          </span>
        )}
      </div>
    </div>
  );
}

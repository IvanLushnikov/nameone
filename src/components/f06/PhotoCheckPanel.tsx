"use client";

/**
 * Панель «Проверка работ по фото» (TZ-11, F-06).
 *
 * Контракт props НЕ МЕНЯЛИ — он согласован точкой вызова в конструкторе
 * (`src/app/constructor/page.tsx`): `assignmentId` / `demoTasks` / `onResult`.
 * Переписан только стаб внутри, как и требовало ТЗ §4.5.
 *
 * Пять состояний сценария §3:
 *   idle   — инструкция, согласие, выбор фото (шаги 1-2)
 *   file   — фото выбрано, эталон подставлен, ждём кнопки «Проверить» (шаги 3)
 *   pending— запрос ушёл, «Распознаём ответы…» (шаг 4)
 *   result — таблица с вердиктами (шаг 5)
 *   error  — понятная ошибка и возможность повторить
 *
 * Идентификатор вида `local-ws_xxx` означает, что лист НЕ сохранён в D1 —
 * поэтому эталон всегда уходит в теле запроса, серверной зависимости от
 * сохранённого листа нет (ТЗ §2.1).
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PhotoUpload } from "./PhotoUpload";
import { PhotoCheckResultView } from "./PhotoCheckResult";
import {
  deletePhotoCheck,
  runPhotoCheck,
  type PhotoCheckApiError,
} from "@/lib/photo-check/api";
import type { PhotoCheckResult, PhotoCheckTask } from "@/lib/photo-check/types";
import { trackEvent } from "@/lib/track";

/** Эталонное задание в том виде, в каком его прокидывает конструктор. */
export interface PhotoCheckTaskInput {
  number: number;
  taskText: string;
  correctAnswer: string;
  maxPoints: number;
}

export interface PhotoCheckPanelProps {
  assignmentId: string;
  demoTasks: PhotoCheckTaskInput[];
  onResult?: (r: { source?: string; percentage?: number }) => void;
}

type ViewState = "idle" | "pending" | "result" | "error";

export function PhotoCheckPanel({
  assignmentId,
  demoTasks,
  onResult,
}: PhotoCheckPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<ViewState>("idle");
  const [result, setResult] = useState<PhotoCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);

  // `local-ws_xxx` — лист не в D1, эталон уходит телом запроса.
  const worksheetId = useMemo(
    () => (assignmentId.startsWith("ws_") ? assignmentId : null),
    [assignmentId],
  );

  const tasks: PhotoCheckTask[] = useMemo(
    () =>
      demoTasks.map((t) => ({
        number: t.number,
        taskText: t.taskText,
        correctAnswer: t.correctAnswer,
        maxPoints: t.maxPoints,
      })),
    [demoTasks],
  );

  const canSubmit = file !== null && consent && state !== "pending" && tasks.length > 0;

  async function submit() {
    if (!file) return;
    setState("pending");
    setError(null);

    const res = await runPhotoCheck({
      blob: file,
      tasks,
      worksheetId,
      detail: "low", // черновик/массовая проверка — экономит токены картинки
    });

    if (res.ok) {
      setResult(res);
      setState("result");
      onResult?.({ source: "photo", percentage: res.percentage ?? undefined });
      trackEvent("photo_check_done", {
        source: "photo",
        percentage: res.percentage ?? undefined,
        needs_review: res.needsReview,
      });
      return;
    }

    const err = res as PhotoCheckApiError;
    setError(err.message ?? "Не удалось проверить фото");
    setState("error");
    trackEvent("photo_check_failed", { error: err.error });
  }

  /** В-2.3: удалить фото одной кнопкой, оставив результаты. */
  async function removePhoto() {
    if (!result) return;
    setDeleting(true);
    const res = await deletePhotoCheck(result.checkId);
    setDeleting(false);
    if (res.ok) {
      setResult({ ...result, photoDeleteAt: 0 });
      trackEvent("photo_check_photo_deleted", { check_id: result.checkId });
    } else {
      setError(res.message ?? "Не удалось удалить фото");
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setState("idle");
  }

  return (
    <Card className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-warm-950">Проверка работ по фото</h2>
        <p className="text-sm text-warm-600 mt-1">
          Сфотографируйте страницу тетради с ответами. Одна страница — одно фото.
          Будем сверять с эталоном по {tasks.length}{" "}
          {plural(tasks.length, "заданию", "заданиям", "заданиям")}.
        </p>
      </header>

      {state === "result" && result ? (
        <PhotoCheckResultView
          result={result}
          onDeletePhoto={removePhoto}
          checkId={result.checkId}
          onPrint={() => {
            if (typeof window !== "undefined") window.print();
          }}
          deleting={deleting}
        />
      ) : (
        <>
          {/* ── Шаги 1-2: согласие и фото ─────────────────────────────── */}
          <PhotoUpload
            file={file}
            onFileChange={setFile}
            consentAccepted={consent}
            onConsentChange={setConsent}
            disabled={state === "pending"}
          />

          {/* ── Шаг 3: эталон подставляется автоматически ─────────────── */}
          {tasks.length > 0 && (
            <details
              open={tasksOpen}
              onToggle={(e) => setTasksOpen(e.currentTarget.open)}
              className="rounded-xl border border-warm-100 bg-warm-50/60 px-3.5 py-2.5"
            >
              <summary className="text-sm text-warm-700 cursor-pointer select-none">
                Посмотреть задания и эталоны ({tasks.length})
              </summary>
              <ul className="mt-2.5 space-y-1.5 text-xs text-warm-700">
                {tasks.map((t) => (
                  <li key={t.number} className="flex gap-2">
                    <span className="text-[color:var(--text-muted)] shrink-0 w-5">{t.number}.</span>
                    <span>
                      <span className="text-warm-900">{t.taskText}</span>
                      <span className="block text-warm-500">
                        эталон: {t.correctAnswer} · {t.maxPoints} б.
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {error && (
            <p role="status" className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* ── Шаг 4: отправка ──────────────────────────────────────── */}
          {state === "pending" ? (
            <p role="status" className="text-sm text-warm-700 text-center py-2">
              <span className="inline-block w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin align-middle mr-2" />
              Распознаём ответы… обычно 10–30 секунд
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                // `loading` здесь не нужен: эта ветка рендерится только когда
                // `state !== "pending"` (ветка выше), так что условие
                // `state === "pending"` здесь всегда false. Спиннер показывает
                // та же ветка отдельным блоком с текстом «Распознаём ответы…».
              >
                Проверить
              </Button>
              {!consent && (
                <span className="text-xs text-warm-500">
                  Отметьте согласие на обработку персональных данных, чтобы
                  загрузить фото
                </span>
              )}
              {state === "error" && (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  Сначала
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Русская плюрализация: 1 задание / 2 задания / 5 заданий. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

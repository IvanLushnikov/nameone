"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Clock, Download, FileArchive, FileText, Presentation as PresentationIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BundleSlot, LessonBundle } from "@/lib/types";
import { generateBundleZip, bundleZipFilename, bundleReadyCount, downloadBlob } from "@/lib/utils/bundle-zip";
import { pluralizeFiles } from "@/lib/utils/cn";

interface Props {
  bundle: LessonBundle;
  /** Колбэк после успешного скачивания ZIP (для тоста, опционально). */
  onDownload?: (filename: string) => void;
}

/** Человекочитаемое название слота — учитель не должен гадать, что такое «test». */
const SLOT_LABEL: Record<BundleSlot, string> = {
  "lesson-plan": "План урока",
  presentation: "Презентация",
  worksheet: "Рабочий лист",
  test: "Тест",
};

/** Формат файла слота внутри ZIP — учитель должен знать, что откроет. */
const SLOT_FORMAT: Record<BundleSlot, string> = {
  "lesson-plan": "DOCX",
  presentation: "PPTX",
  worksheet: "DOCX",
  test: "DOCX",
};

/** Порядок слотов совпадает с порядком в LessonBundle и в ZIP. */
const SLOT_ORDER: BundleSlot[] = ["lesson-plan", "presentation", "worksheet", "test"];

function iconFor(slot: BundleSlot) {
  if (slot === "presentation") return <PresentationIcon className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

/** Статус слота: готово / не удалось. Других состояний после сборки не бывает. */
function slotStatus(bundle: LessonBundle, slot: BundleSlot) {
  const failedReason = bundle.failed.find((f) => f.slot === slot)?.reason;
  const value =
    slot === "lesson-plan" ? bundle.lessonPlan :
    slot === "presentation" ? bundle.presentation :
    slot === "worksheet" ? bundle.worksheet :
    bundle.test;

  if (value) return { ok: true as const, reason: null };
  return {
    ok: false as const,
    // Слот без записи в `failed` — это таймаут пакета, а не отказ конкретного
    // слота: показываем это прямо, иначе причина выглядит неизвестной.
    reason: failedReason ?? "не удалось подготовить файл",
  };
}

/**
 * TZ-16 §3.4: превью комплекта «Урок целиком».
 *
 * ГЛАВНЫЙ РИСК, ОТДЕЛЬНО НАЗВАННЫЙ В ТЗ: пакет из 4 моков не имеет ценности —
 * он показывает учителю 4 заглушки, которые выглядят как готовый результат.
 * Поэтому здесь каждый слот имеет ЯВНЫЙ статус, и слот, который не собрался,
 * показывается как ошибка с причиной, а не как пустой блок в общем списке.
 *
 * Плюс честная строка итога: «3 из 4 готовы» + перечисление причин отказа.
 * Учитель сразу видит, что получит в архиве ровно 3 файла, а не 4.
 */
export function LessonBundlePreview({ bundle, onDownload }: Props) {
  const [exporting, setExporting] = React.useState(false);

  const ready = bundleReadyCount(bundle);
  const total = SLOT_ORDER.length;

  const handleDownload = async () => {
    if (exporting || ready === 0) return;
    setExporting(true);
    try {
      const blob = await generateBundleZip(bundle);
      const filename = bundleZipFilename(bundle);
      downloadBlob(blob, filename);
      onDownload?.(filename);
    } finally {
      setExporting(false);
    }
  };

  if (ready === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-accent-300 bg-accent-50 p-8 text-center">
        <AlertCircle className="w-8 h-8 mx-auto text-accent-500" />
        <h2 className="text-base font-semibold text-warm-900 mt-3">Комплект не собрался</h2>
        <p className="text-sm text-warm-600 mt-1 max-w-md mx-auto">
          Не удалось подготовить ни один файл. Попробуйте ещё раз — если повторяется, выберите другую тему.
        </p>
        {bundle.failed.length > 0 && (
          <ul className="mt-4 mx-auto max-w-md space-y-1 text-left">
            {bundle.failed.map((f) => (
              <li key={f.slot} className="text-xs text-warm-600">
                <span className="font-semibold">{SLOT_LABEL[f.slot]}:</span> {f.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Шапка: название комплекта, честный счётчик готовых слотов, кнопка ZIP */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-warm-500 font-semibold flex items-center gap-1.5">
            <FileArchive className="w-3.5 h-3.5" />
            Урок целиком
          </div>
          <h2 className="text-xl font-semibold text-warm-950 mt-1 break-words">{bundle.title}</h2>
          <p className="text-sm text-warm-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>
              Готово {ready} из {total} · {ready}{" "}
              {pluralizeFiles(ready)} в архиве
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {bundle.totalMs < 1000
                ? `${bundle.totalMs} мс`
                : `${Math.round(bundle.totalMs / 1000)} сек`}
            </span>
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Download className="w-4 h-4" />}
          onClick={handleDownload}
          loading={exporting}
        >
          Скачать ZIP
        </Button>
      </div>

      {/* 4 слота, у каждого явный статус: готово (зелёный) / отказ с причиной */}
      <ul className="space-y-2">
        {SLOT_ORDER.map((slot) => {
          const status = slotStatus(bundle, slot);
          return (
            <li
              key={slot}
              data-testid={`bundle-slot-${slot}`}
              data-status={status.ok ? "ready" : "failed"}
              className={
                status.ok
                  ? "flex items-start gap-3 rounded-xl border border-warm-200 bg-white px-4 py-3"
                  : "flex items-start gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3"
              }
            >
              <div className={`mt-0.5 shrink-0 ${status.ok ? "text-warm-500" : "text-accent-500"}`}>
                {iconFor(slot)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-warm-950">{SLOT_LABEL[slot]}</span>
                  {status.ok ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                      <CheckCircle2 className="w-3 h-3" />
                      Готов
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-800">
                      <AlertCircle className="w-3 h-3" />
                      Не получилось
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-warm-500">
                  <span className="font-mono">{SLOT_FORMAT[slot]}</span>
                  <span aria-hidden="true">·</span>
                  {status.ok ? (
                    <span>файл попадёт в архив</span>
                  ) : (
                    <span className="text-accent-700 break-words">Причина: {status.reason}</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Итог по частичным отказам — чтобы учитель не удивился 3 файлам вместо 4 */}
      {bundle.failed.length > 0 && (
        <div className="rounded-xl border border-accent-200 bg-accent-50 px-4 py-3">
          <p className="text-sm font-semibold text-warm-900">
            Собрано {ready} из {total} — остальные можно дозаказать отдельно
          </p>
          <ul className="mt-1.5 space-y-1">
            {bundle.failed.map((f) => (
              <li key={f.slot} className="text-xs text-warm-600">
                <span className="font-semibold">{SLOT_LABEL[f.slot]}</span> — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-warm-500 flex items-start gap-1.5">
        <FileArchive className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Архив собирается в браузере. DOCX открывается в Word, LibreOffice и Google Docs,
          PPTX — в PowerPoint, Keynote и Google Slides.
        </span>
      </p>
    </div>
  );
}

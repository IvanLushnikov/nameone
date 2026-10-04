"use client";

import * as React from "react";
import { Download, FileArchive, FileText, FolderOpen, Table2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { MaterialBundle, MaterialFile, MaterialFileKind } from "@/lib/types";
import {
  generateMaterialsZip,
  materialsZipFilename,
  materialFilename,
  materialFormatLabel,
  downloadBlob,
} from "@/lib/utils/materials-zip";

interface Props {
  bundle: MaterialBundle;
  /** Колбэк после успешного скачивания ZIP (для тоста, опционально). */
  onDownload?: (filename: string) => void;
}

/** Kind → человекочитаемое название (учитель не должен гадать, что такое «glossary»). */
const KIND_LABEL: Record<MaterialFileKind, string> = {
  glossary: "Словарь",
  reference: "Справочные данные",
  handout: "Раздатка",
  checklist: "Чек-лист",
};

/** Иконка по типу файла внутри архива. */
function iconFor(format: MaterialFile["format"]) {
  if (format === "csv") return <Table2 className="w-4 h-4" />;
  if (format === "docx") return <FileText className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

/**
 * Приблизительный размер: DOCX весит сильно больше исходного текста
 * (служебные XML внутри), поэтому для него — округлённая оценка «от 30 КБ».
 * Для CSV/TXT считаем по длине текста в UTF-8.
 */
function approxSize(file: MaterialFile): string {
  if (file.format === "docx") return "≈ 30–60 КБ";
  const bytes = new TextEncoder().encode(file.content).length;
  if (bytes < 1024) return `≈ ${bytes} Б`;
  return `≈ ${Math.round(bytes / 1024)} КБ`;
}

/**
 * TZ-16 §3.2: превью комплекта «Материалы».
 *
 * Показывает список файлов, которые попадут в ZIP: название, тип человеческим
 * языком, формат и примерный размер. Пустой комплект (`files: []`) — это
 * не ошибка, а «тема не нашлась в таксономии»: показываем понятное объяснение
 * вместо пустого экрана (тот же приём, что в LessonPlanPreview).
 */
export function MaterialsPreview({ bundle, onDownload }: Props) {
  const [exporting, setExporting] = React.useState(false);

  const handleDownload = async () => {
    if (exporting || bundle.files.length === 0) return;
    setExporting(true);
    try {
      const blob = await generateMaterialsZip(bundle);
      const filename = materialsZipFilename(bundle);
      downloadBlob(blob, filename);
      onDownload?.(filename);
    } finally {
      setExporting(false);
    }
  };

  if (bundle.files.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-warm-300 bg-warm-50 p-8 text-center">
        <FolderOpen className="w-8 h-8 mx-auto text-warm-600" />
        <h2 className="text-base font-semibold text-warm-900 mt-3">Файлы не собрались</h2>
        <p className="text-sm text-warm-600 mt-1 max-w-md mx-auto">
          Тема «{bundle.topic}» не найдена в списке тем предмета, поэтому комплект собрать не из чего.
          Выберите тему из подсказок при выборе предмета и класса — и файлы появятся.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Шапка: название комплекта + кнопка скачивания ZIP */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-warm-500 font-semibold flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5" />
            Материалы
          </div>
          <h2 className="text-xl font-semibold text-warm-950 mt-1 truncate">{bundle.title}</h2>
          <p className="text-sm text-warm-500 mt-0.5">
            {bundle.subject} · {bundle.grade} класс · {bundle.files.length}{" "}
            {bundle.files.length === 1 ? "файл" : bundle.files.length < 5 ? "файла" : "файлов"} в архиве
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

      {/* Список файлов комплекта */}
      <ul className="space-y-2">
        {bundle.files.map((file, i) => (
          <li
            key={file.id || `${file.kind}-${i}`}
            className="flex items-start gap-3 rounded-xl border border-warm-200 bg-white px-4 py-3"
          >
            <div className="mt-0.5 text-warm-500 shrink-0">{iconFor(file.format)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-warm-950">{file.title}</span>
                <span className="inline-block rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                  {KIND_LABEL[file.kind]}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-warm-500">
                <span className="font-mono">{materialFormatLabel(file.format)}</span>
                <span aria-hidden="true">·</span>
                <span>{approxSize(file)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono truncate">{materialFilename(file, i)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-warm-500 flex items-start gap-1.5">
        <FileArchive className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Архив собирается в браузере. CSV открывается в Excel и LibreOffice с русским текстом
          (кодировка UTF-8), DOCX — в Word, LibreOffice и Google Docs.
        </span>
      </p>
    </div>
  );
}

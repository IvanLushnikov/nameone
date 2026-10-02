"use client";

import * as React from "react";
import type { Presentation, Slide } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Download, Presentation as PresentationIcon } from "lucide-react";
import { generatePptx, pptxFilename, downloadBlob } from "@/lib/utils/pptx";

interface Props {
  presentation: Presentation;
  /** Колбэк для тоста/уведомления об успешном скачивании (опционально). */
  onDownload?: (filename: string) => void;
}

/**
 * Список миниатюр слайдов презентации (НЕ полноценный viewer).
 *
 * Layout:
 *   - desktop: grid 3 колонки (lg:grid-cols-3 sm:grid-cols-2 grid-cols-1).
 *   - каждая миниатюра — aspect-video, белый фон, бордер.
 *   - первый слайд — с плашкой «Титульный».
 *   - справа сверху — кнопка «Скачать PPTX».
 */
export function PresentationPreview({ presentation, onDownload }: Props) {
  const [exporting, setExporting] = React.useState(false);

  const handleDownload = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await generatePptx(presentation);
      const filename = pptxFilename(presentation);
      downloadBlob(blob, filename);
      onDownload?.(filename);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Шапка: заголовок + кнопка скачивания */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-warm-500 font-semibold flex items-center gap-1.5">
            <PresentationIcon className="w-3.5 h-3.5" />
            Презентация
          </div>
          <h2 className="text-xl font-semibold text-warm-950 mt-1 truncate">{presentation.title}</h2>
          <p className="text-sm text-warm-500 mt-0.5">
            {presentation.subject} · {presentation.grade} класс · {presentation.slides.length} слайдов
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Download className="w-4 h-4" />}
            onClick={handleDownload}
            loading={exporting}
          >
            Скачать PPTX
          </Button>
        </div>
      </div>

      {/* Сетка миниатюр */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {presentation.slides.map((slide, idx) => (
          <SlideThumbnail
            key={`${idx}-${slide.kind}`}
            slide={slide}
            index={idx}
            total={presentation.slides.length}
          />
        ))}
      </div>
    </div>
  );
}

interface ThumbProps {
  slide: Slide;
  index: number;
  total: number;
}

/**
 * Миниатюра одного слайда. CSS-упрощённая имитация layout без рендера в canvas/svg — шрифт системный,
 * без вырвиглазия, чтобы не спорить с реальным рендером в PowerPoint.
 */
function SlideThumbnail({ slide, index, total }: ThumbProps) {
  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";

  return (
    <article
      className="relative aspect-video bg-white border border-warm-200 rounded-xl overflow-hidden shadow-soft hover:border-brand-300 transition-colors"
      aria-label={`Слайд ${index + 1} из ${total}: ${slide.title}`}
    >
      {/* Плашка вида слайда (title / summary) */}
      {(isTitle || isSummary) && (
        <span
          className={`absolute top-2 left-2 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
            isTitle ? "bg-brand-500 text-white" : "bg-accent-500 text-white"
          }`}
        >
          {isTitle ? "Титульный" : "Итоги"}
        </span>
      )}

      {/* Номер слайда */}
      <span className="absolute top-2 right-2 text-[10px] text-[color:var(--text-muted)] font-mono">
        {index + 1} / {total}
      </span>

      {/* Контент */}
      <div className="absolute inset-0 p-4 sm:p-5 flex flex-col">
        <h3
          className={`font-bold text-warm-950 leading-tight ${
            isTitle ? "text-base sm:text-lg text-center mt-3" : "text-sm sm:text-base"
          } line-clamp-2`}
        >
          {slide.title}
        </h3>

        {/* Тип-kind ниже заголовка (мелко) */}
        {!isTitle && (
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[color:var(--text-muted)] font-semibold">
            {kindLabel(slide.kind)}
          </div>
        )}

        {/* Буллеты: не больше 4, с ellipsis */}
        <ul className={`mt-2 space-y-1 ${isTitle ? "" : "flex-1"} overflow-hidden`}>
          {(slide.bullets ?? []).slice(0, isTitle ? 2 : 4).map((b, i) => (
            <li
              key={i}
              className={`text-[11px] sm:text-xs text-warm-600 flex gap-1.5 ${
                isSummary ? "before:content-['•']" : ""
              }`}
            >
              {!isTitle && !isSummary && (
                <span className="text-brand-500 shrink-0 leading-snug">•</span>
              )}
              {isSummary && (
                <span className="text-accent-500 shrink-0 leading-snug">{i + 1}.</span>
              )}
              <span className="line-clamp-1">{b}</span>
            </li>
          ))}
          {(slide.bullets?.length ?? 0) > (isTitle ? 2 : 4) && (
            <li className="text-[10px] text-[color:var(--text-muted)] italic">…ещё {slide.bullets!.length - (isTitle ? 2 : 4)} пункт(а)</li>
          )}
        </ul>
      </div>
    </article>
  );
}

/** Человекочитаемый лейбл для kind. */
function kindLabel(kind: Slide["kind"]): string {
  switch (kind) {
    case "title":
      return "Титульный";
    case "definition":
      return "Определение";
    case "example":
      return "Пример";
    case "bullets":
      return "Пункты";
    case "summary":
      return "Итоги";
  }
}

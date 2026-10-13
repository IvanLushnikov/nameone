"use client";

/**
 * Честное предупреждение о том, что материал получился не таким, как просили
 * (ТЗ-25, AD-7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ, А НЕ `<div>` В СТРАНИЦЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше потерь не показывали вообще — учитель узнавал об укороченном материале
 * дома, уже отдав лист классу. Второй риск, который этот блок закрывает: если
 * предупреждение «рисуется» только в разметке страницы, его легко потерять
 * при правках и не заметить на ревью.
 *
 * Отдельный компонент с `role="alert"` и `data-testid` означает, что:
 *   · скринридер читает потерю сразу, а не «когда дойдёт»;
 *   · тест находит блок по стабильному признаку, а не по тексту-рыбе;
 *   · предупреждение нельзя случайно снести вместе с кнопками.
 *
 * Текст приходит готовым из `buildQualityNotice` — здесь только раскладка и
 * оформление. Смыслы в разметке не собираются.
 */
export interface QualityNoticeView {
  tone: "warning" | "info";
  title: string;
  lines: string[];
}

export function QualityNoticeBanner({ notice }: { notice: QualityNoticeView }) {
  const isWarning = notice.tone === "warning";
  return (
    <div
      role="alert"
      data-testid="quality-notice"
      className={[
        "w-full rounded-lg border px-4 py-3 text-left",
        isWarning
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-slate-50 text-slate-700",
      ].join(" ")}
    >
      <p className="text-sm font-semibold">{notice.title}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {notice.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
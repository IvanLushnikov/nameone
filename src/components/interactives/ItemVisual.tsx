"use client";

/**
 * Общая карточка задания для всех шести плееров (движок, ТЗ §4.3).
 *
 * Здесь единственное место, где текст задания и SVG встречаются с React:
 *   - `prompt` рендерится как ОБЫЧНЫЙ текст — React экранирует `<`, `>`, `&`
 *     сам, поэтому строка от LLM не может стать разметкой (ТЗ §4.8);
 *   - `svg` вставляется через `dangerouslySetInnerHTML` — единственный способ
 *     показать вектор в статическом экспорте, поэтому он обязательно идёт
 *     через `sanitizeSvg` (см. `src/lib/interactives/svg.ts`).
 *
 * Если после санитизации строка пустая (LLM подсунул `<script>` или в SVG был
 * только опасный `<foreignObject>`), мы показываем ЗАГЛУШКУ, а не пустоту:
 * ученик не должен гадать, куда делась картинка.
 */

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { safeSvgHtml } from "@/lib/interactives/svg";
import type { InteractiveItem } from "@/lib/interactives/types";

export function ItemVisual({
  item,
  className,
  showPrompt = true,
}: {
  item: Pick<InteractiveItem, "prompt" | "svg">;
  className?: string;
  showPrompt?: boolean;
}) {
  const svg = React.useMemo(() => safeSvgHtml(item.svg).__html, [item.svg]);

  return (
    <div className={cn("min-w-0", className)}>
      {showPrompt && (
        <p className="text-base text-warm-950 break-words" data-interactive-prompt="">
          {item.prompt}
        </p>
      )}
      {svg ? (
        <div
          className="mt-3 flex justify-center svg-chart-wrapper"
          data-interactive-svg=""
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        item.svg !== undefined && <PlaceholderIllustration />
      )}
    </div>
  );
}

/** Заглушка на месте вырезанной санитайзером картинки. */
function PlaceholderIllustration() {
  return (
    <div
      className="mt-3 h-24 rounded-xl bg-warm-50 border border-dashed border-warm-200 grid place-items-center"
      data-interactive-svg-removed=""
    >
      <span className="text-xs text-[color:var(--text-muted)]">Картинка не загрузилась</span>
    </div>
  );
}

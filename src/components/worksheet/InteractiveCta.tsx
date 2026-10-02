"use client";

/**
 * Блок «Оживить урок» на экране готового листа (TZ-13 §4.9, сценарий A).
 *
 * Зачем он на листе, а не в конструкторе: вся ценность фичи в пересечении
 * «мы уже знаем тему» × «интерактив» (ТЗ §1.3). Учитель пришёл за листом по
 * теме «Дроби, 5 класс» — значит, интерактив по той же теме ему нужен сильнее
 * всего именно здесь. Отдельная вкладка в навигации была бы «ещё одна
 * фича», а этот блок — один клик от уже сделанной работы.
 *
 * ⚠️ КОМПОНЕНТ НЕ ВСТРОЕН НИ В ОДНУ СТРАНИЦУ. Места вставки перечислены в
 * `INTERACTIVE_CTA_PLACEMENTS` (см. конец файла) — оркестратор вставляет его
 * сам, потому что `src/app/constructor/page.tsx` и страницы листа сейчас
 * правятся другими воркерами, и трогать их отсюда — гарантированный конфликт.
 *
 * Что делает компонент: показывает 6 форматов (ТЗ §2.1), первый помечен как
 * рекомендуемый, и ведёт в конструктор с параметрами. САМ интерактив не
 * создаёт: это зона бэкенда (`POST /api/interactives`, ТЗ §4.5).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";
import { INTERACTIVE_FORMATS, type InteractiveFormat } from "@/lib/interactives/types";
import { FORMAT_META, formatMeta } from "@/lib/interactives/formats";
import { Sparkles } from "lucide-react";

export interface InteractiveCtaProps {
  /** id готового листа — по нему бэк возьмёт задания из `payload_json`. */
  worksheetId?: string;
  /** Заголовок листа — для подписи и предзаполнения конструктора. */
  worksheetTitle?: string;
  /** Предмет и класс — помогают ранклеру разложить задания по секторам. */
  subject?: string;
  grade?: number;
  /** Обработчик выбора формата. Если не передан — ведём в конструктор. */
  onPick?: (format: InteractiveFormat) => void;
}

export function InteractiveCta({
  worksheetId,
  worksheetTitle,
  subject,
  grade,
  onPick,
}: InteractiveCtaProps) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<InteractiveFormat | null>(null);

  const go = (format: InteractiveFormat) => {
    setPicked(format);
    if (onPick) {
      onPick(format);
      return;
    }
    // Параметры договорились с конструктором (его зона): формат, лист и тема.
    // Если конструктор их не читает — просто откроется обычная форма.
    const params = new URLSearchParams();
    if (worksheetId) params.set("sheet", worksheetId);
    params.set("interactiveFormat", format);
    if (worksheetTitle) params.set("title", worksheetTitle);
    if (subject) params.set("subject", subject);
    if (grade) params.set("grade", String(grade));
    router.push(`/constructor?${params.toString()}`);
  };

  return (
    <Card className="no-print" data-testid="interactive-cta" data-interactive-cta="">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-warm-950 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-500" aria-hidden />
          Оживить урок
        </h2>
        <Badge tone="brand">40 секунд</Badge>
      </div>
      <p className="text-sm text-warm-600">
        Сделайте из этого листа игру для класса: ссылка + QR, ученик проходит с
        телефона, вы видите баллы и темы, которые не зашли.
      </p>

      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">
        {INTERACTIVE_FORMATS.map((format) => {
          const meta: ReturnType<typeof formatMeta> = FORMAT_META[format];
          return (
            <li key={format}>
              <button
                type="button"
                onClick={() => go(format)}
                className={cn(
                  "w-full text-left rounded-xl border p-3 transition-all h-full",
                  picked === format
                    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200"
                    : "border-warm-200 bg-white hover:border-brand-300",
                )}
                data-interactive-format-option={format}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>
                    {meta.emoji}
                  </span>
                  <span className="font-medium text-warm-950 text-sm">{meta.title}</span>
                  {meta.recommended && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-800">
                      советуем
                    </span>
                  )}
                </div>
                <p className="text-xs text-warm-500 mt-1.5">{meta.mechanic}</p>
                <p className="text-[11px] text-[color:var(--text-muted)] mt-1.5">
                  {difficultyLabel(meta.difficulty)} · {meta.codeDays} дня кода
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-warm-500 mt-3">
        Настройки: {INTERACTIVE_FORMATS.map((f) => FORMAT_META[f].settings[0]).join(" · ")} — у
        каждого формата свои, остальное можно не трогать.
      </p>
    </Card>
  );
}

function difficultyLabel(difficulty: "low" | "medium" | "high"): string {
  if (difficulty === "low") return "просто";
  if (difficulty === "medium") return "средне";
  return "сложно";
}

/**
 * Где вставлять блок (ТЗ §4.9). Оркестратор вставляет вручную — эти файлы сейчас
 * заняты другими воркерами, и правка отсюда = конфликт при слиянии.
 *
 *   1. `src/app/preview/page.tsx` — экран готового листа (главное место;
 *      лист открывается из ЛК по `/preview?id=`). Ставить ПОСЛЕ списка заданий.
 *   2. `src/components/constructor/WorksheetPreview.tsx` — превью листа в
 *      конструкторе (учитель ещё не сохранил лист — блок должен быть
 *      неактивным и подсказывать «сначала сгенерируйте лист»).
 *   3. `src/app/constructor/page.tsx` — НЕ вставляем: файл в зоне оркестратора.
 *
 * Передавать пропсы: `worksheetId`, `worksheetTitle`, `subject`, `grade`.
 */
export const INTERACTIVE_CTA_PLACEMENTS = [
  "src/app/preview/page.tsx — после списка заданий",
  "src/components/constructor/WorksheetPreview.tsx — неактивный вариант",
] as const;

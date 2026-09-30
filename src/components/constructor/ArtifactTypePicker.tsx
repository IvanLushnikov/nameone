"use client";

import * as React from "react";
import {
  FileText,
  ClipboardList,
  Layers,
  Pencil,
  Presentation as PresentationIcon,
  Calendar,
  ClipboardCheck,
  Lock,
  type LucideIcon,
} from "lucide-react";
import type { TaskType } from "@/lib/types";

/**
 * Q1-2027: единый сегментер типа артефакта в конструкторе.
 *
 * Содержит ВСЕ типы (3 базовых + 3 новых из worker A/B/C + контрольная),
 * чтобы каждый worker-агент НЕ трогал этот файл и `constructor/page.tsx`.
 *
 * Layout — 2 ряда: ряд 1 — «быстрые» (те, что делают каждый урок),
 * ряд 2 — «тяжёлые» (планы/презентации/КТП/контрольная).
 */
export interface ArtifactTypeOption {
  id: TaskType;
  label: string;
  icon: LucideIcon;
  /** Короткий поясняющий текст под кнопкой. */
  hint: string;
  /** Ряд: 0 = «быстрые», 1 = «тяжёлые». */
  row: 0 | 1;
  /** Если true — тип доступен только в Plus/Плюс (будущая привязка к тарифу). */
  plusOnly?: boolean;
}

export const ARTIFACT_TYPE_OPTIONS: ArtifactTypeOption[] = [
  // Ряд 0 — быстрые (5-30 заданий, текущий daily-driver учителя)
  { id: "worksheet", label: "Лист", icon: FileText, hint: "5–30 заданий, A4 PDF/DOCX", row: 0 },
  { id: "test", label: "Тест", icon: ClipboardList, hint: "С автопроверкой, ответы в конце", row: 0 },
  { id: "cards", label: "Карточки", icon: Layers, hint: "Короткие, для запоминания", row: 0 },
  // Ряд 1 — тяжёлые (Q1-2027 scope, расширение до «полного сервиса»)
  { id: "lesson-plan", label: "План урока", icon: Pencil, hint: "ФГОС-конспект на 45 мин", row: 1, plusOnly: true },
  { id: "presentation", label: "Презентация", icon: PresentationIcon, hint: "5–20 слайдов, PPTX", row: 1, plusOnly: true },
  { id: "ktp", label: "КТП", icon: Calendar, hint: "Календарно-тематическое планирование на год", row: 1, plusOnly: true },
  { id: "control", label: "Контрольная", icon: ClipboardCheck, hint: "2 варианта + критерии", row: 1 },
];

interface ArtifactTypePickerProps {
  value: TaskType;
  onChange: (next: TaskType) => void;
  /** true = текущий план пользователя Plus — показываем все опции; false = скрываем plusOnly. */
  hasPlus: boolean;
}

/**
 * 2-строчный сегментер. Каждая опция — кнопка с иконкой + label + tooltip-hint.
 * При клике — меняет `value` через `onChange`. Использует стилистику существующего
 * TYPE_OPTIONS в constructor/page.tsx (3-кнопочный сегментер), но расширен до 7.
 */
export function ArtifactTypePicker({ value, onChange, hasPlus }: ArtifactTypePickerProps) {
  const rows: Array<0 | 1> = [0, 1];
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Тип материала">
      {rows.map((rowIdx) => (
        <div
          key={rowIdx}
          className="flex flex-wrap gap-1 p-1 bg-warm-100 rounded-xl"
        >
          {ARTIFACT_TYPE_OPTIONS.filter((o) => o.row === rowIdx).map((opt) => {
            const disabled = opt.plusOnly && !hasPlus;
            const selected = value === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={disabled}
                // TZ-5: НЕ ставим HTML `disabled`, иначе браузер глохнет onClick и мы
                // не сможем перенаправить на /pricing/. Состояние "заблокировано" держим
                // через aria-disabled + CSS (opacity-60, cursor-not-allowed) + логику onClick.
                onClick={() => {
                  // TZ-5 (QA-аудит 2026-09-30): для plusOnly без подписки Плюс — перенаправляем
                  // на /pricing/, чтобы юзер получил понятную обратную связь, а не клик в пустоту.
                  if (disabled) {
                    window.location.href = "/pricing/";
                    return;
                  }
                  onChange(opt.id);
                }}
                title={disabled ? `Доступно в тарифе «Плюс» — откроем тарифы (${opt.hint})` : opt.hint}
                className={`group flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg text-[13px] font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 whitespace-nowrap ${
                  selected
                    ? "bg-white text-warm-950 shadow-soft"
                    : disabled
                      ? "text-warm-400 opacity-60 cursor-not-allowed hover:bg-warm-50"
                      : "text-warm-600 hover:text-warm-900"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{opt.label}</span>
                {opt.plusOnly && (
                  <span
                    className={`text-[9px] uppercase tracking-wider font-bold px-1 rounded ${
                      disabled
                        // TZ-5: яркий оранжевый badge с иконкой замка для заблокированных опций —
                        // чтобы было ясно видно «премиум» без необходимости читать текст.
                        ? "bg-accent-500 text-white inline-flex items-center gap-0.5"
                        : selected
                          ? "bg-accent-100 text-accent-700"
                          : "bg-warm-200 text-warm-500"
                    }`}
                  >
                    {disabled && <Lock className="w-2 h-2" />}
                    +
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

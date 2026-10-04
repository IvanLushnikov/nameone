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
  ChevronDown,
  Lock,
  type LucideIcon,
} from "lucide-react";
import type { TaskType } from "@/lib/types";

/**
 * Q1-2027: единый сегментер типа артефакта в конструкторе.
 *
 * TZ-16 §4.2: при 9 типах плоский массив в 2 ряда — визуальный хаос
 * (учитель перестаёт выбирать, а это ровно та ловушка, от которой мы
 * позиционированием отстраиваемся). Поэтому модель — группы:
 *
 *   «Каждый день» — всегда развёрнута (4 кнопки, 80% случаев)
 *   «К уроку»     — свёрнута, раскрывается кликом по заголовку-чипу
 *   «На период»   — свёрнута, раскрывается кликом по заголовку-чипу
 *
 * Раскрытое состояние — локальный `useState` ВНУТРИ компонента:
 * в глобальный state конструктора оно не выносится (там остаётся только `value`).
 */
export type ArtifactGroup = "daily" | "lesson" | "period";

export interface ArtifactTypeOption {
  id: TaskType;
  label: string;
  icon: LucideIcon;
  /** Короткий поясняющий текст под кнопкой. */
  hint: string;
  /** Группа выбора. TZ-16: было `row: 0 | 1` — плоская раскладка на 2 ряда. */
  group: ArtifactGroup;
  /** Если true — тип доступен только в Plus/Плюс (будущая привязка к тарифу). */
  plusOnly?: boolean;
  /** Показывать, даже если группа свёрнута (топ-1 тип группы). */
  primaryInGroup?: boolean;
}

export const ARTIFACT_TYPE_OPTIONS: ArtifactTypeOption[] = [
  // Группа «Каждый день» — всегда развёрнута, это daily-driver учителя.
  { id: "worksheet", label: "Лист", icon: FileText, hint: "5–30 заданий, A4 PDF/DOCX", group: "daily" },
  { id: "test", label: "Тест", icon: ClipboardList, hint: "С автопроверкой, ответы в конце", group: "daily" },
  { id: "cards", label: "Карточки", icon: Layers, hint: "Короткие, для запоминания", group: "daily" },
  { id: "control", label: "Контрольная", icon: ClipboardCheck, hint: "2 варианта работы", group: "daily" },
  // Группа «К уроку» — свёрнута по умолчанию. План урока — топ-1 тип группы.
  { id: "lesson-plan", label: "План урока", icon: Pencil, hint: "ФГОС-конспект на 45 мин", group: "lesson", plusOnly: true, primaryInGroup: true },
  { id: "presentation", label: "Презентация", icon: PresentationIcon, hint: "5–20 слайдов, PPTX", group: "lesson", plusOnly: true },
  // Группа «На период» — свёрнута по умолчанию. КТП — топ-1 тип группы.
  { id: "ktp", label: "КТП", icon: Calendar, hint: "Календарно-тематическое планирование на год", group: "period", plusOnly: true, primaryInGroup: true },
];

/** Порядок и подписи групп. `daily` развёрнута всегда, остальные — по клику. */
const ARTIFACT_GROUPS: Array<{ id: ArtifactGroup; label: string; collapsedByDefault: boolean }> = [
  { id: "daily", label: "Каждый день", collapsedByDefault: false },
  { id: "lesson", label: "К уроку", collapsedByDefault: true },
  { id: "period", label: "На период", collapsedByDefault: true },
];

interface ArtifactTypePickerProps {
  value: TaskType;
  onChange: (next: TaskType) => void;
  /** true = текущий план пользователя Plus — показываем все опции; false = скрываем plusOnly. */
  hasPlus: boolean;
}

/**
 * Сегментер типа артефакта с группировкой (TZ-16 §4.2).
 *
 * Каждая опция — кнопка с иконкой + label + tooltip-hint. При клике — меняет
 * `value` через `onChange`. Стилистика как в TYPE_OPTIONS конструктора,
 * но с группами и локальным раскрытием.
 *
 * Механика `plusOnly` (TZ-5) НЕ ИЗМЕНЕНА: `aria-disabled` + редирект на
 * `/pricing/`, а НЕ HTML-`disabled` (иначе браузер глохнет onClick).
 */
export function ArtifactTypePicker({ value, onChange, hasPlus }: ArtifactTypePickerProps) {
  // TZ-16 §4.2: раскрытость групп — локальный state, в конструктор не прокидываем.
  const [expanded, setExpanded] = React.useState<Record<ArtifactGroup, boolean>>(() =>
    Object.fromEntries(ARTIFACT_GROUPS.map((g) => [g.id, !g.collapsedByDefault])) as Record<
      ArtifactGroup,
      boolean
    >,
  );

  const selectedGroup = ARTIFACT_TYPE_OPTIONS.find((o) => o.id === value)?.group;

  // Если выбранный тип оказался в свёрнутой группе (deep-link `?type=ktp`,
  // смена типа извне) — раскрываем её, чтобы выбор был виден.
  React.useEffect(() => {
    if (selectedGroup && !expanded[selectedGroup]) {
      setExpanded((prev) => ({ ...prev, [selectedGroup]: true }));
    }
    // `expanded` намеренно не в зависимостях: реагируем только на смену выбора.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup]);

  return (
    <div className="space-y-2" role="radiogroup" aria-label="Тип материала">
      {ARTIFACT_GROUPS.map((group) => {
        const options = ARTIFACT_TYPE_OPTIONS.filter((o) => o.group === group.id);
        if (options.length === 0) return null;
        const isOpen = expanded[group.id];
        // В свёрнутой группе наружу торчит только топ-1 тип (`primaryInGroup`),
        // остальные лежат в скрытом контейнере — 9 кнопок разом не показываем.
        const primary = options.filter((o) => o.primaryInGroup);
        const secondary = options.filter((o) => !o.primaryInGroup);

        const renderOption = (opt: ArtifactTypeOption) => {
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
                    ? "text-[color:var(--text-muted)] opacity-60 cursor-not-allowed hover:bg-warm-50"
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
        };

        return (
          <div key={group.id} data-testid={`artifact-group-${group.id}`}>
            <div className="flex items-center gap-1.5 mb-1">
              {group.collapsedByDefault ? (
                // Свёрнутая группа раскрывается кликом по заголовку-чипу.
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider text-warm-500 hover:text-warm-800 hover:bg-warm-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
              ) : (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
                  {group.label}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1 p-1 bg-warm-100 rounded-xl">
              {isOpen ? options.map(renderOption) : primary.map(renderOption)}
            </div>

            {/* Свёрнутые не-primary опции: остаются в DOM, но визуально скрыты
                классом `hidden` (в браузере display:none убирает их и из дерева
                доступности). Так 9 типов не показываются разом. */}
            {!isOpen && secondary.length > 0 && (
              <div className="hidden">{secondary.map(renderOption)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

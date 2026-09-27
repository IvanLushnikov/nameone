"use client";

import * as React from "react";
import {
  Timer,
  BookOpen,
  ClipboardCheck,
  Printer,
  Trophy,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import type { Difficulty, TaskType } from "@/lib/types";
import { trackPresetSelected } from "@/lib/utils/storage";

export type PresetMode = "template" | "custom";

export type PresetOutputTone = "brand" | "accent" | "warm" | "info" | "success";

export interface Preset {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  count: number;
  difficulty: Difficulty;
  type: TaskType;
  /** Человекочитаемая метка формата вывода: «Карточка», «Лист», «Тест», «Раздаточный», «Вариант ОГЭ/ЕГЭ». */
  outputLabel: string;
  /** Тон плашки формата вывода (используется и для цветной точки у иконки). */
  outputTone: PresetOutputTone;
  withAnswers?: boolean;
  withExplanations?: boolean;
  /** Если указано — preset показывается только для этих классов. */
  onlyGrades?: number[];
}

const OUTPUT_PILL: Record<PresetOutputTone, string> = {
  brand: "bg-brand-100 text-brand-800 ring-brand-200",
  accent: "bg-accent-100 text-accent-800 ring-accent-200",
  warm: "bg-warm-100 text-warm-800 ring-warm-200",
  info: "bg-blue-100 text-blue-800 ring-blue-200",
  success: "bg-emerald-100 text-emerald-800 ring-emerald-200",
};

const OUTPUT_DOT: Record<PresetOutputTone, string> = {
  brand: "bg-brand-500",
  accent: "bg-accent-500",
  warm: "bg-warm-500",
  info: "bg-blue-500",
  success: "bg-emerald-500",
};

/** Каталог из 5 типовых сценариев учителя. */
export const PRESETS: Preset[] = [
  {
    id: "card-15min",
    title: "Карточка на 15 минут",
    description: "5 заданий, базовая — быстрая разминка на 1 страницу",
    icon: Timer,
    count: 5,
    difficulty: "easy",
    type: "worksheet",
    outputLabel: "Карточка",
    outputTone: "warm",
    withExplanations: false,
  },
  {
    id: "homework",
    title: "Домашняя работа",
    description: "10 заданий, средняя — стандартная домашка с пояснениями",
    icon: BookOpen,
    count: 10,
    difficulty: "medium",
    type: "worksheet",
    outputLabel: "Лист",
    outputTone: "brand",
    withExplanations: true,
  },
  {
    id: "test-new-topic",
    title: "Проверочная по новой теме",
    description: "8 заданий, средняя, разные типы — проверить усвоение после урока",
    icon: ClipboardCheck,
    count: 8,
    difficulty: "medium",
    type: "test",
    outputLabel: "Тест",
    outputTone: "info",
    withExplanations: true,
  },
  {
    id: "handout",
    title: "Раздаточный материал к уроку",
    description: "12 заданий, базовая, место для заметок — большой лист для класса",
    icon: Printer,
    count: 12,
    difficulty: "easy",
    type: "worksheet",
    outputLabel: "Раздаточный",
    outputTone: "accent",
    withExplanations: false,
  },
  {
    id: "oge-ege",
    title: "Подготовка к ОГЭ/ЕГЭ",
    description: "6 заданий, повышенная, формат экзамена — только для 9 и 11 класса",
    icon: Trophy,
    count: 6,
    difficulty: "hard",
    type: "test",
    outputLabel: "Вариант ОГЭ/ЕГЭ",
    outputTone: "success",
    withExplanations: true,
    onlyGrades: [9, 11],
  },
];

interface PresetGridProps {
  /** Текущий выбранный класс — используется для фильтрации preset'ов. */
  grade: number;
  /** Текущий режим: «Шаблон» (grid) или «Свой вариант» (skip grid). */
  mode: PresetMode;
  /** Колбэк переключения режима. */
  onModeChange: (m: PresetMode) => void;
  /** Колбэк выбора preset'а — родитель заполняет поля и идёт на шаг «Тема». */
  onSelectPreset: (preset: Preset) => void;
  /** Колбэк «пропустить preset, идти вручную к теме». */
  onSkipToTopic: () => void;
  /** id ранее выбранного preset'а (для подсветки при возврате назад). */
  selectedPresetId?: string | null;
  /** Текущий тип для «Свой вариант». Используется в inline-пикере Лист/Тест/Карточки. */
  customType?: TaskType;
  /** Колбэк смены типа в «Свой вариант». */
  onCustomTypeChange?: (t: TaskType) => void;
}

/**
 * Шаблонная сетка из 5 preset-карточек + переключатель «Шаблон / Свой вариант».
 *
 * Mobile (375×667): 2 колонки, ~3 ряда — всё помещается без вертикального скролла.
 * a11y: каждая карточка — `<button>` с `aria-label="<title>: <description>"`.
 */
export function PresetGrid({
  grade,
  mode,
  onModeChange,
  onSelectPreset,
  onSkipToTopic,
  selectedPresetId,
  customType,
  onCustomTypeChange,
}: PresetGridProps) {
  const visiblePresets = React.useMemo(
    () => PRESETS.filter((p) => !p.onlyGrades || p.onlyGrades.includes(grade)),
    [grade]
  );

  const handleSelect = (preset: Preset) => {
    trackPresetSelected(preset.id);
    onSelectPreset(preset);
  };

  return (
    <div>
      {/* Переключатель «Шаблон / Свой вариант» */}
      <div
        className="flex gap-1 p-1 bg-warm-100 rounded-xl mb-4"
        role="tablist"
        aria-label="Режим выбора параметров"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "template"}
          onClick={() => onModeChange("template")}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            mode === "template"
              ? "bg-white text-warm-950 shadow-soft"
              : "text-warm-600 hover:text-warm-900"
          }`}
        >
          Шаблон
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "custom"}
          onClick={() => onModeChange("custom")}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            mode === "custom"
              ? "bg-white text-warm-950 shadow-soft"
              : "text-warm-600 hover:text-warm-900"
          }`}
        >
          Свой вариант
        </button>
      </div>

      {mode === "template" ? (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {visiblePresets.map((p) => {
            const Icon = p.icon;
            const selected = selectedPresetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                aria-label={`${p.title}: ${p.description}, формат: ${p.outputLabel}`}
                aria-pressed={selected}
                className={`relative group text-left p-3 sm:p-4 rounded-xl border transition-all min-h-[108px] sm:min-h-[140px] hover:-translate-y-0.5 motion-safe:hover:-translate-y-0.5 transition-transform duration-200 motion-safe:transition-transform duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                  selected
                    ? "border-brand-500 bg-brand-50 shadow-soft"
                    : "border-warm-200 hover:border-brand-400 hover:bg-brand-50"
                }`}
              >
                {/* Плашка формата вывода — правый верхний угол карточки. */}
                <span
                  className={`absolute top-1.5 right-1.5 sm:top-2 sm:right-2 inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${
                    OUTPUT_PILL[p.outputTone]
                  }`}
                  aria-hidden
                >
                  {p.outputLabel}
                </span>
                <div className="flex items-start gap-2 sm:gap-3 pr-14 sm:pr-16">
                  <div
                    className={`relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl grid place-items-center shrink-0 transition-colors ${
                      selected
                        ? "bg-brand-500 text-white"
                        : "bg-brand-100 text-brand-700 group-hover:bg-brand-500 group-hover:text-white"
                    }`}
                  >
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden />
                    {/* Цветная точка-индикатор формата (правый нижний угол иконки). */}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ring-2 ring-white animate-pulse motion-safe:animate-pulse ${
                        OUTPUT_DOT[p.outputTone]
                      }`}
                      aria-hidden
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-warm-950 leading-tight">
                      {p.title}
                    </div>
                    <div className="text-xs text-warm-500 mt-1 leading-snug line-clamp-2 sm:line-clamp-3">
                      {p.description}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-warm-300 bg-warm-50 p-5 text-center">
          <p className="text-sm text-warm-700 mb-1 font-medium">
            Без шаблона
          </p>
          <p className="text-xs text-warm-500 mb-4">
            Параметры листа (сложность, количество заданий) настроите на&nbsp;следующем шаге.
          </p>
          {onCustomTypeChange && (
            <div
              className="inline-flex p-1 bg-white rounded-xl mb-4 border border-warm-200"
              role="radiogroup"
              aria-label="Тип работы"
            >
              {(["worksheet", "test", "cards"] as TaskType[]).map((t) => {
                const selected = (customType ?? "worksheet") === t;
                const label = t === "worksheet" ? "Лист" : t === "test" ? "Тест" : "Карточки";
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onCustomTypeChange(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      selected
                        ? "bg-brand-500 text-white shadow-soft"
                        : "text-warm-600 hover:text-warm-900"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          <br />
          <button
            type="button"
            onClick={onSkipToTopic}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Перейти к выбору темы
            <ArrowRight className="w-4 h-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

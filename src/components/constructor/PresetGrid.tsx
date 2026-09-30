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
  /**
   * TZ-11: миниатюра-превью формата вывода, которую юзер видит прямо в карточке.
   * Показывает «как выглядит результат» (сетка карточек / нумерованный лист /
   * вопрос с radio / стопка листов / экзаменационный вариант) — без открытия полного
   * preview в ЛК. Стилизована под тон outputTone.
   */
  preview: React.ReactNode;
  /**
   * TZ-11: развёрнутое описание формата для hover-tooltip (`title` на кнопке).
   * Помогает юзеру сравнить тон перед кликом: «5 карточек на одном листе для
   * быстрой разминки в начале урока».
   */
  previewHint: string;
}

/**
 * TZ-11: примеры заданий для мини-превью формата в карточке пресета.
 * Юзер просил «не понятно что есть что какой формат надо показывать пример сразу».
 * Теперь каждая карточка показывает 3 коротких примера в формате пресета
 * (квадратики для листа, радио для теста, 2×2 для карточек, бокс для раздаточного,
 *  «Часть 1/2» для варианта ОГЭ/ЕГЭ).
 */
type MiniSample = { kind: "blank" | "radio" | "choice"; text: string };

const CARD_PREVIEW: Record<string, MiniSample[]> = {
  "card-15min": [
    { kind: "blank", text: "2 + 3 = __" },
    { kind: "blank", text: "5 − 1 = __" },
    { kind: "blank", text: "столица РФ = __" },
  ],
  homework: [
    { kind: "blank", text: "3x + 12 = 0, x = ?" },
    { kind: "choice", text: "В каком году Куликовская битва?" },
    { kind: "blank", text: "She ___ (read) every day." },
  ],
  "test-new-topic": [
    { kind: "radio", text: "A) …" },
    { kind: "radio", text: "B) …" },
    { kind: "radio", text: "C) …" },
  ],
  handout: [
    { kind: "blank", text: "Запишите тему урока: ___" },
    { kind: "blank", text: "3 примера из жизни: ___" },
    { kind: "blank", text: "Ваш вопрос учителю: ___" },
  ],
  "oge-ege": [
    { kind: "radio", text: "Часть 1 · Задание 1 (1 балл)" },
    { kind: "radio", text: "Часть 1 · Задание 2 (1 балл)" },
    { kind: "radio", text: "Часть 2 · Развёрнутый ответ" },
  ],
};

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

/**
 * TZ-11: лёгкий фон под миниатюрой-превью. Используем 100-й шаг палитры,
 * чтобы детали превью (тон-500/600 линии) читались с контрастом.
 */
const PREVIEW_BG: Record<PresetOutputTone, string> = {
  brand: "bg-brand-100/60",
  accent: "bg-accent-100/60",
  warm: "bg-warm-100/60",
  info: "bg-blue-100/60",
  success: "bg-emerald-100/60",
};

const PREVIEW_STROKE: Record<PresetOutputTone, string> = {
  brand: "border-brand-300",
  accent: "border-accent-300",
  warm: "border-warm-300",
  info: "border-blue-300",
  success: "border-emerald-300",
};

const PREVIEW_TEXT: Record<PresetOutputTone, string> = {
  brand: "text-brand-700",
  accent: "text-accent-700",
  warm: "text-warm-700",
  info: "text-blue-700",
  success: "text-emerald-700",
};

const PREVIEW_LINE: Record<PresetOutputTone, string> = {
  brand: "bg-brand-300",
  accent: "bg-accent-300",
  warm: "bg-warm-300",
  info: "bg-blue-300",
  success: "bg-emerald-300",
};

const PREVIEW_BAR: Record<PresetOutputTone, string> = {
  brand: "bg-brand-500",
  accent: "bg-accent-500",
  warm: "bg-warm-500",
  info: "bg-blue-500",
  success: "bg-emerald-500",
};

/**
 * TZ-11: 5 миниатюр-превью для каталога пресетов. Каждая — компактная
 * визуальная метафора формата вывода. Высота 60-72px, ширина = вся
 * ширина карточки (на мобиле ~140px, на sm+ ~158px). Используют существующую
 * палитру brand/warm/accent/blue/emerald, без новых цветов.
 *
 * Компоненты принимают `tone` и читают классы из tone-карт выше —
 * tailwind JIT видит полные имена классов в map-значениях и собирает их
 * в сборку (важно для purge в prod).
 */

function PreviewCard({ tone }: { tone: PresetOutputTone }) {
  // Сетка 3×2 маленьких карточек с номером и двумя строками.
  return (
    <div
      className="grid grid-cols-3 gap-1 w-full h-full"
      aria-hidden
      data-testid="preview-card"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`bg-white border ${PREVIEW_STROKE[tone]} rounded-[3px] flex flex-col p-[2px] min-h-0 overflow-hidden`}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${PREVIEW_BAR[tone]} mb-[2px]`} />
          <div className={`h-[2px] w-full ${PREVIEW_LINE[tone]} rounded-full`} />
          <div className={`h-[2px] w-3/4 ${PREVIEW_LINE[tone]} opacity-50 rounded-full mt-[2px]`} />
        </div>
      ))}
    </div>
  );
}

function PreviewList({ tone }: { tone: PresetOutputTone }) {
  // Мини-A4 с заголовком и 3 нумерованными строками-ответами.
  return (
    <div
      className={`bg-white border ${PREVIEW_STROKE[tone]} rounded-[3px] w-full h-full p-1 flex flex-col`}
      aria-hidden
      data-testid="preview-list"
    >
      <div className={`h-[3px] w-1/3 ${PREVIEW_BAR[tone]} rounded-full mb-1`} />
      <div className="flex-1 space-y-[3px]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${PREVIEW_BAR[tone]} text-white text-[6px] leading-none font-bold flex items-center justify-center shrink-0`}
            >
              {i}
            </span>
            <div
              className={`flex-1 h-px border-b border-dashed ${PREVIEW_STROKE[tone]}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewTest({ tone }: { tone: PresetOutputTone }) {
  // Вопрос сверху + 4 radio-кружка с буквами A-D в две колонки.
  return (
    <div
      className={`bg-white border ${PREVIEW_STROKE[tone]} rounded-[3px] w-full h-full p-1 flex flex-col`}
      aria-hidden
      data-testid="preview-test"
    >
      <div className="flex items-start gap-1 mb-1">
        <span
          className={`w-2.5 h-2.5 rounded-full ${PREVIEW_BAR[tone]} text-white text-[7px] leading-none font-bold flex items-center justify-center shrink-0`}
        >
          ?
        </span>
        <div className="flex-1 mt-1 space-y-[2px]">
          <div className={`h-[2px] w-full ${PREVIEW_LINE[tone]} rounded-full`} />
          <div className={`h-[2px] w-2/3 ${PREVIEW_LINE[tone]} opacity-50 rounded-full`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-[2px] mt-auto">
        {(["A", "B", "C", "D"] as const).map((l) => (
          <div key={l} className="flex items-center gap-[3px]">
            <span
              className={`w-2 h-2 rounded-full border-[1.5px] ${PREVIEW_STROKE[tone]}`}
            />
            <span className={`text-[7px] font-bold ${PREVIEW_TEXT[tone]} leading-none`}>
              {l}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewHandout({ tone }: { tone: PresetOutputTone }) {
  // Стопка из 3 листов с лёгким поворотом + поля для заметок на верхнем.
  return (
    <div
      className="relative w-full h-full"
      aria-hidden
      data-testid="preview-handout"
    >
      <div
        className={`absolute top-0 left-1 right-2 bottom-1 ${PREVIEW_LINE[tone]} opacity-40 rounded-[3px] border ${PREVIEW_STROKE[tone]} -rotate-[4deg]`}
      />
      <div
        className={`absolute top-0.5 left-2 right-1 bottom-0.5 ${PREVIEW_LINE[tone]} opacity-70 rounded-[3px] border ${PREVIEW_STROKE[tone]} rotate-[3deg]`}
      />
      <div
        className={`absolute inset-x-2 top-1 bottom-0 bg-white/95 rounded-[3px] border ${PREVIEW_STROKE[tone]} p-1 flex flex-col`}
      >
        <div className={`h-[3px] w-1/2 ${PREVIEW_BAR[tone]} rounded-full mb-1`} />
        <div className="flex-1 space-y-[3px]">
          <div className={`h-px w-full ${PREVIEW_LINE[tone]}`} />
          <div className={`h-px w-5/6 ${PREVIEW_LINE[tone]}`} />
          <div className={`h-px w-full ${PREVIEW_LINE[tone]}`} />
        </div>
      </div>
    </div>
  );
}

function PreviewExam({ tone }: { tone: PresetOutputTone }) {
  // Экзаменационный лист: шапка «Часть 1 / Часть 2» + 5 пронумерованных заданий.
  return (
    <div
      className={`bg-white border ${PREVIEW_STROKE[tone]} rounded-[3px] w-full h-full p-1 flex flex-col`}
      aria-hidden
      data-testid="preview-exam"
    >
      <div className="flex items-center justify-between mb-1 leading-none">
        <span className={`text-[7px] font-bold ${PREVIEW_TEXT[tone]}`}>Часть 1</span>
        <span className={`text-[7px] font-bold ${PREVIEW_TEXT[tone]}`}>Часть 2</span>
      </div>
      <div className="grid grid-cols-5 gap-[2px] flex-1 items-end">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-[2px]">
            <span
              className={`w-2.5 h-2.5 rounded-full ${PREVIEW_BAR[tone]} text-white text-[7px] leading-none font-bold flex items-center justify-center`}
            >
              {i}
            </span>
            <div className={`h-px w-full ${PREVIEW_LINE[tone]}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

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
    preview: <PreviewCard tone="warm" />,
    previewHint:
      "5 коротких заданий на одном листе A4 — для быстрой разминки в начале или конце урока, когда осталось 10–15 минут. Печатается как «карточки» — один разрез, и раздавать по одной.",
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
    preview: <PreviewList tone="brand" />,
    previewHint:
      "Классический рабочий лист A4: шапка с темой, нумерованные задания, поля для ответов. На отдельной странице — ответы и пояснения для учителя.",
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
    preview: <PreviewTest tone="info" />,
    previewHint:
      "Тест с автопроверкой: вопрос и 4 варианта ответа (A–D). Ученик выбирает один вариант, на отдельной странице — ключ с пояснениями для проверки.",
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
    preview: <PreviewHandout tone="accent" />,
    previewHint:
      "Большой раздаточный лист на весь класс: опорный конспект + задания с местом для заметок и решений прямо на листе. Печатается пачкой на класс.",
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
    preview: <PreviewExam tone="success" />,
    previewHint:
      "Вариант в формате экзамена (ОГЭ для 9 класса, ЕГЭ для 11): две части, разные типы заданий — краткий ответ и развёрнутое решение. С таймером и баллами.",
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
                title={p.previewHint}
                aria-pressed={selected}
                className={`relative group text-left p-3 sm:p-4 rounded-xl border transition-all min-h-[160px] sm:min-h-[180px] hover:-translate-y-0.5 motion-safe:hover:-translate-y-0.5 transition-transform duration-200 motion-safe:transition-transform duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                  selected
                    ? "border-brand-500 bg-brand-50 shadow-soft"
                    : "border-warm-200 hover:border-brand-400 hover:bg-brand-50"
                }`}
              >
                {/* Плашка формата вывода — правый верхний угол карточки. */}
                <span
                  className={`absolute top-1.5 right-1.5 sm:top-2 sm:right-2 inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium ring-1 ring-inset whitespace-nowrap z-10 ${
                    OUTPUT_PILL[p.outputTone]
                  }`}
                  aria-hidden
                >
                  {p.outputLabel}
                </span>

                {/* TZ-11: миниатюра-превью формата вывода (вверху карточки). */}
                <div
                  className={`relative h-[60px] sm:h-[68px] mb-2 sm:mb-2.5 rounded-lg border ${PREVIEW_STROKE[p.outputTone]} ${PREVIEW_BG[p.outputTone]} p-1.5 transition-transform duration-200 group-hover:scale-[1.02] motion-safe:group-hover:scale-[1.02] overflow-hidden`}
                >
                  {p.preview}
                </div>

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

                {/* TZ-11: мини-превью формата — чтобы юзер сразу видел как выглядит результат. */}
                <div className="mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-warm-100 space-y-1">
                  {(CARD_PREVIEW[p.id] ?? []).slice(0, 3).map((sample, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 text-[11px] sm:text-[12px] text-warm-600 leading-tight"
                    >
                      {sample.kind === "radio" ? (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full border border-warm-400 shrink-0"
                          aria-hidden
                        />
                      ) : (
                        <span
                          className="inline-block w-2.5 h-2.5 border border-warm-300 rounded-sm shrink-0 bg-white"
                          aria-hidden
                        />
                      )}
                      <span className="truncate">{sample.text}</span>
                    </div>
                  ))}
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

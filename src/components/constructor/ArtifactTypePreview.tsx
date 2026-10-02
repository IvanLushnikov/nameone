"use client";

import * as React from "react";
import type { TaskType } from "@/lib/types";

/**
 * TZ-12 (QA-аудит 2026-09-30, шаг 2): миниатюрные SVG-превью для каждого типа артефакта.
 *
 * Заменили статичный текстовый sample ("1. Решите уравнение: 3x + 12 = 0…")
 * на реальную миниатюру формата, чтобы пользователь ДО генерации видел,
 * как будет выглядеть результат: для worksheet — список заданий с местом
 * для ответов, для test — задания с radio-кружочками, для cards — сетка
 * карточек, и т.д.
 *
 * Design constraints:
 * — viewBox 320×96 (соотношение ~3.3:1), в контейнере max-h-[96px] w-full
 * — все формы — geometry primitives (rect/line/circle/path), без зависимостей
 *   от lucide-react / внешних SVG, чтобы не плодить лишние assets
 * — палитра — бренд + warm из tailwind.config.ts
 * — каждый миниатюрный type самодостаточен: не зависит от других типов
 *   и не трогает shared-стили (worker A/B/C могли рендерить свои типы,
 *   поэтому изоляция максимальная)
 */

const W = 320;
const H = 96;

interface Props {
  type: TaskType;
  /** Доп. CSS-класс для контейнера. По умолчанию — растягивается по ширине родителя. */
  className?: string;
  /** aria-label для скринридеров. */
  title?: string;
}

export function ArtifactTypePreview({ type, className, title }: Props) {
  return (
    <div className={`w-full overflow-hidden rounded-lg ${className ?? ""}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        className="block w-full h-auto max-h-[96px]"
        preserveAspectRatio="xMidYMid meet"
        aria-label={title ?? "Превью формата результата"}
        role="img"
      >
        <rect x={0} y={0} width={W} height={H} fill="#FAFAF7" rx={8} />
        {renderForType(type)}
      </svg>
    </div>
  );
}

function renderForType(type: TaskType): React.ReactNode {
  switch (type) {
    case "worksheet":
      return <WorksheetPreview_ />;
    case "test":
      return <TestPreview_ />;
    case "cards":
      return <CardsPreview_ />;
    case "control":
      return <ControlPreview_ />;
    case "lesson-plan":
      return <LessonPlanPreview_ />;
    case "presentation":
      return <PresentationPreview_ />;
    case "ktp":
      return <KtpPreview_ />;
    case "oge":
      return <OgePreview_ />;
    case "ege":
      return <EgePreview_ />;
    // TZ-16 Этап 1: миниатюры-заглушки для 4 новых типов. Реальные превью
    // (CardsPreview/MaterialsPreview/LessonBundlePreview) придут в Этапах 2–7.
    // Формат уже показывает ожидаемую структуру артефакта, чтобы учитель видел,
    // что получит, а не пустоту.
    case "materials":
      return <MaterialsPreview_ />;
    case "lesson-bundle":
      return <LessonBundlePreview_ />;
    case "interactive":
      return <InteractivePreview_ />;
    case "image":
      return <ImagePreview_ />;
    default:
      return <WorksheetPreview_ />;
  }
}

// ───────────────────── Worksheet: нумерованный список с линиями для ответов ─────────────────────

function WorksheetPreview_() {
  return (
    <g>
      {/* Полоска-заголовок сверху */}
      <rect x={12} y={10} width={120} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={22} width={70} height={3} rx={1.5} fill="#A8A29E" />
      {/* Три задания: номер + текст + линия для ответа */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(0, ${36 + i * 18})`}>
          <text x={14} y={9} fontSize={8} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
            {`${i + 1}.`}
          </text>
          <rect x={26} y={2} width={140 - i * 16} height={5} rx={1} fill="#E7E5E0" />
          <line x1={26} y1={13} x2={W - 16} y2={13} stroke="#E7E5E0" strokeWidth={1} />
        </g>
      ))}
    </g>
  );
}

// ───────────────────── Test: список с radio-кружочками ─────────────────────

function TestPreview_() {
  return (
    <g>
      <rect x={12} y={10} width={130} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={22} width={60} height={3} rx={1.5} fill="#A8A29E" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(0, ${36 + i * 18})`}>
          <text x={14} y={9} fontSize={8} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
            {`${i + 1}.`}
          </text>
          <rect x={26} y={2} width={100 - i * 12} height={5} rx={1} fill="#E7E5E0" />
          {/* 4 radio-кружочка справа */}
          {[0, 1, 2, 3].map((j) => (
            <circle key={j} cx={180 + j * 28} cy={5} r={3.5} fill="white" stroke="#A8A29E" strokeWidth={1} />
          ))}
          {/* A B C D буквы */}
          {[0, 1, 2, 3].map((j) => (
            <text
              key={j}
              x={180 + j * 28}
              y={14}
              fontSize={5.5}
              fill="#A8A29E"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              textAnchor="middle"
            >
              {String.fromCharCode(65 + j)}
            </text>
          ))}
        </g>
      ))}
    </g>
  );
}

// ───────────────────── Cards: сетка 2×3 мини-карточек ─────────────────────

function CardsPreview_() {
  const cardW = 90;
  const cardH = 22;
  const gap = 8;
  const startX = 16;
  const startY = 14;
  return (
    <g>
      {/* Заголовок-вопрос сверху */}
      <rect x={16} y={6} width={140} height={4} rx={1.5} fill="#1F1B16" />
      {Array.from({ length: 6 }).map((_, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = startX + col * (cardW + gap);
        const y = startY + 10 + row * (cardH + gap);
        return (
          <g key={i}>
            <rect x={x} y={y} width={cardW} height={cardH} rx={3} fill="white" stroke="#E7E5E0" strokeWidth={1} />
            <text
              x={x + 6}
              y={y + 9}
              fontSize={6}
              fill="#A8A29E"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {`#${i + 1}`}
            </text>
            <rect x={x + 6} y={y + 12} width={cardW - 30} height={3} rx={1} fill="#E7E5E0" />
            <rect x={x + 6} y={y + 17} width={cardW - 50} height={3} rx={1} fill="#E7E5E0" />
          </g>
        );
      })}
    </g>
  );
}

// ───────────────────── Control: два варианта рядом с шапкой «Вариант 1/2» ─────────────────────

function ControlPreview_() {
  return (
    <g>
      <rect x={12} y={10} width={130} height={6} rx={2} fill="#1F1B16" />
      {/* Левая колонка — Вариант 1 */}
      <rect x={12} y={24} width={42} height={9} rx={2} fill="#22B37C" />
      <text x={33} y={31} fontSize={6} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600} textAnchor="middle">
        Вариант 1
      </text>
      {/* Правая колонка — Вариант 2 */}
      <rect x={170} y={24} width={42} height={9} rx={2} fill="#FF5E2E" />
      <text x={191} y={31} fontSize={6} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600} textAnchor="middle">
        Вариант 2
      </text>
      {/* Задания: по 3 в каждой колонке */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <text x={14} y={50 + i * 13} fontSize={7} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
            {`${i + 1}.`}
          </text>
          <rect x={24} y={44 + i * 13} width={130 - i * 10} height={4} rx={1} fill="#E7E5E0" />
          <line x1={24} y1={53 + i * 13} x2={156} y2={53 + i * 13} stroke="#E7E5E0" strokeWidth={0.8} />
        </g>
      ))}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <text x={172} y={50 + i * 13} fontSize={7} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
            {`${i + 1}.`}
          </text>
          <rect x={182} y={44 + i * 13} width={130 - i * 10} height={4} rx={1} fill="#E7E5E0" />
          <line x1={182} y1={53 + i * 13} x2={W - 12} y2={53 + i * 13} stroke="#E7E5E0" strokeWidth={0.8} />
        </g>
      ))}
    </g>
  );
}

// ───────────────────── Lesson plan: timeline с time-blocks этапов ─────────────────────

function LessonPlanPreview_() {
  // 4 этапа урока по ~10-12 минут, горизонтальные блоки
  const blocks = [
    { x: 12, w: 48, label: "Орг", mins: "2 мин", tone: "#22B37C" },
    { x: 64, w: 90, label: "Опрос", mins: "10 мин", tone: "#46CB97" },
    { x: 158, w: 110, label: "Новая тема", mins: "25 мин", tone: "#FF5E2E" },
    { x: 272, w: 36, label: "Итог", mins: "8 мин", tone: "#FFA688" },
  ];
  return (
    <g>
      {/* Заголовок */}
      <rect x={12} y={8} width={130} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={20} width={60} height={3} rx={1.5} fill="#A8A29E" />
      {/* Ось времени */}
      <line x1={12} y1={36} x2={W - 12} y2={36} stroke="#A8A29E" strokeWidth={1} strokeDasharray="2 3" />
      {/* Time-tick метки */}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={12 + i * 75} y1={36} x2={12 + i * 75} y2={40} stroke="#A8A29E" strokeWidth={1} />
          <text x={12 + i * 75} y={50} fontSize={5.5} fill="#A8A29E" fontFamily="ui-sans-serif, system-ui, sans-serif" textAnchor="middle">
            {`${i * 10}′`}
          </text>
        </g>
      ))}
      {/* Этапы как блоки на оси */}
      {blocks.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={56} width={b.w} height={20} rx={3} fill={b.tone} opacity={0.85} />
          <text x={b.x + b.w / 2} y={68} fontSize={6.5} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600} textAnchor="middle">
            {b.label}
          </text>
          <text x={b.x + b.w / 2} y={74} fontSize={5} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" textAnchor="middle" opacity={0.85}>
            {b.mins}
          </text>
        </g>
      ))}
      {/* Линия снизу — заголовок ФГОС */}
      <rect x={12} y={84} width={80} height={3} rx={1.5} fill="#E7E5E0" />
    </g>
  );
}

// ───────────────────── Presentation: сетка мини-слайдов ─────────────────────

function PresentationPreview_() {
  // Слайды 4×2 = 8 штук в формате 16:9 миниатюр
  const cols = 4;
  const rows = 2;
  const sw = 70;
  const sh = 22;
  const gap = 6;
  const startX = 14;
  const startY = 12;
  const activeIdx = 1; // один слайд "выделен" — визуальный акцент
  return (
    <g>
      {Array.from({ length: cols * rows }).map((_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (sw + gap);
        const y = startY + row * (sh + gap);
        const isActive = i === activeIdx;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={sw}
              height={sh}
              rx={2}
              fill="white"
              stroke={isActive ? "#22B37C" : "#E7E5E0"}
              strokeWidth={isActive ? 1.5 : 1}
            />
            {/* Имитация контента слайда */}
            <rect x={x + 4} y={y + 4} width={sw - 8} height={3} rx={1} fill={isActive ? "#22B37C" : "#A8A29E"} opacity={isActive ? 0.9 : 0.6} />
            <rect x={x + 4} y={y + 10} width={(sw - 8) * 0.8} height={2.5} rx={1} fill="#E7E5E0" />
            <rect x={x + 4} y={y + 14} width={(sw - 8) * 0.5} height={2.5} rx={1} fill="#E7E5E0" />
            <rect x={x + 4} y={y + 18} width={sw - 16} height={2} rx={1} fill="#E7E5E0" />
          </g>
        );
      })}
    </g>
  );
}

// ───────────────────── KTP: таблица «месяц / темы / часы» ─────────────────────

function KtpPreview_() {
  // Колонки: Месяц | Тема (тема) | Тема | Часы
  // 3 строки месяцев
  const months = ["Сен", "Окт", "Ноя"];
  return (
    <g>
      {/* Шапка таблицы */}
      <rect x={12} y={6} width={W - 24} height={12} fill="#1F1B16" rx={2} />
      <text x={20} y={14} fontSize={6} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
        Месяц
      </text>
      <text x={70} y={14} fontSize={6} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
        Тема 1
      </text>
      <text x={160} y={14} fontSize={6} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
        Тема 2
      </text>
      <text x={290} y={14} fontSize={6} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
        ч.
      </text>
      {months.map((m, i) => {
        const y = 22 + i * 22;
        return (
          <g key={i}>
            {/* Чередующаяся подсветка строк */}
            <rect x={12} y={y} width={W - 24} height={20} fill={i % 2 === 0 ? "#FAFAF7" : "white"} />
            <line x1={12} y1={y + 20} x2={W - 12} y2={y + 20} stroke="#E7E5E0" strokeWidth={0.8} />
            <text x={20} y={y + 12} fontSize={6.5} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
              {m}
            </text>
            <rect x={70} y={y + 6} width={75 - i * 8} height={4} rx={1} fill="#E7E5E0" />
            <rect x={70} y={y + 12} width={45 - i * 5} height={3} rx={1} fill="#F0EFEB" />
            <rect x={160} y={y + 6} width={85 - i * 10} height={4} rx={1} fill="#E7E5E0" />
            <rect x={160} y={y + 12} width={50 - i * 6} height={3} rx={1} fill="#F0EFEB" />
            <text x={295} y={y + 13} fontSize={7} fill="#22B37C" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={700}>
              {`${6 + i * 2}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ───────────────────── OGE: две части (задания 1–19 + 20–25) ─────────────────────

function OgePreview_() {
  return (
    <g>
      <rect x={12} y={8} width={80} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={20} width={50} height={3} rx={1.5} fill="#A8A29E" />
      {/* Часть 1: 8 кружочков (1–19, dense grid) */}
      <text x={14} y={36} fontSize={6} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={700}>
        Часть 1
      </text>
      <text x={14} y={42} fontSize={4.5} fill="#A8A29E" fontFamily="ui-sans-serif, system-ui, sans-serif">
        №1–19 · краткий ответ
      </text>
      {Array.from({ length: 19 }).map((_, i) => {
        const col = i % 10;
        const row = Math.floor(i / 10);
        return (
          <g key={i}>
            <rect
              x={14 + col * 18}
              y={48 + row * 18}
              width={14}
              height={14}
              rx={2}
              fill={i < 5 ? "#22B37C" : "white"}
              stroke="#E7E5E0"
              strokeWidth={1}
            />
            <text
              x={14 + col * 18 + 7}
              y={48 + row * 18 + 9}
              fontSize={5}
              fill={i < 5 ? "white" : "#1F1B16"}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={600}
              textAnchor="middle"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      {/* Часть 2: 6 широких строк (20–25) */}
      <text x={216} y={36} fontSize={6} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={700}>
        Часть 2
      </text>
      <text x={216} y={42} fontSize={4.5} fill="#A8A29E" fontFamily="ui-sans-serif, system-ui, sans-serif">
        №20–25 · развёрнутый
      </text>
      {Array.from({ length: 6 }).map((_, i) => (
        <g key={i}>
          <rect
            x={216}
            y={48 + i * 8}
            width={92}
            height={6}
            rx={1.5}
            fill="white"
            stroke="#E7E5E0"
            strokeWidth={1}
          />
          <text
            x={220}
            y={48 + i * 8 + 4.5}
            fontSize={4.5}
            fill="#A8A29E"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight={600}
          >
            {`№${20 + i}`}
          </text>
        </g>
      ))}
    </g>
  );
}

// ───────────────────── EGE: 27 + 4 (часть 1 + часть 2) ─────────────────────

function EgePreview_() {
  return (
    <g>
      <rect x={12} y={8} width={80} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={20} width={50} height={3} rx={1.5} fill="#A8A29E" />
      {/* Часть 1: 27 клеток (3 ряда × 9) — более плотная сетка */}
      <text x={14} y={36} fontSize={6} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={700}>
        Часть 1
      </text>
      <text x={14} y={42} fontSize={4.5} fill="#A8A29E" fontFamily="ui-sans-serif, system-ui, sans-serif">
        №1–27 · краткий ответ
      </text>
      {Array.from({ length: 27 }).map((_, i) => {
        const col = i % 9;
        const row = Math.floor(i / 9);
        return (
          <g key={i}>
            <rect
              x={14 + col * 17}
              y={48 + row * 14}
              width={13}
              height={12}
              rx={2}
              fill={i < 8 ? "#22B37C" : "white"}
              stroke="#E7E5E0"
              strokeWidth={1}
            />
            <text
              x={14 + col * 17 + 6.5}
              y={48 + row * 14 + 8}
              fontSize={4.5}
              fill={i < 8 ? "white" : "#1F1B16"}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={600}
              textAnchor="middle"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      {/* Часть 2: 4 широких строки */}
      <text x={172} y={36} fontSize={6} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={700}>
        Часть 2
      </text>
      <text x={172} y={42} fontSize={4.5} fill="#A8A29E" fontFamily="ui-sans-serif, system-ui, sans-serif">
        №28+ · развёрнутый
      </text>
      {Array.from({ length: 4 }).map((_, i) => (
        <g key={i}>
          <rect
            x={172}
            y={48 + i * 11}
            width={136}
            height={9}
            rx={2}
            fill="white"
            stroke="#E7E5E0"
            strokeWidth={1}
          />
          <text
            x={176}
            y={48 + i * 11 + 6}
            fontSize={5}
            fill="#A8A29E"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight={600}
          >
            {`№${28 + i}`}
          </text>
          <line x1={186} y1={48 + i * 11 + 6} x2={304} y2={48 + i * 11 + 6} stroke="#F0EFEB" strokeWidth={1} />
        </g>
      ))}
    </g>
  );
}

// ═══════════════ TZ-16 Этап 1: миниатюры-заглушки новых типов ═══════════════
// Форма повторяет структуру будущего артефакта (сетка карточек, список файлов,
// 4 слота пакета, поля формы, холст иллюстрации), чтобы превью не было пустым.
// Реальные данные подставят моки в Этапах 2–7.

// ───────────────────── Materials: список файлов комплекта с иконками ─────────────────────

function MaterialsPreview_() {
  const kinds = [
    { label: "Словарь", tone: "#22B37C" },
    { label: "Справочник", tone: "#FF5E2E" },
    { label: "Раздатка", tone: "#8B7FD4" },
  ];
  return (
    <g>
      <rect x={12} y={8} width={150} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={20} width={70} height={3} rx={1.5} fill="#A8A29E" />
      {kinds.map((k, i) => {
        const y = 32 + i * 19;
        return (
          <g key={k.label}>
            <rect x={12} y={y} width={W - 24} height={16} rx={2} fill="white" stroke="#E7E5E0" strokeWidth={1} />
            {/* Иконка «документ» с загнутым уголком */}
            <path
              d={`M18 ${y + 4} h7 l3 3 v5 h-10 z`}
              fill={k.tone}
              opacity={0.85}
            />
            <text x={36} y={y + 11} fontSize={6.5} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
              {k.label}
            </text>
            <rect x={120} y={y + 6} width={110 - i * 14} height={4} rx={1} fill="#E7E5E0" />
            {/* Бейдж формата (docx / csv / txt) */}
            <rect x={W - 44} y={y + 4} width={24} height={8} rx={2} fill="#F0EFEB" />
          </g>
        );
      })}
    </g>
  );
}

// ───────────────────── Lesson bundle: 4 слота пакета со статусом ─────────────────────

function LessonBundlePreview_() {
  const slots = ["План урока", "Презентация", "Лист", "Тест"];
  return (
    <g>
      <rect x={12} y={8} width={140} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={20} width={58} height={3} rx={1.5} fill="#A8A29E" />
      {/* Сетка 2×2 — по блоку на слот, у каждого галочка «готово» */}
      {slots.map((s, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 12 + col * 152;
        const y = 32 + row * 28;
        return (
          <g key={s}>
            <rect x={x} y={y} width={144} height={24} rx={3} fill="white" stroke="#E7E5E0" strokeWidth={1} />
            {/* Иконка мини-артефакта слева */}
            <rect x={x + 6} y={y + 5} width={14} height={14} rx={2} fill="#22B37C" opacity={0.15} />
            <rect x={x + 10} y={y + 8} width={6} height={8} rx={1} fill="#22B37C" opacity={0.7} />
            <text x={x + 26} y={y + 11} fontSize={6} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
              {s}
            </text>
            <rect x={x + 26} y={y + 14} width={44 - i * 6} height={3} rx={1} fill="#E7E5E0" />
            {/* Статус «готово» — зелёная галочка */}
            <path
              d={`M${x + 124} ${y + 12} l4 4 l7 -8`}
              fill="none"
              stroke="#22B37C"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </g>
  );
}

// ───────────────────── Interactive: форма с полями ввода ─────────────────────

function InteractivePreview_() {
  return (
    <g>
      <rect x={12} y={8} width={120} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={20} width={60} height={3} rx={1.5} fill="#A8A29E" />
      {/* Два вопроса: подпись + поле ввода */}
      {[0, 1].map((i) => {
        const y = 32 + i * 30;
        return (
          <g key={i}>
            <text x={14} y={y + 8} fontSize={6} fill="#1F1B16" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight={600}>
              {`Вопрос ${i + 1}`}
            </text>
            <rect x={14} y={y + 13} width={W - 28} height={13} rx={3} fill="white" stroke="#E7E5E0" strokeWidth={1} />
            <rect x={20} y={y + 18} width={100 - i * 22} height={3} rx={1} fill="#F0EFEB" />
          </g>
        );
      })}
    </g>
  );
}

// ───────────────────── Image: холст иллюстрации с рамкой и подписью ─────────────────────

function ImagePreview_() {
  return (
    <g>
      <rect x={12} y={8} width={110} height={6} rx={2} fill="#1F1B16" />
      <rect x={12} y={20} width={64} height={3} rx={1.5} fill="#A8A29E" />
      {/* Холст A4 (landscape-миниатюра) */}
      <rect x={12} y={30} width={W - 24} height={54} rx={3} fill="white" stroke="#E7E5E0" strokeWidth={1} />
      {/* Импровизированная схема: заголовок + узлы со связями */}
      <rect x={24} y={38} width={70} height={4} rx={1.5} fill="#1F1B16" opacity={0.75} />
      <path d="M52 50 L52 62 M52 62 L32 76 M52 62 L72 76 M52 62 L112 76" stroke="#A8A29E" strokeWidth={1.2} fill="none" />
      <rect x={42} y={50} width={20} height={12} rx={2} fill="#22B37C" opacity={0.85} />
      <rect x={22} y={76} width={20} height={6} rx={2} fill="#E7E5E0" />
      <rect x={62} y={76} width={20} height={6} rx={2} fill="#E7E5E0" />
      <rect x={102} y={76} width={20} height={6} rx={2} fill="#FF5E2E" opacity={0.7} />
    </g>
  );
}

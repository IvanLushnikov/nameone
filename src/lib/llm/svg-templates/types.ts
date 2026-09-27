/**
 * Типы для chart_spec — структурированные данные, которые LLM-Generator
 * (Claude Opus 5.5 / gpt-6-sol) возвращает вместе с листом, а наш
 * шаблонный рендерер превращает в SVG.
 *
 * Подход C (гибрид) из docs/04-product-features-svg-graphs.md §3:
 * LLM отвечает за выбор типа графика и данных, мы — за валидный SVG.
 * Zod-схемы валидации живут отдельно (worker 2), здесь — только типы.
 *
 * Все размеры — пиксели в координатной системе viewBox 0 0 600 400 (3:2).
 * Это ratio A4-печати с учётом полей: график влезает в page-area
 * рабочего листа без подрезки.
 */

/** G1: bar chart — столбцы с подписями осей, данных, легенды. */
export interface BarChartSpec {
  type: 'bar';
  /** Заголовок графика (рисуется сверху, центрируется). */
  title: string;
  /** Подпись оси X (например, «Месяц»). Опционально. */
  x_label?: string;
  /** Подпись оси Y (например, «Продажи, шт»). Опционально. */
  y_label?: string;
  /** Данные: массив меток категорий и соответствующих им значений. */
  data: {
    labels: string[];
    values: number[];
  };
  /** Подпись под графиком (например, «Данные: опрос 30 учеников»). */
  caption?: string;
}

/** G2: line chart — точки + линии, сетка, легенда до 3 серий. */
export interface LineChartSpec {
  type: 'line';
  title: string;
  x_label?: string;
  y_label?: string;
  data: {
    labels: string[];
    /** До 3 серий — больше мы не поддерживаем в MVP. */
    series: { name: string; values: number[] }[];
  };
  caption?: string;
}

/** G3: pie chart — секторы с процентами, легенда справа. */
export interface PieChartSpec {
  type: 'pie';
  title: string;
  data: {
    labels: string[];
    /** Значения нормализуются автоматически (сумма к 100%). */
    values: number[];
  };
  caption?: string;
}

/** G4: number line — горизонтальная шкала с точками для координатной прямой. */
export interface NumberLineSpec {
  type: 'number_line';
  title: string;
  /** Диапазон шкалы: [min, max]. min < max, |max - min| ≤ 100. */
  range: [number, number];
  /** Шаг делений на шкале. По умолчанию — авто (1/2/5 × 10^n от span). */
  step?: number;
  /** Точки для отметки на шкале. */
  points?: Array<{
    /** Значение на шкале. */
    value: number;
    /** Подпись под точкой (например, "A" или "x = -3"). */
    label?: string;
    /** highlight (красный) — ключевые точки; normal (серый) — обычные. */
    color?: 'highlight' | 'normal';
  }>;
  caption?: string;
}

/** G5: geometry — набор фигур для геометрических задач. */
export type GeometryShape =
  | 'triangle'
  | 'rectangle'
  | 'square'
  | 'parallelogram'
  | 'circle'
  | 'trapezoid';

/** Аннотация стороны фигуры — подпись вида «AB = 5 см». */
export interface GeometrySideAnnotation {
  label: string;
  /** Идентификатор стороны, например "AB", "BC", "AC". */
  side: string;
}

/** Длины сторон, заданные в задаче (например, a = 3 см, b = 4 см). */
export interface GeometrySideMeasurement {
  id: string;
  value?: number;
  unit?: string;
}

/** Углы, заданные в задаче (например, ∠A = 60°). */
export interface GeometryAngleMeasurement {
  id: string;
  value?: number;
  unit?: '°';
}

/** G5: geometry — фигура с подписями сторон, длинами и углами. */
export interface GeometrySpec {
  type: 'geometry';
  shape: GeometryShape;
  title: string;
  /** Подписи сторон («AB = 5 см»). */
  annotations?: GeometrySideAnnotation[];
  /** Числовые данные для задач на вычисление. */
  measurements?: {
    sides?: GeometrySideMeasurement[];
    angles?: GeometryAngleMeasurement[];
  };
  /** Вопрос задачи (например, «Найдите площадь»). */
  question?: string;
  caption?: string;
}

/** G6: biology — набор шаблонных биологических диаграмм. */
export type BiologyDiagram =
  | 'plant-cell'        // растительная клетка с органеллами
  | 'animal-cell'       // животная клетка
  | 'plant'             // части растения (корень/стебель/лист/цветок)
  | 'dna'               // двойная спираль ДНК
  | 'chromosome'        // хромосома
  | 'animal-class';     // классификация животных

/** G6: biology — диаграмма с подписями. */
export interface BiologySpec {
  type: 'biology';
  diagram: BiologyDiagram;
  title: string;
  /** Подписи к частям диаграммы (например, «ядро», «хлоропласт»). */
  labels?: Array<{
    /** Идентификатор части (используется рендерером для позиционирования). */
    id: string;
    /** Текст подписи. */
    text: string;
  }>;
  /** Вопрос задачи. */
  question?: string;
  caption?: string;
}

/** G7: chemistry — набор шаблонных химических структур. */
export type ChemistryDiagram =
  | 'atom'         // атом с электронными оболочками
  | 'molecule'    // молекула из 2-3 атомов с линиями связей
  | 'periodic'    // мини-таблица Менделеева
  | 'reaction';   // схема химической реакции (реагенты → продукты)

/** G7: chemistry — диаграмма с подписями. */
export interface ChemistrySpec {
  type: 'chemistry';
  diagram: ChemistryDiagram;
  title: string;
  /** Для molecule: список атомов (id + символ). */
  atoms?: Array<{ id: string; symbol: string }>;
  /** Для molecule/reaction: связи между атомами. */
  bonds?: Array<{ from: string; to: string }>;
  /** Подписи к частям диаграммы. */
  labels?: Array<{
    id: string;
    text: string;
  }>;
  question?: string;
  caption?: string;
}

/** Дискриминированное объединение — exhaustive switch в renderChart. */
export type ChartSpec =
  | BarChartSpec
  | LineChartSpec
  | PieChartSpec
  | NumberLineSpec
  | GeometrySpec
  | BiologySpec
  | ChemistrySpec;

/**
 * Zod-схемы для chart_spec — спецификации SVG-графиков в рабочих листах.
 *
 * Phase 1 roadmap: docs/04-product-features-svg-graphs.md §5.
 * Используется как для валидации LLM-выдачи (когда LLM подключим),
 * так и для type-safety mock-fixtures и Renderer-входа.
 */
import { z } from 'zod';

/**
 * Bar chart data — пары `labels` и `values` одинаковой длины.
 */
const BarChartDataSchema = z.object({
  labels: z
    .array(z.string().min(1).max(30))
    .min(2)
    .max(12),
  values: z
    .array(z.number().finite())
    .min(2)
    .max(12),
}).refine((d) => d.labels.length === d.values.length, {
  message: 'labels и values должны быть одной длины',
  path: ['labels'],
});

export const BarChartSpecSchema = z.object({
  type: z.literal('bar'),
  title: z.string().min(1).max(100),
  x_label: z.string().max(50).optional(),
  y_label: z.string().max(50).optional(),
  data: BarChartDataSchema,
  caption: z.string().max(150).optional(),
});

/**
 * Line chart data — до 3 серий с одним x-основанием.
 */
const LineChartSeriesSchema = z.object({
  name: z.string().min(1).max(50),
  values: z.array(z.number().finite()).min(2).max(20),
});

const LineChartDataSchema = z.object({
  labels: z
    .array(z.string().min(1).max(30))
    .min(2)
    .max(20),
  series: z.array(LineChartSeriesSchema).min(1).max(3),
}).refine(
  (d) => d.series.every((s) => s.values.length === d.labels.length),
  { message: 'Каждая серия должна быть длины labels', path: ['series'] },
);

export const LineChartSpecSchema = z.object({
  type: z.literal('line'),
  title: z.string().min(1).max(100),
  x_label: z.string().max(50).optional(),
  y_label: z.string().max(50).optional(),
  data: LineChartDataSchema,
  caption: z.string().max(150).optional(),
});

/**
 * Pie chart data — секторы круга.
 */
const PieChartDataSchema = z.object({
  labels: z
    .array(z.string().min(1).max(30))
    .min(2)
    .max(12),
  values: z
    .array(z.number().finite().nonnegative())
    .min(2)
    .max(12),
}).refine((d) => d.labels.length === d.values.length, {
  message: 'labels и values должны быть одной длины',
  path: ['labels'],
}).refine(
  (d) => d.values.some((v) => v > 0),
  { message: 'Хотя бы одно значение должно быть > 0', path: ['values'] },
);

export const PieChartSpecSchema = z.object({
  type: z.literal('pie'),
  title: z.string().min(1).max(100),
  data: PieChartDataSchema,
  caption: z.string().max(150).optional(),
});

/**
 * Number line (G4) — координатная прямая с точками.
 *
 * Валидации:
 *   - range: tuple из 2 чисел, min < max, |max - min| ≤ 100
 *   - step: positive number
 *   - points: max 10
 */
const NumberLinePointSchema = z.object({
  value: z.number().finite(),
  label: z.string().max(30).optional(),
  color: z.enum(['highlight', 'normal']).optional(),
});

export const NumberLineChartSpecSchema = z.object({
  type: z.literal('number_line'),
  title: z.string().min(1).max(100),
  range: z
    .tuple([z.number().finite(), z.number().finite()])
    .refine(([min, max]) => min < max, {
      message: 'range[0] должно быть строго меньше range[1]',
    })
    .refine(([min, max]) => Math.abs(max - min) <= 100, {
      message: '|range[1] - range[0]| должно быть ≤ 100',
    }),
  step: z.number().positive().finite().optional(),
  points: z.array(NumberLinePointSchema).max(10).optional(),
  caption: z.string().max(150).optional(),
});

/**
 * Geometry (G5) — фигура с подписями сторон и измерениями.
 *
 * Валидации:
 *   - shape: enum (6 фигур)
 *   - annotations: max 8
 *   - measurements.sides / measurements.angles: max 8
 */
const GeometryShapeSchema = z.enum([
  'triangle',
  'rectangle',
  'square',
  'parallelogram',
  'circle',
  'trapezoid',
]);

const GeometrySideAnnotationSchema = z.object({
  label: z.string().min(1).max(50),
  side: z.string().min(1).max(10),
});

const GeometrySideMeasurementSchema = z.object({
  id: z.string().min(1).max(10),
  value: z.number().finite().nonnegative().optional(),
  unit: z.string().max(10).optional(),
});

const GeometryAngleMeasurementSchema = z.object({
  id: z.string().min(1).max(10),
  value: z.number().finite().min(0).max(360).optional(),
  unit: z.literal('°').optional(),
});

const GeometryMeasurementsSchema = z
  .object({
    sides: z.array(GeometrySideMeasurementSchema).max(8).optional(),
    angles: z.array(GeometryAngleMeasurementSchema).max(8).optional(),
  })
  .optional();

export const GeometryChartSpecSchema = z.object({
  type: z.literal('geometry'),
  shape: GeometryShapeSchema,
  title: z.string().min(1).max(100),
  annotations: z.array(GeometrySideAnnotationSchema).max(8).optional(),
  measurements: GeometryMeasurementsSchema,
  question: z.string().max(150).optional(),
  caption: z.string().max(150).optional(),
});

/**
 * Biology (G6) — 6 шаблонов.
 */
const BiologyDiagramSchema = z.enum([
  'plant-cell',
  'animal-cell',
  'plant',
  'dna',
  'chromosome',
  'animal-class',
]);

const BiologyLabelSchema = z.object({
  id: z.string().min(1).max(30),
  text: z.string().min(1).max(100),
});

export const BiologyChartSpecSchema = z.object({
  type: z.literal('biology'),
  diagram: BiologyDiagramSchema,
  title: z.string().min(1).max(100),
  labels: z.array(BiologyLabelSchema).max(12).optional(),
  question: z.string().max(150).optional(),
  caption: z.string().max(150).optional(),
});

/**
 * Chemistry (G7) — 4 шаблона.
 */
const ChemistryDiagramSchema = z.enum([
  'atom',
  'molecule',
  'periodic',
  'reaction',
]);

const ChemistryAtomSchema = z.object({
  id: z.string().min(1).max(10),
  symbol: z.string().min(1).max(3),
});

const ChemistryBondSchema = z.object({
  from: z.string().min(1).max(10),
  to: z.string().min(1).max(10),
});

export const ChemistryChartSpecSchema = z.object({
  type: z.literal('chemistry'),
  diagram: ChemistryDiagramSchema,
  title: z.string().min(1).max(100),
  atoms: z.array(ChemistryAtomSchema).max(20).optional(),
  bonds: z.array(ChemistryBondSchema).max(30).optional(),
  labels: z.array(BiologyLabelSchema).max(12).optional(),
  question: z.string().max(150).optional(),
  caption: z.string().max(150).optional(),
});

/**
 * Discriminated union по `type` — гарантирует exhaustive в renderer.ts.
 */
export const ChartSpecSchema = z.discriminatedUnion('type', [
  BarChartSpecSchema,
  LineChartSpecSchema,
  PieChartSpecSchema,
  NumberLineChartSpecSchema,
  GeometryChartSpecSchema,
  BiologyChartSpecSchema,
  ChemistryChartSpecSchema,
]);

export type ChartSpecFromZod = z.infer<typeof ChartSpecSchema>;
export type BarChartSpecFromZod = z.infer<typeof BarChartSpecSchema>;
export type LineChartSpecFromZod = z.infer<typeof LineChartSpecSchema>;
export type PieChartSpecFromZod = z.infer<typeof PieChartSpecSchema>;
export type NumberLineChartSpecFromZod = z.infer<typeof NumberLineChartSpecSchema>;
export type GeometryChartSpecFromZod = z.infer<typeof GeometryChartSpecSchema>;
export type BiologyChartSpecFromZod = z.infer<typeof BiologyChartSpecSchema>;
export type ChemistryChartSpecFromZod = z.infer<typeof ChemistryChartSpecSchema>;

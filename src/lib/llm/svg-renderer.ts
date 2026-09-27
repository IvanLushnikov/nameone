/**
 * Главный рендерер SVG-графиков для рабочих листов.
 *
 * Принимает `ChartSpec` (дискриминированное объединение из types.ts),
 * возвращает строку с валидным SVG-кодом, готовую к встраиванию в HTML
 * или PDF-экспорт.
 *
 * Использование:
 *   const svg = renderChart(chartSpec);
 *   // → встроить через dangerouslySetInnerHTML (после санитайзера на бэке)
 *   //    или через React-компонент <SvgChart spec={...} /> в preview.
 *
 * Каждый шаблон (bar/line/pie) — отдельный файл в ./svg-templates/.
 * Exhaustiveness через `_exhaustive: never` гарантирует, что при добавлении
 * нового типа в ChartSpec компилятор напомнит обновить switch.
 */

import type { ChartSpec } from './svg-templates/types';
import { renderBar } from './svg-templates/bar';
import { renderLine } from './svg-templates/line';
import { renderPie } from './svg-templates/pie';
import { renderNumberLine } from './svg-templates/number-line';
import { renderGeometry } from './svg-templates/geometry';
import { renderBiology } from './svg-templates/biology';
import { renderChemistry } from './svg-templates/chemistry';

export type { ChartSpec } from './svg-templates/types';

export function renderChart(spec: ChartSpec): string {
  switch (spec.type) {
    case 'bar':
      return renderBar(spec);
    case 'line':
      return renderLine(spec);
    case 'pie':
      return renderPie(spec);
    case 'number_line':
      return renderNumberLine(spec);
    case 'geometry':
      return renderGeometry(spec);
    case 'biology':
      return renderBiology(spec);
    case 'chemistry':
      return renderChemistry(spec);
    default: {
      // Exhaustiveness check: если в ChartSpec добавят новый тип,
      // TS заставит обновить switch.
      const _exhaustive: never = spec;
      throw new Error(`Unknown chart type: ${(spec as { type: string }).type}`);
    }
  }
}

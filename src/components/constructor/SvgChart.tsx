'use client';

import type { FC } from 'react';
import { renderChart } from '@/lib/llm/svg-renderer';
import type { ChartSpec } from '@/lib/llm/svg-renderer';

interface SvgChartProps {
  spec: ChartSpec;
  className?: string;
}

/**
 * Inline-рендер SVG-графика из chart_spec.
 *
 * Принцип (см. docs/04-product-features-svg-graphs.md §3, подход C):
 * LLM отдаёт только данные (chart_spec), а валидированный шаблон
 * генерит финальный SVG через `renderChart()`. Результат приходит
 * строкой — встраиваем через `dangerouslySetInnerHTML`. На стороне
 * renderer-а гарантируется валидный SVG (это не AI-вывод), поэтому
 * trust-boundary здесь не нарушается.
 *
 * Inline-рендер обязателен для печати/PDF (Phase 2): внешние
 * `<img src="...svg">` ломают @page A4-разводку.
 */
export const SvgChart: FC<SvgChartProps> = ({ spec, className }) => {
  const svg = renderChart(spec);
  return (
    <div
      className={`svg-chart-wrapper my-4 flex justify-center ${className ?? ''}`.trim()}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
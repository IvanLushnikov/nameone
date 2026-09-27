/**
 * Unit-тесты для SVG-рендерера графиков (svg-renderer.ts + svg-templates/*).
 *
 * Покрытие:
 *   1. Bar chart: валидный SVG, есть <rect> для каждого столбца, высота в пределах viewBox.
 *   2. Line chart: правильное число точек (labels × series).
 *   3. Pie chart: path-элементы для каждого сектора.
 *   4. Edge cases: пустые/единичные данные не падают.
 *
 * Запуск: `npx vitest run src/lib/llm/__tests__/svg-renderer.test.ts`
 */

import { describe, it, expect } from 'vitest';
import { renderChart } from '../svg-renderer';
import type {
  BarChartSpec,
  LineChartSpec,
  PieChartSpec,
  NumberLineSpec,
  GeometrySpec,
  BiologySpec,
  ChemistrySpec,
} from '../svg-templates/types';

describe('renderChart — bar', () => {
  const barSpec: BarChartSpec = {
    type: 'bar',
    title: 'Продажи мороженого по месяцам',
    x_label: 'Месяц',
    y_label: 'Продажи, шт',
    data: { labels: ['Янв', 'Фев', 'Мар', 'Апр'], values: [120, 145, 98, 170] },
    caption: 'Данные: кафе "Морозко", 2026',
  };

  it('возвращает валидный SVG, начинающийся с <svg и закрывающийся </svg>', () => {
    const svg = renderChart(barSpec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('содержит <rect> для каждого столбца (по data.values)', () => {
    const svg = renderChart(barSpec);
    const rectMatches = svg.match(/<rect\b/g) ?? [];
    // Один <rect> на каждый столбец (4) + в некоторых местах может быть больше
    // (например, rect для hover-style в <style>). Минимум — 4.
    expect(rectMatches.length).toBeGreaterThanOrEqual(barSpec.data.values.length);
  });

  it('viewBox ограничивает высоту ≤ 400', () => {
    const svg = renderChart(barSpec);
    const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(m).not.toBeNull();
    const height = Number(m![2]);
    expect(height).toBeLessThanOrEqual(400);
  });

  it('edge case: пустые values — рендерится без падения', () => {
    const empty: BarChartSpec = { type: 'bar', title: 'Пусто', data: { labels: [], values: [] } };
    expect(() => renderChart(empty)).not.toThrow();
    const svg = renderChart(empty);
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('edge case: один label — не падает', () => {
    const single: BarChartSpec = { type: 'bar', title: 'Один', data: { labels: ['Только'], values: [42] } };
    expect(() => renderChart(single)).not.toThrow();
    const svg = renderChart(single);
    expect(svg).toContain('<rect');
  });
});

describe('renderChart — line', () => {
  const lineSpec: LineChartSpec = {
    type: 'line',
    title: 'Температура за неделю',
    x_label: 'День',
    y_label: '°C',
    data: {
      labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'],
      series: [
        { name: 'Москва', values: [15, 17, 16, 18, 20] },
        { name: 'Сочи', values: [22, 23, 25, 24, 26] },
      ],
    },
  };

  it('возвращает валидный SVG', () => {
    const svg = renderChart(lineSpec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('содержит правильное число точек (<circle>) = labels × series', () => {
    const svg = renderChart(lineSpec);
    const circles = svg.match(/<circle\b/g) ?? [];
    const expected = lineSpec.data.labels.length * lineSpec.data.series.length;
    expect(circles.length).toBe(expected);
  });

  it('содержит polyline для каждой серии', () => {
    const svg = renderChart(lineSpec);
    const polylines = svg.match(/<polyline\b/g) ?? [];
    expect(polylines.length).toBe(lineSpec.data.series.length);
  });

  it('edge case: одна серия с одним label — не падает', () => {
    const tiny: LineChartSpec = {
      type: 'line',
      title: 'Минимум',
      data: { labels: ['A'], series: [{ name: 'S1', values: [1] }] },
    };
    expect(() => renderChart(tiny)).not.toThrow();
    const svg = renderChart(tiny);
    expect(svg.match(/<circle\b/g)?.length ?? 0).toBe(1);
  });
});

describe('renderChart — pie', () => {
  const pieSpec: PieChartSpec = {
    type: 'pie',
    title: 'Доли бюджета',
    data: { labels: ['Аренда', 'Зарплата', 'Маркетинг', 'Прочее'], values: [40, 35, 15, 10] },
  };

  it('возвращает валидный SVG', () => {
    const svg = renderChart(pieSpec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('содержит <path> для каждого непустого сектора', () => {
    const svg = renderChart(pieSpec);
    const paths = svg.match(/<path\b/g) ?? [];
    // По одному path на каждый непустой сектор (здесь все 4 положительные).
    expect(paths.length).toBeGreaterThanOrEqual(pieSpec.data.labels.length);
  });

  it('edge case: все значения 0 — не падает, показывает заглушку', () => {
    const empty: PieChartSpec = { type: 'pie', title: 'Пусто', data: { labels: ['A', 'B'], values: [0, 0] } };
    expect(() => renderChart(empty)).not.toThrow();
    const svg = renderChart(empty);
    expect(svg).toContain('<circle'); // Серый placeholder.
  });

  it('edge case: один slice — не падает', () => {
    const single: PieChartSpec = { type: 'pie', title: 'Один', data: { labels: ['Все'], values: [100] } };
    expect(() => renderChart(single)).not.toThrow();
    const svg = renderChart(single);
    expect(svg).toContain('<path');
  });
});

describe('renderChart — общий', () => {
  it('возвращает строку, которая парсится как SVG XML (через regex — без DOMParser в node)', () => {
    // В node нет встроенного DOMParser; проверяем минимальную валидность структуры.
    const bar: BarChartSpec = { type: 'bar', title: 'T', data: { labels: ['A', 'B'], values: [1, 2] } };
    const svg = renderChart(bar);
    expect(svg).toMatch(/^<svg [^>]+>/);
    expect(svg).toMatch(/<\/svg>$/);
    // Сбалансированные открывающие/закрывающие теги основных элементов.
    const opens = (svg.match(/<rect\b/g) ?? []).length;
    const rectsSelfClosed = svg.match(/<rect[^>]*\/>/g) ?? [];
    expect(opens).toBe(rectsSelfClosed.length);
  });
});

describe('renderChart — number_line (Phase 2)', () => {
  const nlSpec: NumberLineSpec = {
    type: 'number_line',
    title: 'Числовая прямая',
    range: [-5, 5],
    step: 1,
    points: [
      { value: -3, label: 'A', color: 'highlight' },
      { value: 3, label: 'B', color: 'normal' },
    ],
  };

  it('starts with <svg> and has viewBox 0 0 600 400', () => {
    const svg = renderChart(nlSpec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 400"');
  });

  it('renders line element for the axis', () => {
    const svg = renderChart(nlSpec);
    expect(svg).toContain('<line');
    expect(svg).toContain('stroke="#374151"');
  });

  it('renders circles for each point', () => {
    const svg = renderChart(nlSpec);
    const circles = svg.match(/<circle /g);
    expect(circles).not.toBeNull();
    expect(circles!.length).toBeGreaterThanOrEqual(2);
  });

  it('uses red color for highlight points', () => {
    const svg = renderChart(nlSpec);
    expect(svg).toContain('#ef4444');
  });

  it('edge case: invalid range (min == max) returns placeholder, not crashes', () => {
    const bad: NumberLineSpec = {
      type: 'number_line',
      title: 'Bad',
      range: [5, 5],
    };
    expect(() => renderChart(bad)).not.toThrow();
    const svg = renderChart(bad);
    expect(svg).toContain('Некорректный диапазон');
  });

  it('skips points outside range', () => {
    const bad: NumberLineSpec = {
      type: 'number_line',
      title: 'Out',
      range: [0, 5],
      points: [
        { value: 100, label: 'far' }, // за пределами
        { value: 2, label: 'in' },
      ],
    };
    const svg = renderChart(bad);
    // Только точка 'in' должна попасть в SVG
    expect(svg).toContain('>in<');
    expect(svg).not.toContain('>far<');
  });
});

describe('renderChart — geometry (Phase 2)', () => {
  const triangle: GeometrySpec = {
    type: 'geometry',
    shape: 'triangle',
    title: 'Test Triangle',
    measurements: { angles: [{ id: 'A', value: 60, unit: '°' }] },
  };

  it('starts with <svg> with correct viewBox', () => {
    const svg = renderChart(triangle);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 400"');
  });

  it('renders polygon for triangle (3 points)', () => {
    const svg = renderChart(triangle);
    expect(svg).toContain('<polygon');
    const pointsMatch = svg.match(/<polygon points="([^"]+)"/);
    expect(pointsMatch).not.toBeNull();
    // 3 координаты через запятую = 3 вершины.
    const points = pointsMatch![1].trim().split(/\s+/);
    expect(points.length).toBe(3);
  });

  it('labels vertices A, B, C for triangle', () => {
    const svg = renderChart(triangle);
    expect(svg).toContain('>A<');
    expect(svg).toContain('>B<');
    expect(svg).toContain('>C<');
  });

  it('renders angle arc when measurements.angles provided', () => {
    const svg = renderChart(triangle);
    expect(svg).toContain('<path d="M ');
    // Угол A=60° должен быть отрисован.
    expect(svg).toContain('>60°<');
  });

  it.each([
    ['rectangle', 'rect'],
    ['square', 'rect'],
    ['parallelogram', 'polygon'],
    ['circle', 'circle'],
    ['trapezoid', 'polygon'],
  ] as const)('shape=%s renders expected svg element', (shape, expectedTag) => {
    const spec: GeometrySpec = {
      type: 'geometry',
      shape: shape as GeometrySpec['shape'],
      title: 'Test',
    };
    const svg = renderChart(spec);
    expect(svg).toContain(`<${expectedTag}`);
  });

  it('edge case: triangle without measurements renders OK', () => {
    const spec: GeometrySpec = { type: 'geometry', shape: 'triangle', title: 'No Angles' };
    expect(() => renderChart(spec)).not.toThrow();
  });
});

describe('renderChart — biology (Phase 3)', () => {
  const spec: BiologySpec = {
    type: 'biology',
    diagram: 'animal-cell',
    title: 'Животная клетка',
  };

  it('starts with <svg> and has correct viewBox', () => {
    const svg = renderChart(spec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 400"');
  });

  it('renders ellipse for cell membrane', () => {
    const svg = renderChart(spec);
    expect(svg).toContain('<ellipse');
  });

  it('renders labels in Russian', () => {
    const svg = renderChart(spec);
    expect(svg).toContain('Ядро');
    expect(svg).toContain('Митохондрия');
  });

  it.each([
    'plant-cell', 'animal-cell', 'plant', 'dna', 'chromosome', 'animal-class',
  ] as const)('diagram=%s renders without throwing', (diagram) => {
    const s: BiologySpec = { type: 'biology', diagram, title: 'Test' };
    expect(() => renderChart(s)).not.toThrow();
  });
});

describe('renderChart — chemistry (Phase 3)', () => {
  const spec: ChemistrySpec = {
    type: 'chemistry',
    diagram: 'atom',
    title: 'Атом',
  };

  it('starts with <svg> with correct viewBox', () => {
    const svg = renderChart(spec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 400"');
  });

  it('atom renders core circle and electron shell', () => {
    const svg = renderChart(spec);
    expect(svg).toContain('H'); // символ водорода
    expect(svg).toContain('<circle'); // ядро + электроны
  });

  it('molecule renders atoms with bond lines', () => {
    const s: ChemistrySpec = { type: 'chemistry', diagram: 'molecule', title: 'H2O' };
    const svg = renderChart(s);
    expect(svg).toContain('O'); // кислород
    expect(svg).toContain('H'); // водород
    expect(svg).toContain('<line'); // связи
  });

  it('reaction renders arrow and products', () => {
    const s: ChemistrySpec = { type: 'chemistry', diagram: 'reaction', title: 'Combustion' };
    const svg = renderChart(s);
    expect(svg).toContain('<line'); // стрелка
    expect(svg).toContain('<polygon'); // наконечник стрелки
  });

  it.each([
    'atom', 'molecule', 'periodic', 'reaction',
  ] as const)('diagram=%s renders without throwing', (diagram) => {
    const s: ChemistrySpec = { type: 'chemistry', diagram, title: 'Test' };
    expect(() => renderChart(s)).not.toThrow();
  });
});

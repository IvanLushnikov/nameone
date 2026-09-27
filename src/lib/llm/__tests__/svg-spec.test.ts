/**
 * Тесты Zod-схем для chart_spec.
 * Покрывают валидные данные + основные edge cases + discriminated union.
 */
import { describe, it, expect } from 'vitest';
import {
  ChartSpecSchema,
  BarChartSpecSchema,
  LineChartSpecSchema,
  PieChartSpecSchema,
} from '../svg-spec';

const validBar = {
  type: 'bar' as const,
  title: 'Test Bar',
  data: {
    labels: ['A', 'B', 'C'],
    values: [10, 20, 30],
  },
};

const validLine = {
  type: 'line' as const,
  title: 'Test Line',
  data: {
    labels: ['X', 'Y'],
    series: [{ name: 's1', values: [1, 2] }],
  },
};

const validPie = {
  type: 'pie' as const,
  title: 'Test Pie',
  data: {
    labels: ['A', 'B'],
    values: [60, 40],
  },
};

describe('ChartSpecSchema — discriminated union', () => {
  it('accepts valid bar', () => {
    expect(() => ChartSpecSchema.parse(validBar)).not.toThrow();
  });

  it('accepts valid line', () => {
    expect(() => ChartSpecSchema.parse(validLine)).not.toThrow();
  });

  it('accepts valid pie', () => {
    expect(() => ChartSpecSchema.parse(validPie)).not.toThrow();
  });

  it('rejects missing type (object without type field)', () => {
    const noType = { title: 'Test', data: validBar.data };
    expect(() => ChartSpecSchema.parse(noType)).toThrow();
  });

  it('rejects invalid data shape', () => {
    const wrongType = { type: 'bar', title: 'Test', data: { labels: ['A'], values: [1] } };
    expect(() => ChartSpecSchema.parse(wrongType)).toThrow();
  });
});

describe('BarChartSpecSchema', () => {
  it('rejects when labels.length !== values.length', () => {
    expect(() =>
      BarChartSpecSchema.parse({
        type: 'bar',
        title: 'Test',
        data: { labels: ['A', 'B'], values: [10] },
      }),
    ).toThrow(/labels и values/);
  });

  it('rejects when labels < 2', () => {
    expect(() =>
      BarChartSpecSchema.parse({
        type: 'bar',
        title: 'Test',
        data: { labels: ['A'], values: [1] },
      }),
    ).toThrow();
  });

  it('rejects when labels > 12', () => {
    expect(() =>
      BarChartSpecSchema.parse({
        type: 'bar',
        title: 'Test',
        data: {
          labels: Array(13).fill('x'),
          values: Array(13).fill(1),
        },
      }),
    ).toThrow();
  });

  it('accepts optional x_label / y_label / caption', () => {
    const r = BarChartSpecSchema.parse({
      ...validBar,
      x_label: 'X',
      y_label: 'Y',
      caption: 'C',
    });
    expect(r.x_label).toBe('X');
  });
});

describe('LineChartSpecSchema', () => {
  it('rejects when more than 3 series', () => {
    expect(() =>
      LineChartSpecSchema.parse({
        type: 'line',
        title: 'Test',
        data: {
          labels: ['A', 'B'],
          series: [
            { name: 's1', values: [1, 2] },
            { name: 's2', values: [3, 4] },
            { name: 's3', values: [5, 6] },
            { name: 's4', values: [7, 8] },
          ],
        },
      }),
    ).toThrow();
  });

  it('rejects when series length != labels length', () => {
    expect(() =>
      LineChartSpecSchema.parse({
        type: 'line',
        title: 'Test',
        data: {
          labels: ['A', 'B', 'C'],
          series: [{ name: 's1', values: [1, 2] }],
        },
      }),
    ).toThrow(/длины labels/);
  });
});

describe('PieChartSpecSchema', () => {
  it('accepts values summing to 100', () => {
    const r = PieChartSpecSchema.parse({
      type: 'pie',
      title: 'Test',
      data: { labels: ['A', 'B'], values: [70, 30] },
    });
    expect(r.type).toBe('pie');
  });

  it('rejects when all values are zero', () => {
    expect(() =>
      PieChartSpecSchema.parse({
        type: 'pie',
        title: 'Test',
        data: { labels: ['A', 'B'], values: [0, 0] },
      }),
    ).toThrow(/> 0/);
  });

  it('rejects negative values', () => {
    expect(() =>
      PieChartSpecSchema.parse({
        type: 'pie',
        title: 'Test',
        data: { labels: ['A', 'B'], values: [-10, 110] },
      }),
    ).toThrow();
  });
});

describe('NumberLineChartSpecSchema (Phase 2)', () => {
  it('accepts valid number_line', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'number_line',
        title: 'Test',
        range: [-5, 5],
        step: 1,
        points: [{ value: 0, label: 'O', color: 'highlight' }],
      }),
    ).not.toThrow();
  });

  it('rejects range where min >= max', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'number_line',
        title: 'Test',
        range: [5, 5],
      }),
    ).toThrow();
  });

  it('rejects range larger than 100', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'number_line',
        title: 'Test',
        range: [-200, 200],
      }),
    ).toThrow();
  });

  it('rejects step <= 0', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'number_line',
        title: 'Test',
        range: [0, 10],
        step: 0,
      }),
    ).toThrow();
  });
});

describe('GeometryChartSpecSchema (Phase 2)', () => {
  it('accepts valid geometry (triangle)', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'geometry',
        shape: 'triangle',
        title: 'Test',
      }),
    ).not.toThrow();
  });

  it('accepts all 6 shapes', () => {
    for (const shape of ['triangle', 'rectangle', 'square', 'parallelogram', 'circle', 'trapezoid']) {
      expect(() =>
        ChartSpecSchema.parse({ type: 'geometry', shape, title: 'Test' }),
      ).not.toThrow();
    }
  });

  it('rejects unknown shape', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'geometry',
        shape: 'hexagon',
        title: 'Test',
      }),
    ).toThrow();
  });

  it('rejects too many annotations (>8)', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'geometry',
        shape: 'triangle',
        title: 'Test',
        annotations: Array(9).fill({ label: 'a=b', side: 'AB' }),
      }),
    ).toThrow();
  });

  it('rejects angle > 360', () => {
    expect(() =>
      ChartSpecSchema.parse({
        type: 'geometry',
        shape: 'triangle',
        title: 'Test',
        measurements: { angles: [{ id: 'A', value: 400, unit: '°' }] },
      }),
    ).toThrow();
  });
});

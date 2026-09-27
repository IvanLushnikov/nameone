/**
 * Тесты для pickChartForTopic — наша mock-функция, которая возвращает
 * chart_spec для заданной темы из таксономии.
 *
 * Phase 1+2: bar/line/pie/number_line/geometry.
 * Slug'и должны совпадать с src/lib/content/subjects.ts.
 */
import { describe, it, expect } from 'vitest';
import { pickChartForTopic, CHART_TOPICS } from '../../mock/chart-fixtures';

describe('pickChartForTopic — Phase 1 (bar/line/pie)', () => {
  it('math/gistory → bar', () => {
    const r = pickChartForTopic('math', 'gistory');
    expect(r?.type).toBe('bar');
  });

  it('math/lineynaya-funktsiya → line', () => {
    const r = pickChartForTopic('math', 'lineynaya-funktsiya');
    expect(r?.type).toBe('line');
  });

  it('math/doli-i-protsenty → pie', () => {
    const r = pickChartForTopic('math', 'doli-i-protsenty');
    expect(r?.type).toBe('pie');
  });
});

describe('pickChartForTopic — Phase 2 (number_line)', () => {
  it('math/koordinatnyy-luch-i-shkaly → number_line', () => {
    const r = pickChartForTopic('math', 'koordinatnyy-luch-i-shkaly');
    expect(r?.type).toBe('number_line');
    if (r?.type === 'number_line') {
      expect(r.range[0]).toBe(0);
      expect(r.range[1]).toBe(12);
    }
  });

  it('math/deystviya-s-ratsionalnymi-chislami → number_line', () => {
    const r = pickChartForTopic('math', 'deystviya-s-ratsionalnymi-chislami');
    expect(r?.type).toBe('number_line');
    if (r?.type === 'number_line') {
      // Отрицательные значения.
      expect(r.range[0]).toBeLessThan(0);
    }
  });

  it('math/modul-chisla → number_line', () => {
    const r = pickChartForTopic('math', 'modul-chisla');
    expect(r?.type).toBe('number_line');
  });
});

describe('pickChartForTopic — Phase 2 (geometry)', () => {
  it('math/ugly-izmerenie-uglov → geometry (triangle)', () => {
    const r = pickChartForTopic('math', 'ugly-izmerenie-uglov');
    expect(r?.type).toBe('geometry');
    if (r?.type === 'geometry') {
      expect(r.shape).toBe('triangle');
    }
  });

  it('math/ploshchad-i-perimetr → geometry (rectangle)', () => {
    const r = pickChartForTopic('math', 'ploschad-i-perimetr');
    expect(r?.type).toBe('geometry');
    if (r?.type === 'geometry') {
      expect(r.shape).toBe('rectangle');
    }
  });

  it('math/pravye-i-ugly → geometry (parallelogram)', () => {
    const r = pickChartForTopic('math', 'pravye-i-ugly');
    expect(r?.type).toBe('geometry');
    if (r?.type === 'geometry') {
      expect(r.shape).toBe('parallelogram');
    }
  });

  it('math/krug → geometry (circle)', () => {
    const r = pickChartForTopic('math', 'krug');
    expect(r?.type).toBe('geometry');
    if (r?.type === 'geometry') {
      expect(r.shape).toBe('circle');
    }
  });
});

describe('pickChartForTopic — fallback', () => {
  it('returns null for unknown topic', () => {
    expect(pickChartForTopic('math', 'unknown-topic-xyz')).toBeNull();
  });

  it('returns null for subject without fixtures', () => {
    expect(pickChartForTopic('english', 'past-simple')).toBeNull();
  });

  it('returns null for empty subject', () => {
    expect(pickChartForTopic('', 'anything')).toBeNull();
  });
});

describe('CHART_TOPICS', () => {
  it('exposes all fixture topics for admin-UI / SEO', () => {
    expect(CHART_TOPICS.length).toBeGreaterThan(0);
    for (const t of CHART_TOPICS) {
      expect(t.subject).toBeTruthy();
      expect(t.topicSlug).toBeTruthy();
      expect(t.title).toBeTruthy();
    }
  });
});

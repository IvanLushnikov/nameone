import type { LineChartSpec } from './types';

/**
 * Шаблон G2: line chart.
 *
 * SVG-код для встраивания в рабочий лист. До 3 серий разными цветами,
 * точки (круги) + соединительные линии (polyline), тонкая серая сетка,
 * легенда в правом верхнем углу.
 *
 * viewBox = "0 0 600 400", padding: top=40, right=40, bottom=60, left=60.
 * Дополнительно справа сверху — место под легенду (~150×60).
 */

const COLORS = ['#3b82f6', '#ef4444', '#10b981'] as const;
const COLOR_AXIS = '#374151';
const COLOR_GRID = '#e5e7eb';
const COLOR_TEXT = '#111827';

const W = 600;
const H = 400;
const PAD = { top: 40, right: 40, bottom: 60, left: 60 } as const;

function niceStep(max: number, targetTicks: number): number {
  if (max <= 0) return 1;
  const rough = max / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderLine(spec: LineChartSpec): string {
  const { title, x_label, y_label, data, caption } = spec;

  const labels = data?.labels ?? [];
  // Лимит на 3 серии (как в ТЗ).
  const series = (data?.series ?? []).slice(0, 3);
  const n = labels.length;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Считаем общий max по всем сериям.
  const allValues = series.flatMap((s) => s.values ?? []);
  const maxRaw = allValues.length > 0 ? Math.max(0, ...allValues) : 0;
  const maxVal = maxRaw > 0 ? maxRaw * 1.05 : 1;
  const step = niceStep(maxVal, 5);
  const yMax = Math.ceil(maxVal / step) * step;

  const tickValues: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) tickValues.push(v);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">`
  );

  // Title.
  parts.push(
    `<text x="${W / 2}" y="22" text-anchor="middle" font-size="16" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(title)}</text>`
  );

  // Y grid + ticks.
  for (const t of tickValues) {
    const y = PAD.top + plotH - (t / yMax) * plotH;
    parts.push(`<line x1="${PAD.left}" y1="${y.toFixed(2)}" x2="${PAD.left + plotW}" y2="${y.toFixed(2)}" stroke="${COLOR_GRID}" stroke-width="1"/>`);
    parts.push(
      `<text x="${PAD.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="${COLOR_AXIS}">${t}</text>`
    );
  }

  // X ticks: тонкие серые риски под осью.
  if (n > 0) {
    const bandW = plotW / n;
    for (let i = 0; i < n; i++) {
      const cx = PAD.left + bandW * i + bandW / 2;
      parts.push(
        `<line x1="${cx.toFixed(2)}" y1="${PAD.top + plotH}" x2="${cx.toFixed(2)}" y2="${PAD.top + plotH + 4}" stroke="${COLOR_AXIS}" stroke-width="1"/>`
      );
      // X label — поворачиваем если длинный.
      const lbl = labels[i] ?? '';
      if (lbl.length > 10) {
        parts.push(
          `<text x="${cx.toFixed(2)}" y="${PAD.top + plotH + 14}" text-anchor="end" font-size="11" fill="${COLOR_AXIS}" transform="rotate(-30 ${cx.toFixed(2)} ${PAD.top + plotH + 14})">${escapeXml(lbl)}</text>`
        );
      } else {
        parts.push(
          `<text x="${cx.toFixed(2)}" y="${PAD.top + plotH + 16}" text-anchor="middle" font-size="11" fill="${COLOR_AXIS}">${escapeXml(lbl)}</text>`
        );
      }
    }
  }

  // Axis lines.
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="${COLOR_AXIS}" stroke-width="1.5"/>`);
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" stroke="${COLOR_AXIS}" stroke-width="1.5"/>`);

  // Series (polyline + points).
  if (n > 0) {
    const bandW = plotW / n;
    series.forEach((s, sIdx) => {
      const color = COLORS[sIdx] ?? COLORS[0]!;
      const points: string[] = [];
      const values = s.values ?? [];
      for (let i = 0; i < n; i++) {
        const v = Number.isFinite(values[i]) ? values[i]! : 0;
        const cx = PAD.left + bandW * i + bandW / 2;
        const cy = PAD.top + plotH - (yMax > 0 ? (v / yMax) * plotH : 0);
        points.push(`${cx.toFixed(2)},${cy.toFixed(2)}`);
        // Точка-кружок.
        parts.push(
          `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.5" fill="${color}" stroke="#ffffff" stroke-width="1"/>`
        );
      }
      parts.push(
        `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${points.join(' ')}"/>`
      );
    });
  }

  // Axis labels.
  if (x_label) {
    parts.push(
      `<text x="${PAD.left + plotW / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${COLOR_TEXT}">${escapeXml(x_label)}</text>`
    );
  }
  if (y_label) {
    parts.push(
      `<text x="14" y="${PAD.top + plotH / 2}" text-anchor="middle" font-size="12" fill="${COLOR_TEXT}" transform="rotate(-90 14 ${PAD.top + plotH / 2})">${escapeXml(y_label)}</text>`
    );
  }

  // Legend (правый верхний угол plot area). До 3 серий = до 3 строк.
  if (series.length > 0) {
    const legW = 130;
    const legH = 16 + 18 * series.length + 8;
    const legX = PAD.left + plotW - legW - 8;
    const legY = PAD.top + 8;
    parts.push(
      `<g><rect x="${legX}" y="${legY}" width="${legW}" height="${legH}" fill="#ffffff" stroke="${COLOR_GRID}" stroke-width="1" rx="4"/>`
    );
    series.forEach((s, sIdx) => {
      const color = COLORS[sIdx] ?? COLORS[0]!;
      const ly = legY + 16 + sIdx * 18;
      parts.push(
        `<rect x="${legX + 8}" y="${ly - 8}" width="12" height="12" fill="${color}" rx="2"/>` +
          `<text x="${legX + 26}" y="${ly + 2}" font-size="11" fill="${COLOR_TEXT}">${escapeXml(s.name)}</text>`
      );
    });
    parts.push(`</g>`);
  }

  // Caption.
  if (caption) {
    parts.push(
      `<text x="${PAD.left + plotW / 2}" y="${H - 24}" text-anchor="middle" font-size="10" fill="${COLOR_AXIS}" font-style="italic">${escapeXml(caption)}</text>`
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}

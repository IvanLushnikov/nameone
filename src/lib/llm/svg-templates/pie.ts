import type { PieChartSpec } from './types';

/**
 * Шаблон G3: pie chart.
 *
 * Pie слева (центр ~ (200, 200), радиус 140), легенда справа.
 * Цвета — категориальная палитра из 7 цветов (как в ТЗ), циклически.
 * Внутри секторов подписываем проценты, если доля > 8%.
 *
 * viewBox = "0 0 600 400", padding: top=40, right=40, bottom=60, left=60.
 */

const PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'] as const;
const COLOR_TEXT = '#111827';
const COLOR_AXIS = '#374151';
const COLOR_LEGEND_BORDER = '#e5e7eb';

const W = 600;
const H = 400;
const PAD = { top: 40, right: 40, bottom: 60, left: 60 } as const;

// Геометрия пирога.
const PIE_CX = 200;
const const_CY = 200;
const PIE_R = 130;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Рисует сектор пирога через SVG path с двумя дугами.
 * Для целого круга (100%) — рисуем два полукруга, чтобы избежать дегенеративного path.
 */
function sectorPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  // Нормализуем углы в радианы. 0° = верх (12 часов), идём по часовой.
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const a0 = toRad(startAngle);
  const a1 = toRad(endAngle);
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  // Если угол почти полный (>= 359.999°) — рисуем два полукруга, иначе path с одной дугой.
  if (endAngle - startAngle >= 359.999) {
    // Полный круг как два полукруга через Z.
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  return `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

/**
 * Точка для подписи процента внутри сектора (на середине радиуса).
 */
function polarPoint(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function renderPie(spec: PieChartSpec): string {
  const { title, data, caption } = spec;

  const labels = data?.labels ?? [];
  const values = data?.values ?? [];
  const n = Math.min(labels.length, values.length);

  // Edge cases: пустые данные или все нули — заглушка с серым кругом и подписью.
  const sum = n > 0 ? values.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0) : 0;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">`
  );

  // Title.
  parts.push(
    `<text x="${W / 2}" y="22" text-anchor="middle" font-size="16" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(title)}</text>`
  );

  if (sum <= 0) {
    // Пустой пирог — серый круг с текстом по центру.
    parts.push(
      `<circle cx="${PIE_CX}" cy="${const_CY}" r="${PIE_R}" fill="#f3f4f6" stroke="${COLOR_AXIS}" stroke-width="1"/>` +
        `<text x="${PIE_CX}" y="${const_CY}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="${COLOR_AXIS}">Нет данных</text>`
    );
  } else {
    // Секторы.
    let angle = 0;
    for (let i = 0; i < n; i++) {
      const v = Number.isFinite(values[i]) && values[i]! > 0 ? values[i]! : 0;
      const frac = v / sum;
      const sweep = frac * 360;
      const startAngle = angle;
      const endAngle = angle + sweep;
      angle = endAngle;
      // Последний сектор — фиксируем до 360° чтобы не было щели из-за float-arithmetic.
      const endAngleFixed = i === n - 1 ? 360 : endAngle;
      const color = PALETTE[i % PALETTE.length]!;
      parts.push(
        `<path d="${sectorPath(PIE_CX, const_CY, PIE_R, startAngle, endAngleFixed)}" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`
      );
      // Подпись процента внутри сектора (если доля > 8%).
      if (frac > 0.08) {
        const mid = (startAngle + endAngleFixed) / 2;
        const labelR = PIE_R * 0.65;
        const p = polarPoint(PIE_CX, const_CY, labelR, mid);
        parts.push(
          `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="600" fill="#ffffff">${(frac * 100).toFixed(1)}%</text>`
        );
      }
    }
  }

  // Легенда справа. Линии по ~20px.
  const legX = 380;
  let legY = 70;
  const rowH = Math.min(28, (H - 100) / Math.max(n, 1));
  parts.push(`<g>`);
  for (let i = 0; i < n; i++) {
    const color = PALETTE[i % PALETTE.length]!;
    const lbl = labels[i] ?? '';
    const v = values[i] ?? 0;
    const pct = sum > 0 ? ((v / sum) * 100).toFixed(1) : '0.0';
    parts.push(
      `<rect x="${legX}" y="${legY - 10}" width="14" height="14" fill="${color}" rx="2"/>` +
        `<text x="${legX + 22}" y="${legY + 2}" font-size="12" fill="${COLOR_TEXT}">${escapeXml(lbl)} (${pct}%)</text>`
    );
    legY += rowH;
  }
  parts.push(`</g>`);

  // Caption.
  if (caption) {
    parts.push(
      `<text x="${W / 2}" y="${H - 24}" text-anchor="middle" font-size="10" fill="${COLOR_AXIS}" font-style="italic">${escapeXml(caption)}</text>`
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}

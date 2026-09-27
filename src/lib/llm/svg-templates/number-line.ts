import type { NumberLineSpec } from './types';

/**
 * Шаблон G4: number line (координатная прямая).
 *
 * Горизонтальная шкала по центру viewBox (y = 200), деления, подписи
 * чисел и точки для отметки. Используется для задач на координатную
 * прямую, сложение/вычитание отрицательных чисел, модуль числа и т.п.
 *
 * viewBox = "0 0 600 400".
 *   - padding: top=80 (title + воздух), bottom=80 (labels + caption),
 *     left=60, right=40.
 *   - Ось X: x ∈ [60, 560] на y = 200.
 *   - Точки: маленькие круги r=5, highlighted = #ef4444, normal = #9ca3af.
 *
 * Если `step` не задан — вычисляется через niceStep(span) (1/2/5 × 10^n).
 */

const COLOR_AXIS = '#374151';
const COLOR_TEXT = '#111827';
const COLOR_GRID = '#e5e7eb';
const COLOR_HIGHLIGHT = '#ef4444';
const COLOR_NORMAL = '#9ca3af';

const W = 600;
const H = 400;
const PAD = { top: 80, right: 40, bottom: 80, left: 60 } as const;
const LINE_Y = 200;

/**
 * «Красивый» шаг шкалы — округляем span до 1/2/5 × 10^n.
 * Для диапазона [-1, 1] (span=2) → 1; для [-10, 10] (span=20) → 5;
 * для [-100, 100] (span=200) → 50.
 */
function niceStep(span: number): number {
  if (span <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(span)));
  const norm = span / mag;
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

/**
 * Маппинг значения на координату X. Защита от деления на ноль.
 */
function valueToX(value: number, min: number, max: number, left: number, width: number): number {
  const span = max - min;
  if (span <= 0) return left;
  return left + ((value - min) / span) * width;
}

export function renderNumberLine(spec: NumberLineSpec): string {
  const { title, range, step, points, caption } = spec;
  const [min, max] = range;
  const span = max - min;

  // Защита от инвалидного диапазона (валидация должна ловить, но рендерер
  // не должен падать — возвращаем минимальный плейсхолдер).
  if (span <= 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="14" fill="${COLOR_AXIS}">Некорректный диапазон</text></svg>`;
  }

  const effectiveStep = step ?? niceStep(span);
  const plotW = W - PAD.left - PAD.right;

  // Подбираем количество подписей: не больше ~12 делений, чтобы не было
  // наложений. Если step слишком мелкий — увеличиваем.
  let ticks = Math.floor(span / effectiveStep);
  let useStep = effectiveStep;
  while (ticks > 14 && useStep * 2 <= span) {
    useStep *= 2;
    ticks = Math.floor(span / useStep);
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">`
  );

  // Title.
  parts.push(
    `<text x="${W / 2}" y="32" text-anchor="middle" font-size="16" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(title)}</text>`
  );

  // Ось (горизонтальная линия по центру).
  parts.push(
    `<line x1="${PAD.left}" y1="${LINE_Y}" x2="${PAD.left + plotW}" y2="${LINE_Y}" stroke="${COLOR_AXIS}" stroke-width="2" stroke-linecap="round"/>`
  );

  // Деления и подписи чисел. Идём от min до max с шагом useStep.
  // Округление до 6 знаков чтобы избежать 0.30000000000000004.
  const firstTick = Math.ceil(min / useStep) * useStep;
  for (let v = firstTick; v <= max + 1e-9; v += useStep) {
    const x = valueToX(v, min, max, PAD.left, plotW);
    const xStr = x.toFixed(2);
    // Риска деления.
    parts.push(
      `<line x1="${xStr}" y1="${LINE_Y - 6}" x2="${xStr}" y2="${LINE_Y + 6}" stroke="${COLOR_AXIS}" stroke-width="1.5"/>`
    );
    // Подпись числа (под риской).
    parts.push(
      `<text x="${xStr}" y="${LINE_Y + 22}" text-anchor="middle" font-size="12" fill="${COLOR_TEXT}">${formatNumber(v)}</text>`
    );
  }

  // Точки на шкале (над осью).
  if (points && points.length > 0) {
    for (const p of points) {
      // Пропускаем точки за пределами диапазона — иначе уезжают за viewBox.
      if (p.value < min || p.value > max) continue;
      const x = valueToX(p.value, min, max, PAD.left, plotW);
      const xStr = x.toFixed(2);
      const isHighlight = p.color === 'highlight';
      const fill = isHighlight ? COLOR_HIGHLIGHT : COLOR_NORMAL;
      parts.push(
        `<circle cx="${xStr}" cy="${LINE_Y}" r="5" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>`
      );
      if (p.label) {
        // Подпись НАД точкой (над осью) — иначе слипнется с подписями чисел.
        parts.push(
          `<text x="${xStr}" y="${LINE_Y - 12}" text-anchor="middle" font-size="11" font-weight="600" fill="${fill}">${escapeXml(p.label)}</text>`
        );
      }
    }
  }

  // Caption (если есть) — мелким серым внизу.
  if (caption) {
    parts.push(
      `<text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-size="10" fill="${COLOR_AXIS}" font-style="italic">${escapeXml(caption)}</text>`
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}

/**
 * Форматируем число для подписи на шкале: целые — без дробной части,
 * дробные — до 2 знаков (например, 0.5, -1.25).
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}
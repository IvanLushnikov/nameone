import type { BarChartSpec } from './types';

/**
 * Шаблон G1: bar chart.
 *
 * Возвращает валидный SVG-код (строку), готовый к встраиванию в HTML/PDF
 * рабочего листа. Используется svg-renderer.ts как часть exhaustive switch
 * по ChartSpec.type.
 *
 * Координатная система:
 *   viewBox = "0 0 600 400"
 *   padding: top=40 (title), bottom=60 (x-axis labels), left=60 (y-axis labels), right=40
 *   Полезная площадь графика: x ∈ [60, 560], y ∈ [40, 340].
 *
 * Особенности:
 *   - Столбцы — один синий цвет #3b82f6 (без категориальной палитры, как в G3).
 *   - Hover-эффекты через CSS (`<style>` внутри SVG) — для статического
 *     экспорта в PDF они не сработают, но в браузерном preview будут видны.
 *   - Подписи оси X поворачиваются на -30°, если длиннее ~10 символов.
 *   - Без font-family — используется дефолт браузера (sans-serif).
 */

/** Палитра MVP. */
const COLOR_BAR = '#3b82f6';
const COLOR_BAR_HOVER = '#2563eb';
const COLOR_AXIS = '#374151';
const COLOR_GRID = '#e5e7eb';
const COLOR_TEXT = '#111827';

/** Размеры viewBox и padding (синхронизированы с JSDoc). */
const W = 600;
const H = 400;
const PAD = { top: 40, right: 40, bottom: 60, left: 60 } as const;

/** "Красивый" шаг для делений Y — выбираем ближайший из 1/2/5 × 10^n. */
function niceStep(max: number, targetTicks: number): number {
  if (max <= 0) return 1;
  const rough = max / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

/**
 * Экранирует текст для безопасной вставки в SVG (< > & " ').
 * На случай если LLM вернёт в title/caption спец-символы.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderBar(spec: BarChartSpec): string {
  const { title, x_label, y_label, data, caption } = spec;

  // Edge cases: пустые данные — возвращаем минимальный валидный SVG-плейсхолдер.
  const labels = data?.labels ?? [];
  const values = data?.values ?? [];
  const n = Math.min(labels.length, values.length);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Y-шкала: max с запасом +5%, минимум 1 чтобы не было деления на ноль.
  const maxValRaw = n > 0 ? Math.max(0, ...values) : 0;
  const maxVal = maxValRaw > 0 ? maxValRaw * 1.05 : 1;
  const step = niceStep(maxVal, 5);
  const yMax = Math.ceil(maxVal / step) * step;

  const tickValues: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) tickValues.push(v);

  // Ширина столбца + зазор. minBarW защищает от отрицательной ширины при n=0.
  const bandW = n > 0 ? plotW / n : plotW;
  const barW = Math.max(8, Math.min(48, bandW * 0.7));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">`
  );

  // Hover-стиль (без интерактива в PDF, но в preview сработает).
  parts.push(`<style>.bar{fill:${COLOR_BAR};transition:fill .15s ease}.bar:hover{fill:${COLOR_BAR_HOVER}}</style>`);

  // Title.
  parts.push(
    `<text x="${W / 2}" y="22" text-anchor="middle" font-size="16" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(title)}</text>`
  );

  // Plot area background (опционально; можно опустить — оставляю белым).

  // Y-axis grid + ticks.
  for (const t of tickValues) {
    const y = PAD.top + plotH - (t / yMax) * plotH;
    parts.push(`<line x1="${PAD.left}" y1="${y.toFixed(2)}" x2="${PAD.left + plotW}" y2="${y.toFixed(2)}" stroke="${COLOR_GRID}" stroke-width="1"/>`);
    parts.push(
      `<text x="${PAD.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="${COLOR_AXIS}">${t}</text>`
    );
  }

  // Y-axis line.
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="${COLOR_AXIS}" stroke-width="1.5"/>`);
  // X-axis line.
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" stroke="${COLOR_AXIS}" stroke-width="1.5"/>`);

  // Bars + X-axis labels.
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(values[i]) ? values[i]! : 0;
    const cx = PAD.left + bandW * i + bandW / 2;
    const x = cx - barW / 2;
    const h = yMax > 0 ? (v / yMax) * plotH : 0;
    const y = PAD.top + plotH - h;
    parts.push(
      `<rect class="bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, h).toFixed(2)}" rx="2"/>`
    );
    // X label: если длинный (>10 символов) — повернуть на -30°.
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

  // Caption (если есть) — мелким серым под X-подписью.
  if (caption) {
    parts.push(
      `<text x="${PAD.left + plotW / 2}" y="${H - 24}" text-anchor="middle" font-size="10" fill="${COLOR_AXIS}" font-style="italic">${escapeXml(caption)}</text>`
    );
  }

  parts.push(`</svg>`);
  return parts.join('');
}

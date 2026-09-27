import type { GeometrySpec } from './types';

/**
 * Шаблон G5: geometry — набор фигур для геометрических задач.
 *
 * 6 фигур: triangle, rectangle, square, parallelogram, circle, trapezoid.
 * Каждая центрирована в (300, 220) внутри viewBox 0 0 600 400.
 * Подписи сторон — горизонтально у середины ребра.
 * Углы — дуги у вершин (если переданы в measurements.angles).
 *
 * viewBox 600×400 для совместимости с bar/line/pie.
 */

const W = 600;
const H = 400;
const CX = 300;
const CY = 220;

const COLOR_FILL = '#dbeafe';
const COLOR_STROKE = '#1e40af';
const COLOR_TEXT = '#111827';
const COLOR_LABEL = '#1f2937';
const COLOR_ARC = '#dc2626';
const COLOR_CAPTION = '#6b7280';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Угол дуги в радианах по трём точкам (vertex, p1, p2) для SVG-арки. */
function arcPath(
  vx: number,
  vy: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  radius: number,
): string {
  // Угол от vertex до p1 и до p2.
  const a1 = Math.atan2(p1y - vy, p1x - vx);
  const a2 = Math.atan2(p2y - vy, p2x - vx);
  // SVG-арка с sweep=0 (против часовой) — идём от p1 к p2 коротким путём.
  return `M ${vx + radius * Math.cos(a1)} ${vy + radius * Math.sin(a1)} A ${radius} ${radius} 0 0 0 ${vx + radius * Math.cos(a2)} ${vy + radius * Math.sin(a2)}`;
}

/** Подпись стороны: отображаем у середины отрезка со смещением наружу. */
function sideLabel(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Перпендикулярное смещение (10 px) от середины.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Нормаль: (-dy, dx) / len, для SVG ось Y направлена вниз, поэтому (-dy, dx) даёт «вверх-наружу» для горизонтальной линии.
  const offsetX = (-dy / len) * 14;
  const offsetY = (dx / len) * 14;
  return `<text x="${(mx + offsetX).toFixed(1)}" y="${(my + offsetY).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="${COLOR_LABEL}">${escapeXml(label)}</text>`;
}

/** Подпись вершины. */
function vertexLabel(x: number, y: number, label: string, dx = 0, dy = -10): string {
  return `<text x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(label)}</text>`;
}

function titleAndCaption(spec: GeometrySpec): string {
  const parts: string[] = [];
  parts.push(
    `<text x="${W / 2}" y="32" text-anchor="middle" font-size="16" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(spec.title)}</text>`,
  );
  if (spec.caption) {
    parts.push(
      `<text x="${W / 2}" y="${H - 30}" text-anchor="middle" font-size="10" fill="${COLOR_CAPTION}" font-style="italic">${escapeXml(spec.caption)}</text>`,
    );
  }
  if (spec.question) {
    parts.push(
      `<text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-size="12" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(spec.question)}</text>`,
    );
  }
  return parts.join('');
}

/** Рендер треугольника. Равнобедренный, высота 180, ширина 220. */
function renderTriangle(spec: GeometrySpec): string {
  const A = { x: CX, y: CY - 90 };
  const B = { x: CX - 110, y: CY + 90 };
  const C = { x: CX + 110, y: CY + 90 };
  const parts: string[] = [];
  parts.push(`<polygon points="${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}" fill="${COLOR_FILL}" stroke="${COLOR_STROKE}" stroke-width="2" stroke-linejoin="round"/>`);
  // Подписи вершин.
  parts.push(vertexLabel(A.x, A.y, 'A', 0, -16));
  parts.push(vertexLabel(B.x, B.y, 'B', -14, 18));
  parts.push(vertexLabel(C.x, C.y, 'C', 14, 18));
  // Подписи сторон.
  parts.push(sideLabel(B.x, B.y, C.x, C.y, 'a')); // BC (низ)
  parts.push(sideLabel(C.x, C.y, A.x, A.y, 'b')); // CA (право)
  parts.push(sideLabel(A.x, A.y, B.x, B.y, 'c')); // AB (лево)
  // Углы (если заданы).
  if (spec.measurements?.angles) {
    for (const a of spec.measurements.angles) {
      const v = a.id === 'A' ? A : a.id === 'B' ? B : a.id === 'C' ? C : null;
      if (!v || a.value == null) continue;
      // 2 точки на смежных сторонах на расстоянии 28 от вершины.
      const toA = a.id === 'A' ? B : A;
      const toB = a.id === 'A' ? C : a.id === 'B' ? C : B;
      const dirA = { x: toA.x - v.x, y: toA.y - v.y };
      const dirB = { x: toB.x - v.x, y: toB.y - v.y };
      const lA = Math.sqrt(dirA.x * dirA.x + dirA.y * dirA.y);
      const lB = Math.sqrt(dirB.x * dirB.x + dirB.y * dirB.y);
      const pA = { x: v.x + (dirA.x / lA) * 28, y: v.y + (dirA.y / lA) * 28 };
      const pB = { x: v.x + (dirB.x / lB) * 28, y: v.y + (dirB.y / lB) * 28 };
      parts.push(`<path d="${arcPath(v.x, v.y, pA.x, pA.y, pB.x, pB.y, 22)}" fill="none" stroke="${COLOR_ARC}" stroke-width="1.5"/>`);
      // Подпись угла — между вершиной и точкой pA/pB, чуть дальше от вершины.
      const mid = { x: v.x + (pA.x + pB.x) / 2 - v.x, y: v.y + (pA.y + pB.y) / 2 - v.y };
      const midLen = Math.sqrt(mid.x * mid.x + mid.y * mid.y) || 1;
      const labelX = v.x + (mid.x / midLen) * 38;
      const labelY = v.y + (mid.y / midLen) * 38 + 4;
      parts.push(`<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="10" fill="${COLOR_ARC}">${a.value}°</text>`);
    }
  }
  return parts.join('');
}

/** Рендер прямоугольника. */
function renderRectangle(spec: GeometrySpec, isSquare = false): string {
  const w = isSquare ? 160 : 200;
  const h = isSquare ? 160 : 110;
  const x = CX - w / 2;
  const y = CY - h / 2;
  const A = { x, y };
  const B = { x: x + w, y };
  const C = { x: x + w, y: y + h };
  const D = { x, y: y + h };
  const parts: string[] = [];
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${COLOR_FILL}" stroke="${COLOR_STROKE}" stroke-width="2"/>`);
  // Маленькие квадратики в углах.
  for (const c of [A, B, C, D]) {
    parts.push(`<rect x="${c.x - 4}" y="${c.y - 4}" width="8" height="8" fill="none" stroke="${COLOR_STROKE}" stroke-width="1"/>`);
  }
  // Подписи вершин.
  parts.push(vertexLabel(A.x, A.y, 'A', -8, -8));
  parts.push(vertexLabel(B.x, B.y, 'B', 8, -8));
  parts.push(vertexLabel(C.x, C.y, 'C', 8, 14));
  parts.push(vertexLabel(D.x, D.y, 'D', -8, 14));
  // Подписи сторон.
  parts.push(sideLabel(A.x, A.y, B.x, B.y, 'AB'));
  parts.push(sideLabel(B.x, B.y, C.x, C.y, 'BC'));
  parts.push(sideLabel(C.x, C.y, D.x, D.y, 'CD'));
  parts.push(sideLabel(D.x, D.y, A.x, A.y, 'DA'));
  return parts.join('');
}

/** Рендер параллелограмма. Нижняя сторона горизонтальная, верхняя сдвинута. */
function renderParallelogram(spec: GeometrySpec): string {
  const w = 200;
  const h = 100;
  const offset = 60;
  const A = { x: CX - w / 2, y: CY + h / 2 };
  const B = { x: CX + w / 2, y: CY + h / 2 };
  const C = { x: B.x - offset, y: B.y - h };
  const D = { x: A.x - offset, y: A.y - h };
  const parts: string[] = [];
  parts.push(`<polygon points="${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y} ${D.x},${D.y}" fill="${COLOR_FILL}" stroke="${COLOR_STROKE}" stroke-width="2" stroke-linejoin="round"/>`);
  parts.push(vertexLabel(A.x, A.y, 'A', -10, 16));
  parts.push(vertexLabel(B.x, B.y, 'B', 10, 16));
  parts.push(vertexLabel(C.x, C.y, 'C', 10, -6));
  parts.push(vertexLabel(D.x, D.y, 'D', -10, -6));
  parts.push(sideLabel(A.x, A.y, B.x, B.y, 'a'));
  parts.push(sideLabel(B.x, B.y, C.x, C.y, 'b'));
  parts.push(sideLabel(D.x, D.y, A.x, A.y, 'a'));
  parts.push(sideLabel(C.x, C.y, D.x, D.y, 'b'));
  return parts.join('');
}

/** Рендер трапеции. */
function renderTrapezoid(spec: GeometrySpec): string {
  const halfA = 110; // нижняя сторона
  const halfB = 70;  // верхняя сторона
  const h = 110;
  const A = { x: CX - halfA, y: CY + h / 2 };
  const B = { x: CX + halfA, y: CY + h / 2 };
  const C = { x: CX + halfB, y: CY - h / 2 };
  const D = { x: CX - halfB, y: CY - h / 2 };
  const parts: string[] = [];
  parts.push(`<polygon points="${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y} ${D.x},${D.y}" fill="${COLOR_FILL}" stroke="${COLOR_STROKE}" stroke-width="2" stroke-linejoin="round"/>`);
  parts.push(vertexLabel(A.x, A.y, 'A', -10, 16));
  parts.push(vertexLabel(B.x, B.y, 'B', 10, 16));
  parts.push(vertexLabel(C.x, C.y, 'C', 10, -6));
  parts.push(vertexLabel(D.x, D.y, 'D', -10, -6));
  parts.push(sideLabel(A.x, A.y, B.x, B.y, 'a'));
  parts.push(sideLabel(B.x, B.y, C.x, C.y, 'b'));
  parts.push(sideLabel(C.x, C.y, D.x, D.y, 'c'));
  parts.push(sideLabel(D.x, D.y, A.x, A.y, 'd'));
  return parts.join('');
}

/** Рендер круга. */
function renderCircle(spec: GeometrySpec): string {
  const r = 130;
  const parts: string[] = [];
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${r}" fill="${COLOR_FILL}" stroke="${COLOR_STROKE}" stroke-width="2"/>`);
  // Центр.
  parts.push(`<circle cx="${CX}" cy="${CY}" r="3" fill="${COLOR_STROKE}"/>`);
  parts.push(vertexLabel(CX, CY, 'O', 8, 4));
  // Радиус.
  parts.push(`<line x1="${CX}" y1="${CY}" x2="${CX + r}" y2="${CY}" stroke="${COLOR_ARC}" stroke-width="1.5" stroke-dasharray="4,3"/>`);
  parts.push(`<text x="${(CX + r / 2).toFixed(1)}" y="${CY - 8}" text-anchor="middle" font-size="12" font-style="italic" fill="${COLOR_ARC}">r</text>`);
  return parts.join('');
}

export function renderGeometry(spec: GeometrySpec): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(spec.title)}">`,
  );
  parts.push(titleAndCaption(spec));
  switch (spec.shape) {
    case 'triangle':
      parts.push(renderTriangle(spec));
      break;
    case 'rectangle':
      parts.push(renderRectangle(spec, false));
      break;
    case 'square':
      parts.push(renderRectangle(spec, true));
      break;
    case 'parallelogram':
      parts.push(renderParallelogram(spec));
      break;
    case 'circle':
      parts.push(renderCircle(spec));
      break;
    case 'trapezoid':
      parts.push(renderTrapezoid(spec));
      break;
  }
  parts.push(`</svg>`);
  return parts.join('');
}

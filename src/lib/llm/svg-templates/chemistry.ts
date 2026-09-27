import type { ChemistrySpec } from './types';

/**
 * G7: chemistry — набор шаблонных химических структур.
 *
 * Phase 3 из docs/04-product-features-svg-graphs.md.
 * viewBox 0 0 600 400 (как у остальных графиков).
 *
 * 4 шаблона:
 *  - atom:       атом с электронными оболочками (1-3 кольца + точки электронов)
 *  - molecule:  молекула из 2-3 атомов (круги с символами + линии связей)
 *  - periodic:   мини-таблица Менделеева (4-5 элементов)
 *  - reaction:   схема химической реакции (реагенты → продукты)
 */

const W = 600;
const H = 400;
const CX = 300;
const CY = 220;

const COLOR_PRIMARY = '#1d4ed8';   // синий — атомы
const COLOR_SECONDARY = '#0891b2'; // бирюзовый — оболочки
const COLOR_BG = '#eff6ff';        // светло-синий фон
const COLOR_TEXT = '#111827';
const COLOR_LABEL = '#1f2937';
const COLOR_CAPTION = '#6b7280';
const COLOR_LINE = '#374151';
const COLOR_BOND = '#475569';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function titleAndCaption(spec: ChemistrySpec): string {
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

/** Цвета для разных элементов (как в стандартной хим. нотации CPK). */
const ELEMENT_COLORS: Record<string, string> = {
  H: '#ffffff',  // белый
  O: '#ef4444',  // красный
  C: '#1f2937',  // чёрный
  N: '#3b82f6',  // синий
  Na: '#a855f7', // фиолетовый
  Cl: '#22c55e', // зелёный
  O2: '#ef4444', // для O₂ подписи
  H2: '#ffffff', // для H₂ подписи
};

function elementColor(symbol: string): string {
  return ELEMENT_COLORS[symbol] || '#9ca3af';
}

/** Рендер атома с оболочками. */
function renderAtom(): string {
  const parts: string[] = [];
  // Ядро.
  parts.push(`<circle cx="${CX}" cy="${CY}" r="20" fill="${COLOR_PRIMARY}" stroke="#1e3a8a" stroke-width="2"/>`);
  parts.push(`<text x="${CX}" y="${CY + 6}" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff">H</text>`);
  // 3 оболочки (для наглядности).
  const shells = [
    { r: 50, electrons: 1 },
    { r: 80, electrons: 0 },
    { r: 110, electrons: 0 },
  ];
  for (const s of shells) {
    parts.push(`<circle cx="${CX}" cy="${CY}" r="${s.r}" fill="none" stroke="${COLOR_SECONDARY}" stroke-width="1.5" stroke-dasharray="4,3"/>`);
  }
  // Электроны на первой оболочке.
  for (let i = 0; i < shells[0].electrons; i++) {
    const angle = (i / shells[0].electrons) * 2 * Math.PI;
    const ex = CX + shells[0].r * Math.cos(angle);
    const ey = CY + shells[0].r * Math.sin(angle);
    parts.push(`<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="${COLOR_PRIMARY}"/>`);
  }
  // Подписи.
  parts.push(`<text x="${CX}" y="${CY - 130}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLOR_LABEL}">1s</text>`);
  parts.push(`<text x="${CX}" y="${CY - 95}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLOR_LABEL}">2s</text>`);
  parts.push(`<text x="${CX}" y="${CY - 65}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLOR_LABEL}">2p</text>`);
  return parts.join('');
}

/** Рендер молекулы H2O. */
function renderMolecule(): string {
  const parts: string[] = [];
  // O в центре.
  parts.push(`<circle cx="${CX}" cy="${CY + 30}" r="28" fill="${elementColor('O')}" stroke="#7f1d1d" stroke-width="2"/>`);
  parts.push(`<text x="${CX}" y="${CY + 38}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffffff">O</text>`);
  // 2 атома H (сверху-слева и сверху-справа, угол 104.5°).
  const angle = (104.5 / 180) * Math.PI;
  const r = 80;
  const h1x = CX - r * Math.sin(angle / 2);
  const h1y = CY - r * Math.cos(angle / 2);
  const h2x = CX + r * Math.sin(angle / 2);
  const h2y = CY - r * Math.cos(angle / 2);
  // Связи.
  parts.push(`<line x1="${h1x.toFixed(1)}" y1="${h1y.toFixed(1)}" x2="${CX}" y2="${CY + 30}" stroke="${COLOR_BOND}" stroke-width="3"/>`);
  parts.push(`<line x1="${h2x.toFixed(1)}" y1="${h2y.toFixed(1)}" x2="${CX}" y2="${CY + 30}" stroke="${COLOR_BOND}" stroke-width="3"/>`);
  // H атомы.
  parts.push(`<circle cx="${h1x.toFixed(1)}" cy="${h1y.toFixed(1)}" r="18" fill="${elementColor('H')}" stroke="#9ca3af" stroke-width="2"/>`);
  parts.push(`<text x="${h1x.toFixed(1)}" y="${(h1y + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="${COLOR_LABEL}">H</text>`);
  parts.push(`<circle cx="${h2x.toFixed(1)}" cy="${h2y.toFixed(1)}" r="18" fill="${elementColor('H')}" stroke="#9ca3af" stroke-width="2"/>`);
  parts.push(`<text x="${h2x.toFixed(1)}" y="${(h2y + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="${COLOR_LABEL}">H</text>`);
  // Угол 104.5°.
  parts.push(`<path d="${`M ${h1x} ${h1y} A 28 28 0 0 1 ${h2x} ${h2y}`}" fill="none" stroke="${COLOR_LINE}" stroke-width="1" stroke-dasharray="2,2"/>`);
  parts.push(`<text x="${CX}" y="${(CY - 10).toString()}" text-anchor="middle" font-size="11" fill="${COLOR_LABEL}">104.5°</text>`);
  return parts.join('');
}

/** Рендер мини-таблицы Менделеева. */
function renderPeriodic(): string {
  const parts: string[] = [];
  // 6 элементов в 1 ряд (H, He, Li, Be, B, C).
  const elements = [
    { sym: 'H', num: 1, mass: '1.008' },
    { sym: 'He', num: 2, mass: '4.003' },
    { sym: 'Li', num: 3, mass: '6.94' },
    { sym: 'Be', num: 4, mass: '9.01' },
    { sym: 'B', num: 5, mass: '10.81' },
    { sym: 'C', num: 6, mass: '12.01' },
  ];
  const cellW = 70;
  const cellH = 130;
  const totalW = elements.length * cellW;
  const startX = CX - totalW / 2;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const x = startX + i * cellW;
    // Внешняя рамка.
    parts.push(`<rect x="${x + 3}" y="${CY - cellH / 2}" width="${cellW - 6}" height="${cellH}" fill="${COLOR_BG}" stroke="${COLOR_LINE}" stroke-width="1.5"/>`);
    // Атомный номер (сверху-слева).
    parts.push(`<text x="${x + 8}" y="${CY - cellH / 2 + 16}" font-size="11" font-weight="600" fill="${COLOR_LABEL}">${el.num}</text>`);
    // Символ (центр, крупно).
    parts.push(`<text x="${x + cellW / 2}" y="${CY + 15}" text-anchor="middle" font-size="32" font-weight="700" fill="${COLOR_LABEL}">${el.sym}</text>`);
    // Масса (снизу).
    parts.push(`<text x="${x + cellW / 2}" y="${CY + cellH / 2 - 8}" text-anchor="middle" font-size="9" fill="${COLOR_LABEL}">${el.mass}</text>`);
  }
  return parts.join('');
}

/** Рендер химической реакции: реагенты → продукты. */
function renderReaction(): string {
  const parts: string[] = [];
  // Левая часть — 2H₂ + O₂.
  const left1 = { x: 80, y: CY };
  const left2 = { x: 130, y: CY + 60 };
  // O₂ вверху-слева.
  parts.push(`<circle cx="${left1.x}" cy="${left1.y}" r="22" fill="${elementColor('O')}" stroke="#7f1d1d" stroke-width="2"/>`);
  parts.push(`<text x="${left1.x}" y="${left1.y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff">O</text>`);
  parts.push(`<text x="${left1.x + 30}" y="${left1.y + 5}" font-size="14" font-weight="700" fill="${COLOR_LABEL}">₂</text>`);
  // 2H₂ внизу-слева.
  parts.push(`<text x="${left2.x - 35}" y="${left2.y + 5}" font-size="14" font-weight="700" fill="${COLOR_LABEL}">2H₂</text>`);
  parts.push(`<circle cx="${left2.x}" cy="${left2.y}" r="18" fill="${elementColor('H')}" stroke="#9ca3af" stroke-width="2"/>`);
  parts.push(`<text x="${left2.x}" y="${left2.y + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${COLOR_LABEL}">H</text>`);
  // Знак "+".
  parts.push(`<text x="${left1.x + 30}" y="${left1.y - 15}" font-size="20" font-weight="700" fill="${COLOR_LABEL}">+</text>`);
  // Стрелка "=" (с H₂O над).
  parts.push(`<line x1="200" y1="${CY + 30}" x2="380" y2="${CY + 30}" stroke="${COLOR_LINE}" stroke-width="2"/>`);
  parts.push(`<polygon points="380,${CY + 30} 370,${CY + 25} 370,${CY + 35}" fill="${COLOR_LINE}"/>`);
  // Продукты справа — 2 H₂O.
  const prod1 = { x: 440, y: CY - 30 };
  const prod2 = { x: 510, y: CY + 40 };
  // Каждая молекула H₂O.
  const waterMolecules: Array<[{ x: number; y: number }, string]> = [
    [prod1, ""],
    [prod2, "₂"],
  ];
  for (const [p, lbl] of waterMolecules) {
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="20" fill="${elementColor('O')}" stroke="#7f1d1d" stroke-width="2"/>`);
    parts.push(`<text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">O</text>`);
    const hy = p.y - 35;
    const hx = p.x - 20;
    parts.push(`<line x1="${hx}" y1="${hy}" x2="${p.x}" y2="${p.y}" stroke="${COLOR_BOND}" stroke-width="2.5"/>`);
    parts.push(`<circle cx="${hx}" cy="${hy}" r="12" fill="${elementColor('H')}" stroke="#9ca3af" stroke-width="1.5"/>`);
    parts.push(`<text x="${hx}" y="${hy + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLOR_LABEL}">H</text>`);
    const hx2 = p.x + 20;
    parts.push(`<line x1="${hx2}" y1="${hy}" x2="${p.x}" y2="${p.y}" stroke="${COLOR_BOND}" stroke-width="2.5"/>`);
    parts.push(`<circle cx="${hx2}" cy="${hy}" r="12" fill="${elementColor('H')}" stroke="#9ca3af" stroke-width="1.5"/>`);
    parts.push(`<text x="${hx2}" y="${hy + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${COLOR_LABEL}">H</text>`);
  }
  // Коэффициент "2" слева от продуктов.
  parts.push(`<text x="400" y="${(CY - 5).toString()}" font-size="20" font-weight="700" fill="${COLOR_LABEL}">2</text>`);
  // Условия реакции (сверху над стрелкой).
  parts.push(`<text x="290" y="${CY - 30}" text-anchor="middle" font-size="10" fill="${COLOR_CAPTION}">t°, кат.</text>`);
  return parts.join('');
}

export function renderChemistry(spec: ChemistrySpec): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(spec.title)}">`,
  );
  parts.push(titleAndCaption(spec));
  switch (spec.diagram) {
    case 'atom':
      parts.push(renderAtom());
      break;
    case 'molecule':
      parts.push(renderMolecule());
      break;
    case 'periodic':
      parts.push(renderPeriodic());
      break;
    case 'reaction':
      parts.push(renderReaction());
      break;
  }
  parts.push(`</svg>`);
  return parts.join('');
}

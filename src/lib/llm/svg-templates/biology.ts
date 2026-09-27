import type { BiologySpec } from './types';

/**
 * G6: biology — набор шаблонных биологических диаграмм.
 *
 * Phase 3 из docs/04-product-features-svg-graphs.md.
 * viewBox 0 0 600 400 (как у остальных графиков).
 *
 * 6 шаблонов:
 *  - plant-cell:    растительная клетка (с органеллами: ядро, вакуоль, хлоропласты, митохондрии)
 *  - animal-cell:   животная клетка (с органеллами: ядро, митохондрии, лизосомы, аппарат Гольджи)
 *  - plant:         схема частей растения (корень, стебель, лист, цветок, плод)
 *  - dna:           двойная спираль (упрощённая)
 *  - chromosome:    хромосома (X-образная, с центромерой)
 *  - animal-class:  простая иерархия классификации животных
 *
 * Не рисуем фотореалистичные диаграммы — только иконочные с подписями.
 * Достаточно для школьного контекста.
 */

const W = 600;
const H = 400;
const CX = 300;
const CY = 220;

const COLOR_PRIMARY = '#16a34a';   // зелёный — основные части
const COLOR_SECONDARY = '#0891b2'; // бирюзовый — органеллы
const COLOR_BG = '#f0fdf4';        // светло-зелёный фон
const COLOR_TEXT = '#111827';
const COLOR_LABEL = '#1f2937';
const COLOR_CAPTION = '#6b7280';
const COLOR_LINE = '#374151';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function titleAndCaption(spec: BiologySpec): string {
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

/** Рендер животной клетки. */
function renderAnimalCell(): string {
  const parts: string[] = [];
  // Внешняя мембрана.
  parts.push(`<ellipse cx="${CX}" cy="${CY}" rx="180" ry="120" fill="${COLOR_BG}" stroke="${COLOR_LINE}" stroke-width="3"/>`);
  // Ядро.
  parts.push(`<circle cx="${CX - 60}" cy="${CY - 30}" r="40" fill="#dbeafe" stroke="${COLOR_SECONDARY}" stroke-width="2"/>`);
  parts.push(`<text x="${CX - 60}" y="${CY - 25}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLOR_LABEL}">Ядро</text>`);
  // Митохондрия (овалы).
  parts.push(`<ellipse cx="${CX + 50}" cy="${CY - 40}" rx="25" ry="12" fill="#fce7f3" stroke="#be185d" stroke-width="1.5" transform="rotate(20 ${CX + 50} ${CY - 40})"/>`);
  parts.push(`<text x="${CX + 50}" y="${CY - 40}" text-anchor="middle" font-size="9" fill="${COLOR_LABEL}">Митохондрия</text>`);
  // Аппарат Гольджи (стопка).
  parts.push(`<ellipse cx="${CX + 90}" cy="${CY + 40}" rx="20" ry="6" fill="#fed7aa" stroke="#c2410c" stroke-width="1"/>`);
  parts.push(`<ellipse cx="${CX + 90}" cy="${CY + 50}" rx="20" ry="6" fill="#fed7aa" stroke="#c2410c" stroke-width="1"/>`);
  parts.push(`<ellipse cx="${CX + 90}" cy="${CY + 60}" rx="20" ry="6" fill="#fed7aa" stroke="#c2410c" stroke-width="1"/>`);
  parts.push(`<text x="${CX + 90}" y="${CY + 78}" text-anchor="middle" font-size="9" fill="${COLOR_LABEL}">Аппарат Гольджи</text>`);
  // Лизосомы.
  parts.push(`<circle cx="${CX - 100}" cy="${CY + 50}" r="10" fill="#fef3c7" stroke="#a16207" stroke-width="1.5"/>`);
  parts.push(`<text x="${CX - 100}" y="${CY + 53}" text-anchor="middle" font-size="8" fill="${COLOR_LABEL}">Лизосомы</text>`);
  // Мембрана (подпись).
  parts.push(`<text x="${CX - 130}" y="${CY + 95}" text-anchor="middle" font-size="10" font-weight="600" fill="${COLOR_LABEL}">Мембрана</text>`);
  return parts.join('');
}

/** Рендер растительной клетки. */
function renderPlantCell(): string {
  const parts: string[] = [];
  // Клеточная стенка (внешний квадрат).
  parts.push(`<rect x="${CX - 200}" y="${CY - 130}" width="400" height="260" fill="#f0fdf4" stroke="#16a34a" stroke-width="3"/>`);
  // Мембрана (внутри).
  parts.push(`<rect x="${CX - 180}" y="${CY - 110}" width="360" height="220" fill="none" stroke="#65a30d" stroke-width="1.5"/>`);
  parts.push(`<text x="${CX - 175}" y="${CY - 95}" font-size="9" fill="#65a30d">мембрана</text>`);
  // Вакуоль (большой круг).
  parts.push(`<circle cx="${CX + 50}" cy="${CY + 10}" r="80" fill="#dbeafe" stroke="#0891b2" stroke-width="2"/>`);
  parts.push(`<text x="${CX + 50}" y="${CY + 15}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLOR_LABEL}">Вакуоль</text>`);
  // Ядро.
  parts.push(`<circle cx="${CX - 110}" cy="${CY - 40}" r="30" fill="#e9d5ff" stroke="#7c3aed" stroke-width="2"/>`);
  parts.push(`<text x="${CX - 110}" y="${CY - 35}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLOR_LABEL}">Ядро</text>`);
  // Хлоропласты (маленькие зелёные овалы).
  for (const [x, y] of [[CX + 90, CY - 90], [CX - 30, CY + 100], [CX - 60, CY + 90], [CX + 100, CY - 30], [CX - 150, CY + 50]]) {
    parts.push(`<ellipse cx="${x}" cy="${y}" rx="15" ry="8" fill="#86efac" stroke="#16a34a" stroke-width="1.5" transform="rotate(${30 + (x + y) % 60} ${x} ${y})"/>`);
  }
  parts.push(`<text x="${CX - 150}" y="${CY - 95}" font-size="10" fill="#15803d">хлоропласты</text>`);
  // Клеточная стенка (подпись).
  parts.push(`<text x="${CX - 100}" y="${CY + 150}" font-size="9" fill="#15803d">клеточная стенка</text>`);
  return parts.join('');
}

/** Рендер схемы растения (части). */
function renderPlant(): string {
  const parts: string[] = [];
  // Стебель (вертикальная линия).
  parts.push(`<line x1="${CX}" y1="${CY - 100}" x2="${CX}" y2="${CY + 100}" stroke="${COLOR_PRIMARY}" stroke-width="6" stroke-linecap="round"/>`);
  // Корень (вниз).
  parts.push(`<line x1="${CX - 50}" y1="${CY + 100}" x2="${CX}" y2="${CY + 140}" stroke="${COLOR_PRIMARY}" stroke-width="3" stroke-linecap="round"/>`);
  parts.push(`<line x1="${CX + 50}" y1="${CY + 100}" x2="${CX}" y2="${CY + 140}" stroke="${COLOR_PRIMARY}" stroke-width="3" stroke-linecap="round"/>`);
  parts.push(`<line x1="${CX - 25}" y1="${CY + 120}" x2="${CX - 5}" y2="${CY + 140}" stroke="${COLOR_PRIMARY}" stroke-width="2" stroke-linecap="round"/>`);
  parts.push(`<line x1="${CX + 25}" y1="${CY + 120}" x2="${CX + 5}" y2="${CY + 140}" stroke="${COLOR_PRIMARY}" stroke-width="2" stroke-linecap="round"/>`);
  // Листья (2 овала по бокам).
  parts.push(`<ellipse cx="${CX - 60}" cy="${CY}" rx="40" ry="22" fill="#86efac" stroke="${COLOR_PRIMARY}" stroke-width="2" transform="rotate(-30 ${CX - 60} ${CY})"/>`);
  parts.push(`<ellipse cx="${CX + 60}" cy="${CY - 30}" rx="40" ry="22" fill="#86efac" stroke="${COLOR_PRIMARY}" stroke-width="2" transform="rotate(30 ${CX + 60} ${CY - 30})"/>`);
  // Цветок.
  parts.push(`<circle cx="${CX}" cy="${CY - 130}" r="20" fill="#fbbf24" stroke="#d97706" stroke-width="2"/>`);
  parts.push(`<circle cx="${CX - 12}" cy="${CY - 142}" r="8" fill="#fde68a" stroke="#d97706" stroke-width="1"/>`);
  parts.push(`<circle cx="${CX + 12}" cy="${CY - 142}" r="8" fill="#fde68a" stroke="#d97706" stroke-width="1"/>`);
  parts.push(`<circle cx="${CX - 12}" cy="${CY - 118}" r="8" fill="#fde68a" stroke="#d97706" stroke-width="1"/>`);
  parts.push(`<circle cx="${CX + 12}" cy="${CY - 118}" r="8" fill="#fde68a" stroke="#d97706" stroke-width="1"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY - 130}" r="5" fill="#dc2626"/>`);
  // Подписи.
  parts.push(`<text x="${CX + 20}" y="${CY - 145}" font-size="11" font-weight="600" fill="${COLOR_LABEL}">цветок</text>`);
  parts.push(`<text x="${CX - 110}" y="${CY + 5}" font-size="11" font-weight="600" fill="${COLOR_LABEL}">лист</text>`);
  parts.push(`<text x="${CX + 75}" y="${CY - 25}" font-size="11" font-weight="600" fill="${COLOR_LABEL}">лист</text>`);
  parts.push(`<text x="${CX - 50}" y="${CY + 160}" font-size="11" font-weight="600" fill="${COLOR_LABEL}">корень</text>`);
  return parts.join('');
}

/** Рендер ДНК (упрощённая двойная спираль). */
function renderDNA(): string {
  const parts: string[] = [];
  // Левая спираль.
  const turns = 4;
  const topY = CY - 130;
  const bottomY = CY + 130;
  const height = bottomY - topY;
  let leftPath = `M ${CX - 40} ${topY} `;
  let rightPath = `M ${CX + 40} ${topY} `;
  for (let i = 0; i <= turns * 8; i++) {
    const t = i / (turns * 8);
    const y = topY + height * t;
    const angle = t * turns * 2 * Math.PI;
    const leftX = CX - 40 + Math.cos(angle) * 25;
    const rightX = CX + 40 + Math.cos(angle + Math.PI) * 25;
    leftPath += `L ${leftX.toFixed(1)} ${y.toFixed(1)} `;
    rightPath += `L ${rightX.toFixed(1)} ${y.toFixed(1)} `;
  }
  parts.push(`<path d="${leftPath}" fill="none" stroke="${COLOR_PRIMARY}" stroke-width="3"/>`);
  parts.push(`<path d="${rightPath}" fill="none" stroke="${COLOR_SECONDARY}" stroke-width="3"/>`);
  // Водородные связи (горизонтальные линии).
  for (let i = 0; i < turns; i++) {
    const yMid = topY + (height / turns) * (i + 0.5);
    const angle = ((i + 0.5) / turns) * 2 * Math.PI;
    const leftX = CX - 40 + Math.cos(angle) * 25;
    const rightX = CX + 40 + Math.cos(angle + Math.PI) * 25;
    parts.push(`<line x1="${leftX.toFixed(1)}" y1="${yMid.toFixed(1)}" x2="${rightX.toFixed(1)}" y2="${yMid.toFixed(1)}" stroke="${COLOR_LINE}" stroke-width="1.5"/>`);
    parts.push(`<line x1="${((leftX + rightX) / 2 - 5).toFixed(1)}" y1="${(yMid - 4).toFixed(1)}" x2="${((leftX + rightX) / 2 - 5).toFixed(1)}" y2="${(yMid + 4).toFixed(1)}" stroke="${COLOR_LINE}" stroke-width="1.5"/>`);
  }
  parts.push(`<text x="${CX}" y="${H - 50}" text-anchor="middle" font-size="10" fill="${COLOR_CAPTION}" font-style="italic">двойная спираль ДНК (упрощённо)</text>`);
  return parts.join('');
}

/** Рендер хромосомы (X-образная). */
function renderChromosome(): string {
  const parts: string[] = [];
  // Два вертикальных стержня (хроматиды), соединённых центромерой (посередине).
  // Левый стержень.
  parts.push(`<rect x="${CX - 35}" y="${CY - 110}" width="20" height="180" rx="10" fill="#a78bfa" stroke="#6d28d9" stroke-width="2"/>`);
  // Правый стержень.
  parts.push(`<rect x="${CX + 15}" y="${CY - 110}" width="20" height="180" rx="10" fill="#a78bfa" stroke="#6d28d9" stroke-width="2"/>`);
  // Центромера (чёрная перетяжка посередине).
  parts.push(`<circle cx="${CX}" cy="${CY - 20}" r="12" fill="#1f2937"/>`);
  // Подписи.
  parts.push(`<text x="${CX - 25}" y="${CY + 90}" text-anchor="middle" font-size="10" fill="${COLOR_LABEL}">хроматида</text>`);
  parts.push(`<text x="${CX + 25}" y="${CY + 90}" text-anchor="middle" font-size="10" fill="${COLOR_LABEL}">хроматида</text>`);
  parts.push(`<text x="${CX + 50}" y="${CY - 15}" font-size="10" fill="${COLOR_LABEL}">центромера</text>`);
  parts.push(`<line x1="${CX + 12}" y1="${CY - 20}" x2="${CX + 45}" y2="${CY - 15}" stroke="${COLOR_LINE}" stroke-width="1"/>`);
  return parts.join('');
}

/** Рендер иерархии классификации животных. */
function renderAnimalClass(): string {
  const parts: string[] = [];
  // Корень.
  parts.push(`<rect x="${CX - 50}" y="${CY - 100}" width="100" height="30" rx="4" fill="#dbeafe" stroke="#1d4ed8" stroke-width="2"/>`);
  parts.push(`<text x="${CX}" y="${CY - 80}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLOR_LABEL}">Животные</text>`);
  // Уровень 1.
  const lvl1Y = CY - 30;
  for (const x of [CX - 160, CX - 50, CX + 60, CX + 160]) {
    parts.push(`<rect x="${x - 40}" y="${lvl1Y}" width="80" height="28" rx="4" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.5"/>`);
    parts.push(`<line x1="${CX}" y1="${CY - 70}" x2="${x}" y2="${lvl1Y}" stroke="${COLOR_LINE}" stroke-width="1.5"/>`);
  }
  parts.push(`<text x="${CX - 160}" y="${lvl1Y + 18}" text-anchor="middle" font-size="10" fill="${COLOR_LABEL}">Беспозв.</text>`);
  parts.push(`<text x="${CX - 50}" y="${lvl1Y + 18}" text-anchor="middle" font-size="10" fill="${COLOR_LABEL}">Моллюски</text>`);
  parts.push(`<text x="${CX + 60}" y="${lvl1Y + 18}" text-anchor="middle" font-size="10" fill="${COLOR_LABEL}">Членист.</text>`);
  parts.push(`<text x="${CX + 160}" y="${lvl1Y + 18}" text-anchor="middle" font-size="10" fill="${COLOR_LABEL}">Хордовые</text>`);
  // Уровень 2 (примеры).
  const lvl2Y = CY + 50;
  const lvl2Items = [
    { x: CX - 160, name: 'медузы' },
    { x: CX - 50, name: 'улитки' },
    { x: CX + 60, name: 'насекомые' },
    { x: CX + 160, name: 'рыбы' },
  ];
  for (const i of lvl2Items) {
    parts.push(`<rect x="${i.x - 40}" y="${lvl2Y}" width="80" height="24" rx="4" fill="#f0fdf4" stroke="${COLOR_PRIMARY}" stroke-width="1"/>`);
    parts.push(`<line x1="${i.x}" y1="${lvl1Y + 28}" x2="${i.x}" y2="${lvl2Y}" stroke="${COLOR_LINE}" stroke-width="1.2"/>`);
    parts.push(`<text x="${i.x}" y="${lvl2Y + 16}" text-anchor="middle" font-size="9" fill="${COLOR_LABEL}">${i.name}</text>`);
  }
  return parts.join('');
}

export function renderBiology(spec: BiologySpec): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(spec.title)}">`,
  );
  parts.push(titleAndCaption(spec));
  switch (spec.diagram) {
    case 'animal-cell':
      parts.push(renderAnimalCell());
      break;
    case 'plant-cell':
      parts.push(renderPlantCell());
      break;
    case 'plant':
      parts.push(renderPlant());
      break;
    case 'dna':
      parts.push(renderDNA());
      break;
    case 'chromosome':
      parts.push(renderChromosome());
      break;
    case 'animal-class':
      parts.push(renderAnimalClass());
      break;
  }
  parts.push(`</svg>`);
  return parts.join('');
}

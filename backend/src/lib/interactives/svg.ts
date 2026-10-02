/**
 * Серверный рендер SVG для интерактивов (TZ-13 §4.8).
 *
 * ═══ ПОЧЕМУ НЕ `src/lib/llm/svg-renderer.ts` ═══
 * Полный рендерер живёт во фронте и тянет 7 шаблонов. Бэкенд — ОТДЕЛЬНЫЙ
 * npm-проект (`backend/package.json`, свой `tsconfig.json` с
 * `include: ["src\/**\/*"]`), общий пакет между ними не существует, а тащить
 * фронтовый движок в воркер — это дублирование ~1000 строк в бандле.
 * Поэтому здесь маленький СЕРВЕРНЫЙ аналог ровно для тех трёх типов графиков,
 * которые в интерактивах действительно нужны (ТЗ §4.8):
 *
 *   bar          — «какая доля на диаграмме» (quiz-race, jeopardy)
 *   pie          — доли целого (sort-baskets, quiz-race)
 *   number_line  — координатная прямая (quiz-race, sort-sequence)
 *
 * Остальные типы (`line`, `geometry`, `biology`, `chemistry`) сервер НЕ рендерит:
 * `renderInteractiveChart` вернёт `null`, и фронт отрисует их своим рендерером
 * по той же спецификации. Формат данных (ChartSpec) общий, поэтому подмены
 * не происходит — просто два рендерера одного формата.
 *
 * ═══ БЕЗОПАСНОСТЬ (ТЗ §4.8, жёлтый блок) ═══
 * SVG уезжает в браузер и вставляется через dangerouslySetInnerHTML. Отсюда:
 *   1. ЛЮБОЙ текст из LLM (title, labels, caption) проходит через `esc()`.
 *      Это закрывает и `</script>`, и `<img onerror=...>`.
 *   2. Числа в атрибуты идут только через `num()` — строка из LLM в разметку
 *      физически не может попасть.
 *   3. На выходе `sanitizeSvg()` вырезает `<script>`, обработчики `on*=`,
 *      внешние ссылки и `javascript:` — страховка на случай, если строка
 *      придёт не от нашего рендерера (например, из кэша старой версии).
 */

const W = 600;
const H = 400;

/** Поддерживаемые на сервере типы графиков. */
export type ServerChartType = "bar" | "pie" | "number_line";

/** Минимальный ChartSpec в том виде, в котором его отдаёт LLM-ранклер. */
export interface ServerChartSpec {
  type: string;
  title?: string;
  data?: {
    labels?: unknown;
    values?: unknown;
  };
  range?: unknown;
  step?: unknown;
  points?: unknown;
  caption?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Экранирование и санитайз
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Экранирование текста для XML-атрибутов и текстовых узлов.
 * `&` идёт первым — иначе он «съест» экранирование остальных символов.
 */
export function esc(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Число для атрибута. Не-число → 0 (строка из LLM в разметку не попадёт). */
function num(input: unknown, fallback = 0): number {
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : fallback;
}

/** Округлить координату до сотых — иначе SVG распухает. */
function px(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Финальная зачистка готовой SVG-строки.
 *
 * Наш собственный рендерер сюда попадать не должен (всё уже экранировано).
 * Функция — именно страховка для чужих строк: вырезает активное содержимое.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/(href|xlink:href)\s*=\s*"\s*javascript:[^"]*"/gi, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Общие куски разметки
// ─────────────────────────────────────────────────────────────────────────────

function svgShell(title: string, body: string, caption?: string): string {
  const cap =
    caption && caption.trim() !== ""
      ? `<text x="${px(W / 2)}" y="${H - 10}" text-anchor="middle" font-size="13" fill="#6b7280">${esc(caption)}</text>`
      : "";
  const head =
    title && title.trim() !== ""
      ? `<text x="${px(W / 2)}" y="24" text-anchor="middle" font-size="17" font-weight="600" fill="#111827">${esc(title)}</text>`
      : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`,
    head,
    body,
    cap,
    "</svg>",
  ].join("");
}

/** Привести `data` к двум массивам одинаковой длины. */
function readSeries(spec: ServerChartSpec): { labels: string[]; values: number[] } {
  const labels = Array.isArray(spec.data?.labels) ? (spec.data?.labels as unknown[]).map(String) : [];
  const values = Array.isArray(spec.data?.values) ? (spec.data?.values as unknown[]).map((v) => num(v, 0)) : [];
  const n = Math.min(labels.length, values.length);
  return { labels: labels.slice(0, n), values: values.slice(0, n) };
}

// ─────────────────────────────────────────────────────────────────────────────
// bar
// ─────────────────────────────────────────────────────────────────────────────

function renderBar(spec: ServerChartSpec): string {
  const { labels, values } = readSeries(spec);
  if (labels.length === 0) return svgShell(spec.title ?? "", "", spec.caption);

  const left = 60;
  const right = W - 20;
  const top = 50;
  const bottom = H - 50;
  const max = Math.max(...values, 0);
  const scaleMax = max > 0 ? max : 1;
  const slot = (right - left) / labels.length;
  const barW = Math.max(8, slot * 0.6);

  const parts: string[] = [];
  // Ось Y и сетка на 4 деления.
  for (let i = 0; i <= 4; i++) {
    const y = bottom - ((bottom - top) * i) / 4;
    const value = (scaleMax * i) / 4;
    parts.push(`<line x1="${px(left)}" y1="${px(y)}" x2="${px(right)}" y2="${px(y)}" stroke="#e5e7eb" stroke-width="1" />`);
    parts.push(`<text x="${px(left - 6)}" y="${px(y + 4)}" text-anchor="end" font-size="11" fill="#6b7280">${esc(Math.round(value * 100) / 100)}</text>`);
  }
  parts.push(`<line x1="${px(left)}" y1="${px(top)}" x2="${px(left)}" y2="${px(bottom)}" stroke="#9ca3af" stroke-width="1" />`);
  parts.push(`<line x1="${px(left)}" y1="${px(bottom)}" x2="${px(right)}" y2="${px(bottom)}" stroke="#9ca3af" stroke-width="1" />`);

  labels.forEach((label, i) => {
    const value = values[i] ?? 0;
    const h = ((bottom - top) * value) / scaleMax;
    const x = left + slot * i + (slot - barW) / 2;
    const y = bottom - h;
    parts.push(`<rect x="${px(x)}" y="${px(y)}" width="${px(barW)}" height="${px(Math.max(h, 0))}" fill="#3b82f6" />`);
    parts.push(`<text x="${px(x + barW / 2)}" y="${px(y - 6)}" text-anchor="middle" font-size="11" fill="#374151">${esc(Math.round(value * 100) / 100)}</text>`);
    // Длинные подписи режем — иначе налезают друг на друга.
    const short = label.length > 14 ? `${label.slice(0, 13)}…` : label;
    parts.push(`<text x="${px(x + barW / 2)}" y="${px(bottom + 18)}" text-anchor="middle" font-size="12" fill="#374151">${esc(short)}</text>`);
  });

  return svgShell(spec.title ?? "", parts.join(""), spec.caption);
}

// ─────────────────────────────────────────────────────────────────────────────
// pie
// ─────────────────────────────────────────────────────────────────────────────

function renderPie(spec: ServerChartSpec): string {
  const { labels, values } = readSeries(spec);
  const total = values.reduce((acc, v) => acc + Math.max(v, 0), 0);
  if (labels.length === 0 || total <= 0) return svgShell(spec.title ?? "", "", spec.caption);

  const cx = 210;
  const cy = (top0() + H) / 2 - 10;
  const r = 130;
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

  const parts: string[] = [];
  let angle = -Math.PI / 2; // начинаем сверху
  labels.forEach((label, i) => {
    const value = Math.max(values[i] ?? 0, 0);
    const sweep = (value / total) * Math.PI * 2;
    const end = angle + sweep;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    // Полный круг одним path не рисуем (arc флаг не совпадёт) — рисуем два сектора.
    if (sweep >= Math.PI * 2 - 1e-9) {
      parts.push(`<circle cx="${cx}" cy="${px(cy)}" r="${r}" fill="${colors[i % colors.length]}" />`);
    } else {
      const large = sweep > Math.PI ? 1 : 0;
      parts.push(
        `<path d="M ${cx} ${px(cy)} L ${px(x1)} ${px(y1)} A ${r} ${r} 0 ${large} 1 ${px(x2)} ${px(y2)} Z" fill="${colors[i % colors.length]}" stroke="#ffffff" stroke-width="1.5" />`,
      );
    }
    angle = end;
  });

  // Легенда справа.
  const legendX = 400;
  labels.forEach((label, i) => {
    const y = 80 + i * 26;
    const value = Math.max(values[i] ?? 0, 0);
    const share = Math.round((value / total) * 100);
    parts.push(`<rect x="${legendX}" y="${px(y - 10)}" width="14" height="14" fill="${colors[i % colors.length]}" />`);
    const short = label.length > 20 ? `${label.slice(0, 19)}…` : label;
    parts.push(`<text x="${legendX + 22}" y="${px(y + 2)}" font-size="13" fill="#374151">${esc(short)} — ${share}%</text>`);
  });

  return svgShell(spec.title ?? "", parts.join(""), spec.caption);
}

/** Верхняя граница области рисования pie — мелкие layout-константы. */
function top0(): number {
  return 50;
}

// ─────────────────────────────────────────────────────────────────────────────
// number_line
// ─────────────────────────────────────────────────────────────────────────────

function renderNumberLine(spec: ServerChartSpec): string {
  const range = Array.isArray(spec.range) ? spec.range : [];
  const min = num(range[0], 0);
  const maxRaw = num(range[1], min + 1);
  const max = maxRaw > min ? maxRaw : min + 1;

  const left = 50;
  const right = W - 50;
  const y = H / 2;
  const toX = (value: number): number => left + ((value - min) / (max - min)) * (right - left);

  const parts: string[] = [];
  parts.push(`<line x1="${left}" y1="${px(y)}" x2="${right}" y2="${px(y)}" stroke="#374151" stroke-width="2" />`);

  // Делим шкалу на 10 сегментов — предсказуемо и не зависит от «умного» шага.
  const segments = 10;
  for (let i = 0; i <= segments; i++) {
    const value = min + ((max - min) * i) / segments;
    const x = toX(value);
    const isEdge = i === 0 || i === segments;
    parts.push(
      `<line x1="${px(x)}" y1="${px(y - (isEdge ? 12 : 7))}" x2="${px(x)}" y2="${px(y + (isEdge ? 12 : 7))}" stroke="${isEdge ? "#374151" : "#9ca3af"}" stroke-width="${isEdge ? 2 : 1}" />`,
    );
    parts.push(`<text x="${px(x)}" y="${px(y + 30)}" text-anchor="middle" font-size="11" fill="#6b7280">${esc(Math.round(value * 100) / 100)}</text>`);
  }

  if (Array.isArray(spec.points)) {
    for (const raw of spec.points) {
      if (!raw || typeof raw !== "object") continue;
      const point = raw as { value?: unknown; label?: unknown; color?: unknown };
      const value = num(point.value, min);
      const x = Math.min(Math.max(toX(value), left), right);
      const highlight = point.color === "highlight";
      parts.push(`<circle cx="${px(x)}" cy="${px(y)}" r="7" fill="${highlight ? "#ef4444" : "#3b82f6"}" stroke="#ffffff" stroke-width="1.5" />`);
      const label = typeof point.label === "string" ? point.label : String(Math.round(value * 100) / 100);
      parts.push(`<text x="${px(x)}" y="${px(y - 18)}" text-anchor="middle" font-size="12" fill="#111827">${esc(label)}</text>`);
    }
  }

  return svgShell(spec.title ?? "", parts.join(""), spec.caption);
}

// ─────────────────────────────────────────────────────────────────────────────
// Точка входа
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Отрендерить график на сервере.
 *
 * Возвращает `null`, если тип не поддерживается или данных не хватает: это
 * НЕ ошибка — фронт в этом случае рисует своим рендерером, и задание просто
 * останется без картинки. Так мы не блокируем создание интерактива из-за
 * графика.
 */
export function renderInteractiveChart(spec: ServerChartSpec | null | undefined): string | null {
  if (!spec || typeof spec.type !== "string") return null;
  try {
    let svg: string;
    switch (spec.type) {
      case "bar":
        svg = renderBar(spec);
        break;
      case "pie":
        svg = renderPie(spec);
        break;
      case "number_line":
        svg = renderNumberLine(spec);
        break;
      default:
        return null; // line / geometry / biology / chemistry — фронт сам
    }
    return sanitizeSvg(svg);
  } catch {
    return null;
  }
}

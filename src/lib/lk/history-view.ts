/**
 * Поиск, фильтры и группировка истории кабинета (ТЗ-21, блок 3).
 *
 * Проблема, которую это чинит: одна лента из 50 одинаковых карточек, где
 * нельзя ни найти нужный лист, ни отличить два листа одного предмета.
 *
 * Все функции чистые и не знают ни про сеть, ни про localStorage — их можно
 * тестировать обычными массивами, а вёрстка просто рисует то, что вернулось.
 */

import {
  MATERIAL_KIND_LABEL,
  MATERIAL_KIND_ORDER,
  materialKindOf,
  type DateGroup,
  type HistoryItem,
  type MaterialKind,
} from "./types";

/* ─── Поиск ───────────────────────────────────────────────────────────────── */

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Поиск по названию и теме. Слово «дроби» находит «Дроби: сложение и вычитание»
 * и «Рабочий лист по теме Дроби», потому что сравниваются оба поля.
 *
 * Нечувствителен к регистру и лишним пробелам; несколько слов ищутся как
 * фрагмент целиком, чтобы «дроби 5» не давал ложных совпадений.
 */
export function matchesQuery(item: HistoryItem, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const haystack = normalize(
    [item.title, item.topic ?? "", item.subject ?? ""].filter(Boolean).join(" ")
  );
  return haystack.includes(q);
}

/* ─── Фильтры ─────────────────────────────────────────────────────────────── */

export interface HistoryFilters {
  /** Пустая строка = «все предметы». */
  subject: string;
  /** null = «все классы». */
  grade: number | null;
  /** null = «все типы материалов». */
  kind: MaterialKind | null;
}

export const EMPTY_FILTERS: HistoryFilters = {
  subject: "",
  grade: null,
  kind: null,
};

export function isFilterActive(f: HistoryFilters): boolean {
  return f.subject !== "" || f.grade !== null || f.kind !== null;
}

/** Предмет + класс + тип материала. Фильтры сочетаются между собой и с поиском. */
export function matchesFilters(item: HistoryItem, f: HistoryFilters): boolean {
  if (f.subject && item.subject !== f.subject) return false;
  if (f.grade !== null && item.grade !== f.grade) return false;
  if (f.kind !== null && materialKindOf(item.type) !== f.kind) return false;
  return true;
}

/** Полный прогон: поиск + фильтры одним проходом. */
export function applyHistoryView(
  items: HistoryItem[],
  query: string,
  filters: HistoryFilters,
): HistoryItem[] {
  return items.filter(
    (i) => matchesQuery(i, query) && matchesFilters(i, filters)
  );
}

/* ─── Значения для выпадающих списков ─────────────────────────────────────── */

/** Список предметов, реально встречающихся в истории, по алфавиту. */
export function subjectsOf(items: HistoryItem[]): string[] {
  return Array.from(new Set(items.map((i) => i.subject).filter(Boolean))).sort();
}

/** Список классов по возрастанию. */
export function gradesOf(items: HistoryItem[]): number[] {
  return Array.from(
    new Set(items.map((i) => i.grade).filter((g): g is number => typeof g === "number"))
  ).sort((a, b) => a - b);
}

/** Типы материалов, реально встречающиеся в истории, в заданном порядке. */
export function kindsOf(items: HistoryItem[]): MaterialKind[] {
  const present = new Set(items.map((i) => materialKindOf(i.type)));
  const ordered = MATERIAL_KIND_ORDER.filter((k) => present.has(k));
  if (present.has("other")) ordered.push("other");
  return ordered;
}

/* ─── Группировка по дате ─────────────────────────────────────────────────── */

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Заголовок группы для карточки по дате создания.
 *
 * «Сегодня / Вчера / Эта неделя / Октябрь / Раньше». Это снимает главный
 * вопрос учителя — «где мой вчерашний лист» — без прокрутки всей ленты.
 *
 * `now` передаётся снаружи, чтобы группировка была детерминированной в тестах.
 */
export function dateGroupLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Раньше";

  const todayStart = startOfDay(now);
  const dayStart = startOfDay(d);
  const diffDays = Math.round((todayStart - dayStart) / 86_400_000);

  if (diffDays <= 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  if (diffDays < 7) return "Эта неделя";
  if (d.getFullYear() === now.getFullYear()) {
    const m = MONTHS_GEN[d.getMonth()];
    // «Октябрь» → «В октябре»: заголовок группы читается как период.
    return `В ${m}`;
  }
  return `${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Группирует отфильтрованные карточки по дате, сохраняя порядок внутри
 * группы и порядок самих групп (свежие сверху).
 *
 * Пустой массив на входе даёт пустой массив на выходе — вкладка в этом случае
 * показывает пустое состояние, а не пустые заголовки.
 */
export function groupByDate(
  items: HistoryItem[],
  now: Date = new Date(),
): DateGroup[] {
  const groups: DateGroup[] = [];
  const index = new Map<string, DateGroup>();

  for (const item of items) {
    const label = dateGroupLabel(item.createdAt, now);
    const existing = index.get(label);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    const group: DateGroup = { label, items: [item] };
    index.set(label, group);
    groups.push(group);
  }
  return groups;
}

/* ─── Подпись карточки ────────────────────────────────────────────────────── */

/** «Рабочий лист» — тип материала текстом, а не эмодзи. */
export function kindLabel(item: HistoryItem): string {
  return MATERIAL_KIND_LABEL[materialKindOf(item.type)];
}

/**
 * Размер материала: «12 заданий», «10 слайдов». Для серверной истории бэк
 * размер не отдаёт — тогда подпись честно молчит, вместо того чтобы врать
 * про количество.
 */
export function countLabel(item: HistoryItem): string | null {
  if (typeof item.count !== "number" || item.count <= 0) return null;
  const kind = materialKindOf(item.type);
  const noun =
    kind === "presentation" ? ["слайд", "слайда", "слайдов"]
    : kind === "lesson-plan" ? ["этап", "этапа", "этапов"]
    : kind === "ktp" ? ["неделя", "недели", "недель"]
    : kind === "cards" ? ["карточка", "карточки", "карточек"]
    : ["задание", "задания", "заданий"];
  return `${item.count} ${plural(item.count, noun[0], noun[1], noun[2])}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Подбор соседних тем для страницы темы — блок Г из плана
 * `docs/30-audit-plan-2026-10-11.md`.
 *
 * ЗАЧЕМ ФАЙЛ. На странице темы нужен ограниченный список ссылок на соседние
 * темы того же предмета и класса. Раньше здесь стоял блок «Другие темы»,
 * который рендерил ВСЕ темы класса: у 15 из 141 пары «предмет × класс»
 * их больше восьми (максимум 29 — algebra/9), и страница превращалась в
 * простыню ссылок без всякого смысла для учителя и для робота.
 *
 * ЧЕМ ЭТО ДЕШЕВЛЕ ОТКАЧЕННОГО `components/seo/RelatedTopics.tsx`.
 * Старый компонент просит `allTopics` — плоский список тем ВСЕХ предметов
 * и классов (1075 штук) — и фильтрует его три раза на каждой странице.
 * То есть глобальная работа на каждой из 1075 страниц. Здесь нужен только
 * `getGrade(subject, grade)`: список тем одного класса, не больше 30 штук.
 * Плюс он самый список кешируется по ключу `предмет/класс`, то есть считается
 * один раз на класс, а не один раз на страницу. Итог: O(классы) вместо
 * O(страницы × все темы), при этом блок рисует 4–8 ссылок, а не 26.
 *
 * ЧЕСТНОСТЬ ДАННЫХ. Ничего не выдумывается: берутся только темы того же
 * предмета и класса из `subjects.ts`, то есть ровно те, для которых
 * `generateStaticParams` создаёт страницы. Ссылка не может оказаться битой,
 * потому что её цель — сосед из того же списка, из которого строится выдача.
 *
 * ПОРЯДОК ССЫЛОК. Тематическая близость, а не алфавит:
 *   1. тот же раздел ФГОС (`fgosRef`) — это единственная настоящая
 *      тематическая группировка в таксономии;
 *   2. близость по порядку тем в классе (порядок программы, а не а→я);
 *   3. порядок в таксономии — чтобы выбор был воспроизводимым.
 */

import type { Topic } from "@/lib/types";
import { getGrade } from "./subjects";

/** Ссылка на соседнюю тему для блока «Смотрите также». */
export interface TopicNeighbor {
  /** Готовый href, например `/subject/math/5/drobi-obyknovennye`. */
  href: string;
  title: string;
  /** Первое задание соседней темы — подсказка, чем тема отличается. */
  hint: string;
}

/** Ниже 4 ссылок блок не рисуем: это уже не «смотрите также», а мусор. */
export const MIN_NEIGHBORS = 4;
/** Больше 8 — страница превращается в простыню ссылок. */
export const MAX_NEIGHBORS = 8;

/**
 * Список тем класса кешируется по ключу «предмет/класс»: за сборку он
 * считается 141 раз вместо 1075. Храним ссылки на темы, а не копии.
 */
const gradeCache = new Map<string, readonly Topic[]>();

function gradeTopics(subjectSlug: string, gradeNum: number): readonly Topic[] {
  const key = `${subjectSlug}/${gradeNum}`;
  const cached = gradeCache.get(key);
  if (cached) return cached;
  const topics: readonly Topic[] = getGrade(subjectSlug, gradeNum)?.topics ?? [];
  gradeCache.set(key, topics);
  return topics;
}

/** Сколько раз считать набор соседей — для теста и для диагностики. */
export function topicNeighborsCacheSize(): number {
  return gradeCache.size;
}

interface Scored {
  topic: Topic;
  /** 0 — тот же раздел ФГОС, 1 — другой. */
  section: 0 | 1;
  /** Расстояние по порядку тем в классе. */
  distance: number;
  /** Позиция в таксономии — последний ключ сортировки. */
  index: number;
}

/**
 * Соседние темы той же пары «предмет + класс»: от 4 до 8 штук.
 *
 * Порядок: сначала соседи по разделу ФГОС, потом ближайшие по порядку
 * программы. Больше `MAX_NEIGHBORS` не берём никогда — на больших предметах
 * (algebra/9 — 30 тем) иначе блок разрастается в 29 ссылок.
 *
 * Если соседей меньше `MIN_NEIGHBORS`, возвращается пустой список и блок
 * не рисуется: выдумывать ссылки на другие предметы или классы здесь
 * нельзя, а блок из одной ссылки хуже, чем никакого.
 */
export function getTopicNeighbors(
  subjectSlug: string,
  gradeNum: number,
  topicSlug: string,
  basePath = "/subject",
): TopicNeighbor[] {
  const topics = gradeTopics(subjectSlug, gradeNum);
  if (topics.length < MIN_NEIGHBORS + 1) return [];

  const index = topics.findIndex((t) => t.slug === topicSlug);
  const current = index >= 0 ? topics[index] : undefined;

  const scored: Scored[] = [];
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    if (topic.slug === topicSlug) continue;
    scored.push({
      topic,
      section: current?.fgosRef && topic.fgosRef === current.fgosRef ? 0 : 1,
      distance: index >= 0 ? Math.abs(i - index) : i,
      index: i,
    });
  }

  scored.sort(
    (a, b) =>
      a.section - b.section || a.distance - b.distance || a.index - b.index,
  );

  const picked = scored.slice(0, MAX_NEIGHBORS);
  if (picked.length < MIN_NEIGHBORS) return [];

  return picked.map(({ topic }) => ({
    href: `${basePath}/${subjectSlug}/${gradeNum}/${topic.slug}`,
    title: topic.title,
    hint: topic.examples[0]?.text ?? "",
  }));
}
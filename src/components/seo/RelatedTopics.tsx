/**
 * SEO: перелинковка на теме — 3 блока ссылок + структурированный <nav>.
 *
 * Использование:
 *   <RelatedTopics
 *     currentTopic={{ slug: topic.slug, title: topic.title, grade: grade.num }}
 *     subject={{ slug: subject.slug, shortTitle: subject.shortTitle }}
 *     allTopics={flatRelated}   // slim shape: {slug, title, grade, subject}
 *   />
 *
 * TZ-10 §6.1 / §9.12 (P1): Related topics блок на теме — 5+ ссылок.
 *
 * Три блока внутри одного <nav aria-label="Связанные темы">:
 *   1. Другие темы {grade} класса по {subject.shortTitle} (≤12).
 *   2. {subject.shortTitle} в соседних классах (grade±1, ≤8).
 *   3. Часто ищут с темой «{topic.title}» — related searches (≤6).
 *      Если relatedSlugs не задан — fallback на похожие по slug'у темы.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

/** Slim-форма темы для перелинковки (без тяжёлых полей examples/fgosRef). */
export interface RelatedTopicLink {
  slug: string;
  title: string;
  grade: number;
  /** Slug предмета (например "math"). */
  subject: string;
}

export interface RelatedTopicRef {
  slug: string;
  title: string;
  grade: number;
}

export interface RelatedSubjectRef {
  slug: string;
  /** Короткое название ("Математика") — используется в заголовках блоков. */
  shortTitle: string;
}

export interface RelatedTopicsProps {
  currentTopic: RelatedTopicRef;
  subject: RelatedSubjectRef;
  allTopics: RelatedTopicLink[];
  /**
   * Related searches (slug'и тем, которые чаще всего ищут вместе с этой).
   * Опционально — если не задано, используется fallback по похожим slug'ам.
   */
  relatedSlugs?: string[];
  /** Базовый путь для построения ссылок (по умолчанию "/subject"). */
  basePath?: string;
}

const MAX_SAME_GRADE = 12;
const MAX_ADJACENT = 8;
const MAX_RELATED = 6;

/**
 * Fallback для третьего блока: 4–6 тем того же предмета, которые ещё
 * не показаны в блоках 1–2. Приоритет — темы с похожим первым блоком slug'а
 * (например, "drobi-obykn", "drobi-des", "drobi-smesh").
 */
function fallbackRelated(
  current: RelatedTopicRef,
  subject: RelatedSubjectRef,
  allTopics: RelatedTopicLink[],
  exclude: Set<string>,
): RelatedTopicLink[] {
  const sameSubject = allTopics.filter(
    (t) =>
      t.subject === subject.slug &&
      t.slug !== current.slug &&
      !exclude.has(`${t.subject}/${t.grade}/${t.slug}`),
  );

  // Heuristic: первый блок slug (4+ символа) обычно объединяет темы одной группы.
  const prefix = current.slug.split("-")[0] ?? "";
  const similar = sameSubject.filter(
    (t) => prefix.length >= 3 && t.slug.startsWith(prefix),
  );

  if (similar.length >= 3) return similar.slice(0, MAX_RELATED);

  // Иначе — соседи по slug'у в том же классе (алфавитный порядок).
  const sameGrade = sameSubject
    .filter((t) => t.grade === current.grade)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const idx = sameGrade.findIndex((t) => t.slug === current.slug);
  const neighbors: RelatedTopicLink[] = [];
  for (let i = 1; neighbors.length < MAX_RELATED && sameGrade.length > 0; i++) {
    const pos = idx >= 0 ? idx + i : i - 1;
    const t = sameGrade[((pos % sameGrade.length) + sameGrade.length) % sameGrade.length];
    if (t && !neighbors.includes(t)) neighbors.push(t);
  }
  return neighbors;
}

export function RelatedTopics({
  currentTopic,
  subject,
  allTopics,
  relatedSlugs,
  basePath = "/subject",
}: RelatedTopicsProps) {
  const currentKey = `${subject.slug}/${currentTopic.grade}/${currentTopic.slug}`;

  // 1. Другие темы того же класса × предмета
  const sameGrade = allTopics
    .filter(
      (t) =>
        t.subject === subject.slug &&
        t.grade === currentTopic.grade &&
        t.slug !== currentTopic.slug,
    )
    .slice(0, MAX_SAME_GRADE);

  // 2. Тот же предмет в соседних классах (grade ± 1)
  const adjacent = allTopics
    .filter(
      (t) =>
        t.subject === subject.slug &&
        Math.abs(t.grade - currentTopic.grade) === 1,
    )
    .sort((a, b) => a.grade - b.grade)
    .slice(0, MAX_ADJACENT);

  const shown = new Set<string>([
    currentKey,
    ...sameGrade.map((t) => `${t.subject}/${t.grade}/${t.slug}`),
    ...adjacent.map((t) => `${t.subject}/${t.grade}/${t.slug}`),
  ]);

  // 3. Related searches: из переданного списка slug'ов или fallback.
  let related: RelatedTopicLink[] = [];
  if (relatedSlugs && relatedSlugs.length > 0) {
    related = relatedSlugs
      .map((slug) => allTopics.find((t) => t.slug === slug))
      .filter((t): t is RelatedTopicLink => Boolean(t))
      .filter((t) => !shown.has(`${t.subject}/${t.grade}/${t.slug}`))
      .slice(0, MAX_RELATED);
  }
  if (related.length === 0) {
    related = fallbackRelated(currentTopic, subject, allTopics, shown);
  }

  const blocks: Array<{ title: string; items: RelatedTopicLink[] }> = [
    {
      title: `Другие темы ${currentTopic.grade} класса по ${subject.shortTitle}`,
      items: sameGrade,
    },
    {
      title: `${subject.shortTitle} в соседних классах`,
      items: adjacent,
    },
    {
      title: `Часто ищут с темой «${currentTopic.title}»`,
      items: related,
    },
  ];

  // Не рендерим весь блок, если все три секции пустые (например, для 1 класса).
  if (sameGrade.length === 0 && adjacent.length === 0 && related.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Связанные темы"
      className="py-12 sm:py-16 border-t border-warm-100 bg-warm-50/50"
    >
      <div className="container-tight space-y-10">
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-warm-950">
          Связанные темы
        </h2>
        {blocks.map((block) =>
          block.items.length === 0 ? null : (
            <section key={block.title} aria-label={block.title}>
              <h3 className="text-base sm:text-lg font-semibold text-warm-800 mb-3">
                {block.title}
              </h3>
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {block.items.map((t) => (
                  <li key={`${t.subject}/${t.grade}/${t.slug}`}>
                    <Link
                      href={`${basePath}/${t.subject}/${t.grade}/${t.slug}`}
                      className="group block rounded-xl border border-warm-100 bg-white px-4 py-3 hover:border-brand-200 hover:shadow-soft transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-warm-950 group-hover:text-brand-700 transition-colors line-clamp-2">
                          {t.title}
                        </span>
                        {t.grade !== currentTopic.grade && (
                          <Badge tone="neutral" className="shrink-0">
                            {t.grade} кл.
                          </Badge>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </nav>
  );
}
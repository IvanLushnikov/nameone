/**
 * Перелинковка на странице темы — блок Г (кейсы Г-1 и Г-2,
 * `docs/30-audit-plan-2026-10-11.md`).
 *
 * ## Что именно ловит этот файл
 *
 * 11.10.2026 на странице темы стоял блок «Другие темы», который рендерил
 * ВСЕ темы класса без ограничения. У 15 из 141 пар «предмет × класс» тем
 * больше восьми, у algebra/9 — 30 тем и 29 ссылок. То есть на части страниц
 * критерий «4–8 ссылок на соседние темы» не выполнялся: ссылок было 9–29.
 * Раньше это и называлось «перелинковки нет» — на 126 классах блок был,
 * но на самых больших предметах превращался в простыню.
 *
 * ## Почему тест считает ссылки в разметке, а не по данным
 *
 * Считается ровно то, что уходит в HTML: `renderToStaticMarkup` даёт тот же
 * вывод, что и статическая генерация. Список ожидаемых соседей не зашит:
 * он собирается из таксономии (`subjects.ts`), поэтому тест ломается, если
 * подбор перестанет соответствовать реальным страницам, а не если изменится
 * число тем в каком-то предмете.
 *
 * ## Почему здесь же проверка кеша
 *
 * Предыдущую попытку подключить перелинковку откатили из-за таймаутов статической
 * генерации. Причина была в контракте откатанного компонента
 * `components/seo/RelatedTopics.tsx`: он просил плоский список тем ВСЕХ
 * предметов и классов и фильтровал его внутри каждой из 1075 страниц.
 * Если бы кто-то снова начал считать соседей по всей таксономии на странице,
 * тест на кеш это поймает.
 */

import { createElement } from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TopicPage from "@/app/subject/[subject]/[grade]/[topic]/page";
import {
  getTopicNeighbors,
  topicNeighborsCacheSize,
  MIN_NEIGHBORS,
  MAX_NEIGHBORS,
} from "@/lib/content/topic-neighbors";
import { subjects, getTopic } from "@/lib/content/subjects";

interface TopicRef {
  subject: string;
  grade: number;
  slug: string;
  title: string;
  fgosRef?: string;
}

/** Все страницы тем из таксономии — то же, что даёт `generateStaticParams`. */
const ALL_TOPICS: TopicRef[] = subjects.flatMap((s) =>
  s.grades.flatMap((g) =>
    g.topics.map((t) => ({
      subject: s.slug,
      grade: g.num,
      slug: t.slug,
      title: t.title,
      fgosRef: t.fgosRef,
    })),
  ),
);

/** Ссылка на страницу темы в собранном HTML. Три сегмента после /subject/. */
const TOPIC_HREF = /href="\/subject\/([^/"]+)\/(\d+)\/([^/"]+)\/?"/g;

/** Ссылки на соседние темы в разметке страницы. */
function renderedNeighborHrefs(
  subject: string,
  grade: number,
  slug: string,
): string[] {
  const html = renderToStaticMarkup(
    createElement(TopicPage, {
      params: { subject, grade: String(grade), topic: slug },
    }),
  );
  const own = `/subject/${subject}/${grade}/${slug}`;
  const found: string[] = [];
  for (const match of html.matchAll(TOPIC_HREF)) {
    const href = `/subject/${match[1]}/${match[2]}/${match[3]}`;
    // Хлебные крошки ведут на текущую страницу — это не сосед.
    if (href !== own && !found.includes(href)) found.push(href);
  }
  return found;
}

/** Пары «предмет × класс», отсортированные по убыванию числа тем. */
const GRADES_BY_SIZE = subjects
  .flatMap((s) => s.grades.map((g) => ({ subject: s.slug, grade: g.num, topics: g.topics })))
  .sort((a, b) => b.topics.length - a.topics.length);

describe("Страница темы: соседние темы для перелинковки", () => {
  it("таксономия не пустая — иначе проверки ниже ничего не значат", () => {
    expect(ALL_TOPICS.length).toBeGreaterThan(1000);
  });

  // Г-1: 4–8 ссылок на соседние темы на каждой странице.
  // Считаем по разметке всех страниц — так же, как их собирает Next.
  // Страниц стало 5682 (темы федеральных рабочих программ), рендер каждой
  // страницы — это полноценный SSR, поэтому 5 секунд штатного таймаута не
  // хватает. Проверка та же самая, выросло только время её выполнения.
  it("на каждой странице темы 4–8 ссылок на соседние темы", () => {
    const bad: string[] = [];
    for (const t of ALL_TOPICS) {
      const count = renderedNeighborHrefs(t.subject, t.grade, t.slug).length;
      if (count < MIN_NEIGHBORS || count > MAX_NEIGHBORS) {
        bad.push(`${t.subject}/${t.grade}/${t.slug} → ${count}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(bad).toHaveLength(0);
  }, 240_000);

  // Г-1 на самых больших предметах — с сообщением, которое читается сразу.
  it("на самых больших предметах страница всё равно отдаёт 4–8 ссылок", () => {
    const biggest = GRADES_BY_SIZE.slice(0, 5);
    // Страховка: тест должен брать настоящие большие предметы, а не вырожденные.
    expect(biggest[0].topics.length).toBeGreaterThan(MAX_NEIGHBORS);

    const counts = biggest.map(({ subject, grade, topics }) => {
      const hrefs = renderedNeighborHrefs(subject, grade, topics[0].slug);
      return { page: `${subject}/${grade}`, count: hrefs.length };
    });
    for (const { page, count } of counts) {
      expect(count, `страница ${page}`).toBeGreaterThanOrEqual(MIN_NEIGHBORS);
      expect(count, `страница ${page}`).toBeLessThanOrEqual(MAX_NEIGHBORS);
    }
  });

  // Г-2: каждая ссылка ведёт на существующую страницу.
  it("каждая ссылка соответствует реально существующей странице темы", () => {
    const broken: string[] = [];
    for (const t of ALL_TOPICS) {
      for (const n of getTopicNeighbors(t.subject, t.grade, t.slug)) {
        // href обязан совпадать с каноническим адресом и вести на реальную тему.
        const expected = `/subject/${t.subject}/${t.grade}/`;
        if (!n.href.startsWith(expected)) {
          broken.push(`${n.href} — ссылка ушла за пределы «предмет + класс»`);
          continue;
        }
        const slug = n.href.slice(expected.length);
        const target = getTopic(t.subject, t.grade, slug);
        if (!target) broken.push(`${n.href} — такой темы нет в таксономии`);
        else if (target.title !== n.title) broken.push(`${n.href} — заголовок не совпал`);
      }
    }
    expect(broken.slice(0, 10)).toEqual([]);
    expect(broken).toHaveLength(0);
  });

  it("в ссылках нет самой темы и нет повторов", () => {
    for (const t of ALL_TOPICS) {
      const hrefs = getTopicNeighbors(t.subject, t.grade, t.slug).map((n) => n.href);
      const own = `/subject/${t.subject}/${t.grade}/${t.slug}`;
      expect(hrefs).not.toContain(own);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  // Порядок тематический, а не «по алфавиту»: темы того же раздела ФГОС
  // идут раньше остальных. Такое свойство проверяем на реальных группах
  // из таксономии, а не на выдуманном примере.
  it("соседи по одному разделу ФГОС стоят раньше остальных", () => {
    let checkedPages = 0;
    // Страницы, у которых все 8 ссылок — из одного раздела: порядок там
    // проверять не на чем. Такие появились, когда в классы добавили темы из
    // рабочих программ: в разделе «Дроби» их теперь больше, чем блок ссылок.
    let singleSectionPages = 0;

    for (const t of ALL_TOPICS) {
      if (!t.fgosRef) continue;
      const section = getTopic(t.subject, t.grade, t.slug)?.fgosRef;
      if (!section) continue;

      const picked = getTopicNeighbors(t.subject, t.grade, t.slug);
      const refs = picked.map((n) => getTopic(t.subject, t.grade, n.href.split("/").pop()!)?.fgosRef);
      const ownSectionAt = refs.flatMap((r, i) => (r === section ? [i] : []));
      // Свой раздел есть в выдаче не на каждой странице: у части тем раздел
      // ФГОС не проставлен, и тогда сравнивать нечего.
      if (ownSectionAt.length === 0) continue;
      // Первая ссылка на тему другого (заполненного) раздела. Темы без
      // раздела не считаем «другими»: их подбор идёт по порядку программы.
      const firstOther = refs.findIndex((r) => r !== section && r !== undefined);
      if (firstOther === -1) {
        singleSectionPages++;
        continue;
      }
      checkedPages++;
      // Свой раздел открывает блок, а после первой темы другого раздела
      // своих не возвращается: разделы в одном блоке не перемешиваются.
      expect(ownSectionAt[0], `${t.subject}/${t.grade}/${t.slug}`).toBe(0);
      expect(
        ownSectionAt.some((i) => i > firstOther),
        `${t.subject}/${t.grade}/${t.slug}: свой раздел вернулся после чужого`,
      ).toBe(false);
    }

    // Проверка не должна быть пустой: в таксономии есть и смешанные блоки,
    // и блоки целиком из одного раздела.
    expect(checkedPages).toBeGreaterThan(0);
    expect(singleSectionPages).toBeGreaterThan(0);
  });

  // Защита от возврата к прежней причине таймаутов: список тем класса
  // кешируется один раз на пару «предмет × класс», а не пересчитывается
  // на каждой из 1075 страниц.
  it("список тем класса считается один раз, а не на каждой странице", () => {
    const before = topicNeighborsCacheSize();
    const pageCount = GRADES_BY_SIZE.length;

    for (const t of ALL_TOPICS) getTopicNeighbors(t.subject, t.grade, t.slug);

    // Всё, что добавилось в кеш, — не больше, чем было пар «предмет × класс».
    expect(topicNeighborsCacheSize() - before).toBeLessThanOrEqual(pageCount);
    // 1075 страниц не должны превращаться в 1075 записей кеша.
    expect(ALL_TOPICS.length).toBeGreaterThan(pageCount);
  });
});
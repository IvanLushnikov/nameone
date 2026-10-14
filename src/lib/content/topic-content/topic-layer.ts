/**
 * Второй слой содержания: различия ВНУТРИ одной пары «предмет + класс».
 *
 * ## Проблема, которую решает файл
 *
 * `GradeContent` описан по паре «предмет + класс», поэтому у всех тем года
 * он один и тот же. Замер это показывал: внутри пары страницы различались на
 * 3,3% длины текста, а подпись содержания у всех тем класса была одна
 * (`1/6` различных подписей на 6 тем). Поисковик это видит так же, как мы:
 * внутри класса страницы переставлены местами.
 *
 * ## Откуда берутся различия
 *
 * Из таксономии, а не из этого файла. У темы есть `fgosRef` — раздел ФГОС,
 * к которому она относится. В 128 парах «предмет + класс» темы класса
 * лежат в РАЗНЫХ разделах: значит, внутри года ученик идёт по разным
 * разделам программы, и страница может это показать и назвать.
 *
 * ## Правило «никаких выдумок»
 *
 * Здесь нет ни одной оценки, которую нельзя было бы посчитать по данным
 * таксономии. Собираются только: название раздела темы, список других тем
 * класса с их разделами и количество примеров с ответами. Если у темы
 * `fgosRef` не заполнен — `filled: false`, и страница не рисует отсюда
 * ничего. Лучше пустой блок, чем приписанный теме раздел.
 */

import type { Topic } from "../../types";
import { getGrade } from "../subjects";
import type { GradeSection, TopicLayer } from "./types";

/** Кеш по «предмет/класс»: разделы собраны один раз на класс, а не на тему. */
const sectionsCache = new Map<string, GradeSection[]>();

/**
 * Разделы ФГОС, встречающиеся в темах класса, с темами внутри каждого.
 *
 * Порядок разделов и тем внутри раздела — как в таксономии, а не
 * отсортированный по алфавиту: учитель сверяется с программой.
 */
function gradeSections(subjectSlug: string, gradeNum: number): GradeSection[] {
  const key = `${subjectSlug}/${gradeNum}`;
  const hit = sectionsCache.get(key);
  if (hit) return hit;

  const grade = getGrade(subjectSlug, gradeNum);
  const byRef = new Map<string, string[]>();

  for (const topic of grade?.topics ?? []) {
    if (!topic.fgosRef) continue;
    const list = byRef.get(topic.fgosRef);
    if (list) list.push(topic.title);
    else byRef.set(topic.fgosRef, [topic.title]);
  }

  const sections: GradeSection[] = [...byRef.entries()].map(([ref, titles]) => ({
    ref,
    topicCount: titles.length,
    titles,
  }));
  sectionsCache.set(key, sections);
  return sections;
}

/**
 * Содержание уровня темы.
 *
 * Возвращает `filled: false`, когда у темы нет `fgosRef`: тогда в блоке
 * нечего показать, и вызывающий код обязан не рендерить его вовсе.
 */
export function getTopicLayer(subjectSlug: string, gradeNum: number, topic: Topic): TopicLayer {
  const answeredCount = topic.examples.filter((e) => e.answer).length;
  const sections = gradeSections(subjectSlug, gradeNum);

  if (!topic.fgosRef) {
    return {
      filled: false,
      section: null,
      sections,
      siblingTitles: [],
      exampleCount: topic.examples.length,
      answeredCount,
      note: "",
    };
  }

  const own = sections.find((s) => s.ref === topic.fgosRef);
  // Соседи по разделу — темы того же года, что и эта, кроме самой темы.
  const siblingTitles = (own?.titles ?? []).filter((t) => t !== topic.title);

  return {
    filled: true,
    section: topic.fgosRef,
    sections,
    siblingTitles,
    exampleCount: topic.examples.length,
    answeredCount,
    note: buildNote(topic, own?.topicCount ?? 1, siblingTitles.length),
  };
}

/**
 * Фраза о разделе для страницы.
 *
 * Собирается из счётчиков, посчитанных по таксономии. Никаких оценок вида
 * «всего несколько тем» — количество всегда названо точно, потому что оно
 * считается, а не оценивается.
 */
function buildNote(topic: Topic, topicCount: number, siblings: number): string {
  const head = `«${topic.fgosRef}» — раздел ФГОС, к которому относится эта тема.`;
  // Раздел из одной темы называть счётом бессмысленно: соседей в нём нет.
  if (siblings === 0) return `${head} В этом классе она единственная в этом разделе.`;
  return `${head} В этом классе в разделе ${topicCount} ${pluralTopics(topicCount)}, кроме неё здесь ${siblings} ${siblings === 1 ? "тема" : pluralTopics(siblings)}.`;
}

/** Русское склонение по числу: 1 тема, 2 темы, 5 тем. */
function pluralTopics(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "тема";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "темы";
  return "тем";
}
/**
 * Сборка предметного содержания для страницы.
 *
 * Здесь три уровня поиска, от точного к общему:
 *   1. запись по точному классу предмета (`grades`);
 *   2. диапазон классов, который накрывает класс (`bands`);
 *   3. ничего — `filled: false`, страница рисует то, что рисовала раньше.
 *
 * Третий уровень существует не для красоты: он гарантирует, что предмет без
 * наполненных данных НЕ получит чужой текст. Лучше старый блок, чем правдоподобный
 * «математический» текст на странице литературы.
 *
 * Кэш: сборка 1075 страниц × 3 роута зовёт функцию тысячи раз, а предметов и
 * классов — десятки. Кешируем по «предмет/класс» (см. `topic-neighbors.ts`,
 * который кэширует так же и по той же причине).
 */

import type { SubjectSlug } from "../../types";
import type { GradeContent, SubjectContent, TopicContent } from "./types";

import { math } from "./data/math";
import { algebra } from "./data/algebra";
import { geometry } from "./data/geometry";
import { russian } from "./data/russian";
import { english } from "./data/english";
import { literature } from "./data/literature";
import { informatics } from "./data/informatics";
import { physics } from "./data/physics";
import { chemistry } from "./data/chemistry";
import { biology } from "./data/biology";
import { geography } from "./data/geography";
import { history } from "./data/history";
import { social } from "./data/social";
import { german } from "./data/german";
import { obzh } from "./data/obzh";
import { technology } from "./data/technology";
import { finance } from "./data/finance";
import { music } from "./data/music";
import { art } from "./data/art";
import { pe } from "./data/pe";
import { okruzhaet } from "./data/okruzhaet";

export type { GradeContent, LessonStage, SlideUnit, SubjectContent, TopicContent } from "./types";

/** Все предметы с наполненным содержанием, по слагу предмета. */
export const TOPIC_CONTENT: Record<string, SubjectContent> = {
  math,
  algebra,
  geometry,
  russian,
  english,
  literature,
  informatics,
  physics,
  chemistry,
  biology,
  geography,
  history,
  social,
  german,
  obzh,
  technology,
  finance,
  music,
  art,
  pe,
  okruzhaet,
};

type Cached = TopicContent | null;

const cache = new Map<string, Cached>();

/** Есть ли содержание по предмету — быстрая проверка без сборки GradeContent. */
export function hasTopicContent(subjectSlug: string): boolean {
  return Boolean(TOPIC_CONTENT[subjectSlug]);
}

/**
 * Содержание для пары «предмет + класс».
 *
 * Возвращает `null`, если предмета нет в карте — вызывающий код обязан это
 * учесть и отрендерить старый блок, а не выдумывать текст.
 */
export function getTopicContent(subjectSlug: string, grade: number): TopicContent | null {
  const key = `${subjectSlug}/${grade}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const subject = TOPIC_CONTENT[subjectSlug];
  if (!subject) {
    cache.set(key, null);
    return null;
  }

  const exact = subject.grades[grade];
  const band = subject.bands.find((b) => grade >= b.from && grade <= b.to);

  const result: TopicContent = exact
    ? { subject, grade: exact, match: "exact", depth: subject.depth, filled: true }
    : band
      ? { subject, grade: band.content, match: "band", depth: subject.depth, filled: true }
      : {
          // Предмет есть, но класс не накрыт ни записью, ни диапазоном.
          // `filled: false` — вызывающий код не имеет права нарисовать отсюда
          // предметный текст: это был бы чужой текст на чужой странице.
          subject,
          grade: emptyGrade(),
          match: "band",
          depth: subject.depth,
          filled: false,
        };

  cache.set(key, result);
  return result;
}

/** Пустая заглушка: предмет не найден — возвращаем пустой предмет, а не данные. */
function emptyGrade(): GradeContent {
  return { focus: "", operations: [], pitfalls: [], workingStyle: "" };
}

/**
 * Сводка по наполненности — для отчёта и для честной рекомендации.
 * Считает страницы тем, у которых содержание точное, и по диапазону.
 */
export function topicContentCoverage(
  gradesBySubject: Record<string, number[]>,
): { total: number; exact: number; band: number; missing: number } {
  let total = 0;
  let exact = 0;
  let band = 0;
  let missing = 0;
  for (const [slug, grades] of Object.entries(gradesBySubject)) {
    for (const grade of grades) {
      total++;
      const c = getTopicContent(slug, grade);
      if (!c || !c.filled) missing++;
      else if (c.match === "exact") exact++;
      else band++;
    }
  }
  return { total, exact, band, missing };
}
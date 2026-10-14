#!/usr/bin/env node
/**
 * Замер наполненности `topic-content` и различия страниц внутри класса.
 *
 * ЗАЧЕМ. Две цифры, которые нельзя назвать на глаз:
 *  1) сколько тем получают точную запись по своему классу, а сколько —
 *     диапазон (внутри класса такие страницы неразличимы);
 *  2) насколько страницы РАЗНЫХ тем одного класса отличаются друг от друга.
 *     Это и есть то, что видит поисковик: шаблон или содержание.
 *
 * Запуск: `npx tsx scripts/topic-coverage-measure.mts`
 *
 * Ничего не меняет — только читает таксономию и данные.
 */

import { subjects, allTopics } from "../src/lib/content/subjects";
import { getTopicContent, getTopicLayer } from "../src/lib/content/topic-content";

/** Медиана по массиву чисел. */
function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Разборрос внутри одной пары «предмет + класс».
 *
 * За длину страницы берём НЕ видимый HTML, а сам предметный текст: то, что
 * рендерят блоки страницы из `GradeContent` плюс примеры темы. Именно этот
 * текст отличался бы от страницы к странице, если данные есть.
 */
function gradePairSignature(subjectSlug: string, gradeNum: number): string {
  const c = getTopicContent(subjectSlug, gradeNum);
  if (!c || !c.filled) return "";
  return [
    c.grade.focus,
    c.grade.operations.join(" | "),
    c.grade.pitfalls.join(" | "),
    c.grade.workingStyle,
    c.subject.workKind,
    c.subject.worksheetLook,
    c.subject.exampleFraming,
    c.subject.lessonStages.map((s) => `${s.name}:${s.teacher}:${s.students}`).join(" | "),
    c.subject.slidePlan.map((s) => `${s.name}:${s.content}`).join(" | "),
    c.subject.equipment.join(" | "),
    c.subject.basePitfalls.join(" | "),
  ].join("\n");
}

let totalTopics = 0;
let exactTopics = 0;
let bandTopics = 0;
let missingTopics = 0;

const rows: Array<{
  slug: string;
  title: string;
  grades: number[];
  exactGrades: number[];
  topics: number;
  bandTopics: number;
}> = [];

console.log("=".repeat(96));
console.log("НАПОЛНЕННОСТЬ topic-content · таксономия subjects.ts");
console.log("=".repeat(96));
console.log(
  ["предмет", "классы предмета", "тем", "точн.", "диап."].join("  "),
);

for (const subject of subjects) {
  const grades = subject.grades.map((g) => g.num);
  let topics = 0;
  let exact = 0;
  let band = 0;
  let missing = 0;
  const exactGrades: number[] = [];

  for (const grade of grades) {
    const c = getTopicContent(subject.slug, grade);
    const gradeTopics = subject.grades.find((g) => g.num === grade)?.topics ?? [];
    topics += gradeTopics.length;
    if (!c || !c.filled) missing += gradeTopics.length;
    else if (c.match === "exact") {
      exact += gradeTopics.length;
      exactGrades.push(grade);
    } else band += gradeTopics.length;
  }

  totalTopics += topics;
  exactTopics += exact;
  bandTopics += band;
  missingTopics += missing;

  rows.push({
    slug: subject.slug,
    title: subject.title,
    grades,
    exactGrades,
    topics,
    bandTopics: band + missing,
  });

  console.log(
    [
      subject.slug.padEnd(14),
      grades.join(",").padEnd(26),
      String(topics).padStart(4),
      String(exact).padStart(6),
      String(band + missing).padStart(6),
    ].join("  "),
  );
}

console.log("-".repeat(96));
console.log(
  [
    "ИТОГО".padEnd(14),
    "".padEnd(26),
    String(totalTopics).padStart(4),
    String(exactTopics).padStart(6),
    String(bandTopics).padStart(6),
  ].join("  "),
);
const pct = (n: number) => `${((n / totalTopics) * 100).toFixed(1)}%`;
console.log(
  `  точно по классу ${exactTopics}/${totalTopics} (${pct(exactTopics)}) · через диапазон или пусто ${bandTopics}/${totalTopics} (${pct(bandTopics)})`,
);

// ---------------------------------------------------------------------------
// Различие страниц внутри одной пары «предмет + класс».
// ---------------------------------------------------------------------------

console.log("");
console.log("=".repeat(96));
console.log("РАЗЛИЧИЕ ТЕМ ВНУТРИ ОДНОЙ ПАРЫ «ПРЕДМЕТ + КЛАСС»");
console.log("=".repeat(96));
console.log(
  ["предмет", "класс", "тем", "разл. подписей", "разброс %"].join("  "),
);

const all = allTopics();
const pairs = new Map<string, typeof all>();
for (const item of all) {
  const key = `${item.subject.slug}/${item.grade}`;
  if (!pairs.has(key)) pairs.set(key, []);
  pairs.get(key)!.push(item);
}

const spreads: number[] = [];
let signaturesPerPair = 0;
for (const [key, items] of [...pairs.entries()].sort()) {
  const [slug, gradeNum] = key.split("/");
  const signatures = new Set<string>();
  const lens: number[] = [];
  for (const item of items) {
    const sig = gradePairSignature(slug, Number(gradeNum));
    // Второй слой: раздел ФГОС темы и соседние темы класса из него.
    const layer = getTopicLayer(slug, Number(gradeNum), item.topic);
    const topicSig = layer.filled
      ? `${sig}\n${layer.note}\n${layer.siblingTitles.join(" | ")}`
      : sig;
    signatures.add(topicSig);
    // Примеры темы — единственное, что различает страницы по ТЕМАМ внутри
    // одного класса. Считаем их в общий текст пары.
    lens.push(
      topicSig.length +
        item.topic.examples.map((e) => e.text).join(" ").length +
        item.topic.examples.map((e) => e.answer ?? "").join(" ").length,
    );
  }
  signaturesPerPair += signatures.size;
  const min = Math.min(...lens);
  const max = Math.max(...lens);
  const med = median(lens);
  const spread = ((max - min) / Math.max(med, 1)) * 100;
  spreads.push(spread);
  console.log(
    [
      slug.padEnd(14),
      gradeNum.padStart(3),
      String(items.length).padStart(4),
      `${String(signatures.size).padStart(3)}/${String(items.length).padEnd(3)}`,
      `${spread.toFixed(1)}%`.padStart(9),
    ].join("  "),
  );
}

console.log("-".repeat(96));
console.log(
  `Медианный разброс текста внутри пары «предмет + класс»: ${median(spreads).toFixed(1)}%`,
);
console.log(
  `Разных подписей внутри пар: ${signaturesPerPair} на ${pairs.size} пар · в среднем ${(signaturesPerPair / pairs.size).toFixed(2)} подписей на пару`,
);
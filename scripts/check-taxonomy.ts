/**
 * Быстрая проверка инвариантов таксономии без vitest/jsdom.
 *
 * Запуск: npx tsx scripts/check-taxonomy.ts
 * Полезен на этапе наполнения данных: vitest на этой машине стартует
 * дольше минуты из-за jsdom, а править 40+ файлов тем вслепую нельзя.
 * Те же проверки продублированы в tests/taxonomy-completeness.test.ts —
 * этот скрипт не заменяет тест, а ускоряет цикл правки.
 */

import { subjects, getSubject, getGrade, getTopic } from "../src/lib/content/subjects";
import { GRADE_EXTENSIONS } from "../src/lib/content/grade-extensions";
import { umk, getUMK } from "../src/lib/content/umk";
import { WEEKLY_TOPICS } from "../src/lib/content/weekly-topics";
import type { SubjectSlug } from "../src/lib/types";

const EXPECTED_COVERAGE: Record<SubjectSlug, number[]> = {
  math: [1, 2, 3, 4, 5, 6],
  algebra: [7, 8, 9, 10, 11],
  geometry: [7, 8, 9, 10, 11],
  russian: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  literature: [5, 6, 7, 8, 9, 10, 11],
  english: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  german: [5, 6, 7, 8, 9, 10, 11],
  informatics: [5, 6, 7, 8, 9, 10, 11],
  physics: [7, 8, 9, 10, 11],
  chemistry: [8, 9, 10, 11],
  biology: [5, 6, 7, 8, 9, 10, 11],
  geography: [5, 6, 7, 8, 9, 10, 11],
  history: [5, 6, 7, 8, 9, 10, 11],
  social: [6, 7, 8, 9, 10, 11],
  okruzhaet: [1, 2, 3, 4],
  obzh: [5, 6, 7, 8, 9, 10, 11],
  technology: [5, 6, 7, 8, 9],
  finance: [7, 8, 9],
  music: [1, 2, 3, 4, 5, 6, 7, 8],
  art: [1, 2, 3, 4, 5, 6, 7, 8],
  pe: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const problems: string[] = [];

// 1. Предметы
for (const slug of Object.keys(EXPECTED_COVERAGE)) {
  if (!getSubject(slug as SubjectSlug)) problems.push(`нет предмета: ${slug}`);
}
for (const s of subjects) {
  if (!Object.keys(EXPECTED_COVERAGE).includes(s.slug)) problems.push(`предмет вне матрицы: ${s.slug}`);
  if ((umk[s.slug] ?? []).length === 0) problems.push(`нет УМК: ${s.slug}`);
}
for (const key of Object.keys(GRADE_EXTENSIONS)) {
  if (!Object.keys(EXPECTED_COVERAGE).includes(key)) problems.push(`GRADE_EXTENSIONS: неизвестный ключ ${key}`);
}

// 1b. Ссылочная целостность «Темы недели» → темы в таксономии
for (const t of WEEKLY_TOPICS) {
  if (!getTopic(t.subject as SubjectSlug, t.grade, t.topicSlug)) {
    problems.push(`тема недели "${t.seoSlug}" ссылается на несуществующую тему: /subject/${t.subject}/${t.grade}/${t.topicSlug}`);
  }
}

// 1c. УМК не выходят за диапазон классов своего предмета
for (const s of subjects) {
  const nums = s.grades.map((g) => g.num);
  const from = Math.min(...nums);
  const to = Math.max(...nums);
  for (const u of umk[s.slug] ?? []) {
    if (u.grades?.some((gr) => gr < from || gr > to)) {
      problems.push(`УМК ${s.slug}/${u.id}: grades=${u.grades?.join(",")} вне диапазона ${from}-${to}`);
    }
  }
  for (const g of nums) {
    const n = getUMK(s.slug, g).length;
    if (n < 3) problems.push(`${s.slug}/${g}: всего ${n} УМК (нужно ≥3)`);
  }
}

// 2. Классы
for (const [slug, expected] of Object.entries(EXPECTED_COVERAGE)) {
  const subject = getSubject(slug as SubjectSlug);
  if (!subject) continue;
  const nums = subject.grades.map((g) => g.num);
  const missing = expected.filter((g) => !nums.includes(g));
  const extra = nums.filter((n) => !expected.includes(n));
  const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
  if (missing.length) problems.push(`${slug}: нет классов ${missing.join(",")}`);
  if (extra.length) problems.push(`${slug}: лишние классы ${extra.join(",")}`);
  if (dupes.length) problems.push(`${slug}: дубли классов ${dupes.join(",")}`);
  const sorted = [...nums].sort((a, b) => a - b);
  if (nums.join() !== sorted.join()) problems.push(`${slug}: классы не отсортированы (${nums.join()})`);
}

// 3. Темы
let topicCount = 0;
let exampleCount = 0;
for (const s of subjects) {
  for (const g of s.grades) {
    if (g.topics.length < 5) problems.push(`${s.slug}/${g.num}: всего ${g.topics.length} тем (нужно ≥5)`);
    const slugs = g.topics.map((t) => t.slug);
    for (const d of slugs.filter((n, i) => slugs.indexOf(n) !== i)) {
      problems.push(`${s.slug}/${g.num}: дубль slug "${d}"`);
    }
    for (const t of g.topics) {
      topicCount++;
      exampleCount += t.examples?.length ?? 0;
      if (!t.title || t.title.trim().length < 3) problems.push(`${s.slug}/${g.num}/${t.slug}: пустой title`);
      // ВАЖНО: не требуем slug === slugify(title). У исторических тем slug
      // ручные и осмысленные ("drobi-obyknovennye", "m-fsu-7"), они уже в
      // индексе поисковиков — переименование сломает живые URL. Проверяем
      // только, что slug пригоден для URL-сегмента.
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug)) {
        problems.push(`${s.slug}/${g.num}: slug "${t.slug}" непригоден для URL`);
      }
      if (t.examples && t.examples.length < 2) {
        problems.push(
          `${s.slug}/${g.num}/${t.slug}: примеров ${t.examples.length}, нужно ≥2 ` +
            `→ дописать в src/lib/content/topic-examples-extra/`,
        );
      }
      for (const [i, ex] of (t.examples ?? []).entries()) {
        if (!ex.text || ex.text.trim().length < 3) {
          problems.push(`${s.slug}/${g.num}/${t.slug}: пустой текст примера #${i + 1}`);
        }
      }
      if (!getTopic(s.slug, g.num, t.slug)) problems.push(`getTopic не нашёл ${s.slug}/${g.num}/${t.slug}`);
    }
  }
}

const pairs = subjects.reduce((n, s) => n + s.grades.length, 0);
const expectedPairs = Object.values(EXPECTED_COVERAGE).reduce((n, g) => n + g.length, 0);

console.log("=== ПОКРЫТИЕ ===");
for (const [slug, expected] of Object.entries(EXPECTED_COVERAGE)) {
  const s = getSubject(slug as SubjectSlug);
  const have = s ? s.grades.map((g) => g.num) : [];
  const topics = s ? s.grades.reduce((n, g) => n + g.topics.length, 0) : 0;
  const ok = have.length === expected.length;
  console.log(
    `${ok ? "OK  " : "ДЫРА"} ${slug.padEnd(12)} классов ${String(have.length).padStart(2)}/${expected.length}` +
      `  тем ${String(topics).padStart(3)}  УМК ${(umk[slug] ?? []).length}` +
      (ok ? "" : `  ← нет: ${expected.filter((g) => !have.includes(g)).join(",")}`),
  );
}

console.log(
  `\nИТОГО: предметов ${subjects.length}, пар ${pairs}/${expectedPairs}, тем ${topicCount}, примеров ${exampleCount}`,
);

if (problems.length) {
  console.log(`\n=== ПРОБЛЕМЫ (${problems.length}) ===`);
  const byKind: Record<string, number> = {};
  for (const p of problems) {
    const k = p.includes("всего") ? "мало тем в классе" : p.includes("УМК") ? "УМК" : p.includes("тема недели") ? "тема недели" : "прочее";
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  console.log(" По видам:", JSON.stringify(byKind));
  for (const p of problems) console.log(" -", p);
  process.exit(1);
} else {
  console.log("\nВсе инварианты в порядке.");
}

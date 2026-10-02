/**
 * Аудит покрытия таксономии: какие предметы/классы/темы есть, а какие нет.
 *
 * Запуск: npx tsx scripts/audit-coverage.ts
 * Печатает markdown-таблицу и JSON-сводку для последующей обработки.
 */

import { subjects } from "../src/lib/content/subjects";
import { umk } from "../src/lib/content/umk";

const EXPECTED: Record<string, number[]> = {
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
  obzh: [8, 9, 10, 11],
  technology: [5, 6, 7, 8, 9],
  finance: [7, 8, 9],
  music: [1, 2, 3, 4, 5, 6, 7, 8],
  art: [1, 2, 3, 4, 5, 6, 7, 8],
  pe: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const rows: string[] = [];
let totalGrades = 0;
let totalTopics = 0;
const missingSubjects: string[] = [];
const missingGrades: string[] = [];

rows.push("| Предмет | УМК | Классы (есть/ожидается) | Тем | Дыры |");
rows.push("|---|---|---|---|---|");

for (const [slug, expected] of Object.entries(EXPECTED)) {
  const subject = subjects.find((s) => s.slug === slug);
  if (!subject) {
    missingSubjects.push(slug);
    rows.push(`| ${slug} | ${(umk[slug] ?? []).length} | 0/${expected.length} | 0 | **ПРЕДМЕТ ОТСУТСТВУЕТ** |`);
    continue;
  }
  const have = subject.grades.map((g) => g.num).sort((a, b) => a - b);
  const gaps = expected.filter((g) => !have.includes(g));
  const extra = have.filter((g) => !expected.includes(g));
  const topics = subject.grades.reduce((n, g) => n + g.topics.length, 0);
  totalGrades += have.length;
  totalTopics += topics;
  if (gaps.length) missingGrades.push(`${slug}: нет ${gaps.join(",")}`);
  const umkCount = (umk[slug] ?? []).length;
  rows.push(
    `| ${slug} | ${umkCount} | ${have.length}/${expected.length} | ${topics} | ${
      gaps.length ? `**нет ${gaps.join(",")}**` : "—"
    }${extra.length ? ` лишние:${extra.join(",")}` : ""} |`,
  );
}

console.log(rows.join("\n"));
console.log(`\n**Итого:** предметов ${subjects.length}, пар (предмет,класс) ${totalGrades}, тем ${totalTopics}`);
if (missingSubjects.length) console.log(`\nОтсутствуют предметы: ${missingSubjects.join(", ")}`);
if (missingGrades.length) console.log(`\nДыры в классах:\n- ${missingGrades.join("\n- ")}`);

// Темы без примеров
let noExamples = 0;
for (const s of subjects)
  for (const g of s.grades) for (const t of g.topics) if (!t.examples || t.examples.length === 0) noExamples++;
console.log(`\nТем без примеров заданий: ${noExamples}`);

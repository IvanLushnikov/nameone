#!/usr/bin/env node
/**
 * Сверка таксономии тем с эталоном из федеральных рабочих программ.
 *
 * ЗАЧЕМ. `src/lib/content/subjects.ts` — это то, что видит посетитель сайта.
 * `data/fgos/topics.json` — то, что требует федеральная рабочая программа.
 * Этот скрипт ставит одно рядом с другим и показывает разницу по каждой паре
 * «предмет + класс»: сколько тем есть у нас, сколько должно быть и какого
 * объёма не хватает.
 *
 * ЗАПУСК.
 *   npx tsx scripts/topic-gap-audit.mts              # вся таблица
 *   npx tsx scripts/topic-gap-audit.mts --subject russian
 *   npx tsx scripts/topic-gap-audit.mts --worst 15   # самые пустые пары
 *   npx tsx scripts/topic-gap-audit.mts --examples 8 # показать примеры недостающих тем
 *
 * Что означают пометки:
 *   «нет эталона» — по этому предмету федеральной рабочей программы нет
 *     (например, финансовая грамотность — это курс внеурочной деятельности);
 *   «источник не отдал текст» — программа есть, но её текст не удалось получить
 *     постранично. Это дыра в сборе, а не в таксономии, и разбираться с ней
 *     нужно отдельно.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { subjects } from "../src/lib/content/subjects";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF_FILE = path.join(ROOT, "data", "fgos", "topics.json");

const args = process.argv.slice(2);
const only = argValue("--subject");
const worstN = Number(argValue("--worst") ?? "0");
const examplesN = Number(argValue("--examples") ?? "0");

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const ref = JSON.parse(readFileSync(REF_FILE, "utf8"));
const refSubjects = ref.subjects as Record<string, Record<string, { topics: string[]; sources: any[] }>>;
const noSource = new Set<string>(ref.noSource ?? []);

// Пары, по которым эталон не собрался: предмет + класс, разобранные из
// списков недоступных страниц и несобранных разделов.
const unresolved = new Set<string>();
for (const line of [...(ref.unavailable ?? []), ...(ref.missing ?? [])]) {
  const m = line.match(/^(\w+)\s+—\s+(\w+)\/(\d+)(?:\.(\d+))?(?:\s+класс\s+(\d+))?/);
  if (!m) continue;
  const [, slug, , , , grade] = m;
  const doc = m[2];
  const grades = doc === "noo" ? [1, 2, 3, 4] : doc === "ooo" ? [5, 6, 7, 8, 9] : [10, 11];
  const targets = grade ? [Number(grade)] : grades;
  for (const g of targets) unresolved.add(`${slug}:${g}`);
}
// В самой программе раздела нет — например, информатика начинается с 7 класса.
const absentInProgram = new Set<string>();
for (const line of ref.notInProgram ?? []) {
  const m = line.match(/^(\w+)\s+—\s+класс\s+(\d+)/);
  if (m) absentInProgram.add(`${m[1]}:${Number(m[2])}`);
}

interface Row {
  slug: string;
  title: string;
  grade: number;
  ours: number;
  ref: number | null;
  note: string;
}

const rows: Row[] = [];
for (const s of subjects) {
  for (const g of s.grades) {
    const rec = refSubjects[s.slug]?.[String(g.num)];
    let note = "";
    if (rec) note = rec.sources.some((x: any) => x.shared) ? "общее на весь уровень" : "";
    else if (noSource.has(s.slug)) note = "нет федеральной программы";
    else if (absentInProgram.has(`${s.slug}:${g.num}`)) note = "в программе этого класса нет";
    else if (unresolved.has(`${s.slug}:${g.num}`)) note = "источник не отдал текст";
    else note = "нет эталона";
    rows.push({
      slug: s.slug,
      title: s.title,
      grade: g.num,
      ours: g.topics.length,
      ref: rec ? rec.topics.length : null,
      note,
    });
  }
}

const covered = rows.filter((r) => r.ref !== null);
const ourTopicsTotal = rows.reduce((a, r) => a + r.ours, 0);
const refTopicsTotal = covered.reduce((a, r) => a + (r.ref ?? 0), 0);

console.log("=".repeat(94));
console.log("ДЫРЫ В ТЕМАХ: что есть на сайте против федеральной рабочей программы");
console.log("=".repeat(94));
console.log(`пар «предмет + класс» всего:            ${rows.length}`);
console.log(`пар, где эталон есть:                    ${covered.length}`);
console.log(`пар, где эталон не собран:               ${rows.length - covered.length}`);
console.log(`тем на сайте:                            ${ourTopicsTotal}`);
console.log(`тем в федеральной программе (по собранным парам): ${refTopicsTotal}`);
console.log();

function table(list: Row[]) {
  console.log(["Предмет".padEnd(11), "Кл".padStart(2), "у нас".padStart(6), "в программе".padStart(11), "не хватает".padStart(10), "наше/прод".padStart(10), "  примечание"].join(" "));
  for (const r of list) {
    const ratio = r.ref ? `${Math.round((r.ours / r.ref) * 100)}%` : "—";
    const lack = r.ref !== null ? String(Math.max(0, r.ref - r.ours)) : "";
    console.log(
      [
        r.slug.padEnd(11),
        String(r.grade).padStart(2),
        String(r.ours).padStart(6),
        r.ref !== null ? String(r.ref).padStart(11) : "—".padStart(11),
        lack.padStart(10),
        ratio.padStart(10),
        "  " + r.note,
      ].join(" "),
    );
  }
}

if (only) {
  const list = rows.filter((r) => r.slug === only);
  if (list.length === 0) {
    console.error(`предмет «${only}» не найден в таксономии`);
    process.exit(1);
  }
  table(list);
  console.log();
} else if (worstN > 0) {
  const list = [...covered].sort((a, b) => a.ours / (a.ref ?? 1) - b.ours / (b.ref ?? 1)).slice(0, worstN);
  console.log(`САМЫЕ ПУСТЫЕ ПАРЫ ИЗ ${covered.length}\n`);
  table(list);
  console.log();
} else {
  const slugs = [...new Set(rows.map((r) => r.slug))].sort();
  for (const slug of slugs) {
    const list = rows.filter((r) => r.slug === slug);
    const totalOurs = list.reduce((a, r) => a + r.ours, 0);
    const withRef = list.filter((r) => r.ref !== null);
    const totalRef = withRef.reduce((a, r) => a + (r.ref ?? 0), 0);
    console.log(`--- ${slug} — тем на сайте ${totalOurs}, в программе ${totalRef} (по ${withRef.length} из ${list.length} пар) ---`);
    table(list);
    console.log();
  }
}

// Примеры недостающих тем: наши темы, которых нет в тексте программы.
if (examplesN > 0) {
  console.log("=".repeat(94));
  console.log("ТЕМЫ, КОТОРЫХ НЕТ В ФЕДЕРАЛЬНОЙ ПРОГРАММЕ");
  console.log("=".repeat(94));
  let left = examplesN;
  for (const r of covered) {
    if (r.ref === null) continue;
    const rec = refSubjects[r.slug][String(r.grade)];
    if (!rec) continue;
    const prog = rec.topics.map((t) => t.toLowerCase()).join(" | ");
    const subject = subjects.find((s) => s.slug === r.slug)!;
    const grade = subject.grades.find((g) => g.num === r.grade)!;
    const foreign = grade.topics
      .map((t) => t.title)
      .filter((title) => {
        const t = title.toLowerCase();
        const words = t.split(/[^а-яёa-z]+/).filter((w) => w.length >= 5);
        return words.length > 0 && !words.some((w) => prog.includes(w));
      });
    if (foreign.length === 0) continue;
    console.log(`${r.slug} ${r.grade} кл — не найдено в программе: ${foreign.join("; ")}`);
    if (--left <= 0) break;
  }
  console.log();
}

console.log("GAP-AUDIT-OK");
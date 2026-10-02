/**
 * Аудит покрытия УМК: для каждого предмета сколько учебников доступно
 * в каждом классе. Пустой класс = учитель этого предмета в этом классе
 * не найдёт ни одного УМК для фильтра.
 *
 * Запуск: npx tsx scripts/audit-umk.ts
 */

import { umk, getUMK } from "../src/lib/content/umk";
import { subjects } from "../src/lib/content/subjects";
import type { SubjectSlug } from "../src/lib/types";

console.log("=== УМК по классам (1-11) ===\n");

// Проверяем только те пары (предмет, класс), которые реально есть в таксономии.
// Класс, где предмет не преподаётся, — не дыра.
const thin: string[] = [];
const spill: string[] = [];
const thinGrade: string[] = [];
for (const s of subjects) {
  const realGrades = s.grades.map((g) => g.num);
  const counts: string[] = [];
  for (let g = 1; g <= 11; g++) {
    const n = getUMK(s.slug, g).length;
    counts.push(n > 0 ? String(n) : "·");
    if (realGrades.includes(g) && n === 0) thin.push(`${s.slug}/${g}`);
    if (realGrades.includes(g) && n < 3) thinGrade.push(`${s.slug}/${g}: ${n} УМК`);
  }
  // УМК, вылезающие за пределы классов предмета, — фильтр будет врать.
  const from = Math.min(...realGrades);
  const to = Math.max(...realGrades);
  for (const u of umk[s.slug] ?? []) {
    if (u.grades?.some((gr) => gr < from || gr > to)) {
      spill.push(`${s.slug}/${u.id}: grades=${u.grades?.join(",")} вне ${from}-${to}`);
    }
  }
  console.log(`${s.slug.padEnd(12)} всего=${String((umk[s.slug] ?? []).length).padStart(2)}  1..11 = ${counts.join(" ")}`);
}

console.log("\n=== Пары (предмет, класс) без УМК ===");
if (thin.length === 0) {
  console.log("нет — все пары покрыты");
} else {
  for (const t of thin) console.log(" -", t);
}

// Предметы без единого УМК
const noUMK = subjects.filter((s) => (umk[s.slug] ?? []).length === 0);
console.log(`\n=== Пары с меньше чем 3 УМК ===`);
console.log(thinGrade.length ? thinGrade.join("\n") : "нет — у всех пар ≥3 УМК");

console.log(`\n=== УМК вне диапазона классов предмета ===`);
console.log(spill.length ? spill.join("\n") : "нет");

console.log(`\nПредметов без УМК: ${noUMK.length ? noUMK.map((s) => s.slug).join(", ") : "нет"}`);

// УМК, объявленные вне наших предметов
const known = new Set(subjects.map((s) => s.slug as SubjectSlug));
const orphan = Object.keys(umk).filter((k) => !known.has(k as SubjectSlug));
console.log(`УМК для неизвестных предметов: ${orphan.length ? orphan.join(", ") : "нет"}`);

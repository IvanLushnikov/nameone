#!/usr/bin/env node
/**
 * Подборка тем для вычитки заданий.
 *
 * ЗАЧЕМ. Задания написаны моделью по содержанию федеральной программы, а не
 * взяты из неё. В пилоте на 150 заданий нашлась одна ошибка — примерно одна на
 * 150. Прежде чем выкатывать 15 тысяч заданий учителям, нужно понять реальную
 * долю брака и починить то, что чинится.
 *
 * ЗАЧЕМ ИМЕННО ВЫБОРКА. Тем 7251, заданий больше 15000 — вычитать всё целиком
 * дорого и долго. Берём равномерную выборку по каждому предмету: так ошибки
 * находятся и в начале списка, и в конце, а не только там, где агент устал.
 *
 * ЗАЧЕМ АГЕНТ НЕ ПРАВИТ ФАЙЛ САМ. Ошибка в проверке испортит контент сильнее,
 * чем ошибка в задании: агент может «исправить» верное задание и сломать
 * пример. Поэтому агент только отмечает проблемы и пишет предложение в
 * отдельный файл, а применение делает сборка с проверкой инвариантов.
 *
 * ЗАПУСК. node scripts/fgos/make-review-sample.mjs [тем на предмет]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "src", "lib", "content", "grade-extensions", "fgos-program", "data.json");
const OUT_DIR = path.join(ROOT, "work", "fgos", "review");
const FIX_DIR = path.join(ROOT, "data", "fgos", "review-fixes");

const PER_SUBJECT = Number(process.argv[2] ?? 12);

const data = JSON.parse(readFileSync(DATA, "utf8"));

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(FIX_DIR, { recursive: true });

/** Равномерная выборка: шаг по всему списку, а не первые N. */
function spread(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

let totalTopics = 0;
let totalExamples = 0;
const report = [];

for (const [subject, grades] of Object.entries(data)) {
  const picked = [];
  for (const g of grades) {
    for (const t of spread(g.topics, Math.max(1, Math.ceil(PER_SUBJECT / grades.length)))) {
      picked.push({ grade: g.num, slug: t.slug, title: t.title, examples: t.examples });
    }
  }
  const capped = picked.slice(0, PER_SUBJECT);
  const nEx = capped.reduce((a, t) => a + (t.examples?.length ?? 0), 0);
  totalTopics += capped.length;
  totalExamples += nEx;
  report.push({ subject, topics: capped.length, examples: nEx });
  writeFileSync(
    path.join(OUT_DIR, `${subject}.json`),
    JSON.stringify({ subject, topics: capped }, null, 1),
    "utf8",
  );
}

console.log(`выборка готова: ${Object.keys(data).length} предметов, ${totalTopics} тем, ${totalExamples} заданий`);
console.log(`папка с выборками: ${path.relative(ROOT, OUT_DIR)}`);
console.log(`папка для исправлений: ${path.relative(ROOT, FIX_DIR)}`);
console.log();
for (const r of report) console.log(`  ${r.subject.padEnd(12)} ${r.topics} тем, ${r.examples} заданий`);

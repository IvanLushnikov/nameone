#!/usr/bin/env node
/**
 * Разбивка плана дололива на куски для саб-агентов.
 *
 * ЗАЧЕМ. Доливать надо не только задания, но и названия тем: в федеральной
 * программе по гуманитарным предметам тема записана предложением («Приставка.
 * Написание приставок.»), а на сайте тема называется коротко («Приставка»).
 * Значит агент получает высказывание программы и возвращает название темы и
 * два задания к ней.
 *
 * Кусок — это одна пара «предмет + класс» либо её часть, не больше
 * MAX_TOPICS высказываний. Мелкие куски нужны, чтобы агент отвечал за один
 * заход и не молчал на середине.
 *
 * ЗАПУСК. node scripts/fgos/split-plan.mjs
 * ВЫВОД. work/fgos/chunks/*.json
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN_FILE = path.join(ROOT, "work", "fgos", "plan.json");
const OUT_DIR = path.join(ROOT, "work", "fgos", "chunks");

const MAX_TOPICS = 75;

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8"));

if (plan.topics.length === 0) {
  console.error("план пуст — нечего разбивать");
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

/** Сколько кусков у одного предмета — для оценки объёма работы. */
const byPair = new Map();
for (const t of plan.topics) {
  const key = `${t.subject}:${t.grade}`;
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(t);
}

const chunks = [];
for (const [key, items] of [...byPair.entries()].sort()) {
  for (let i = 0; i < items.length; i += MAX_TOPICS) {
    const slice = items.slice(i, i + MAX_TOPICS);
    const [subject, grade] = key.split(":");
    const part = Math.floor(i / MAX_TOPICS) + 1;
    const total = Math.ceil(items.length / MAX_TOPICS);
    const name = `${subject}-${grade}${total > 1 ? `-part${part}` : ""}`;
    chunks.push({
      name,
      subject,
      grade: Number(grade),
      part,
      totalParts: total,
      sourceProgram: items[0].programSection,
      sourceUrl: items[0].sourceUrl,
      statements: slice.map((t) => ({ title: t.title, fgosRef: t.fgosRef })),
    });
  }
}

for (const c of chunks) {
  writeFileSync(path.join(OUT_DIR, `${c.name}.json`), JSON.stringify(c, null, 1), "utf8");
}

const bySubject = {};
for (const c of chunks) bySubject[c.subject] = (bySubject[c.subject] ?? 0) + 1;

console.log(`кусков: ${chunks.length} (по ${MAX_TOPICS} высказываний максимум)`);
console.log(`высказываний всего: ${plan.topics.length}`);
console.log("\nкусков по предметам:");
for (const [k, v] of Object.entries(bySubject).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v}`);
}
console.log(`\nпапка: ${path.relative(ROOT, OUT_DIR)}`);
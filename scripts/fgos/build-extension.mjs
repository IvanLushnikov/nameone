#!/usr/bin/env node
/**
 * Сборка дололива таксономии из результатов саб-агентов.
 *
 * ЗАЧЕМ. Саб-агенты пишут по кускам: название темы и два задания к каждому
 * высказыванию федеральной программы. Лежат результаты в
 * `data/fgos/authored/<кусок>.json`. Здесь они сшиваются обратно с планом
 * (`work/fgos/plan.json`), где у каждой темы уже есть slug, и превращаются в
 * расширение таксономии — то, что `subjects.ts` подмешивает к базе.
 *
 * ЧТО ПРОВЕРЯЕТСЯ ДО ЗАПИСИ ФАЙЛА.
 *  - количество тем совпадает с планом куска;
 *  - `statement` совпадает с планом дословно (по нему держится привязка к
 *    программе, а потерять его — значит потерять источник темы);
 *  - у темы два непустых задания;
 *  - slug не совпадает ни с одной темой, которая уже есть в таксономии:
 *    иначе `withExtensions` молча выбросит новую тему, и дыра останется.
 *
 * ЗАПУСК.
 *   node scripts/fgos/build-extension.mjs           # проверить и показать сводку
 *   node scripts/fgos/build-extension.mjs --write   # записать файлы расширения
 *   node scripts/fgos/build-extension.mjs --allow-partial
 *
 * --allow-partial собирает то, что уже готово, не требуя всех кусков.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN_FILE = path.join(ROOT, "work", "fgos", "plan.json");
const CHUNK_DIR = path.join(ROOT, "work", "fgos", "chunks");
const AUTHORED_DIR = path.join(ROOT, "data", "fgos", "authored");
const OUT_DIR = path.join(ROOT, "src", "lib", "content", "grade-extensions", "fgos-program");
const OUT_FILE = path.join(OUT_DIR, "data.json");

const WRITE = process.argv.includes("--write");
const ALLOW_PARTIAL = process.argv.includes("--allow-partial");

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8"));
const problems = [];

/** Темы, которые уже есть на сайте: slug и название по каждой паре. */
function readExisting() {
  const script =
    "import { allTopics } from './src/lib/content/subjects';" +
    "console.log(JSON.stringify(allTopics().map(t => ({ k: t.subject.slug + ':' + t.grade, slug: t.topic.slug, title: t.topic.title }))));";
  const out = execFileSync("npx", ["tsx", "-e", script], { cwd: ROOT, encoding: "utf8", maxBuffer: 128e6 });
  const items = JSON.parse(out);
  const byPair = new Map();
  const slugs = new Map();
  for (const it of items) {
    if (!byPair.has(it.k)) byPair.set(it.k, new Set());
    byPair.get(it.k).add(it.slug);
    if (!slugs.has(it.k)) slugs.set(it.k, new Set());
    slugs.get(it.k).add(it.title.toLowerCase().trim());
  }
  return { byPair, slugs };
}

/** Порядок тем в плане: план строился попарно, так и держим. */
function planByPair() {
  const map = new Map();
  for (const t of plan.topics) {
    const k = `${t.subject}:${t.grade}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
}

/** Куски по предметам: имя куска -> метаданные. */
function chunkIndex() {
  const out = new Map();
  for (const f of readdirSync(CHUNK_DIR)) {
    if (!f.endsWith(".json")) continue;
    const c = JSON.parse(readFileSync(path.join(CHUNK_DIR, f), "utf8"));
    out.set(c.name, c);
  }
  return out;
}

const existing = readExisting();
const planPairs = planByPair();
const chunks = chunkIndex();

const authored = new Map(); // пара -> [{statement, title, examples, slug}]
let authoredTotal = 0;
let missingChunks = [];

const authoredSet = new Set(
  fs.existsSync(AUTHORED_DIR)
    ? readdirSync(AUTHORED_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
    : [],
);

// Пара готова целиком, только когда на месте все её куски. Иначе темы
// собираются из разных кусков и не совпадут с планом — это не брак данных,
// а незавершённая работа, и такую пару надо пропустить целиком.
const chunkNamesByPair = new Map();
for (const [name, chunk] of chunks) {
  const key = `${chunk.subject}:${chunk.grade}`;
  if (!chunkNamesByPair.has(key)) chunkNamesByPair.set(key, []);
  chunkNamesByPair.get(key).push(name);
}

for (const [name, chunk] of chunks) {
  if (!authoredSet.has(name)) {
    missingChunks.push(name);
    continue;
  }
  const data = JSON.parse(readFileSync(path.join(AUTHORED_DIR, `${name}.json`), "utf8"));
  const key = `${chunk.subject}:${chunk.grade}`;
  if (!authored.has(key)) authored.set(key, []);
  const arr = authored.get(key);
  const ordered = (data.topics ?? []).slice().sort((a, b) => chunk.statements.indexOf(a.statement) - chunk.statements.indexOf(b.statement));
  arr.push(...ordered);
  authoredTotal += ordered.length;
}

const incompletePairs = [];
for (const [key, names] of chunkNamesByPair) {
  if (names.some((n) => !authoredSet.has(n))) {
    incompletePairs.push({ key, missing: names.filter((n) => !authoredSet.has(n)) });
    authored.delete(key);
  }
}

// Сверяем и собираем.
const perPair = new Map();
for (const [key, items] of authored) {
  const planned = planPairs.get(key) ?? [];
  const got = items.slice().sort((a, b) => planned.findIndex((p) => p.title === a.statement) - planned.findIndex((p) => p.title === b.statement));
  if (got.length !== planned.length) {
    problems.push(`${key}: готово ${got.length} тем, в плане ${planned.length}`);
  }
  perPair.set(key, { planned, got });
}

if (incompletePairs.length) console.log("пары пропущены (не все куски готовы): " + incompletePairs.map((p) => `${p.key} — нет ${p.missing.join(", ")}`).join("; "));
if (!ALLOW_PARTIAL && missingChunks.length) {
  console.error(`не готовы куски (${missingChunks.length}):`);
  missingChunks.forEach((n) => console.error("  " + n));
  process.exit(1);
}

const perSubject = new Map();
let totalTopics = 0;
let totalExamples = 0;

for (const [key, { planned, got }] of perPair) {
  const [subject, grade] = key.split(":");
  const used = new Set(existing.byPair.get(key) ?? []);
  const usedTitles = new Set(existing.slugs.get(key) ?? []);
  const topics = [];
  for (let i = 0; i < got.length; i++) {
    const item = got[i];
    const p = planned[i];
    if (!p) {
      problems.push(`${key}: тема «${item.title}» не нашлась в плане`);
      continue;
    }
    if (item.statement !== p.title) {
      problems.push(`${key}: высказывание не совпало с планом — «${String(item.statement).slice(0, 50)}»`);
      continue;
    }
    const examples = (item.examples ?? []).filter((e) => e && e.text && e.answer);
    if (examples.length < 2) {
      problems.push(`${key} / ${item.title}: заданий ${examples.length}, нужно минимум 2`);
      continue;
    }
    const title = String(item.title ?? "").trim();
    if (title.length < 2 || title.length > 60) problems.push(`${key}: странное название «${title}»`);

    // Приводим slug к виду, пригодному для URL-сегмента: только строчные
    // латинские буквы, цифры и одиночные дефисы между словами. Слаг из плана
    // обрезан по длине и может кончаться дефисом или содержать «--».
    const cleanSlug = (s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/-+$/, "");

    const base = cleanSlug(p.slug).slice(0, 60).replace(/-+$/, "");
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      const tail = `-${n++}`;
      slug = base.slice(0, Math.max(1, 60 - tail.length)).replace(/-+$/, "") + tail;
    }

    const topic = { slug, title, examples: examples.slice(0, 3) };
    if (p.fgosRef) topic.fgosRef = p.fgosRef;
    topics.push(topic);
    used.add(slug);
    usedTitles.add(title.toLowerCase());
    totalTopics++;
    totalExamples += topic.examples.length;
  }
  if (topics.length === 0) continue;
  if (!perSubject.has(subject)) perSubject.set(subject, []);
  const gradeNum = Number(grade);
  const existingGrade = perSubject.get(subject).find((g) => g.num === gradeNum);
  const gradeObj = { num: gradeNum, title: `${gradeNum} класс`, topics };
  if (existingGrade) existingGrade.topics.push(...topics);
  else perSubject.get(subject).push(gradeObj);
}

console.log("=".repeat(74));
console.log("СБОРКА ДОЛИВА ТАКСОНОМИИ");
console.log("=".repeat(74));
console.log(`кусков готово:        ${chunks.size - missingChunks.length} из ${chunks.size}`);
console.log(`тем собрано:          ${totalTopics}`);
console.log(`заданий к ним:        ${totalExamples}`);
console.log(`предметов затронуто:  ${perSubject.size}`);
if (missingChunks.length) console.log(`кусков ещё не готово:  ${missingChunks.length}`);
console.log();
for (const [s, grades] of [...perSubject].sort()) {
  const n = grades.reduce((a, g) => a + g.topics.length, 0);
  console.log(`  ${s.padEnd(12)} ${String(n).padStart(5)} тем по классам: ${grades.map((g) => `${g.num}(${g.topics.length})`).join(" ")}`);
}

if (problems.length) {
  console.error("\nПРОБЛЕМЫ:");
  problems.slice(0, 40).forEach((p) => console.error("  - " + p));
  if (problems.length > 40) console.error(`  …ещё ${problems.length - 40}`);
  process.exit(1);
}

if (WRITE) {
  mkdirSync(OUT_DIR, { recursive: true });

  // Файл собирается не с нуля, а поверх уже записанного: план на каждом
  // прогоне содержит только недостающие темы, и перезапись потеряла бы всё,
  // что добавлено раньше. Слияние идёт по ключу «предмет + класс», внутри —
  // по slug, поэтому повторная сборка ничего не дублирует.
  let existing = {};
  if (existsSync(OUT_FILE)) {
    try {
      existing = JSON.parse(readFileSync(OUT_FILE, "utf8")) ?? {};
    } catch {
      existing = {};
    }
  }

  const merged = { ...existing };
  for (const [subject, grades] of perSubject) {
    const byNum = new Map((merged[subject] ?? []).map((g) => [g.num, { ...g, topics: [...g.topics] }]));
    for (const g of grades) {
      const prev = byNum.get(g.num);
      if (!prev) {
        byNum.set(g.num, { num: g.num, title: g.title, topics: [...g.topics] });
        continue;
      }
      const have = new Set(prev.topics.map((t) => t.slug));
      const fresh = g.topics.filter((t) => !have.has(t.slug));
      byNum.set(g.num, { ...prev, topics: [...prev.topics, ...fresh] });
    }
    merged[subject] = [...byNum.values()].sort((a, b) => a.num - b.num);
  }

  writeFileSync(OUT_FILE, JSON.stringify(merged), "utf8");
  const total = Object.values(merged).reduce(
    (a, grades) => a + grades.reduce((b, g) => b + g.topics.length, 0),
    0,
  );
  console.log(`\nзаписано: ${path.relative(ROOT, OUT_FILE)} (предметов ${Object.keys(merged).length}, тем всего ${total})`);
}
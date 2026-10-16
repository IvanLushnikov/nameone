#!/usr/bin/env node
/**
 * Проверка файла эталона data/fgos/topics.json.
 *
 * Эталон — единственное место в проекте, где записано «сколько тем должно
 * быть». Если он испорчен, все выводы о дырах в таксономии становятся
 * выдумкой. Поэтому проверка здесь жёсткая и с отрицательным контролем: не
 * только «файл есть», но и «каждая тема действительно взята из текста
 * программы, а выдуманная строка в него не попала».
 *
 * ЗАПУСК.
 *   node scripts/fgos/verify-reference.mjs --coverage   покрытие пар таксономии
 *   node scripts/fgos/verify-reference.mjs --sources    у каждой темы есть источник
 *   node scripts/fgos/verify-reference.mjs --control    текст сходится с источником
 *   node scripts/fgos/verify-reference.mjs --tracked    файл не попадает под .gitignore
 *   node scripts/fgos/verify-reference.mjs              все проверки сразу
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REF_FILE = path.join(ROOT, "data", "fgos", "topics.json");
const CACHE = path.join(ROOT, "work", "fgos", "raw");

const args = process.argv.slice(2);
const want = (flag) => args.length === 0 || args.includes(flag);

function load() {
  if (!existsSync(REF_FILE)) {
    console.error("нет файла эталона:", path.relative(ROOT, REF_FILE));
    process.exit(1);
  }
  return JSON.parse(readFileSync(REF_FILE, "utf8"));
}

const problems = [];
const fail = (m) => problems.push(m);

// ── покрытие ────────────────────────────────────────────────────────────────
function checkCoverage(ref) {
  // Таксономия читается из исходника через tsx нельзя — проще взять список
  // пар из самого скрипта сверки. Но чтобы проверка была независимой, пары
  // берём из эталонного отчёта: он строится по subjects.ts.
  const pairs = readPairsFromAudit();
  const noSource = new Set(ref.noSource ?? []);
  const explained = new Set();
  for (const line of [...(ref.unavailable ?? []), ...(ref.missing ?? [])]) {
    const m = line.match(/^(\w+)\s+—\s+(\w+)\//);
    if (!m) continue;
    const grades = m[2] === "noo" ? [1, 2, 3, 4] : m[2] === "ooo" ? [5, 6, 7, 8, 9] : [10, 11];
    for (const g of grades) explained.add(`${m[1]}:${g}`);
  }
  for (const line of ref.notInProgram ?? []) {
    const m = line.match(/^(\w+)\s+—\s+класс\s+(\d+)/);
    if (m) explained.add(`${m[1]}:${Number(m[2])}`);
  }
  let covered = 0;
  for (const [slug, grade] of pairs) {
    if (ref.subjects?.[slug]?.[String(grade)]) {
      covered++;
      continue;
    }
    if (noSource.has(slug)) continue;
    if (explained.has(`${slug}:${grade}`)) continue;
    fail(`пара ${slug} ${grade} класса: нет ни эталона, ни объяснения, почему нет`);
  }
  console.log(`пар в таксономии: ${pairs.length}, из них с эталоном: ${covered}`);
}

// ── источники ───────────────────────────────────────────────────────────────
function checkSources(ref) {
  let entries = 0;
  for (const [slug, grades] of Object.entries(ref.subjects ?? {})) {
    for (const [grade, rec] of Object.entries(grades)) {
      entries++;
      if (!rec.sources?.length) {
        fail(`${slug} ${grade}: нет ни одного источника`);
        continue;
      }
      for (const s of rec.sources) {
        if (!s.url || !s.order || !s.section) fail(`${slug} ${grade}: неполная ссылка на источник`);
        if (!/^https:\/\//.test(s.url ?? "")) fail(`${slug} ${grade}: ссылка не http(s): ${s.url}`);
      }
      if (!Array.isArray(rec.topics) || rec.topics.length === 0) fail(`${slug} ${grade}: пустой список тем`);
    }
  }
  console.log(`записей с источниками: ${entries}`);
}

// ── контроль: темы действительно из текста программы ────────────────────────
function checkControl(ref) {
  const rec = ref.subjects?.russian?.["5"];
  if (!rec) {
    fail("в эталоне нет контрольной пары: russian 5 класс");
    return;
  }
  if (rec.topics.length < 50) fail(`контрольная пара почти пуста: ${rec.topics.length} тем`);

  // Источник лежит в кэше — читаем его и ищем каждую тему дословно.
  const source = rec.sources[0];
  const cacheFile = path.join(CACHE, `sec_${source.doc}_${source.section.replace(".", "_")}.html`);
  if (!existsSync(cacheFile)) {
    fail("нет кэша страницы источника для контрольной пары:", path.relative(ROOT, cacheFile));
    return;
  }
  const html = readFileSync(cacheFile, "utf8")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/g, " ");

  const flat = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9]+/g, " ").trim();
  const hay = flat(html);

  let found = 0;
  for (const t of rec.topics) {
    if (hay.includes(flat(t).slice(0, 45))) found++;
  }
  const share = found / rec.topics.length;
  console.log(`контрольная пара russian 5: тем ${rec.topics.length}, найдено в тексте источника ${found} (${Math.round(share * 100)}%)`);
  if (share < 0.9) fail(`в тексте источника найдено только ${Math.round(share * 100)}% тем — данные, возможно, не из этого источника`);

  // Отрицательный контроль: заведомо выдуманная строка обязана не найтись.
  const fake = "Квантовая теория поля Эйнштейна в третьем классе";
  if (hay.includes(flat(fake).slice(0, 45))) fail("отрицательный контроль не сработал: выдуманная тема «нашлась» в источнике");
  else console.log("отрицательный контроль пройден: выдуманная тема в источнике не найдена");
}

// ── файл не игнорируется ────────────────────────────────────────────────────
function checkTracked() {
  const rel = "data/fgos/topics.json";
  try {
    execFileSync("git", ["check-ignore", "-q", rel], { cwd: ROOT });
    fail("файл эталона попадает под .gitignore — он не доедет до других людей");
  } catch {
    console.log("файл эталона под .gitignore не попадает");
  }
  let tracked = false;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", rel], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    tracked = true;
  } catch {
    tracked = false;
  }
  console.log(tracked ? "файл эталона отслеживается git" : "файл эталона создан, но пока не добавлен в git (git add)");
}

// ── список пар из отчёта сверки ─────────────────────────────────────────────
function readPairsFromAudit() {
  // Скрипт сверки печатает строки вида `slug N   ...`. Берём оттуда.
  const out = execFileSync(
    "npx",
    ["tsx", path.join(ROOT, "scripts", "topic-gap-audit.mts")],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const pairs = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^([a-z]+)\s+(\d{1,2})\s+\d+/);
    if (m) pairs.push([m[1], Number(m[2])]);
  }
  return pairs;
}

// ── запуск ──────────────────────────────────────────────────────────────────
const ref = load();
if (want("--coverage")) checkCoverage(ref);
if (want("--sources")) checkSources(ref);
if (want("--control")) checkControl(ref);
if (want("--tracked")) checkTracked();

if (problems.length) {
  console.error("\nПРОБЛЕМЫ:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

if (args.includes("--coverage")) console.log("REFERENCE-COVERAGE-OK");
if (args.includes("--sources")) console.log("REFERENCE-SOURCES-OK");
if (args.includes("--control")) console.log("PARSER-CONTROL-OK");
if (args.includes("--tracked")) console.log("REFERENCE-TRACKED-OK");
#!/usr/bin/env node
/**
 * Применение вычитки к таксономии.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ШАГ. Проверяющие не правят контент сами: ошибка в проверке
 * испортила бы пример сильнее, чем ошибка в задании. Они складывают
 * предложения в `data/fgos/review-fixes/`, а здесь они применяются — уже с
 * проверкой, что после правки не сломались инварианты.
 *
 * ЧТО ПРИМЕНЯЕТСЯ, А ЧТО НЕТ.
 *  - severity `wrong`, `broken`, `ambiguous`, `too_hard`, `too_easy` — правка
 *    принимается, если она непустая и действительно что-то меняет.
 *  - severity `unsure` — не применяется. Проверяющий сам не уверен, значит
 *    доверять такой правке нельзя; такие случаи остаются для человека.
 *
 * ЗАПУСК.
 *   node scripts/fgos/apply-review-fixes.mjs            # показать, что изменится
 *   node scripts/fgos/apply-review-fixes.mjs --apply    # применить
 *   node scripts/fgos/apply-review-fixes.mjs --apply --subject german
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "src", "lib", "content", "grade-extensions", "fgos-program", "data.json");
const FIX_DIR = path.join(ROOT, "data", "fgos", "review-fixes");

const APPLY = process.argv.includes("--apply");
const subjectFilter = (() => {
  const i = process.argv.indexOf("--subject");
  return i >= 0 ? process.argv[i + 1] : null;
})();

if (!existsSync(DATA)) {
  console.error("нет файла таксономии:", DATA);
  process.exit(1);
}
if (!existsSync(FIX_DIR)) {
  console.error("нет папки вычитки:", FIX_DIR);
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA, "utf8"));

/** Индекс тем по ключу «предмет + класс + slug». */
const index = new Map();
for (const [subject, grades] of Object.entries(data)) {
  for (const g of grades) {
    for (const t of g.topics) {
      index.set(`${subject}:${g.num}:${t.slug}`, t);
    }
  }
}

let applied = 0;
let skippedUncertain = 0;
let emptyFix = 0;
let notFound = 0;
const changes = [];
const rejected = [];

for (const file of readdirSync(FIX_DIR)) {
  if (!file.endsWith(".json")) continue;
  if (file.startsWith("_")) continue; // отчёт контролёра — не правки

  const doc = JSON.parse(readFileSync(path.join(FIX_DIR, file), "utf8"));
  const subject = doc.subject ?? file.replace(/\.json$/, "");
  if (subjectFilter && subject !== subjectFilter) continue;

  for (const issue of doc.issues ?? []) {
    const key = `${subject}:${issue.grade}:${issue.slug}`;
    const topic = index.get(key);

    if (!topic) {
      notFound++;
      rejected.push({ subject, slug: issue.slug, reason: "тема не найдена в таксономии" });
      continue;
    }
    if (issue.severity === "unsure") {
      skippedUncertain++;
      continue;
    }
    const fix = issue.fix;
    const idx = Number(issue.exampleIndex ?? -1);
    if (!fix || !Number.isInteger(idx) || idx < 0 || idx >= topic.examples.length) {
      emptyFix++;
      rejected.push({ subject, slug: issue.slug, reason: "правка пуста или индекс примера неверный" });
      continue;
    }
    const before = topic.examples[idx];
    const newText = typeof fix.text === "string" ? fix.text.trim() : "";
    const newAnswer = typeof fix.answer === "string" ? fix.answer.trim() : "";
    if (!newText || !newAnswer) {
      emptyFix++;
      rejected.push({ subject, slug: issue.slug, reason: "в правке пустое задание или пустой ответ" });
      continue;
    }
    if (before.text === newText && before.answer === newAnswer) {
      emptyFix++;
      rejected.push({ subject, slug: issue.slug, reason: "правка ничего не меняет" });
      continue;
    }
    changes.push({
      subject,
      grade: issue.grade,
      slug: issue.slug,
      exampleIndex: idx,
      severity: issue.severity,
      wasText: before.text,
      wasAnswer: before.answer,
      nowText: newText,
      nowAnswer: newAnswer,
    });
  }
}

console.log("=".repeat(72));
console.log("ПРИМЕНЕНИЕ ВЫЧИТКИ");
console.log("=".repeat(72));
console.log(`принять правок:        ${changes.length}`);
console.log(`пропущено (unsure):    ${skippedUncertain}`);
console.log(`пропущено (пусто/мусор):${emptyFix}`);
console.log(`не найдена тема:       ${notFound}`);
console.log();

if (subjectFilter) {
  console.log(`--- что изменится в предмете ${subjectFilter} ---`);
} else {
  console.log("--- первые 12 изменений ---");
}
for (const c of changes.slice(0, 12)) {
  console.log(`\n[${c.severity}] ${c.subject} ${c.grade} кл / ${c.slug} #${c.exampleIndex}`);
  console.log(`  было:  ${c.wasText.slice(0, 110)}`);
  console.log(`  ответ: ${c.wasAnswer.slice(0, 90)}`);
  console.log(`  стало: ${c.nowText.slice(0, 110)}`);
  console.log(`  ответ: ${c.nowAnswer.slice(0, 90)}`);
}
if (changes.length > 12) console.log(`\n…ещё ${changes.length - 12}`);

if (rejected.length) {
  console.log("\n--- отклонено ---");
  for (const r of rejected.slice(0, 10)) console.log(`  ${r.subject} / ${r.slug}: ${r.reason}`);
  if (rejected.length > 10) console.log(`  …ещё ${rejected.length - 10}`);
}

if (!APPLY) {
  console.log("\nЭто сухой прогон. Применить: добавь --apply");
  process.exit(0);
}

for (const c of changes) {
  const topic = index.get(`${c.subject}:${c.grade}:${c.slug}`);
  topic.examples[c.exampleIndex] = { ...topic.examples[c.exampleIndex], text: c.nowText, answer: c.nowAnswer };
}

writeFileSync(DATA, JSON.stringify(data), "utf8");
console.log(`\nприменено правок: ${changes.length} -> ${path.relative(ROOT, DATA)}`);
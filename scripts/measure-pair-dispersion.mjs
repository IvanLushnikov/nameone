#!/usr/bin/env node
/**
 * Разброс видимого текста ВНУТРИ одной пары «предмет + класс» по `out/`.
 *
 * Отличие от `measure-text-dispersion.mjs`: там разброс считается по группам
 * маршрутов (все страницы планов урока вместе), а здесь — только по страницам
 * тем ОДНОГО класса. Именно этот разброс показывает, отличаются ли темы
 * внутри года друг от друга, или это один текст с разными заголовками.
 *
 * Запуск: `npm run build && node scripts/measure-pair-dispersion.mjs`
 *
 * Скрипт ничего не меняет — только читает собранный HTML.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";

function collectHtml(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectHtml(full));
    else if (entry === "index.html") out.push(full);
  }
  return out;
}

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Пары «предмет + класс» из маршрутов /subject/<slug>/<grade>/<topic>/.
 * Путь в out/ — `subject/<slug>/<grade>/<topic>/index.html`, это 5 частей.
 */
const pairs = new Map();
for (const file of collectHtml(OUT)) {
  const parts = relative(OUT, file).split("/");
  if (parts[0] !== "subject" || parts.length !== 5 || parts[4] !== "index.html") continue;
  const key = `${parts[1]}/${parts[2]}`;
  if (!pairs.has(key)) pairs.set(key, []);
  pairs.get(key).push(visibleText(readFileSync(file, "utf8")).length);
}

const spreads = [];
const lensAll = [];
console.log("=".repeat(72));
console.log(`РАЗБРОС ТЕМ ВНУТРИ ПАРЫ «ПРЕДМЕТ + КЛАСС» · ${OUT}/subject`);
console.log("=".repeat(72));
console.log(["пара", "тем", "min", "медиана", "max", "разброс %"].join("  "));

for (const [key, lens] of [...pairs.entries()].sort()) {
  const min = Math.min(...lens);
  const max = Math.max(...lens);
  const med = median(lens);
  const spread = ((max - min) / Math.max(med, 1)) * 100;
  spreads.push(spread);
  lensAll.push(...lens);
  console.log(
    [
      key.padEnd(16),
      String(lens.length).padStart(4),
      String(min).padStart(6),
      String(med).padStart(7),
      String(max).padStart(6),
      `${spread.toFixed(1)}%`.padStart(9),
    ].join("  "),
  );
}

console.log("-".repeat(72));
console.log(`Пар разобрано: ${pairs.size} · страниц тем: ${lensAll.length}`);
console.log(
  `Медианный разброс внутри пары: ${median(spreads).toFixed(1)}% · средний: ${(spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1)}%`,
);
console.log(
  `Общий разброс по всем страницам тем: ${((Math.max(...lensAll) - Math.min(...lensAll)) / median(lensAll) * 100).toFixed(1)}%`,
);
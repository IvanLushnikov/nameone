#!/usr/bin/env node
/**
 * Замер разброса видимого текста по массовым страницам (`out/`).
 *
 * ЗАЧЕМ. SEO-аудит P0-3 называет главным риском профиль «массовый тонкий
 * контент»: если видимый текст тысячи страниц отличается только именем темы,
 * поисковик видит это так же, как и мы — один текст, переставленный. Признак
 * виден не в среднем, а в РАЗБРОСЕ: у шаблонных страниц длина текста
 * укладывается в несколько процентов, у наполненных — расходится на десятки
 * процентов.
 *
 * Запуск: `npm run build && node scripts/measure-text-dispersion.mjs`
 *
 * Что делаем:
 *  - рекурсивно собираем все `index.html` из каталога `out`;
 *  - вырезаем script/style/svg, HTML-комментарии и атрибуты тегов —
 *    остаётся видимый текст, как его читает человек;
 *  - группируем страницы по «пузырю» маршрута (lesson-plan, presentation,
 *    страницы тем), чтобы шаблонность одного типа не пряталась за другим;
 *  - печатаем count / min / медиану / max / разброс (max-min и max/min).
 *
 * Скрипт ничего не меняет — только считает по собранному HTML.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";

/** Рекурсивно собирает все `index.html` из каталога. */
function collectHtml(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectHtml(full));
    else if (entry === "index.html") out.push(full);
  }
  return out;
}

/** Видимый текст страницы: без тегов, скриптов, стилей и разметки. */
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
 * «Пузырь» маршрута — по нему группируем страницы одного типа.
 *  /lesson-plan/math/5/...   → lesson-plan
 *  /presentation/…           → presentation
 *  /subject/math/5/…         → subject-topic (три уровня после /subject/)
 */
function bucket(route) {
  const parts = route.split("/").filter(Boolean);
  if (!parts.length) return "(прочее)";
  if (parts[0] === "lesson-plan") return "lesson-plan";
  if (parts[0] === "presentation") return "presentation";
  if (parts[0] === "subject" && parts.length >= 4) return "subject-topic";
  return parts[0];
}

const groups = new Map();

for (const file of collectHtml(OUT)) {
  const route = "/" + relative(OUT, file).replace(/index\.html$/, "");
  const key = bucket(route);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ route, len: visibleText(readFileSync(file, "utf8")).length });
}

const pct = (n) => `${n.toFixed(1)}%`;

console.log("=".repeat(78));
console.log(`РАЗБРОС ВИДИМОГО ТЕКСТА · ${OUT}/`);
console.log("=".repeat(78));
console.log(
  ["группа", "страниц", "min", "медиана", "max", "max-min", "max/min"].join("  ").padEnd(0),
);
console.log("-".repeat(78));

// Порядок вывода фиксированный, чтобы «до» и «после» читались встык.
const ORDER = ["lesson-plan", "presentation", "subject-topic"];
const keys = [...ORDER.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !ORDER.includes(k))];

for (const key of keys) {
  const list = groups.get(key);
  const lens = list.map((x) => x.len);
  const min = Math.min(...lens);
  const max = Math.max(...lens);
  const med = median(lens);
  const spread = ((max - min) / med) * 100;
  const ratio = max / Math.max(min, 1);
  console.log(
    [
      key.padEnd(15),
      String(list.length).padStart(6),
      String(min).padStart(6),
      String(med).padStart(8),
      String(max).padStart(6),
      String(max - min).padStart(7),
      pct(spread).padStart(7),
    ].join("  ") + `   (max/min ${ratio.toFixed(2)})`,
  );
}

console.log("-".repeat(78));
console.log("Подробнее по «хвостам» (где текст самый короткий и самый длинный):");
for (const key of ORDER.filter((k) => groups.has(k))) {
  const list = groups.get(key).slice().sort((a, b) => a.len - b.len);
  const short = list[0];
  const long = list[list.length - 1];
  console.log(`  ${key}:`);
  console.log(`    min ${String(short.len).padStart(5)}  ${short.route}`);
  console.log(`    max ${String(long.len).padStart(5)}  ${long.route}`);
}
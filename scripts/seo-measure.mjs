#!/usr/bin/env node
/**
 * Замер SEO-метрик по собранному статическому экспорту (`out/`).
 *
 * ТЗ-21 п.14 (пункты 1–4) и SEO-аудит P1-1…P1-9: цифры в отчёте берутся
 * отсюда, а не «на глаз». Скрипт ничего не меняет — только считает по HTML.
 *
 * Запуск: `node scripts/seo-measure.mjs` (после `npm run build`).
 *
 * Что считаем:
 *  - canonical      — `<link rel="canonical">` в head;
 *  - description    — длина `<meta name="description">`, отдельно отмечаем > 160;
 *  - keywords       — наличие тега `<meta name="keywords">`;
 *  - og:image       — наличие `property="og:image"`;
 *  - title          — группировка одинаковых title (дубли);
 *  - JSON-LD        — типы schema.org по блокам `application/ld+json`;
 *  - sitemap        — URL со/без слеша и дубли.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";

/** Рекурсивно собирает все `index.html` + `404.html` из каталога. */
function collectHtml(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectHtml(full));
    else if (entry === "index.html" || entry === "404.html") out.push(full);
  }
  return out;
}

const files = collectHtml(OUT);

const stats = {
  total: files.length,
  canonical: 0,
  noCanonical: [],
  descLong: [],
  descMissing: 0,
  keywords: 0,
  noOgImage: [],
  titles: new Map(),
  learningResourceMissing: [],
  productMissing: [],
};

const LD_TYPES = new Map(); // тип → число страниц, где встречается

for (const file of files) {
  const html = readFileSync(file, "utf8");
  const route = "/" + relative(OUT, file).replace(/index\.html$/, "").replace(/404\.html$/, "");
  const head = html.slice(0, html.indexOf("</head>") === -1 ? html.length : html.indexOf("</head>"));

  // canonical
  if (/<link[^>]+rel=["']canonical["']/i.test(head)) stats.canonical++;
  else stats.noCanonical.push(route);

  // description
  const desc = head.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || head.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (!desc) {
    stats.descMissing++;
  } else if (desc[1].length > 160) {
    stats.descLong.push([route, desc[1].length]);
  }

  // keywords
  if (/<meta[^>]+name=["']keywords["']/i.test(head)) stats.keywords++;

  // og:image
  if (!/property=["']og:image["']/i.test(head)) stats.noOgImage.push(route);

  // title
  const t = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (t) {
    const list = stats.titles.get(t[1]) || [];
    list.push(route);
    stats.titles.set(t[1], list);
  }

  // JSON-LD
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const types = new Set();
  for (const b of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(b[1]);
    } catch {
      continue;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const obj of arr) {
      const ty = obj?.["@type"];
      if (Array.isArray(ty)) ty.forEach((x) => types.add(String(x)));
      else if (ty) types.add(String(ty));
    }
  }
  for (const ty of types) LD_TYPES.set(ty, (LD_TYPES.get(ty) || 0) + 1);

  if (route.startsWith("/subject/") && !types.has("LearningResource")) {
    stats.learningResourceMissing.push(route);
  }
  if (route === "/pricing/" && !types.has("Product")) stats.productMissing.push(route);
}

/** Группировка URL по «пузырю» маршрута, чтобы видеть, где массовая просадка. */
function byBucket(routes, depth) {
  const m = new Map();
  for (const r of routes) {
    const key = r.split("/").filter(Boolean).slice(0, depth).join("/") || "/";
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

const pct = (n) => ((n / stats.total) * 100).toFixed(1) + "%";

console.log("=".repeat(70));
console.log(`ЗАМЕР SEO · ${stats.total} страниц`);
console.log("=".repeat(70));
console.log(`canonical есть        : ${stats.canonical}  (${pct(stats.canonical)})`);
console.log(`canonical отсутствует : ${stats.noCanonical.length}`);
for (const [k, v] of byBucket(stats.noCanonical, 1)) console.log(`    ${k.padEnd(28)} ${v}`);
console.log(`description > 160     : ${stats.descLong.length}  (${pct(stats.descLong.length)})`);
for (const [k, v] of byBucket(stats.descLong.map(([r]) => r), 1)) console.log(`    ${k.padEnd(28)} ${v}`);
console.log(`description отсутствует: ${stats.descMissing}`);
console.log(`тег keywords          : ${stats.keywords}`);
console.log(`og:image отсутствует  : ${stats.noOgImage.length}`);
for (const [k, v] of byBucket(stats.noOgImage, 1)) console.log(`    ${k.padEnd(28)} ${v}`);
console.log(`\nJSON-LD типы (страниц):`);
for (const [k, v] of [...LD_TYPES.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(28)} ${v}`);
}
console.log(`\nТем без LearningResource: ${stats.learningResourceMissing.length}`);
for (const [k, v] of byBucket(stats.learningResourceMissing, 2)) console.log(`    ${k.padEnd(28)} ${v}`);
console.log(`/pricing без Product   : ${stats.productMissing.length ? "ДА" : "нет"}`);

const dups = [...stats.titles.entries()].filter(([, r]) => r.length > 1).sort((a, b) => b[1].length - a[1].length);
console.log(`\nДубли title: ${dups.length} групп на ${dups.reduce((s, [, r]) => s + r.length, 0)} страниц`);
for (const [t, r] of dups.slice(0, 12)) {
  console.log(`    [${r.length}] ${t}`);
  for (const x of r.slice(0, 4)) console.log(`          ${x}`);
}

// sitemap
const sm = join(OUT, "sitemap.xml");
if (existsSync(sm)) {
  const xml = readFileSync(sm, "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const noSlash = urls.filter((u) => !u.endsWith("/")).length;
  console.log(`\nsitemap.xml: ${urls.length} URL, без слеша ${noSlash}, со слешем ${urls.length - noSlash}`);
  const seen = new Set();
  const sdups = [...new Set(urls.filter((u) => (seen.has(u) ? true : (seen.add(u), false))))];
  console.log(`  дубликатов URL в sitemap: ${sdups.length}`);
} else {
  console.log("\nsitemap.xml не найден в out/");
}

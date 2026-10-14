#!/usr/bin/env node
/**
 * Проверка запретов из разбора: список «чего делать не надо» должен остаться
 * нарушенным как нарушенным.
 *
 * ПЛАН-ДЕЙСТВИЙ прямо запрещает трогать заголовки, открывать личный кабинет в
 * индекс и менять название. Это запрет по умолчанию — такие вети делают
 * «на всякий случай», и потом не помнят, зачем. Проверка читает СОБРАННЫЙ сайт,
 * а не исходники: запрет держится или нет в том, что реально отдаётся.
 *
 *   node scripts/check-geo-invariants.mjs
 *
 * Успех — `INVARIANTS_HELD`. Каждый нарушенный запрет печатается отдельной строкой.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "out");
const problems = [];
const note = (p) => problems.push(p);

function readOut(relative, what) {
  const path = join(OUT, relative);
  if (!existsSync(path)) {
    note(`нет ${what}: ${path} — сначала npm run build`);
    return null;
  }
  return readFileSync(path, "utf8");
}

// ── 1. Личный кабинет и служебные страницы остались закрыты для краулера ──────
const robots = readOut("robots.txt", "robots.txt");
if (robots) {
  for (const forbidden of ["/api/", "/dashboard", "/preview/", "/form/"]) {
    if (!robots.includes(forbidden)) {
      note(`robots.txt больше не закрывает ${forbidden} — личные страницы открылись обходу`);
    }
  }
  if (!robots.includes("Sitemap:")) {
    note("robots.txt потерял ссылку на sitemap.xml");
  }
}

// ── 2. В карте сайта нет закрытых страниц ───────────────────────────────────
const sitemap = readOut("sitemap.xml", "sitemap.xml");
if (sitemap) {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const closed of ["/dashboard", "/login", "/register", "/preview", "/form/"]) {
    const hit = locs.find((u) => u.includes(closed));
    if (hit) note(`в sitemap попала закрытая страница ${closed}: ${hit}`);
  }
  if (!locs.length) note("sitemap.xml пуст");
}

// ── 3. Заголовок и описание главной не переписаны ────────────────────────────
const home = readOut("index.html", "главной");
if (home) {
  const title = home.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  if (!title.includes("ФГОС")) note(`в заголовке главной нет «ФГОС»: «${title}»`);
  if (!title.includes("УчЛист")) note(`в заголовке главной нет названия сервиса: «${title}»`);

  const desc = home.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  if (!desc) note("у главной нет description");
  if (!/ФГОС/.test(desc)) note("в description главной нет категории «ФГОС»");
  if (!/бесплатно/i.test(desc)) note("в description главной нет бесплатного порога");
  if (desc.length > 200) note(`description главной длиннее 200 символов (${desc.length})`);

  // Название сервиса и домен не менялись: это запрещено без отдельного замера.
  if (!home.includes("uchlist.ru")) note("главная ссылается не на uchlist.ru — домен сменился");
}

// ── 4. Личный кабинет сам по себе отдаётся, но не индексируется ─────────────
const dash = readOut("dashboard/index.html", "страницы кабинета");
if (dash) {
  const robotsMeta = dash.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? "";
  if (!/noindex/.test(robotsMeta)) {
    note(`в кабинете нет noindex (robots meta = «${robotsMeta}»)`);
  }
}

// ── 5. Файл для ИИ-краулеров на месте и не пустой ───────────────────────────
const llms = readOut("llms.txt", "llms.txt");
if (llms !== null) {
  if (llms.trim().length < 200) note("llms.txt подозрительно короткий");
  // Ключевой риск правок: файл могли переписать так, что категория пропала —
  // именно её модели не угадывали.
  if (!/рабочие листы/i.test(llms)) note("в llms.txt нет словосочетания «рабочие листы»");
}

if (problems.length) {
  for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
  console.error("INVARIANTS_HELD НЕ ПРОЙДЕНА");
  process.exit(1);
}

console.log("Запреты из разбора соблюдены: закрытые страницы закрыты, заголовок не переписан, llms.txt на месте.");
console.log("INVARIANTS_HELD");
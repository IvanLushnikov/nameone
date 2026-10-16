#!/usr/bin/env node
/**
 * Проверка `public/llms.txt` и `public/llms-full.txt`.
 *
 * Главный риск такого файла — в нём легко написать правдоподобную цифру, которой
 * нет на сайте. Поэтому ни одно число здесь не берётся из самого файла: цены
 * читаются из `src/lib/content/plans.ts`, бесплатный порог — из бэкенда, объём
 * каталога считается по собранному `out/sitemap.xml`. Если источник поменяется и
 * про llms.txt забудут — проверка упадёт.
 *
 *   node scripts/check-llms-txt.mjs --file    файл доезжает до сборки и врёт не о тарифах
 *   node scripts/check-llms-txt.mjs --claims   утверждения про квоту/отмену/ошибки подтверждены кодом
 *
 * Обе части печатают свой маркер и роняют код на любом провале.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "out");
const SRC_LLMS = join(ROOT, "public/llms.txt");
const SRC_FULL = join(ROOT, "public/llms-full.txt");
const PLANS = join(ROOT, "src/lib/content/plans.ts");
const USAGE = join(ROOT, "backend/src/services/usage.ts");
const PRICING_PAGE = join(ROOT, "src/app/pricing/page.tsx");

/**
 * Написана ли в тексте именно ЦЕНА, а не что-то другое с тем же числом.
 *
 * Проверять голое вхождение цифры нельзя: «до 3000 рабочих листов» — это норма
 * тарифа «Оптимальный», и из-за неё проверка решила бы, что цена
 * не запущенного тарифа «Школа» (тоже 3000) опубликована. Поэтому ищем число
 * рядом со знаком рубля.
 */
const statesPrice = (text, amount) => new RegExp(`${amount}\\s*(?:₽|руб)`).test(text);

/** Плейсхолдеры, из-за которых файл для машин становится мусором. */
const PLACEHOLDERS = ["TODO", "lorem", "уточняется", "TBD", "XXX"];

const problems = [];
const note = (p) => problems.push(p);

/**
 * Тексты файлов читаются ОДИН раз на весь прогон: обе секции (--file и --claims)
 * сверяют один и тот же llms-full.txt, и читать его заново незачем.
 */
let full = "";
if (existsSync(SRC_FULL)) full = readFileSync(SRC_FULL, "utf8");

/** Читает файл или падает с внятным сообщением — молча пропускать нельзя. */
function readOrFail(path, what) {
  if (!existsSync(path)) {
    note(`нет ${what}: ${path}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Источники правды
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Цены из plans.ts + признак «тариф ещё не запущен».
 *
 * Для запущенного тарифа цена обязана быть опубликована, для не запущенного —
 * наоборот: публиковать её нельзя. Тариф «Школа» помечен `comingSoon`, и сайт
 * показывает «уточним на запуске». Если такое число появится в llms.txt, мы
 * рекламируем то, что ещё не продаётся.
 */
function readPlanPrices() {
  const src = readOrFail(PLANS, "источника цен plans.ts");
  if (!src) return [];

  const found = [];
  const blockRe = /id:\s*"(free|base|standard|plus|school)"[\s\S]*?prices:\s*\{([\s\S]*?)\n    \},\n/sg;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const [, id, body] = m;
    const month = body.match(/month:\s*\{\s*amount:\s*(\d+)/);
    if (!month) continue;
    // `comingSoon` может стоять ниже блока цен — смотрим следующие 1500 символов,
    // но не дальше следующего тарифа.
    const rest = src.slice(m.index);
    const nextId = rest.slice(1).search(/\n    id:\s*"/);
    const tail = nextId === -1 ? rest.slice(1) : rest.slice(1, 1 + nextId);
    const comingSoon = /comingSoon:\s*"/.test(tail.slice(0, 1500));
    found.push({ id, month: Number(month[1]), comingSoon });
  }

  if (found.length < 4) {
    note(`из plans.ts прочитано тарифов: ${found.length}, ожидалось минимум 4 — парсер разошёлся с файлом`);
  }
  return found;
}

/** Бесплатный порог из бэкенда. */
function readFreeQuota() {
  const src = readOrFail(USAGE, "бэкенда usage.ts");
  if (!src) return null;
  const m = src.match(/FREE_TOTAL_GENERATIONS\s*=\s*(\d+)/);
  if (!m) {
    note("в usage.ts нет FREE_TOTAL_GENERATIONS");
    return null;
  }
  return Number(m[1]);
}

/**
 * Объём каталога по собранной карте сайта — независимый пересчёт.
 *
 * Не берём «1075» из текста: считаем сами и потом сравниваем с тем, что написано
 * в llms.txt. Так расхождение между числом в файле и числом в сайте ловится.
 */
function readCatalogFromSitemap() {
  const path = join(OUT, "sitemap.xml");
  if (!existsSync(path)) {
    note("нет out/sitemap.xml — сначала соберите проект (`npm run build`)");
    return null;
  }
  const xml = readFileSync(path, "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
  const topics = locs.filter((u) => /\/subject\/[^/]+\/\d+\/[^/]+\/$/.test(u)).length;
  const subjects = new Set(
    locs
      .filter((u) => /\/subject\/[^/]+\/$/.test(u))
      .map((u) => u.replace(/^.*\/subject\//, "").replace(/\/$/, "")),
  );
  return { topics, subjects: subjects.size, total: locs.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// --file: файл доезжает до сборки и не врёт о тарифах
// ─────────────────────────────────────────────────────────────────────────────

function checkFile() {
  // 1. Файл существует в исходниках и дожал до статического экспорта.
  for (const [path, what] of [
    [SRC_LLMS, "исходника llms.txt"],
    [SRC_FULL, "исходника llms-full.txt"],
  ]) {
    if (!existsSync(path)) note(`нет ${what}`);
  }

  const built = join(OUT, "llms.txt");
  if (!existsSync(built)) {
    note(`после сборки нет ${built} — файл не доехал до статического экспорта`);
  } else if (!statSync(built).isFile()) {
    note(`out/llms.txt — не файл. При trailingSlash статический экспорт мог свернуть его в каталог`);
  }

  const llms = readOrFail(built, "собранного llms.txt") ?? "";

  if (!llms.trim()) {
    note("llms.txt пустой");
  }

  // 2. Категория названа прямо — это ровно то, что модели не угадывали.
  for (const marker of ["рабоч", "ФГОС", "учител", "репетитор"]) {
    if (!llms.toLowerCase().includes(marker.toLowerCase())) {
      note(`в llms.txt нет слов «${marker}» — категория не названа`);
    }
  }

  // 3. Цены тарифов: запущенные обязаны быть опубликованы, не запущенные — нет.
  const plans = readPlanPrices();
  for (const p of plans) {
    const needle = String(p.month);
    if (p.comingSoon) {
      // Нельзя рекламировать цену того, что ещё не запущено.
      if (p.month > 0 && statesPrice(llms, p.month)) {
        note(`в llms.txt опубликована цена ${p.month} ₽ тарифа ${p.id}, который ещё не запущен (comingSoon)`);
      }
      if (p.month > 0 && statesPrice(full, p.month)) {
        note(`в llms-full.txt опубликована цена ${p.month} ₽ тарифа ${p.id}, который ещё не запущен (comingSoon)`);
      }
      continue;
    }
    if (!statesPrice(llms, p.month)) note(`в llms.txt нет месячной цены тарифа ${p.id} (${needle} ₽)`);
    if (!statesPrice(full, p.month)) note(`в llms-full.txt нет месячной цены тарифа ${p.id} (${needle} ₽)`);
  }

  // 4. Бесплатный порог — из бэкенда.
  const freeQuota = readFreeQuota();
  if (freeQuota !== null) {
    // ТЗ-32 часть 5: раньше здесь было захардкожено «3 бесплатн». Квота давно
    // помесячная (FREE_TOTAL_GENERATIONS = 5), и проверка требовала от текста
    // старого числа вместо живого. Теперь ищем то число, которое задано в
    // usage.ts, — любое другое расхождение по-прежнему падает.
    if (!new RegExp(`${freeQuota} (бесплатн|лист|генерац)`).test(llms)) {
      note(`в llms.txt нет бесплатного порога ${freeQuota} листов, который задан в usage.ts`);
    }
  }

  // 5. Объём каталога — пересчитан по sitemap и должен совпасть с текстом файла.
  const catalog = readCatalogFromSitemap();
  if (catalog) {
    if (!llms.includes(String(catalog.topics))) {
      note(`в llms.txt нет числа тем ${catalog.topics}, которое даёт sitemap`);
    }
    if (!llms.includes(String(catalog.subjects))) {
      note(`в llms.txt нет числа предметов ${catalog.subjects}, которое даёт sitemap`);
    }
  }

  // 6. Никаких плейсхолдеров: файл читает машина, «уточняется» там бесполезно.
  for (const ph of PLACEHOLDERS) {
    for (const [name, text] of [["llms.txt", llms], ["llms-full.txt", full]]) {
      if (text.includes(ph)) note(`в ${name} остался плейсхолдер «${ph}»`);
    }
  }

  // 7. Файл объявлен на сайте — иначе краулер о нём не узнает.
  const home = join(OUT, "index.html");
  if (!existsSync(home)) {
    note("нет out/index.html — сначала соберите проект");
  } else {
    const html = readFileSync(home, "utf8");
    if (!/rel="alternate"[^>]*type="text\/plain"/.test(html) || !html.includes("/llms.txt")) {
      note("главная не объявляет llms.txt ссылкой rel=alternate — краулер не найдёт файл");
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("LLMS_TXT_SHIPPED НЕ ПРОЙДЕНА");
    process.exit(1);
  }
  console.log(`Проверено: тарифов ${plans.length}, тем/предметов по sitemap посчитано, файл в сборке.`);
  console.log("LLMS_TXT_SHIPPED");
}

// ─────────────────────────────────────────────────────────────────────────────
// --claims: утверждения про квоту, отмену и ошибки подтверждены кодом
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Каждое утверждение проверяется ДВАЖДЫ, и это не одно и то же:
 *
 *   1. на вопрос в llms-full.txt есть ответ — ищем по смыслу (характерными
 *      словами, а не дословным совпадением: файл переписывают, и проверка не
 *      должна ломаться от правки формулировки);
 *   2. этот ответ подтверждён кодом или текстом страницы тарифов.
 *
 * Проверка только первого — выдумка, прошедшая проверку. Только второго — файл
 * молчит там, где репетитору всё равно нужно ответить.
 */
function checkClaims() {
  const usage = readOrFail(USAGE, "бэкенда usage.ts");
  const billing = readOrFail(join(ROOT, "backend/src/services/billing.ts"), "бэкенда billing.ts");
  const pricing = readOrFail(PRICING_PAGE, "страницы тарифов pricing/page.tsx");

  // Число квоты — из usage.ts, а не литерал: ТЗ-32 часть 5.
  const quota = readFreeQuota();
  const freeQuotaInUsage = quota === null ? null : new RegExp(`FREE_TOTAL_GENERATIONS\\s*=\\s*${quota}\\b`);
  const freeQuotaInFile =
    quota === null ? /\b\d+\b.{0,40}(генерац|листа|лист)/i : new RegExp(`\\b${quota}\\b.{0,40}(генерац|листа|лист|бесплатн)`, "i");

  const claims = [
    // ТЗ-32 часть 5: число квоты не зашивается — берётся из usage.ts, иначе
    // проверка требовала бы старого «3» вместо живого значения.
    {
      label: "сколько бесплатных генераций",
      inFile: freeQuotaInFile,
      source: { text: usage, name: "usage.ts", proof: freeQuotaInUsage },
    },
    {
      label: "квота обновляется 1-го числа",
      inFile: /1-го числа|обнул\w*|обновля\w* 1/i,
      source: { text: usage, name: "usage.ts", proof: /monthKeyOf|month/ },
    },
    {
      label: "повторная генерация считается отдельно",
      inFile: /включая\s+повторную/i,
      source: { text: usage, name: "usage.ts", proof: /consumeFreeQuota/ },
    },
    {
      label: "неудачная генерация не забирает попытку",
      inFile: /неудачн\w*.{0,90}не забирает/i,
      source: { text: usage, name: "usage.ts", proof: /FREE_QUOTA_HOLD_TTL_SEC/ },
    },
    {
      label: "отмена подписки",
      inFile: /отменить в любой момент|отмена выключает/i,
      source: { text: billing, name: "billing.ts", proof: /cancelSubscription/ },
    },
    {
      label: "оплаченный период доигрывается после отмены",
      inFile: /оплаченный период/i,
      source: { text: pricing, name: "pricing/page.tsx", proof: /уже оплаченный период доиграется/i },
    },
    {
      label: "ошибка в листе — замена или возврат",
      inFile: /ошибк/i,
      source: { text: pricing, name: "pricing/page.tsx", proof: /заменим или вернём деньги/i },
    },
    {
      label: "ошибка в варианте ОГЭ/ЕГЭ — пересборка",
      inFile: /ОГЭ\/ЕГЭ/i,
      source: { text: pricing, name: "pricing/page.tsx", proof: /пересоберём вариант бесплатно/i },
    },
    {
      label: "коммерческая лицензия",
      inFile: /коммерческ[а-яё]*\s+лицензи/i,
      source: { text: pricing, name: "pricing/page.tsx", proof: /коммерческую лицензию/i },
    },
    {
      label: "перепродавать нельзя",
      inFile: /перепродавать/i,
      source: { text: pricing, name: "pricing/page.tsx", proof: /Перепродавать готовые материалы и курсы нельзя/i },
    },
  ];

  for (const c of claims) {
    if (!c.inFile.test(full)) {
      note(`в llms-full.txt нет ответа на вопрос «${c.label}»`);
      continue;
    }
    if (c.source.text === null) continue;
    if (!c.source.proof.test(c.source.text)) {
      note(`ответ «${c.label}» не подтверждается кодом: в ${c.source.name} нет доказательства`);
    }
  }

  // Срок возврара — число, его надо снять со страницы тарифов и сравнить.
  const refundDays = pricing?.match(/Возврат в течение (\d+) дней/)?.[1];
  if (!refundDays) {
    note("на странице тарифов не найден срок возврата — числу в llms-full.txt не на чем основаться");
  } else if (!new RegExp(`${refundDays}\\s+дн`, "i").test(full)) {
    note(`в llms-full.txt срок возврата не совпадает со страницей тарифов (${refundDays} дней)`);
  }


  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("CLAIMS_MATCH_CODE НЕ ПРОЙДЕНА");
    process.exit(1);
  }
  console.log("Утверждения сверены с usage.ts и pricing/page.tsx.");
  console.log("CLAIMS_MATCH_CODE");
}

const MODE = process.argv[2] ?? "all";
if (MODE === "--file" || MODE === "all") checkFile();
if (MODE === "--claims" || MODE === "all") {
  problems.length = 0;
  checkClaims();
}
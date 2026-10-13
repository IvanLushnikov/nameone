/**
 * Проверка переполнения по горизонтали на узком экране (ТЗ-26, Д-8).
 *
 * Запуск: node scripts/check-mobile-overflow.mjs [baseUrl] [width...]
 *
 * Обходит список страниц, на каждой меряет `document.documentElement.scrollWidth`
 * против `innerWidth` и, если есть переполнение, перечисляет элементы, которые
 * за него отвечают. Печатает markdown-таблицу и завершается с кодом 1, если
 * хоть одна страница переполнилась — чтобы это можно было повесить в гейт.
 *
 * Экран 360 px — самый узкий из тех, что проверяем: если вёрстка не ломается
 * на 360, на 390 и 414 она не ломается тоже. Но таблица печатает ВСЕ ширины,
 * потому что дефект иногда вылезает только на одной из них.
 */

const BASE = process.argv[2] ?? "http://localhost:8799";
const WIDTHS = (process.argv.slice(3).length ? process.argv.slice(3) : ["360", "390", "414"]).map(Number);
const HEIGHT = 900;

const PAGES = [
  "/",
  "/pricing",
  "/materials",
  "/about",
  "/contact",
  "/methodology",
  "/legal/offer",
  "/legal/privacy",
  "/legal/cookies",
  "/login",
  "/register",
];

// Страницу конструктора сюда не кладём: там нужен пройденный визард
// (предмет → класс → тема), и на голом `/constructor` переполнения нет.

async function measure(page, path, width) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  // Даём Next дописать гидрацию: overflow иногда появляется после неё.
  await page.waitForTimeout(700);

  return page.evaluate((vw) => {
    const de = document.documentElement;
    const offenders = [];
    if (de.scrollWidth > vw) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 1 || r.right > vw + 1) {
          const cls = typeof el.className === "string" ? el.className : "";
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: cls.slice(0, 90),
            w: Math.round(r.width),
            right: Math.round(r.right),
          });
        }
      }
    }
    return {
      // Ширину берём из ОКНА, а не из аргумента: первая версия скрипта
      // сравнивала с зашитым 360 на всех проходах и «находила» +30px при
      // экране 390 — то есть сравнивала 390 с 360 и называла это переполнением.
      innerWidth: window.innerWidth,
      scrollWidth: de.scrollWidth,
      overflow: de.scrollWidth - window.innerWidth,
      offenders: offenders.slice(0, 4),
    };
  }, width);
}

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const results = [];

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: HEIGHT } });
    for (const path of PAGES) {
      const res = await measure(page, path, width);
      results.push({ width, path, ...res });
    }
    await page.close();
  }
  await browser.close();

  let bad = 0;
  const lines = ["| Страница | 360 | 390 | 414 |", "|---|---|---|---|"];
  const byPage = new Map();
  for (const r of results) {
    if (!byPage.has(r.path)) byPage.set(r.path, {});
    byPage.get(r.path)[r.width] = r;
  }
  for (const [path, byWidth] of byPage) {
    const cells = WIDTHS.map((w) => {
      const r = byWidth[w];
      if (!r) return "—";
      if (r.overflow > 0) {
        bad += 1;
        return `**+${r.overflow}px**`;
      }
      return "ок";
    });
    lines.push(`| \`${path}\` | ${cells.join(" | ")} |`);
  }
  console.log(lines.join("\n"));

  if (bad > 0) {
    console.log("\nПереполнение, элементы-виновники:");
    for (const r of results) {
      if (r.overflow > 0) {
        console.log(`\n${r.path} @${r.width}px +${r.overflow}px`);
        for (const o of r.offenders) {
          console.log(`   ${o.tag}.${o.cls} w=${o.w} right=${o.right}`);
        }
      }
    }
    process.exit(1);
  }
  console.log("\nПереполнения нет ни на одной ширине.");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
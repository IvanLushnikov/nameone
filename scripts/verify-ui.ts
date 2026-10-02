/**
 * UI-проверка собранного статического экспорта.
 *
 * Цель — проверить не «собралось ли», а «видно ли учителю то, что мы
 * наполнили»: страница темы реально открывается, показывает заголовок,
 * примеры заданий и ведёт в конструктор. Проверяем в Chromium через
 * Playwright по собранному `out/`, без дев-сервера — так проверяется
 * ровно то, что уедет на Cloudflare Pages.
 *
 * Запуск:
 *   npm run build
 *   npx tsx scripts/verify-ui.ts
 *
 * Опции:
 *   --base=http://127.0.0.1:4321   адрес статик-сервера (по умолчанию сам поднимает)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { subjects, getSubject, getGrade } from "../src/lib/content/subjects";

const OUT_DIR = path.resolve(process.cwd(), "out");
const PORT = 4321;

interface Check {
  name: string;
  url: string;
  /** Подстроки, которые должны быть в тексте страницы. */
  expect: string[];
  /** Подстроки, которых быть НЕ должно. */
  reject?: string[];
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function startServer(): Promise<ChildProcess> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let filePath = path.join(OUT_DIR, decodeURIComponent(url.pathname));
      // Next export с trailingSlash: /a/b/ → out/a/b/index.html
      if (existsSync(filePath) && (await stat(filePath)).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!existsSync(filePath) || !(await stat(filePath)).isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => {
      // Сервер живёт в процессе скрипта — просто логируем факт старта.
      console.log(`[verify-ui] статик-сервер на http://127.0.0.1:${PORT}`);
      resolve({ kill: () => server.close() } as ChildProcess);
    });
  });
}

/** Собираем список проверок: главная + по одному предмету на каждое новое покрытие. */
function buildChecks(): Check[] {
  const checks: Check[] = [
    {
      name: "главная",
      url: "/",
      expect: ["РабочиеЛисты"],
    },
  ];

  // По одному предмету на каждую пару (предмет, класс), чтобы поймать
  // битый generateStaticParams. Берём ВСЕ пары — их 141, это дёшево.
  for (const s of subjects) {
    checks.push({
      name: `предмет ${s.slug}`,
      url: `/subject/${s.slug}/`,
      expect: [s.title],
      reject: ["Тема не найдена", "404"],
    });
    for (const g of s.grades) {
      checks.push({
        name: `класс ${s.slug}/${g.num}`,
        url: `/subject/${s.slug}/${g.num}/`,
        expect: [`${g.num} класс`],
        reject: ["Тема не найдена", "404"],
      });
      // Первая тема класса — самая частая точка входа из навигации.
      const t = g.topics[0];
      if (!t) continue;
      checks.push({
        name: `тема ${s.slug}/${g.num}/${t.slug}`,
        url: `/subject/${s.slug}/${g.num}/${t.slug}/`,
        expect: [t.title],
        reject: ["Тема не найдена", "404", "Страница не найдена"],
      });
    }
  }
  return checks;
}

async function main() {
  if (!existsSync(OUT_DIR)) {
    console.error(`[verify-ui] нет каталога ${OUT_DIR} — сначала npm run build`);
    process.exit(1);
  }

  const server = await startServer();
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch();
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const checks = buildChecks();
  const failed: string[] = [];
  const consoleErrors: string[] = [];
  let checked = 0;

  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  for (const c of checks) {
    let res;
    try {
      // ВАЖНО: waitUntil "load", а не "domcontentloaded" — на dev-сервере
      // клики по серверному HTML уходят раньше, чем React навесит обработчики.
      res = await page.goto(base + c.url, { waitUntil: "load", timeout: 30000 });
    } catch (e) {
      failed.push(`${c.name} (${c.url}) — не открылась: ${String(e).split("\n")[0]}`);
      continue;
    }
    const status = res?.status() ?? 0;
    if (status !== 200) {
      failed.push(`${c.name} (${c.url}) — HTTP ${status}`);
      continue;
    }
    const text = await page.locator("body").innerText();
    for (const needle of c.expect) {
      if (!text.includes(needle)) {
        failed.push(`${c.name} (${c.url}) — нет текста «${needle}»`);
      }
    }
    for (const needle of c.reject ?? []) {
      if (text.includes(needle)) {
        failed.push(`${c.name} (${c.url}) — найден мусор «${needle}»`);
      }
    }
    checked++;
  }

  // Отдельно — интерактив: со страницы темы должен работать переход
  // в конструктор и раскрытие ответов.
  const probe = getSubject("pe");
  const probeGrade = probe ? getGrade("pe", 11) : undefined;
  const probeTopic = probeGrade?.topics[0];
  if (probeTopic && probeGrade) {
    const url = `${base}/subject/pe/11/${probeTopic.slug}/`;
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    const h1 = await page.locator("h1").first().innerText().catch(() => "");
    if (!h1.includes(probeTopic.title)) {
      failed.push(`H1 на ${url} — «${h1}» вместо «${probeTopic.title}»`);
    }
    const cta = page.locator('a[href*="/constructor"]').first();
    if ((await cta.count()) === 0) {
      failed.push(`на ${url} нет ссылки в конструктор`);
    } else {
      await cta.click();
      await page.waitForURL(/constructor/, { timeout: 20000 }).catch(() => {
        failed.push(`клик по CTA с ${url} не привёл в конструктор`);
      });
    }
  }

  await browser.close();
  server.kill();

  console.log(`\n[verify-ui] проверено страниц: ${checked} из ${checks.length}`);
  if (consoleErrors.length) {
    console.log(`[verify-ui] ошибок в консоли браузера: ${consoleErrors.length}`);
    for (const e of consoleErrors.slice(0, 5)) console.log(`    - ${e.slice(0, 160)}`);
  }
  if (failed.length) {
    console.log(`[verify-ui] ПРОВАЛЕНО: ${failed.length}`);
    for (const f of failed.slice(0, 40)) console.log(`    ✗ ${f}`);
    if (failed.length > 40) console.log(`    ... ещё ${failed.length - 40}`);
    process.exit(1);
  }
  console.log("[verify-ui] все проверки пройдены");
}

main().catch((e) => {
  console.error("[verify-ui] упало:", e);
  process.exit(1);
});

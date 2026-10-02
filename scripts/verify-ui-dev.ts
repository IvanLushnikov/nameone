/**
 * UI-проверка на dev-сервере.
 *
 * Зачем отдельный скрипт, если есть scripts/verify-ui.ts:
 * `next build` на этой машине зависает (см. .github/workflows/deploy.yml:24 —
 * проект собирается в CI), поэтому проверить статический экспорт локально
 * нельзя. Dev-сервер работает, и проверяет ровно те же компоненты.
 *
 * Проверяем не «открывается ли страница», а то, ради чего наполнялась
 * таксономия: учитель доходит до темы нового класса, видит её заголовок и
 * примеры заданий и уходит в конструктор по CTA.
 *
 * Запуск (dev-сервер должен быть поднят):
 *   npx next dev -p 3111
 *   npx tsx scripts/verify-ui-dev.ts --base=http://127.0.0.1:3111
 */

import { chromium, type Page } from "playwright";

import { subjects, getSubject, getGrade, getTopic } from "../src/lib/content/subjects";
import { WEEKLY_TOPICS } from "../src/lib/content/weekly-topics";

const argBase = process.argv.find((a) => a.startsWith("--base="));
const BASE = (argBase ? argBase.slice("--base=".length) : "http://127.0.0.1:3111").replace(/\/$/, "");

const failed: string[] = [];
let passed = 0;

interface Check {
  name: string;
  url: string;
  expect: string[];
  reject?: string[];
}

function push(checks: Check[], c: Check) {
  checks.push(c);
}

/**
 * Классы, которых НЕ было до наполнения таксономии. Именно их страницы —
 * главный риск: если generateStaticParams/роут их не покрывает, учитель
 * получит 404. Список зафиксирован, чтобы регрессия ловилась явно.
 */
const NEW_CLASSES: Array<[string, number]> = [
  ["algebra", 10], ["algebra", 11],
  ["geometry", 10], ["geometry", 11],
  ["physics", 10], ["physics", 11],
  ["russian", 1], ["russian", 10], ["russian", 11],
  ["english", 1], ["english", 3], ["english", 10], ["english", 11],
  ["german", 7], ["german", 8], ["german", 9], ["german", 10], ["german", 11],
  ["informatics", 6], ["informatics", 9], ["informatics", 10], ["informatics", 11],
  ["geography", 11],
  ["technology", 7], ["technology", 8], ["technology", 9],
  ["finance", 8],
  ["music", 2], ["music", 4], ["music", 5], ["music", 6], ["music", 7], ["music", 8],
  ["art", 2], ["art", 3], ["art", 4], ["art", 6], ["art", 7], ["art", 8],
  ["pe", 2], ["pe", 3], ["pe", 4], ["pe", 6], ["pe", 7], ["pe", 8], ["pe", 9], ["pe", 10], ["pe", 11],
];

function buildChecks(): Check[] {
  const checks: Check[] = [];

  push(checks, { name: "главная", url: "/", expect: ["РабочиеЛисты"] });

  // По странице предмета — навигация не должна вести в пустоту.
  for (const s of subjects) {
    push(checks, {
      name: `предмет ${s.slug}`,
      url: `/subject/${s.slug}/`,
      expect: [s.title],
      reject: ["Тема не найдена", "This page could not be found"],
    });
  }

  // Каждый новый класс: страница класса + ВСЕ его темы.
  for (const [slug, gradeNum] of NEW_CLASSES) {
    const grade = getGrade(slug, gradeNum);
    if (!grade) {
      failed.push(`нет класса ${slug}/${gradeNum} в таксономии`);
      continue;
    }
    push(checks, {
      name: `класс ${slug}/${gradeNum}`,
      url: `/subject/${slug}/${gradeNum}/`,
      expect: [`${gradeNum} класс`],
      reject: ["Тема не найдена", "This page could not be found"],
    });
    for (const t of grade.topics) {
      push(checks, {
        name: `тема ${slug}/${gradeNum}/${t.slug}`,
        url: `/subject/${slug}/${gradeNum}/${t.slug}/`,
        expect: [t.title],
        reject: ["Тема не найдена", "This page could not be found"],
      });
    }
  }

  // Исправленные слаги физики — проверяем, что новая страница живая.
  push(checks, {
    name: "исправленный слаг isparenie-kipenie",
    url: "/subject/physics/8/isparenie-kipenie/",
    expect: ["Испарение"],
    reject: ["This page could not be found"],
  });
  push(checks, {
    name: "исправленный слаг reaktivnoe-dvizhenie",
    url: "/subject/physics/9/reaktivnoe-dvizhenie/",
    expect: ["Реактивное"],
    reject: ["This page could not be found"],
  });

  // Страницы «Темы недели» — виджет на главной ведёт туда.
  for (const wt of WEEKLY_TOPICS.slice(0, 4)) {
    push(checks, {
      name: `тема недели ${wt.seoSlug}`,
      url: `/theme/${wt.seoSlug}/`,
      expect: [],
      reject: ["This page could not be found"],
    });
  }

  return checks;
}

async function main() {
  const checks = buildChecks();
  console.log(`[verify-ui-dev] проверок: ${checks.length}, base: ${BASE}\n`);

  const browser = await chromium.launch();
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  for (const c of checks) {
    let status = 0;
    try {
      // waitUntil: "load" — на dev-сервере клики по серверному HTML уходят
      // раньше, чем React навесит обработчики.
      const res = await page.goto(BASE + c.url, { waitUntil: "load", timeout: 60000 });
      status = res?.status() ?? 0;
    } catch (e) {
      failed.push(`${c.name} (${c.url}) — не открылась: ${String(e).split("\n")[0]}`);
      continue;
    }
    if (status !== 200) {
      failed.push(`${c.name} (${c.url}) — HTTP ${status}`);
      continue;
    }
    const text = await page.locator("body").innerText();
    let bad = false;
    for (const needle of c.expect) {
      if (!text.includes(needle)) {
        failed.push(`${c.name} (${c.url}) — нет текста «${needle}»`);
        bad = true;
      }
    }
    for (const needle of c.reject ?? []) {
      if (text.includes(needle)) {
        failed.push(`${c.name} (${c.url}) — мусор «${needle}»`);
        bad = true;
      }
    }
    if (!bad) passed++;
  }

  // Интерактив: со страницы темы CTA в конструктор рабочий,
  // а на странице темы реально видны примеры заданий.
  const probe = getSubject("pe");
  const probeGrade = probe ? getGrade("pe", 11) : undefined;
  const probeTopic = probeGrade?.topics[0];
  if (probe && probeGrade && probeTopic) {
    const url = `${BASE}/subject/pe/11/${probeTopic.slug}/`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    const h1 = await page.locator("h1").first().innerText().catch(() => "");
    if (!h1.includes(probeTopic.title)) {
      failed.push(`H1 на pe/11 — «${h1}» вместо «${probeTopic.title}»`);
    } else {
      passed++;
    }
    // Примеры заданий — это то, из чего генерируется лист.
    const body = await page.locator("body").innerText();
    if (!body.includes(probeTopic.examples[0].text.replace(/__/g, "").slice(0, 20))) {
      failed.push(`на pe/11 не видно текста первого примера задания`);
    } else {
      passed++;
    }
    const cta = page.locator('a[href*="/constructor"]').first();
    if ((await cta.count()) === 0) {
      failed.push("на странице темы нет ссылки в конструктор");
    } else {
      await cta.click();
      await page.waitForURL(/constructor/, { timeout: 30000 }).catch(() => {
        failed.push("клик по CTA не привёл в конструктор");
      });
      if (page.url().includes("/constructor")) passed++;
    }
  }

  await browser.close();

  console.log(`\n[verify-ui-dev] успешно: ${passed}, провалено: ${failed.length}`);
  if (consoleErrors.length) {
    console.log(`[verify-ui-dev] ошибок в консоли браузера: ${consoleErrors.length}`);
    for (const e of consoleErrors.slice(0, 5)) console.log(`    - ${e.slice(0, 150)}`);
  }
  if (failed.length) {
    for (const f of failed.slice(0, 40)) console.log(`    ✗ ${f}`);
    if (failed.length > 40) console.log(`    ... ещё ${failed.length - 40}`);
    process.exit(1);
  }
  console.log("[verify-ui-dev] все проверки пройдены");
}

main().catch((e) => {
  console.error("[verify-ui-dev] упало:", e);
  process.exit(1);
});

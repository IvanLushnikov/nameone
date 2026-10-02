/**
 * UI-проверка остальных разделов, которые читают темы.
 *
 * scripts/verify-ui-dev.ts проверяет /subject/. Но темы таксономии читают
 * ещё три раздела — конспект урока, презентация и КТП. Новый класс,
 * который отдаёт 404 в /subject/, может точно так же сломаться в них:
 * `generateStaticParams` там такой же, а страницы падали бы иначе
 * (например, презентация требует список слайдов от темы).
 *
 * Проверяем не всё подряд (это 3×1070 страниц), а по одному классу
 * из каждого нового набора — риск-выборку: если роут падает на теме
 * без `examples`, он упадёт везде одинаково.
 *
 * Запуск (dev-сервер поднят на 3111):
 *   npx tsx scripts/verify-artifacts-ui.ts --base=http://127.0.0.1:3111
 */

import { chromium } from "playwright";

import { getGrade } from "../src/lib/content/subjects";

const argBase = process.argv.find((a) => a.startsWith("--base="));
const BASE = (argBase ? argBase.slice("--base=".length) : "http://127.0.0.1:3111").replace(/\/$/, "");

/** Классы, которых не было до наполнения — берём по одному на раздел. */
const ALL_PROBES: Array<[string, number]> = [
  ["algebra", 10],
  ["physics", 11],
  ["russian", 1],
  ["english", 11],
  ["german", 9],
  ["informatics", 10],
  ["geography", 11],
  ["technology", 8],
  ["finance", 8],
  ["music", 7],
  ["art", 3],
  ["pe", 11],
  ["obzh", 9],
  ["social", 10],
  ["history", 7],
  ["biology", 9],
  ["chemistry", 10],
  ["literature", 8],
  ["okruzhaet", 2],
];

const failed: string[] = [];
let passed = 0;

interface Check {
  name: string;
  url: string;
  expect: string[];
  reject?: string[];
}

function buildChecks(): Check[] {
  const checks: Check[] = [];
  // `--only=N` — взять первые N классов. Нужно, когда машина перегружена:
  // dev-сервер компилирует первую страницу минутами, и 57 проверок
  // не помещаются в разумное время.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? Number(onlyArg.slice("--only=".length)) : ALL_PROBES.length;
  const probes = ALL_PROBES.slice(0, only);
  console.log(`[verify-artifacts-ui] классов к проверке: ${probes.length}${only < ALL_PROBES.length ? ` (из ${ALL_PROBES.length}, режим smoke)` : ""}`);
  for (const [slug, gradeNum] of probes) {
    const grade = getGrade(slug, gradeNum);
    if (!grade) {
      failed.push(`нет класса ${slug}/${gradeNum} в таксономии`);
      continue;
    }
    const topic = grade.topics[0];
    if (!topic) {
      failed.push(`в классе ${slug}/${gradeNum} нет тем`);
      continue;
    }
    // Конспект урока — по теме.
    checks.push({
      name: `lesson-plan ${slug}/${gradeNum}`,
      url: `/lesson-plan/${slug}/${gradeNum}/${topic.slug}/`,
      expect: [topic.title],
      reject: ["Тема не найдена", "This page could not be found"],
    });
    // Презентация — по теме.
    checks.push({
      name: `presentation ${slug}/${gradeNum}`,
      url: `/presentation/${slug}/${gradeNum}/${topic.slug}/`,
      expect: [topic.title],
      reject: ["Тема не найдена", "This page could not be found"],
    });
    // КТП — по классу, без темы.
    checks.push({
      name: `ktp ${slug}/${gradeNum}`,
      url: `/ktp/${slug}/${gradeNum}/`,
      expect: [`${gradeNum} класс`],
      reject: ["Тема не найдена", "This page could not be found"],
    });
  }
  return checks;
}

async function main() {
  const checks = buildChecks();
  console.log(`[verify-artifacts-ui] проверок: ${checks.length}, base: ${BASE}\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  for (const c of checks) {
    let status = 0;
    try {
      const res = await page.goto(BASE + c.url, { waitUntil: "load", timeout: 90000 });
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
    if (!bad) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      console.log(`  ✗ ${c.name}`);
    }
  }

  await browser.close();

  console.log(`\n[verify-artifacts-ui] успешно: ${passed}, провалено: ${failed.length}`);
  if (consoleErrors.length) {
    console.log(`[verify-artifacts-ui] ошибок в консоли: ${consoleErrors.length}`);
    for (const e of consoleErrors.slice(0, 5)) console.log(`    - ${e.slice(0, 150)}`);
  }
  if (failed.length) {
    for (const f of failed) console.log(`    ✗ ${f}`);
    process.exit(1);
  }
  console.log("[verify-artifacts-ui] все разделы работают на новых классах");
}

main().catch((e) => {
  console.error("[verify-artifacts-ui] упало:", e);
  process.exit(1);
});

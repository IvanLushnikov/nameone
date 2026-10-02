/**
 * UI-проверка дополненных тем: видно ли учителю добавленные примеры.
 *
 * `topic-examples-extra/` дописывает примеры к темам, у которых их был один.
 * Риск не в данных, а в разметке: примеры дописываются в конец массива, и
 * страница может показать только первые три, либо упасть на длинном списке.
 * Проверяем, что на странице видны ВСЕ примеры темы, а не только первый.
 *
 * Запуск (dev-сервер поднят на 3115):
 *   npx tsx scripts/verify-examples-ui.ts --base=http://127.0.0.1:3115
 */

import { chromium } from "playwright";

import { subjects, getTopic } from "../src/lib/content/subjects";
import { EXTRA_EXAMPLES } from "../src/lib/content/topic-examples-extra";

const argBase = process.argv.find((a) => a.startsWith("--base="));
const BASE = (argBase ? argBase.slice("--base=".length) : "http://127.0.0.1:3115").replace(/\/$/, "");

const failed: string[] = [];
let passed = 0;

/** Ключи дополнений, разобранные обратно в (предмет, класс, slug). */
const TARGETS = Object.keys(EXTRA_EXAMPLES).map((key) => {
  const [subject, grade, topic] = key.split("/");
  return { key, subject, grade: Number(grade), topic };
});

async function main() {
  console.log(`[verify-examples-ui] дополненных тем: ${TARGETS.length}, base: ${BASE}\n`);

  // Сколько примеров должно быть видно на странице — считаем по данным,
  // а не хардкодим, чтобы расхождение ловилось здесь, а не на глаз.
  const expectations = TARGETS.map((t) => {
    const topic = getTopic(t.subject, t.grade, t.topic);
    return { ...t, full: topic, count: topic?.examples.length ?? 0 };
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (const e of expectations) {
    if (!e.full) {
      failed.push(`${e.key}: тема не найдена в таксономии`);
      continue;
    }
    const url = `${BASE}/subject/${e.subject}/${e.grade}/${e.topic}/`;
    try {
      const res = await page.goto(url, { waitUntil: "load", timeout: 60000 });
      if ((res?.status() ?? 0) !== 200) {
        failed.push(`${e.key} — HTTP ${res?.status()}`);
        continue;
      }
      const text = await page.locator("body").innerText();

      // Заголовок темы на месте.
      if (!text.includes(e.full.title)) {
        failed.push(`${e.key} — нет заголовка «${e.full.title}»`);
        continue;
      }

      // Каждый пример должен быть виден на странице.
      const missing = e.full.examples.filter((ex) => {
        const probe = ex.text.replace(/__/g, "").trim().slice(0, 28);
        return probe.length > 4 && !text.includes(probe);
      });
      if (missing.length) {
        failed.push(
          `${e.key} — не видно ${missing.length} из ${e.count} примеров; первый скрытый: «${missing[0].text.slice(0, 50)}»`,
        );
        continue;
      }
      passed++;
      console.log(`  ✓ ${e.key} — ${e.count} примеров на странице`);
    } catch (err) {
      failed.push(`${e.key} — ${String(err).split("\n")[0]}`);
    }
  }

  await browser.close();

  console.log(`\n[verify-examples-ui] успешно: ${passed}, провалено: ${failed.length}`);
  if (failed.length) {
    for (const f of failed.slice(0, 30)) console.log(`    ✗ ${f}`);
    process.exit(1);
  }
  console.log("[verify-examples-ui] все примеры видны на страницах тем");
}

main().catch((e) => {
  console.error("[verify-examples-ui] упало:", e);
  process.exit(1);
});

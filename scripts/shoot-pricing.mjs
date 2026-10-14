/**
 * Цены на экране (остаток ТЗ-36 / пункт C20).
 *
 * ЧТО ПРОВЕРЯЕМ. Числа в коде могут быть верными, а на экране — старыми:
 * страница могла закэшировать, отрисовать свой набор или не отрисовать вовсе.
 * Поэтому читаем текст страницы глазами, а не из исходника.
 *
 * Запуск: node scripts/shoot-pricing.mjs [baseUrl]
 * Предусловие: npm run dev -- --port 4318
 *
 * Возвращает 1, если какой-то тариф не показан или показана цена из старого
 * набора — раньше до снижения это были 500 / 990 / 1500.
 */

import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:4318";
const SHOTS = ".unlazy/teacher-path/shots/price-check";

/** Актуальные цены помесячных тарифов после снижения. */
const EXPECTED = ["249", "499"];
/** Цены, которых на странице быть не должно: старый набор до снижения. */
const FORBIDDEN = ["500 ₽", "990 ₽", "1 500 ₽"];

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1200);

  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  await page.screenshot({ path: `${SHOTS}/pricing-1440x900.png`, fullPage: false });

  const found = EXPECTED.filter((p) => text.includes(p));
  const stale = FORBIDDEN.filter((p) => text.includes(p));

  console.log(`[shoot-pricing] актуальные цены найдены: ${found.join(", ") || "—"}`);
  console.log(`[shoot-pricing] старые цены на странице: ${stale.join(", ") || "нет"}`);
  console.log(`[shoot-pricing] снимок: ${SHOTS}/pricing-1440x900.png`);

  await browser.close();

  if (found.length !== EXPECTED.length || stale.length > 0) {
    console.error("[shoot-pricing] Цены на экране не совпадают с актуальными.");
    process.exit(1);
  }
  console.log("PRICES_ON_SCREEN_OK");
}

main().catch((err) => {
  console.error(`[shoot-pricing] Не получилось: ${err.message}`);
  console.error("Проверь, что сервер поднят: npm run dev -- --port 4318");
  process.exit(1);
});
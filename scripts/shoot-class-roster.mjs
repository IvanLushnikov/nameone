/**
 * Скриншоты пути учителя для листа 3.1.5.
 *
 * Запуск: node scripts/shoot-class-roster.mjs [baseUrl]
 * Предусловие: поднят `npm run dev -- --port 4316`.
 *
 * ЗАЧЕМ ПОДМЕНА. Блок «Ученики и персональные QR» показывает данные только
 * владельцу аккаунта, а входа у нас нет: почта, письмо, сессия. Поэтому
 * подменяются ровно три ответа бэка — сессия, профиль и список класса. Ничего
 * больше: рендер, вёрстка, переносы и нажатия — настоящие, скрипт только
 * отвечает за те ответы, до которых у теста нет честного пути.
 */

import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:4316";
const SHOTS = ".unlazy/teacher-path/shots/leaf-3.1.5";

const ACCOUNT = {
  profile: {
    email: "teacher@example.com",
    name: "Иванова Мария Петровна",
    classes: ["5А", "5Б", "8Б"],
  },
};

const ROSTER = {
  classes: [
    {
      id: "cls_5a",
      name: "5А",
      createdAt: 1,
      students: [
        { id: "stu_1", name: "Ковалева-Александрова Екатерина", token: "t1", createdAt: 1 },
        { id: "stu_2", name: "Петров", token: "t2", createdAt: 1 },
        { id: "stu_3", name: "Сидоров Николай", token: "t3", createdAt: 1 },
      ],
    },
  ],
  removedStudents: [],
};

const FORMS = {
  forms: [
    { id: "frm_1", title: "Рациональные дроби · 8 класс", subject: "math", grade: 8, token: "pt1", responsesCount: 2 },
  ],
};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();

  const results = [];
  for (const vp of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    const ctx = await browser.newContext({ viewport: vp, locale: "ru-RU" });
    const page = await ctx.newPage();

    await page.route("**/api/auth/me", (r) =>
      r.fulfill({ json: { user: { id: "usr_1", email: "teacher@example.com" } } }),
    );
    await page.route("**/api/account/profile", (r) => r.fulfill({ json: ACCOUNT }));
    await page.route("**/api/classes", (r) => r.fulfill({ json: ROSTER }));
    await page.route("**/api/assignments/forms**", (r) => r.fulfill({ json: FORMS }));

    await page.goto(`${BASE}/dashboard/settings`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForSelector('[data-testid="class-roster"]', { timeout: 30_000 });
    await page.waitForTimeout(800);

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const tag = `${vp.width}x${vp.height}`;
    await page.screenshot({ path: `${SHOTS}/settings-${tag}.png`, fullPage: true });
    await page
      .locator('[data-testid="class-roster"]')
      .screenshot({ path: `${SHOTS}/roster-${tag}.png` })
      .catch(() => {});

    const overflow = scrollWidth - innerWidth;
    results.push({ tag, overflow, scrollWidth, innerWidth });
    console.log(`  ${tag}: ширина ${scrollWidth} при окне ${innerWidth} → переполнение ${overflow}`);
    await ctx.close();
  }

  await browser.close();

  const worst = Math.max(...results.map((r) => r.overflow));
  if (worst > 0) {
    console.error(`\n[shoot-class-roster] Есть горизонтальное переполнение: до ${worst} px.`);
    process.exit(1);
  }
  console.log(`\n[shoot-class-roster] Переполнения нет ни на одной ширине. Снимки: ${SHOTS}/`);
}

main().catch((err) => {
  console.error(`[shoot-class-roster] Не получилось: ${err.message}`);
  console.error("Проверь, что сервер поднят: npm run dev -- --port 4316");
  process.exit(1);
});

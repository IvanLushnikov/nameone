/**
 * Проверка отображения формул в рабочем листе (лист 2.1.4).
 *
 * Запуск (десктопный dev-сервер уже поднят):
 *   node scripts/check-formula-rendering.mjs [baseUrl]
 *   BASE=http://127.0.0.1:4313 node scripts/check-formula-rendering.mjs
 *
 * ЧТО ПРОВЕРЯЕМ (это гейты G1 и G2).
 *   G1. На экране дробь нарисована ДРОБЬЮ: у каждой `.mfrac` есть черта
 *       `.frac-line`, а в тексте листа не осталось ни одной линейной записи
 *       вида `(x² − 9)/(x² + 6x + 9)`.
 *   G2. В выгрузке DOCX дробь приезжает OMML-дробью (`<m:f>` с `<m:num>` и
 *       `<m:den>`), а не строкой со скобками.
 *
 * КАК ПОЛУЧАЕМ ЧЕСТНЫЙ МАТЕРИАЛ. Артефакт с `isDemo: true` кладём в localStorage
 * истории (`uchlist.history`) и открываем `/preview?id=<id>` — ровно тот путь,
 * которым учитель открывает лист из кабинета. Подделки на уровне флага нет:
 * `isDemo` лежит в самом артефакте, превью читает именно его.
 *
 * Файл DOCX скачивается НАСТОЯЩИМ кликом по кнопке «DOCX» — тем же путём, каким
 * учитель нажимает «скачать». Файл распаковывается и проверяется по
 * `word/document.xml`.
 *
 * ЧТО СКРИПТ НЕ ПРОВЕРЯЕТ (честно): он не открывает Word и не печатает на
 * принтере. Совместимость OMML с конкретной версией Word подтверждается тем,
 * что разметка собрана библиотекой `docx` по спецификации, а не нашим кодом.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:4313").replace(/\/$/, "");
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "..", ".unlazy", "teacher-path", "shots", "leaf-2.1.4");
const KEY_HISTORY = "uchlist.history";

const ID = "shot-frac-demo";

/** Жалоба учительницы — ради этого листа всё и затевалось. */
const PAREN_FRACTION = "(x² − 9)/(x² + 6x + 9)";

const worksheet = {
  id: ID,
  title: "Рациональные дроби · Алгебра · 8 класс",
  subject: "algebra",
  grade: 8,
  topic: "Рациональные дроби",
  difficulty: "medium",
  isDemo: true,
  createdAt: "2026-10-14T10:00:00.000Z",
  tasks: [
    {
      number: 1,
      text: `Сократите дробь ${PAREN_FRACTION} и укажите область определения.`,
      answer: "(x − 3)/(x + 3), x ≠ −3",
      explanation: "Раскладываем числитель по формуле сокращения и сокращаем на (x + 3).",
      points: 2,
    },
    {
      number: 2,
      text: "Решите уравнение 2x + 5 = 11 и запишите корень.",
      answer: "x = 3",
      explanation: "2x = 6, значит x = 3.",
      points: 1,
    },
    {
      number: 3,
      text: "Найдите значение выражения 5/(x + 1) при x = 4.",
      answer: "1",
      explanation: "Подставляем x = 4 и считаем.",
      points: 1,
    },
    {
      number: 4,
      text: "Сколько будет 3/4 + 1/4? Запишите ответ.",
      answer: "1",
      explanation: "Складываем дроби с одинаковым знаменателем.",
      points: 1,
    },
    {
      number: 5,
      text: "Автомобиль ехал 3 ч со скоростью 60 км/ч. Какой путь он проехал?",
      answer: "180 км",
      explanation: "s = 60 · 3 = 180 км.",
      points: 2,
    },
    {
      // Специально битая формула: показывает, ЧТО видит учитель, когда модель
      // принесла негодный LaTeX. Это запасной путь, а не норма.
      number: 6,
      text: "Упростите выражение (a + 3)/(a − 3).",
      text_latex: "Упростите выражение $\\frac{1}{$",
      answer: "не упрощается",
      explanation: "Разность дробей приводим к общему знаменателю.",
      points: 2,
    },
  ],
};

const history = [
  {
    id: ID,
    type: "worksheet",
    title: worksheet.title,
    subject: worksheet.subject,
    grade: worksheet.grade,
    createdAt: worksheet.createdAt,
    isFavorite: false,
    artifact: worksheet,
  },
];

/** 1440×900 — ноутбук Ивана, 1920×1080 — большое окно, 390 — телефон. */
const VIEWPORTS = [
  { tag: "1440x900", width: 1440, height: 900 },
  { tag: "1920x1080", width: 1920, height: 1080 },
  { tag: "390x844", width: 390, height: 844 },
];

const failures = [];
const report = [];
const notes = [];

function check(name, ok, detail) {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  report.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

/** Замечание без падения гейта: дефект есть, но он не в зоне этого листа. */
function note(text) {
  notes.push(text);
}

async function openPreview(browser, width, height, media) {
  const page = await browser.newPage({
    viewport: { width, height },
    acceptDownloads: true,
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [KEY_HISTORY, JSON.stringify(history)]
  );
  await page.goto(`${BASE}/preview?id=${ID}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector(".worksheet-page", { timeout: 30_000 });
  // KaTeX грузится лениво: ждём именно появления отрисованной формулы.
  await page.waitForSelector(".katex", { timeout: 30_000 }).catch(() => {});
  if (media) await page.emulateMedia({ media });
  await page.waitForTimeout(400);
  return page;
}

/** Что на самом деле нарисовано в задании — читаем по DOM, не по глазам. */
async function probe(page) {
  return page.evaluate((linear) => {
    const sheets = [...document.querySelectorAll(".worksheet-page")];
    const sheet = sheets[0];
    const answers = sheets[1];
    const text = sheet ? (sheet.textContent ?? "") : "";
    const fracs = [...document.querySelectorAll(".mfrac")];
    const r = sheet ? sheet.getBoundingClientRect() : null;
    return {
      fracs: fracs.length,
      // Дробь без черты — это не дробь, а сломанная вёрстка.
      withoutLine: fracs.filter((f) => !f.querySelector(".frac-line")).length,
      // Дробь в ОТВЕТАХ: то, по чему учитель сверяет, должно быть напечатано
      // так же, как в задании.
      answerFracs: answers ? answers.querySelectorAll(".mfrac").length : 0,
      katex: document.querySelectorAll(".katex").length,
      linearLeft: text.includes(linear),
      hasBaseline: text.includes("2x + 5 = 11"),
      hasPlainSpeed: text.includes("км/ч"),
      // ЛИСТ целиком в окне. Проверяем сам материал, а не страницу: панель
      // кнопок «Как шаблон / PDF / DOCX» — файл другого листа, и на 390 px
      // она вылезает за экран БЕЗ нашей правки (проверено: полотно 515 px и с
      // дробью, и совсем без формул). Замазывать это здесь нельзя — гейт
      // должен падать на нашем дефекте, а не на чужом.
      sheetFits: r ? r.left >= -1 && r.right <= window.innerWidth + 1 : false,
      sheetRight: r ? Math.round(r.right) : null,
      viewport: window.innerWidth,
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  }, PAREN_FRACTION);
}

async function main() {
  // Префлайт: скрипту нужен поднятый десктопный сервер. Без этой проверки
  // Playwright падает стектрейсом `net::ERR_CONNECTION_REFUSED`, из которого
  // не видно, что делать. Здесь — прямое объяснение и код 1.
  try {
    const probe = await fetch(BASE, { signal: AbortSignal.timeout(5_000) });
    if (!probe.ok) throw new Error(`статус ${probe.status}`);
  } catch (err) {
    console.error(
      `[check-formula-rendering] Dev-сервер не отвечает на ${BASE}\n` +
        `  Причина: ${err.message}\n` +
        `  Что сделать: поднять сервер на порту 4313 и повторить —\n` +
        `    npm run dev -- --port 4313   (в отдельном терминале)\n` +
        `    node scripts/check-formula-rendering.mjs\n` +
        `  Скрипт проверяет картинкой: дробь на экране и дробь в выгрузке DOCX.`,
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    const page = await openPreview(browser, vp.width, vp.height, null);
    const p = await probe(page);

    // G1: дробь есть, черт у неё есть, линейной записи не осталось.
    check(`${vp.tag}: нарисованы вертикальные дроби (KaTeX)`, p.fracs > 0, `дробей ${p.fracs}`);
    check(`${vp.tag}: у каждой дроби есть черта`, p.withoutLine === 0, `без черты ${p.withoutLine}`);
    check(`${vp.tag}: линейная запись «${PAREN_FRACTION}» не осталась`, !p.linearLeft);
    // Регресс: базовые случаи обязаны остаться нетронутыми.
    check(`${vp.tag}: «2x + 5 = 11» осталось текстом`, p.hasBaseline);
    check(`${vp.tag}: «км/ч» не превратилось в дробь`, p.hasPlainSpeed);
    check(`${vp.tag}: дробь в ОТВЕТЕ тоже нарисована дробью`, p.answerFracs > 0, `дробей ${p.answerFracs}`);
    check(`${vp.tag}: лист помещается в окно`, p.sheetFits, `правый край ${p.sheetRight}px из ${p.viewport}px`);
    if (p.docOverflow > 0) {
      note(
        `${vp.tag}: страница целиком шире окна на ${p.docOverflow}px — виновата панель кнопок ` +
          `«Как шаблон / PDF / DOCX» в src/app/preview/page.tsx, не формулы: полотно одинаково ` +
          `и с дробью, и совсем без формул. Файл не наш, гейт на него не смотрит.`
      );
    }

    await page.screenshot({
      path: join(SHOTS, `worksheet-formula-${vp.tag}.png`),
      fullPage: true,
    });
    const sheet = await page.$(".worksheet-page");
    const box = await sheet?.boundingBox();
    if (box) {
      await page.screenshot({
        path: join(SHOTS, `worksheet-formula-${vp.tag}-sheet.png`),
        clip: box,
      });
    }

    // Печать — тоже путь учителя: Ctrl+P. Снимаем без фоновой графики, потому
    // что именно так печатает большинство (галочка по умолчанию выключена).
    if (vp.tag === "1440x900") {
      const printPage = await openPreview(browser, vp.width, vp.height, "print");
      const pp = await probe(printPage);
      check("печать: дробь осталась дробью", pp.fracs > 0 && pp.withoutLine === 0, `дробей ${pp.fracs}`);
      check("печать: линейной записи нет", !pp.linearLeft);

      await printPage.screenshot({
        path: join(SHOTS, "worksheet-formula-print.png"),
        fullPage: true,
      });
      await printPage.pdf({
        path: join(SHOTS, "worksheet-formula-nobg.pdf"),
        format: "A4",
        printBackground: false,
      });
      await printPage.close();
    }

    await page.close();
  }

  /* --- G2: настоящая выгрузка DOCX нажатием кнопки «DOCX» ---------------- */
  const page = await openPreview(browser, 1440, 900, null);
  const hasButton = await page.$$eval("button", (nodes) =>
    nodes.some((n) => (n.textContent ?? "").trim() === "DOCX")
  );
  if (!hasButton) {
    check("DOCX: кнопка выгрузки найдена на странице", false);
  } else {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.$$eval("button", (nodes) => {
        const btn = nodes.find((n) => (n.textContent ?? "").trim() === "DOCX");
        if (btn) btn.click();
      }),
    ]);
    const docxPath = join(SHOTS, "algebra-8kl-racionalnye-drobi.docx");
    await download.saveAs(docxPath);

    const xml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });

    // Сама разметка формул из файла — доказательство без посредников.
    writeFileSync(
      join(SHOTS, "docx-omml.txt"),
      [...xml.matchAll(/<m:oMath>.*?<\/m:oMath>/g)].map((m) => m[0]).join("\n") +
        "\n\n=== файл целиком: " +
        docxPath +
        " ===\n"
    );

    const fracCount = (xml.match(/<m:f>/g) ?? []).length;
    check("DOCX: дробь приезжает OMML-дробью", fracCount >= 2, `дробей ${fracCount}`);
    check("DOCX: у дроби есть числитель и знаменатель", xml.includes("<m:num>") && xml.includes("<m:den>"));
    check("DOCX: формула вставлена как математика, а не как текст", xml.includes("oMath"));
    check("DOCX: линейной записи со скобками в файле нет", !xml.includes(PAREN_FRACTION));
    check("DOCX: «2x + 5 = 11» осталось текстом", xml.includes("2x + 5 = 11"));
    check("DOCX: степень внутри дроби не потерялась", xml.includes("x²"));
  }
  await page.close();
  await browser.close();

  console.log(report.join("\n"));
  if (notes.length > 0) {
    console.log("");
    console.log("ЗАМЕЧАНИЯ (не роняют гейт, чужой файл):");
    for (const n of notes) console.log(`  · ${n}`);
  }
  console.log("");
  if (failures.length > 0) {
    console.error(`FORMULA_RENDERING_FAIL (${failures.length}):`);
    for (const f of failures) console.error(`  · ${f}`);
    process.exit(1);
  }
  console.log(`FORMULA_RENDERING_OK (снимки: ${SHOTS})`);
}

await main();
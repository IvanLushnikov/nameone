/**
 * Проверка панели действий на `/preview` (лист 6.1.4).
 *
 * Два режима.
 *
 * 1) БЕЗ АРГУМЕНТОВ — проверка по исходнику (гейт G2). Портативный Node без
 *    зависимостей: читает `src/app/preview/page.tsx` как текст и проверяет
 *    свойства панели, из-за которых она вылезала за окно телефона. Печатает
 *    `PREVIEW_OVERFLOW_FIXED_OK` и завершается с кодом 0; при нарушении — код 1.
 *
 *      node scripts/check-preview-overflow-source.mjs
 *
 * 2) `--measure <baseUrl> [--tag before]` — измерение в браузере (доказательство G1).
 *    Открывает `/preview` с демо-листом в истории устройства и печатает `scrollWidth`
 *    против `innerWidth` — та же величина и та же формула, что в
 *    `scripts/check-mobile-overflow.mjs` (`documentElement.scrollWidth -
 *    innerWidth`). Отдельный режим нужен потому, что у того скрипта список
 *    страниц зашит в исходнике, `/preview` в него не входит, а демо-лист
 *    надо ещё положить в историю устройства. Скриншоты кладёт в
 *    `.unlazy/teacher-path/shots/leaf-6.1.4/`. `--tag` добавляется к именам
 *    снимков, чтобы «до» и «после» не затирали друг друга.
 *
 *      node scripts/check-preview-overflow-source.mjs --measure http://127.0.0.1:4314 --tag before
 *
 * ПОЧЕМУ ИМЕННО ТАК. 14.10.2026: на 390 px страница превью была шире окна.
 * Лист 2.1.4 замерил +125 px, наш демо-лист с длинным названием даёт +130 px
 * (полотно 520 px при окне 390 px) — величина зависит от названия, суть одна.
 * `.container-tight` даёт 358 px полезной ширины, а четыре кнопки в один ряд
 * («Как шаблон», «В избранное», «PDF», «DOCX») занимали 504 px, и ряд НЕ
 * переносился: контейнер панели был `flex items-center gap-2` без `flex-wrap`.
 * Родительский ряд умел переноситься, но переносить ему было нечего — вложенный
 * ряд сам по себе не сжимался, отдавал родителю свою максимальную ширину и
 * растягивал всю страницу.
 */

/* ─────────────────────────── режим 1: проверка по исходнику ─────────────────── */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_SRC = join(HERE, "..", "src", "app", "preview", "page.tsx");

const sourceFailures = [];
const sourceReport = [];

function srcCheck(name, ok, detail) {
  sourceReport.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) sourceFailures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Комментарии вырезаем. Первая версия искала панель по строке «Как шаблон» и
 * попадала в СВОЙ ЖЕ комментарий над разметкой, откуда откатывалась на
 * полстраницы назад и проверяла чужой контейнер — гейт проходил на пустом месте.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/**
 * Классы ближайшего `<div className="…">` перед позицией idx и его индекс.
 * nth = 1 — самый близкий.
 */
function divClassBefore(src, idx, nth = 1) {
  const OPEN = '<div className="';
  const positions = [];
  for (let i = src.indexOf(OPEN); i !== -1 && i < idx; i = src.indexOf(OPEN, i + 1)) {
    positions.push(i);
  }
  if (positions.length < nth) return null;
  const open = positions[positions.length - nth];
  const close = src.indexOf('"', open + OPEN.length);
  return close === -1 ? null : { classes: src.slice(open + OPEN.length, close), open };
}

/** Классы контейнера панели действий (родителя кнопки «Как шаблон»). */
function findActionPanelClasses(src) {
  const anchor = src.indexOf("Как шаблон");
  if (anchor === -1) return null;
  return divClassBefore(src, anchor, 1)?.classes ?? null;
}

/**
 * Строка шапки — элемент, ВМЕСТИВАЮЩИЙ панель.
 *
 * Считать div'ы «назад» нельзя: блок с названием в разметке записан ДО панели,
 * поэтому «ближайший назад» — это он, а не строка шапки. Ищем по смыслу: строка
 * шапки помечена `no-print` (панель на печать не идёт) и содержит кнопки.
 */
function findHeaderRowClasses(src) {
  const anchor = src.indexOf("Как шаблон");
  if (anchor === -1) return null;
  const panel = divClassBefore(src, anchor, 1);
  if (!panel) return null;

  const OPEN = '<div className="';
  const positions = [];
  for (let i = src.indexOf(OPEN); i !== -1 && i < panel.open; i = src.indexOf(OPEN, i + 1)) {
    positions.push(i);
  }
  // Идём от панели наружу (с конца списка) и берём первый `no-print`: это и есть
  // строка шапки, внутри которой живут и название, и кнопки.
  for (let k = positions.length - 1; k >= 0; k--) {
    const at = positions[k];
    const close = src.indexOf('"', at + OPEN.length);
    if (close === -1) continue;
    const classes = src.slice(at + OPEN.length, close);
    if (classes.includes("no-print")) return classes;
  }
  return null;
}

function runSourceChecks() {
  let raw;
  try {
    raw = readFileSync(PAGE_SRC, "utf8");
  } catch (err) {
    console.error(`[check-preview-overflow-source] Не читается ${PAGE_SRC}: ${err.message}`);
    process.exit(1);
  }
  const src = stripComments(raw);

  const panel = findActionPanelClasses(src);
  const row = findHeaderRowClasses(src);

  srcCheck("исходник превью найден", typeof panel === "string", panel ?? "панель не найдена");
  if (typeof panel !== "string") return;

  const panelClasses = panel.split(/\s+/).filter(Boolean);
  const has = (c) => panelClasses.includes(c);
  const forbidden = [
    "whitespace-nowrap",
    "shrink-0",
    "flex-nowrap",
    "sr-only",
    "hidden",
  ].filter(has);

  /* ГЛАВНОЕ. Без переноса ряд из четырёх кнопок шире окна телефона —
     именно это и выносило страницу за край (замер: 520 px при окне 390 px). */
  srcCheck("панель действий переносится (`flex-wrap`)", has("flex-wrap"), panel);

  /* Ширина панели: на телефоне во всю ширину колонки, на широком экране —
     как была. Вторая часть — регресс для 1440×900 и 1920×1080. */
  srcCheck("панель на телефоне во всю ширину (`w-full`)", has("w-full"), panel);
  srcCheck(
    "на широком экране панель снова по размеру содержимого (`sm:w-auto`)",
    panelClasses.some((c) => /^sm:w-auto$/.test(c)),
    panel
  );

  /* Перечисленные свойства — обратный путь к той же поломке. */
  srcCheck(
    "панель не запрещает перенос и не прижимается по ширине",
    forbidden.length === 0,
    forbidden.join(", ")
  );

  /* Кнопки обязаны остаться видимыми и нажимаемыми: панель не прячется и не
     схлопывается ни на одной ширине. */
  srcCheck("панель не скрывается ни на одной ширине", !has("hidden") && !has("sm:hidden"), panel);

  /* Ряд шапки переносится — иначе широкая панель снова растянет страницу. */
  srcCheck("строка шапки переносится", typeof row === "string" && row.split(/\s+/).includes("flex-wrap"), row ?? "не найдена");

  /* Название листа умеет сжиматься: `min-w-0` на блоке с бейджем и заголовком.
     Без него длинное название выталкивало панель за край окна. */
  const titleBlockOk = /<div className="min-w-0/.test(src);
  srcCheck("блок с названием листа умеет сжиматься (`min-w-0`)", titleBlockOk);
  srcCheck("заголовок листа переносится по словам (`break-words`)", /text-xl font-semibold text-warm-950 break-words/.test(src));

  /* Широкий экран не должен поехать: на `sm` и выше панель остаётся в одну
     строку справа, как была. */
  srcCheck(
    "на широком экране кнопки по-прежнему в одну строку",
    !panelClasses.some((c) => /^sm:flex-wrap$/.test(c)) &&
      !panelClasses.some((c) => /^sm:flex-col$/.test(c)),
    panel
  );

  console.log(sourceReport.join("\n"));
  if (sourceFailures.length > 0) {
    console.error("");
    console.error(`PREVIEW_OVERFLOW_FIXED_FAIL (${sourceFailures.length}):`);
    for (const f of sourceFailures) console.error(`  · ${f}`);
    console.error(
      "\nПричина (лист 6.1.4): на 390 px панель действий в превью была шире окна" +
        "\n(замер: полотно 520 px при окне 390 px) — контейнер кнопок не переносился." +
        "\nЧитать: src/app/preview/page.tsx, ряд с кнопками «Как шаблон / PDF / DOCX»."
    );
    process.exit(1);
  }
  console.log("\nPREVIEW_OVERFLOW_FIXED_OK");
}

/* ───────────────────────── режим 2: измерение в браузере ───────────────────── */

const SHOTS = join(HERE, "..", ".unlazy", "teacher-path", "shots", "leaf-6.1.4");
const KEY_HISTORY = "uchlist.history";
const KEY_FAVORITES = "uchlist.favorites";
const ID = "shot-preview-panel-demo";

/**
 * Демо-лист. Название намеренно длинное и в одно слово без пробелов («Дроби»),
 * чтобы вместе с панелью проверить и крайний случай: не сжимается ли
 * заголовок. Заданий шесть — как у настоящего листа, чтобы превью отрисовалось.
 */
const worksheet = {
  id: ID,
  title: "Рациональные дроби с разложением на множители · Алгебра · 8 класс",
  subject: "algebra",
  grade: 8,
  topic: "Рациональные дроби",
  difficulty: "medium",
  isDemo: true,
  createdAt: "2026-10-14T10:00:00.000Z",
  tasks: [
    { number: 1, text: "Сократите дробь и укажите область определения.", answer: "x ≠ −3", explanation: "Раскладываем числитель и сокращаем.", points: 2 },
    { number: 2, text: "Решите уравнение 2x + 5 = 11 и запишите корень.", answer: "x = 3", explanation: "2x = 6.", points: 1 },
    { number: 3, text: "Найдите значение выражения 5/(x + 1) при x = 4.", answer: "1", explanation: "Подставляем x = 4.", points: 1 },
    { number: 4, text: "Сколько будет 3/4 + 1/4? Запишите ответ.", answer: "1", explanation: "Складываем дроби.", points: 1 },
    { number: 5, text: "Автомобиль ехал 3 ч со скоростью 60 км/ч. Какой путь он проехал?", answer: "180 км", explanation: "s = 60 · 3.", points: 2 },
    { number: 6, text: "Упростите выражение (a + 3)/(a − 3).", answer: "не упрощается", explanation: "Разность дробей.", points: 2 },
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

/**
 * Сценарий `hard` — краевые случаи, которые ломают вёрстку чаще всего:
 *  1) лист в избранном, поэтому кнопка называется «В избранном» — на две
 *     буквы длиннее «В избранное» и это самый широкий вариант панели;
 *  2) название листа — ОДНО слово без пробелов. Без `min-w-0` и `break-words`
 *     такое название не сжимается и выталкивает панель за край окна.
 */
const HARD_TITLE =
  "Сверхдлинное_слово_без_пробелов_которое_не_должно_выталкивать_панель_за_край_экрана_на_телефоне_учителя";

function buildFixture(scenario) {
  if (scenario !== "hard") {
    return {
      id: ID,
      history: JSON.stringify(history),
      favorites: JSON.stringify([]),
      label: "обычный лист",
    };
  }
  const HARD_ID = `${ID}-hard`;
  // id обязан совпадать с тем, о котором страница спрашивает в избранном,
  // иначе кнопка останется «В избранное» и краевой случай не проверится.
  const hard = { ...worksheet, id: HARD_ID, title: HARD_TITLE };
  return {
    id: HARD_ID,
    history: JSON.stringify([
      {
        id: HARD_ID,
        type: "worksheet",
        title: HARD_TITLE,
        subject: hard.subject,
        grade: hard.grade,
        createdAt: hard.createdAt,
        isFavorite: true,
        artifact: hard,
      },
    ]),
    favorites: JSON.stringify([hard]),
    label: "лист в избранном, название одним словом",
  };
}

/** 360 — самый узкий телефон, 390 — iPhone, 414 — крупный телефон,
 *  844×390 — телефон в альбомной ориентации, 1440 и 1920 — экраны учителя. */
const VIEWPORTS = [
  { tag: "360x800", width: 360, height: 800, note: "узкий телефон" },
  { tag: "390x844", width: 390, height: 844, note: "телефон" },
  { tag: "414x896", width: 414, height: 896, note: "крупный телефон" },
  { tag: "844x390-landscape", width: 844, height: 390, note: "альбомная ориентация" },
  { tag: "1440x900", width: 1440, height: 900, note: "ноутбук" },
  { tag: "1920x1080", width: 1920, height: 1080, note: "большой экран" },
];

async function runMeasure(baseUrl, tagSuffix = "", scenario = "normal", withPrint = false) {
  const base = baseUrl.replace(/\/$/, "");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(SHOTS, { recursive: true });

  try {
    const probe = await fetch(base, { signal: AbortSignal.timeout(5_000) });
    if (!probe.ok) throw new Error(`статус ${probe.status}`);
  } catch (err) {
    console.error(
      `[check-preview-overflow-source] Dev-сервер не отвечает на ${base}\n` +
        `  Причина: ${err.message}\n` +
        `  Что сделать: поднять сервер на свободном порту и повторить —\n` +
        `    npm run dev -- --port 4314   (в отдельном терминале)\n` +
        `    node scripts/check-preview-overflow-source.mjs --measure http://127.0.0.1:4314`
    );
    process.exit(1);
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const rows = [];
  const printRows = [];
  let bad = 0;
  const fixture = buildFixture(scenario);

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.addInitScript(
      (pairs) => {
        for (const [k, v] of pairs) window.localStorage.setItem(k, v);
      },
      [
        [KEY_HISTORY, fixture.history],
        [KEY_FAVORITES, fixture.favorites],
      ]
    );
    await page.goto(`${base}/preview?id=${fixture.id}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector(".worksheet-page", { timeout: 30_000 });
    await page.waitForTimeout(500);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth - window.innerWidth;

      // Панель — ближайший предок кнопок «Как шаблон» и «PDF».
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "Как шаблон"
      );
      const panel = btn?.parentElement ?? null;
      const pr = panel?.getBoundingClientRect() ?? null;

      // Кнопки панели: все должны быть видны целиком и не наезжать друг на друга.
      const buttons = panel
        ? [...panel.querySelectorAll("button, a")].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              label: (el.textContent ?? "").trim(),
              left: Math.round(r.left),
              right: Math.round(r.right),
              top: Math.round(r.top),
              width: Math.round(r.width),
              height: Math.round(r.height),
              visible: r.width > 0 && r.height > 0,
              inWindow: r.right <= window.innerWidth + 1,
            };
          })
        : [];

      // Перекрытие = две кнопки на одной строке с общей вертикалью.
      let overlap = 0;
      for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i];
          const b = buttons[j];
          if (a.top === b.top && a.right > b.left + 1 && b.right > a.left + 1) overlap += 1;
        }
      }

      const offenders = [];
      if (overflow > 0) {
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width > window.innerWidth + 1 || r.right > window.innerWidth + 1) {
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

      const title = document.querySelector("h1");
      const tr = title?.getBoundingClientRect() ?? null;
      // Блок шапки с названием — родитель h1. Он же сосед панели по ряду.
      const titleBlock = title?.parentElement ?? null;
      const tbr = titleBlock?.getBoundingClientRect() ?? null;
      // Строка шапки — родитель обоих. Панель обязана лежать внутри неё.
      const headRow = panel?.parentElement ?? null;
      const hr = headRow?.getBoundingClientRect() ?? null;

      return {
        innerWidth: window.innerWidth,
        scrollWidth: de.scrollWidth,
        overflow,
        panelFound: !!panel,
        panelWidth: pr ? Math.round(pr.width) : null,
        panelRows: panel ? new Set([...panel.children].map((c) => Math.round(c.getBoundingClientRect().top))).size : 0,
        buttons,
        overlap,
        buttonCount: buttons.length,
        titleFits: tr ? tr.right <= window.innerWidth + 1 && tr.left >= -1 : false,
        titleRight: tr ? Math.round(tr.right) : null,
        titleBlockWidth: tbr ? Math.round(tbr.width) : null,
        // Панель внутри своей строки шапки — единственная проверка «широкая
        // вёрстка не поехала», которая не зависит от длины названия листа.
        // Раньше панель уходила на вторую строку на длинных названиях, и это
        // норма: сравнивать надо с «до», а не с красивым идеалом.
        panelInsideRow: pr && hr ? pr.right <= hr.right + 1 && pr.left >= hr.left - 1 : null,
        panelBesideTitle: pr && tbr ? Math.abs(pr.top - tbr.top) <= 2 : null,
        titleLeft: tbr ? Math.round(tbr.left) : null,
        panelLeft: pr ? Math.round(pr.left) : null,
        offenders: offenders.slice(0, 5),
      };
    });

    // Широкие экраны учителя — регресс: панель внутри строки шапки и в один ряд.
    const wideRegression =
      vp.width >= 1440 ? m.panelInsideRow === true && m.panelRows === 1 && m.overflow === 0 : false;

    const row = {
      ...vp,
      ...m,
      wideRegression,
      ok:
        m.overflow === 0 &&
        m.panelFound &&
        m.buttonCount >= 3 &&
        m.overlap === 0 &&
        m.titleFits &&
        // Ровно та переменная, что посчитана выше. `m.wideRegression` не
        // существует: `m` — это результат из браузера, а флаг считает Node.
        (!vp.width || vp.width < 1440 || wideRegression),
    };
    if (!row.ok) bad += 1;
    rows.push(row);

    // Снимок ровно того, что видит учитель: размером с окно, без полной страницы.
    await page.screenshot({
      path: join(SHOTS, `preview-${vp.tag}-view${tagSuffix}.png`),
      fullPage: false,
    });
    // Полная страница — чтобы видеть, что переполнения нет дальше fold'а.
    await page.screenshot({
      path: join(SHOTS, `preview-${vp.tag}-full${tagSuffix}.png`),
      fullPage: true,
    });
    if (vp.width < 1440) {
      // Отдельный снимок только панели: на нём видно, что кнопки не наехали
      // друг на друга и ни одна не обрезана краем экрана.
      await page.screenshot({
        path: join(SHOTS, `preview-${vp.tag}-panel${tagSuffix}.png`),
        clip: await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button")].find(
            (b) => (b.textContent ?? "").trim() === "Как шаблон"
          );
          const panel = btn?.parentElement;
          if (!panel) return { x: 0, y: 0, width: 390, height: 120 };
          const r = panel.getBoundingClientRect();
          return {
            x: Math.max(0, Math.floor(r.left) - 8),
            y: Math.max(0, Math.floor(r.top) - 8),
            width: Math.min(Math.ceil(r.width) + 16, window.innerWidth),
            height: Math.ceil(r.height) + 16,
          };
        }),
      });
    }
    await page.close();
  }

  /* Печать. Панель действий лежит внутри `no-print` и на печать не идёт —
     проверить надо, что правка телефонной вёрстки это не сломала: кнопка,
     переехавшая на вторую строку, легко могла бы выползти на раздаточный лист. */
  if (withPrint) {
    for (const vp of VIEWPORTS.filter((v) => v.width === 390 || v.width === 1440)) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.addInitScript(
        (pairs) => {
          for (const [k, v] of pairs) window.localStorage.setItem(k, v);
        },
        [
          [KEY_HISTORY, fixture.history],
          [KEY_FAVORITES, fixture.favorites],
        ]
      );
      await page.goto(`${base}/preview?id=${fixture.id}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForSelector(".worksheet-page", { timeout: 30_000 });
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(400);

      const pr = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(
          (b) => (b.textContent ?? "").trim() === "Как шаблон"
        );
        if (!btn) return { found: false, visible: null, rects: -1 };
        const panel = btn.parentElement;
        // `no-print` стоит на строке шапки, а не на самой панели, поэтому её
        // собственный `display` остаётся `flex`. Видимость определяется тем,
        // рисует ли панель хоть один прямоугольник.
        const rects = panel.getClientRects().length;
        return { found: true, visible: rects > 0, rects };
      });
      const printOk = pr.found && pr.visible === false;
      printRows.push({ tag: vp.tag, ...pr, printOk });
      if (!printOk) bad += 1;

      await page.screenshot({
        path: join(SHOTS, `preview-${vp.tag}-print${tagSuffix}.png`),
        fullPage: false,
      });
      await page.close();
    }
  }

  await browser.close();

  console.log(`Страница /preview?id=${fixture.id} — ${fixture.label}\n`);
  console.log("| Экран | innerWidth | scrollWidth | Перебор | Панель | Рядов в панели | Ряд с названием | Кнопок | Наложений | Заголовок в окне |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const over = r.overflow > 0 ? `**+${r.overflow}px**` : r.overflow === 0 ? "нет" : `${r.overflow}px`;
    const beside =
      r.panelBesideTitle === null ? "—" : r.panelBesideTitle ? `да (${r.titleLeft}→${r.panelLeft})` : `нет (${r.titleLeft}→${r.panelLeft})`;
    console.log(
      `| ${r.tag} | ${r.innerWidth} | ${r.scrollWidth} | ${over} | ${r.panelWidth}px | ${r.panelRows} | ${beside} | ${r.buttonCount} | ${r.overlap} | ${r.titleFits ? "да" : `нет (${r.titleRight}px)`} |`
    );
  }

  const wide = rows.filter((r) => r.width >= 1440);
  console.log("");
  for (const r of rows) {
    if (r.overflow > 0) {
      console.log(`${r.tag}: перебор ${r.overflow}px, виновники:`);
      for (const o of r.offenders) console.log(`   ${o.tag}.${o.cls} w=${o.w} right=${o.right}`);
    }
  }
  for (const r of wide) {
    console.log(
      `${r.tag}: панель ${r.panelInsideRow ? "внутри строки шапки" : "ВЫЛЕЗЛА ЗА СТРОКУ ШАПКИ"}, ` +
        `рядов кнопок ${r.panelRows}, панель ${r.panelWidth}px, ряд с названием ${r.panelBesideTitle ? "да" : "нет"} — ` +
        `регресс «как было на широком экране»: ${r.wideRegression ? "ок" : "НАРУШЕН"}`
    );
  }
  console.log(`\nСнимки: ${SHOTS}`);

  if (withPrint) {
    console.log("");
    for (const p of printRows) {
      console.log(
        `${p.tag} печать: панель действий ${p.visible === false ? "скрыта — на раздаточном листе её нет" : `ВИДНА на раздаточном листе (${p.rects} прямоугольников)`} — ${p.printOk ? "ок" : "НАРУШЕН"}`
      );
    }
  }

  if (bad > 0) {
    console.error(`\nPREVIEW_OVERFLOW_MEASURE_FAIL (${bad} из ${rows.length} экранов)`);
    for (const r of rows.filter((x) => !x.ok)) {
      const why = [];
      if (r.overflow !== 0) why.push(`перебор ${r.overflow}px`);
      if (!r.panelFound) why.push("панель не найдена");
      if (r.buttonCount < 3) why.push(`кнопок ${r.buttonCount}`);
      if (r.overlap !== 0) why.push(`наложений ${r.overlap}`);
      if (!r.titleFits) why.push(`название выходит за окно (${r.titleRight}px)`);
      if (r.width >= 1440 && !r.wideRegression) why.push("широкая вёрстка поехала");
      console.error(`  · ${r.tag}: ${why.join(", ") || "причина не определена"}`);
    }
    process.exit(1);
  }
  console.log("\nPREVIEW_OVERFLOW_MEASURE_OK");
}

/* ─────────────────────────────── точка входа ─────────────────────────────── */

const args = process.argv.slice(2);
if (args[0] === "--measure") {
  const tagIdx = args.indexOf("--tag");
  const scenIdx = args.indexOf("--scenario");
  const tag = tagIdx === -1 ? "" : `-${args[tagIdx + 1] ?? ""}`;
  const scenario = scenIdx === -1 ? "normal" : args[scenIdx + 1] ?? "normal";
  const withPrint = args.includes("--print");
  await runMeasure(args[1] ?? "http://127.0.0.1:4314", tag, scenario, withPrint);
} else {
  if (args.length > 0) {
    console.error(`Неизвестный аргумент: ${args.join(" ")}`);
    console.error("Запуск: node scripts/check-preview-overflow-source.mjs");
    console.error("        node scripts/check-preview-overflow-source.mjs --measure <baseUrl> [--tag before] [--scenario hard]");
    process.exit(1);
  }
  runSourceChecks();
}
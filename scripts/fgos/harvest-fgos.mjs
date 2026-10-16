#!/usr/bin/env node
/**
 * Сбор эталонного списка тем из федеральных рабочих программ (ФОП).
 *
 * ЗАЧЕМ. В `src/lib/content/subjects.ts` лежит таксономия тем, по которой
 * строятся страницы сайта. Сколько тем ДОЛЖНО быть в каждом классе — не
 * записано нигде, поэтому дыры в таксономии никто не замечает: у половины
 * предметов во всех классах ровно по шесть тем. Эталон — это недостающий
 * файл, который превращает «кажется, не все темы взяты» в перечень.
 *
 * ИСТОЧНИК. Федеральные образовательные программы, утверждённые приказами
 * Минпросвещения России от 18.05.2023:
 *   372 — начальное общее образование (1–4 классы)
 *   370 — основное общее образование (5–9 классы)
 *   371 — среднее общее образование (10–11 классы)
 * Тексты публикуются на sudact.ru. Перечень тем — это разделы
 * «Содержание обучения в N классе».
 *
 * ПОЧЕМУ ТАК СЛОЖНО. Разбивка по классам есть не везде и лежит на двух
 * уровнях. У большинства предметов каждому классу соответствует своя
 * страница. У математики — нет: это отдельные программы учебных курсов
 * («Математика» в 5–6 классах, «Алгебра» в 7–9, «Геометрия» в 7–9), и все
 * классы одного курса лежат на одной странице под заголовками
 * «Содержание обучения в 7 классе», «…в 8 классе» и так далее. У части
 * предметов (музыка, физическая культура) содержание одно на весь уровень
 * образования — классов внутри нет, и это свойство самой программы, а не
 * недостаток сбора.
 *
 * ЗАПУСК.
 *   node scripts/fgos/harvest-fgos.mjs            # докачать недостающее и собрать
 *   node scripts/fgos/harvest-fgos.mjs --refresh  # скачать всё заново
 *   node scripts/fgos/harvest-fgos.mjs --dry-run  # показать план, ничего не писать
 *
 * ВЫВОД. data/fgos/topics.json — эталон. У каждой записи есть ссылка на
 * источник и номер пункта, из которого она собрана.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE_DIR = path.join(ROOT, "work", "fgos", "raw");
const OUT_FILE = path.join(ROOT, "data", "fgos", "topics.json");

const REFRESH = process.argv.includes("--refresh");
const DRY_RUN = process.argv.includes("--dry-run");

/** Три программы: ключ, номер приказа и адрес раздела на sudact.ru. */
const DOCS = {
  noo: {
    order: "372",
    title: "Федеральная образовательная программа начального общего образования",
    slug: "federalnaia-obrazovatelnaia-programma-nachalnogo-obshchego",
    grades: [1, 2, 3, 4],
  },
  ooo: {
    order: "370",
    title: "Федеральная образовательная программа основного общего образования",
    slug: "federalnaia-obrazovatelnaia-programma-osnovnogo-obshchego",
    grades: [5, 6, 7, 8, 9],
  },
  soo: {
    order: "371",
    title: "Федеральная образовательная программа среднего общего образования",
    slug: "federalnaia-obrazovatelnaia-programma-srednego-obshchego",
    grades: [10, 11],
  },
};

const baseUrl = (doc) =>
  `https://sudact.ru/law/prikaz-minprosveshcheniia-rossii-ot-18052023-n-${DOCS[doc].order}/${DOCS[doc].slug}/`;

/**
 * Сопоставление наших предметов с разделами федеральных программ.
 *
 * Номера разделов взяты из оглавлений документов, названия предметов
 * приведены дословно. `sub` указывает на отдельный программный курс внутри
 * раздела — так устроена математика. Уровень один: базовый, потому что его
 * преподаёт большинство школ, а углублённый — это другой предмет по объёму.
 */
const SUBJECTS = {
  math: [
    { doc: "noo", sec: 162, name: "Математика" },
    { doc: "ooo", sec: 146, sub: 4, name: "Учебный курс «Математика» (5–6 классы)", grades: [5, 6] },
  ],
  algebra: [
    { doc: "ooo", sec: 146, sub: 5, name: "Учебный курс «Алгебра» (7–9 классы)", grades: [7, 8, 9] },
    { doc: "soo", sec: 112, sub: 7, name: "Учебный курс «Алгебра и начала математического анализа»", grades: [10, 11] },
  ],
  geometry: [
    { doc: "ooo", sec: 146, sub: 6, name: "Учебный курс «Геометрия» (7–9 классы)", grades: [7, 8, 9] },
    { doc: "soo", sec: 112, sub: 8, name: "Учебный курс «Геометрия»", grades: [10, 11] },
  ],
  russian: [
    { doc: "noo", sec: 20, name: "Русский язык" },
    { doc: "ooo", sec: 19, name: "Русский язык" },
    { doc: "soo", sec: 19, name: "Русский язык (базовый уровень)" },
  ],
  literature: [
    { doc: "ooo", sec: 20, name: "Литература" },
    { doc: "soo", sec: 20, name: "Литература (базовый уровень)" },
  ],
  english: [
    { doc: "noo", sec: 157, name: "Иностранный (английский) язык" },
    { doc: "ooo", sec: 136, name: "Иностранный (английский) язык" },
    { doc: "soo", sec: 96, name: "Иностранный (английский) язык (базовый уровень)" },
  ],
  german: [
    { doc: "ooo", sec: 137, name: "Иностранный (немецкий) язык" },
    { doc: "soo", sec: 98, name: "Иностранный (немецкий) язык (базовый уровень)" },
  ],
  informatics: [
    { doc: "ooo", sec: 148, name: "Информатика (базовый уровень)" },
    { doc: "soo", sec: 113, name: "Информатика (базовый уровень)" },
  ],
  physics: [
    { doc: "ooo", sec: 153, name: "Физика (базовый уровень)" },
    { doc: "soo", sec: 115, name: "Физика (базовый уровень)" },
  ],
  chemistry: [
    { doc: "ooo", sec: 155, name: "Химия (базовый уровень)" },
    { doc: "soo", sec: 117, name: "Химия (базовый уровень)" },
  ],
  biology: [
    { doc: "ooo", sec: 157, name: "Биология (базовый уровень)" },
    { doc: "soo", sec: 119, name: "Биология (базовый уровень)" },
  ],
  geography: [
    { doc: "ooo", sec: 152, name: "География" },
    { doc: "soo", sec: 125, name: "География (базовый уровень)" },
  ],
  history: [
    { doc: "ooo", sec: 150, name: "История" },
    { doc: "soo", sec: 121, name: "История (базовый уровень)" },
  ],
  social: [
    { doc: "ooo", sec: 151, name: "Обществознание" },
    { doc: "soo", sec: 123, name: "Обществознание (базовый уровень)" },
  ],
  okruzhaet: [{ doc: "noo", sec: 163, name: "Окружающий мир" }],
  obzh: [
    { doc: "ooo", sec: 164, name: "Основы безопасности жизнедеятельности" },
    { doc: "soo", sec: 128, name: "Основы безопасности жизнедеятельности (базовый уровень)" },
  ],
  technology: [{ doc: "ooo", sec: 162, name: "Труд (технология)" }],
  music: [
    { doc: "noo", sec: 166, name: "Музыка" },
    { doc: "ooo", sec: 161, name: "Музыка" },
  ],
  art: [
    { doc: "noo", sec: 165, name: "Изобразительное искусство" },
    { doc: "ooo", sec: 160, name: "Изобразительное искусство" },
  ],
  pe: [
    { doc: "noo", sec: 168, name: "Физическая культура" },
    { doc: "ooo", sec: 163, name: "Физическая культура" },
    { doc: "soo", sec: 127, name: "Физическая культура" },
  ],
  // finance (финансовая грамотность) в федеральных рабочих программах
  // отсутствует: это курс внеурочной деятельности, отдельной ФРП у него нет.
  // Для него эталон не собирается — и это не дыра, а отсутствие источника.
};

const NO_SOURCE = ["finance"];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchText(url, cacheFile) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, cacheFile);
  if (!REFRESH && existsSync(cached)) return readFile(cached, "utf8");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await writeFile(cached, text, "utf8");
      // Не частим по сайту: между запросами всегда пауза.
      await new Promise((r) => setTimeout(r, 700));
      return text;
    } catch (err) {
      if (attempt === 3) throw new Error(`не скачал ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

const stripTags = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Подразделы документа из оглавления: раздел, подраздел, заголовок, адрес. */
function parseToc(html, doc) {
  const re = /<a[^>]*href="([^"]*\/iii\/(\d+)\/(\d+)\.(\d+)\/)"[^>]*>([\s\S]{0,900}?)<\/a>/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const sec = Number(m[2]);
    const sub = Number(m[4]);
    const href = "https://sudact.ru" + m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ doc, sec, sub, text: stripTags(m[5]), href });
  }
  return out;
}

/** «19.6. Содержание обучения в 5 классе» → 5. */
function gradeFromHeading(text) {
  const m = text.match(/Содержание\s+(?:обучения|учебного\s+предмета)[^.]{0,40}?(\d+)\s*(?:классе|классах)/i);
  return m ? Number(m[1]) : null;
}

/** Служебные подразделы: в них тем нет. */
const SERVICE_HEADING =
  /^(Пояснительная записка|Планируемые результаты|Предметные результаты|Поурочное планирование|Тематическое планирование|Методические рекомендации)/i;

/** Заголовок подраздела без ведущего номера: «161.6. Содержание…» → «Содержание…». */
const headingBody = (text) => text.replace(/^\d+(?:\.\d+)*\.?\s*/, "").trim();

/** Пункт документа: { num, depth, text, numbered }. */
function parseItems(html) {
  if (!html.includes('<div id="law_text_body"')) return null;
  const start = html.indexOf('<div id="law_text_body"');
  const rest = html.slice(start);
  const end = rest.indexOf('<div id="law_bottom"', 1);
  const body = end > 0 ? rest.slice(0, end) : rest.slice(0, 400000);

  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => stripTags(m[1]));

  const items = [];
  for (const raw of paragraphs) {
    const text = raw.trim();
    if (text.length < 3) continue;
    if (/^[-–—|]/.test(text)) continue;
    if (/^https?:\/\//.test(text)) continue;
    if (/^Открыть полный текст/.test(text)) continue;
    if (text === "```" || text === "…" || text === ".") continue;

    const m = text.match(/^(\d+(?:\.\d+)*)\.?\s+([\s\S]+)$/);
    if (m) {
      const num = m[1];
      items.push({ num, depth: num.split(".").length, text: m[2].trim().replace(/\.$/, ""), numbered: true });
      continue;
    }
    const clean = text.replace(/\.$/, "");
    if (clean.length < 3) continue;
    items.push({ num: null, depth: Infinity, text: clean, numbered: false });
  }
  return items;
}

/**
 * Разложить пункты страницы по классам.
 *
 * Заголовок «Содержание обучения в 7 классе» открывает корзину этого
 * класса; всё глубже него относится к этому классу, пока не встретится
 * пункт того же или меньшего уровня. Если таких заголовков на странице нет,
 * содержание общее для всего уровня образования — возвращается одна корзина
 * без класса.
 */
function splitByClass(items) {
  const buckets = [];
  let current = null;

  for (const item of items) {
    const grade = gradeFromHeading(item.text);
    if (grade !== null) {
      current = { grade, depth: item.depth, heading: item.text, items: [] };
      buckets.push(current);
      continue;
    }
    if (!current) continue;
    if (item.numbered && item.depth <= current.depth) continue;
    current.items.push(item);
  }

  return buckets;
}

/**
 * Темы и разделы внутри корзины.
 *
 * Разделы — самый верхний пронумерованный уровень внутри класса, темы — всё,
 * что на уровень глубже, плюс ненумерованные абзацы. Так «162.6.1. Числа и
 * величины» попадает в разделы, а «162.6.1.1. Числа от 1 до 9» — в темы.
 * У русского языка, где содержание ненумерованное, разделами выходят
 * «19.6.1. Общие сведения о языке», а темами — абзацы под ними.
 */
function topicsIn(items) {
  const depths = items.filter((i) => i.numbered).map((i) => i.depth);
  const minDepth = depths.length ? Math.min(...depths) : Infinity;
  const sections = [];
  const topics = [];
  for (const item of items) {
    if (item.numbered && item.depth === minDepth) sections.push(item.text);
    else if (item.text.length > 2) topics.push(item.text);
  }
  return { sections, topics };
}

async function loadPage(doc, sec, sub) {
  const cacheFile = `sec_${doc}_${sec}${sub ? `_${sub}` : ""}.html`;
  const url = `${baseUrl(doc)}iii/${sec}/${sub ? `${sec}.${sub}/` : ""}`;
  return { html: await fetchText(url, cacheFile), url };
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  const tocs = {};
  for (const doc of Object.keys(DOCS)) {
    const html = await fetchText(baseUrl(doc), `toc_${doc}.html`);
    tocs[doc] = parseToc(html, doc);
    console.log(`оглавление ${doc.toUpperCase()}: подразделов ${tocs[doc].length}`);
  }

  const result = {};
  const notes = [];
  const missing = [];
  const unavailable = [];
  // Пары «предмет + класс», для которых в самой федеральной программе нет
  // раздела. Это не дыра в сборе: например, федеральная рабочая программа по
  // информатике написана для 7–11 классов, поэтому 5 и 6 классов в ней нет.
  // Такие пары тоже должны быть записаны, иначе о них молчаливо забывают.
  const notInProgram = [];

  for (const [slug, sources] of Object.entries(SUBJECTS)) {
    for (const src of sources) {
      const subs = tocs[src.doc].filter((e) => e.sec === src.sec);

      // Страницы: либо указанный курс, либо все подразделы раздела, которые
      // содержат содержание.
      let pages;
      if (src.sub) {
        pages = subs.filter((e) => e.sub === src.sub);
        if (pages.length === 0) {
          const { url } = await loadPage(src.doc, src.sec, src.sub);
          pages = [{ href: url, text: src.name, sub: src.sub }];
          notes.push(`${slug}: подраздел ${src.sec}.${src.sub} не найден в оглавлении, взят по адресу`);
        }
      } else {
        pages = subs.filter((e) => !SERVICE_HEADING.test(headingBody(e.text)) && gradeFromHeading(e.text) !== null);
        if (pages.length === 0) {
          // Предметы без разбивки по классам (музыка, физическая культура).
          pages = subs.filter((e) => !SERVICE_HEADING.test(headingBody(e.text)));
          if (pages.length > 0) {
            notes.push(`${slug} (${src.doc}/${src.sec}): содержание без разбивки по классам`);
          }
        }
      }

      if (pages.length === 0) {
        missing.push(`${slug} — ${src.doc}/${src.sec}`);
        continue;
      }

      for (const page of pages) {
        const { html } = await loadPage(src.doc, src.sec, page.sub);
        const items = parseItems(html);
        const docGrades = DOCS[src.doc].grades;

        if (items === null) {
          // Страница-обложка: у источника нет постраничного текста для этого
          // пункта. Это не «тем нет» — это «источник не отдал текст».
          unavailable.push(`${slug} — ${src.doc}/${src.sec}${page.sub ? "." + page.sub : ""} (страница источника без текста)`);
          continue;
        }

        const pageGrade = gradeFromHeading(page.text);

        if (pageGrade !== null) {
          // Страница целиком относится к одному классу: заголовок класса стоит
          // в названии страницы, а в теле сразу идут разделы и темы.
          if (!docGrades.includes(pageGrade)) continue;
          const { sections, topics } = topicsIn(items);
          if (topics.length === 0) {
            missing.push(`${slug} — ${src.doc}/${src.sec}.${page.sub} класс ${pageGrade} (пусто)`);
            continue;
          }
          put(result, slug, pageGrade, {
            topics,
            sections,
            source: {
              doc: src.doc,
              order: DOCS[src.doc].order,
              section: `${src.sec}.${page.sub}`,
              subjectInProgram: src.name,
              url: page.href,
              shared: false,
            },
          });
          continue;
        }

        const buckets = splitByClass(items);

        if (buckets.length === 0) {
          // Страница — отдельный курс без внутренней разбивки по классам:
          // вся страница достаётся всем классам уровня образования.
          const { sections, topics } = topicsIn(items);
          if (topics.length === 0) {
            missing.push(`${slug} — ${src.doc}/${src.sec}.${page.sub} (пусто)`);
            continue;
          }
          for (const g of docGrades) {
            put(result, slug, g, {
              topics,
              sections,
              source: { doc: src.doc, order: DOCS[src.doc].order, section: `${src.sec}.${page.sub}`, subjectInProgram: src.name, url: page.href, shared: true },
            });
          }
          notes.push(`${slug} (${src.doc}/${src.sec}.${page.sub}): содержание одно на ${docGrades.join("–")} классы, без разбивки по годам`);
          continue;
        }

        for (const b of buckets) {
          if (!docGrades.includes(b.grade)) continue;
          const { sections, topics } = topicsIn(b.items);
          if (topics.length === 0) {
            missing.push(`${slug} — ${src.doc}/${src.sec}.${page.sub} класс ${b.grade} (пусто)`);
            continue;
          }
          put(result, slug, b.grade, {
            topics,
            sections,
            source: {
              doc: src.doc,
              order: DOCS[src.doc].order,
              section: page.sub ? `${src.sec}.${page.sub}` : `${src.sec}`,
              subjectInProgram: src.name,
              url: page.href,
              shared: false,
            },
          });
        }
      }
    }

    // Классы, для которых программа этого предмета не содержит ни одного
    // раздела. Записываем явно, чтобы молчаливых пропусков не оставалось.
    for (const src of sources) {
      const inScope = src.grades ?? DOCS[src.doc].grades;
      const produced = new Set(
        Object.keys(result[slug] ?? {})
          .map(Number)
          .filter((g) => inScope.includes(g)),
      );
      for (const g of inScope) {
        if (produced.has(g)) continue;
        const alreadyKnown =
          missing.some((l) => l.startsWith(`${slug} — ${src.doc}/`)) ||
          unavailable.some((l) => l.startsWith(`${slug} — ${src.doc}/`));
        if (alreadyKnown) continue;
        notInProgram.push(`${slug} — класс ${g} (в программе по этому предмету раздела нет)`);
      }
    }
  }

  if (DRY_RUN) {
    console.log("\n--- что получилось ---");
    for (const slug of Object.keys(SUBJECTS).sort()) {
      const g = result[slug];
      console.log(`${slug.padEnd(12)} ${g ? Object.keys(g).sort((a, b) => a - b).join(",") : "— НЕТ ДАННЫХ —"}`);
    }
    console.log("\n--- заметки ---");
    notes.forEach((n) => console.log("  " + n));
    console.log("\n--- не собрано ---");
    missing.forEach((n) => console.log("  " + n));
    return;
  }

  const out = {
    _comment:
      "Эталон тем по федеральным рабочим программам (ФОП НОО/ООО/СОО, приказы Минпросвещения России от 18.05.2023 № 372/370/371). Собран скриптом scripts/fgos/harvest-fgos.mjs, вручную не правится. Тексты программ опубликованы на sudact.ru.",
    generatedFrom: Object.fromEntries(
      Object.entries(DOCS).map(([k, v]) => [k, { order: v.order, title: v.title, grades: v.grades }]),
    ),
    noSource: NO_SOURCE,
    notes,
    missing,
    unavailable,
    notInProgram,
    subjects: result,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out, null, 1), "utf8");

  let pairs = 0;
  let topics = 0;
  for (const g of Object.values(result)) {
    pairs += Object.keys(g).length;
    for (const pair of Object.values(g)) topics += pair.topics.length;
  }
  console.log(`\nзаписано: предметов ${Object.keys(result).length}, пар ${pairs}, тем ${topics}`);
  console.log(`файл: ${path.relative(ROOT, OUT_FILE)}`);
  if (notes.length) {
    console.log("\nзаметки о структуре программ:");
    notes.forEach((n) => console.log("  " + n));
  }
  if (missing.length) {
    console.log("\nне собрано:");
    missing.forEach((n) => console.log("  " + n));
  }
  if (unavailable.length) {
    console.log("\nисточник не отдал текст (нужен другой адрес):");
    unavailable.forEach((n) => console.log("  " + n));
  }
  if (notInProgram.length) {
    console.log("\nв самой программе раздела нет:");
    notInProgram.forEach((n) => console.log("  " + n));
  }
}

function put(result, slug, grade, { topics, sections, source }) {
  if (!result[slug]) result[slug] = {};
  const prev = result[slug][grade];
  if (prev) {
    prev.topics = [...new Set([...prev.topics, ...topics])];
    prev.sections = [...new Set([...prev.sections, ...sections])];
    prev.sources.push(source);
  } else {
    result[slug][grade] = { topics, sections, sources: [source] };
  }
}

main().catch((err) => {
  console.error("ОШИБКА:", err.message);
  process.exit(1);
});
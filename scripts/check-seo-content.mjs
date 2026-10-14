/**
 * Проверка новых SEO-страниц: сравнения, блог, хаб.
 *
 * Зачем файл: главная беда сравнительных страниц — выдуманные цифры о конкурентах.
 * Модель читает их как факт, учитель принимает за обещание, а через месяц цена
 * у конкурента меняется и страница становится ложью. Этот скрипт ловит цену, которой
 * нет в `docs/seo/competitors-factbase-2026-10-14.md`, и не даёт ей уехать в прод.
 *
 * Файл живёт в репозитории, а не в `.unlazy/`, потому что агенты работают в отдельных
 * рабочих копиях и `.unlazy/` туда не попадает — гейты перестали бы запускаться.
 *
 * Запуск:  node scripts/check-seo-content.mjs [compare|blog|hub|desc|all]
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";
const FACTBASE = "docs/seo/competitors-factbase-2026-10-14.md";

/** Страницы сравнения: адрес внутри out/ и ключевое слово в заголовке. */
const COMPARE_PAGES = [
  { dir: "compare/uchlist-ili-obuchay", who: "Обучай" },
  { dir: "compare/uchlist-ili-neyrum", who: "Нейрум" },
  { dir: "compare/uchlist-ili-chatgpt", who: "ChatGPT" },
];

const HUB_DIR = "ai-dlya-uchitelya";
const postsDir = join("src", "app", "blog", "posts");

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const note = (m) => notes.push(m);

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const readOut = (rel) => {
  const p = join(OUT, rel, "index.html");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

const meta = (html, name) => {
  const m =
    html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) ??
    html.match(new RegExp(`<meta property="${name}" content="([^"]*)"`));
  return m ? m[1] : null;
};

const walkOut = (dir = OUT, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "_next") walkOut(full, acc);
    } else if (entry === "index.html") {
      acc.push(full);
    }
  }
  return acc;
};

const factbaseNumbers = () => {
  if (!existsSync(FACTBASE)) {
    fail(`Нет файла фактов ${FACTBASE} — сверять цифры конкурентов не с чем.`);
    return new Set();
  }
  const text = readFileSync(FACTBASE, "utf8");
  const set = new Set();
  // Русские разряды пишут с пробелом: «1 890 ₽», «5 000 учителей». Такое число
  // разбивается на куски регуляркой, поэтому берём и куски, и слитную форму —
  // иначе настоящая цифра из файла не найдётся и гейт будет ругаться на правду.
  for (const m of text.match(/\d[\d\s ]*/g) || []) {
    const joined = m.replace(/\D/g, "");
    if (joined) set.add(joined);
    for (const part of m.match(/\d+/g) || []) set.add(part);
  }
  return set;
};

/* ── сравнительные страницы ───────────────────────────────────────────── */

function checkCompare() {
  const known = factbaseNumbers();
  let pages = 0;

  for (const { dir, who } of COMPARE_PAGES) {
    const html = readOut(dir);
    if (!html) {
      fail(`Нет страницы сравнения ${dir} (${who}).`);
      continue;
    }
    pages += 1;

    const title = meta(html, "title") ?? (html.match(/<title>(.*?)<\/title>/) || [])[1] ?? "";
    if (title.length > 60) fail(`${dir}: title ${title.length} символов, надо ≤60.`);

    const desc = meta(html, "description");
    if (!desc) fail(`${dir}: нет description.`);
    else if (desc.length > 160) fail(`${dir}: description ${desc.length} символов, надо ≤160.`);
    else if (desc.length < 120) fail(`${dir}: description всего ${desc.length} символов — слишком коротко для сниппета.`);

    if (!/rel="canonical"/.test(html)) fail(`${dir}: нет canonical.`);
    if (!/application\/ld\+json/.test(html)) fail(`${dir}: нет JSON-LD.`);

    // Дата проверки обязательна: цены конкурентов меняются, страница без даты
    // через полгода становится ложью, а учитель не может это проверить.
    // Класс символов — `[а-яё]`, а не `\w`: в JavaScript `\w` не покрывает
    // кириллицу, и проверка даты срабатывала бы случайно, а не по назначению.
    const body = stripTags(html);
    const hasDate = /(?:проверен|актуально|данн\w*)[а-яё]*(?:\s+\S+){0,2}\s+14\s+октября/i.test(body);
    if (!hasDate) fail(`${dir}: нет отметки, что факты проверены 14 октября. Цены конкурентов меняются — страница без даты протухает молча.`);

    // Ключевая защита от выдумки: любая сумма в рублях на странице сравнения
    // должна быть в файле фактов. Наша цена тоже проходит через эту проверку,
    // потому что 249 и 1890 есть в файле.
    const rubles = body.match(/\d[\d\s ]*₽/g) || [];
    for (const raw of rubles) {
      const digits = raw.replace(/[^\d]/g, "");
      if (!digits) continue;
      if (!known.has(digits)) {
        fail(`${dir}: сумма «${raw.trim()}» не найдена в файле фактов ${FACTBASE}. Либо она выдумана, либо её нужно сначала внести в файл фактов.`);
      }
    }

    if (!body.includes(who)) note(`${dir}: на странице не упомянут ${who} — проверь, что сравнение читается как сравнение.`);
  }

  if (pages) note(`сравнительных страниц собрано: ${pages} из ${COMPARE_PAGES.length}`);
}

/* ── блог ─────────────────────────────────────────────────────────────── */

function checkBlog() {
  if (!existsSync(postsDir)) {
    fail(`Нет папки постов ${postsDir}.`);
    return;
  }
  const files = readdirSync(postsDir).filter((f) => f.endsWith(".md"));
  if (files.length < 8) {
    fail(`Постов в блоге ${files.length}, требовалось минимум 8 (4 уже было). Сезон ОГЭ начинается в феврале, поздно писать — значит опоздать к нему.`);
  }

  let words = 0;
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    const raw = readFileSync(join(postsDir, f), "utf8");
    const w = (stripTags(raw).match(/[\p{L}]+/gu) || []).length;
    words += w;
    if (w < 1200) fail(`Пост ${slug}: ${w} слов, надо ≥1200.`);

    const html = readOut(join("blog", slug));
    if (!html) {
      fail(`Пост ${slug} есть в исходниках, но не собрался в out/blog/${slug}/.`);
      continue;
    }
    const title = (html.match(/<title>(.*?)<\/title>/) || [])[1] || "";
    if (title.length > 60) fail(`Пост ${slug}: title ${title.length} символов, надо ≤60.`);

    const desc = meta(html, "description");
    if (!desc) fail(`Пост ${slug}: нет description.`);
    else if (desc.length > 160) fail(`Пост ${slug}: description ${desc.length} символов, надо ≤160.`);

    // Внутренние ссылки должны вести на то, что реально собрано.
    // `/ _next/` — это шрифты, css и js, они не страницы: их отсутствие в out/
    // как страницы ничего не значит, исключаем.
    const hrefs = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]);
    const internal = [
      ...new Set(
        hrefs.filter(
          (h) =>
            h.startsWith("/") &&
            !h.startsWith("//") &&
            // шрифты, css и js лежат в /_next/, страницами не являются
            !h.startsWith("/_next/") &&
            !h.startsWith("/og/") &&
            // favicon.ico, robots.txt и прочие файлы тоже не страницы
            !/\.[a-z0-9]{1,5}$/i.test(h),
        ),
      ),
    ];
    const dead = internal.filter((h) => !existsSync(join(OUT, h, "index.html")));
    if (dead.length) fail(`Пост ${slug}: ссылки ведут в никуда — ${dead.slice(0, 3).join(", ")}`);
    if (internal.length < 3) fail(`Пост ${slug}: всего ${internal.length} внутренних ссылок, надо ≥3.`);
  }
  if (files.length) note(`постов в блоге: ${files.length}, слов суммарно: ${words}`);
}

/* ── хаб ──────────────────────────────────────────────────────────────── */

function checkHub() {
  const html = readOut(HUB_DIR);
  if (!html) {
    fail(`Нет хаб-страницы ${HUB_DIR}.`);
    return;
  }
  const desc = meta(html, "description");
  if (!desc) fail(`${HUB_DIR}: нет description.`);
  else if (desc.length > 160) fail(`${HUB_DIR}: description ${desc.length} символов, надо ≤160.`);

  const body = stripTags(html);
  const hrefs = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]);
  const posts = [...new Set(hrefs.filter((h) => h.startsWith("/blog/") && h !== "/blog/"))];
  const subjects = [...new Set(hrefs.filter((h) => h.startsWith("/subject/")))];

  if (posts.length < 6) fail(`${HUB_DIR}: ссылок на посты ${posts.length}, надо ≥6. Хаб без постов — просто ещё одна страница.`);
  if (subjects.length < 5) fail(`${HUB_DIR}: ссылок на предметы ${subjects.length}, надо ≥5.`);

  const dead = [...new Set([...posts, ...subjects])].filter((h) => !existsSync(join(OUT, h, "index.html")));
  if (dead.length) fail(`${HUB_DIR}: ссылки ведут в никуда — ${dead.slice(0, 3).join(", ")}`);
  if (!/application\/ld\+json/.test(html)) fail(`${HUB_DIR}: нет JSON-LD.`);

  note(`хаб: постов ${posts.length}, предметов ${subjects.length}`);
}

/* ── длины описаний на всём сайте ─────────────────────────────────────── */

function checkDescriptions() {
  const pages = walkOut();
  let over = 0;
  for (const p of pages) {
    const html = readFileSync(p, "utf8");
    const d = meta(html, "description");
    if (d && d.length > 160) {
      over += 1;
      if (over <= 5) fail(`description длиннее 160 на ${relative(OUT, p)}: ${d.length} символов.`);
    }
  }
  if (over > 5) fail(`Всего страниц с description длиннее 160: ${over}.`);
  if (!over) note(`описаний длиннее 160 символов на сайте нет (проверено ${pages.length} страниц)`);
}

/* ── запуск ───────────────────────────────────────────────────────────── */

const mode = process.argv[2] || "all";
if (!existsSync(OUT)) {
  console.error("Нет папки out/. Сначала npm run build — проверять нечего.");
  process.exit(1);
}

if (["compare", "all"].includes(mode)) checkCompare();
if (["blog", "all"].includes(mode)) checkBlog();
if (["hub", "all"].includes(mode)) checkHub();
if (["desc", "all"].includes(mode)) checkDescriptions();

for (const n of notes) console.log(`  · ${n}`);

if (problems.length) {
  console.error(`\nSEO_CONTENT_FAILED: ${problems.length} проблем(ы)`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nSEO_CONTENT_OK");
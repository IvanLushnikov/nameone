#!/usr/bin/env node
/**
 * План дололива таксономии: каких тем не хватает и какие из них уже есть.
 *
 * ЗАЧЕМ. `data/fgos/topics.json` перечисляет темы, которые требует федеральная
 * рабочая программа. `src/lib/content/subjects.ts` — то, что есть на сайте.
 * Здесь одно сравнивается с другим и получается список конкретных тем,
 * которые надо добавить: предмет, класс, название, раздел программы и адрес
 * источника. Дальше по этому плану пишутся задания и собирается расширение
 * таксономии.
 *
 * ЧТО СЧИТАЕТСЯ ТЕМОЙ. В программе рядом с темами лежит служебный текст:
 * «Инвариантные модули:», «Виды деятельности обучающихся:», «Содержание:».
 * Это не темы, и если их скопировать в таксономию, на сайте появятся
 * страницы с бессмысленным заголовком. Такие строки отбрасываются, а сколько
 * их отброшено — печатается, чтобы потеря была видна.
 *
 * ЗАПУСК.
 *   node scripts/fgos/build-completion-plan.mjs              # показать сводку
 *   node scripts/fgos/build-completion-plan.mjs --write      # записать work/fgos/plan.json
 *   node scripts/fgos/build-completion-plan.mjs --include-shared
 *
 * --include-shared добавляет пары, где программа отдала один общий блок на
 * весь уровень образования (сейчас это музыка 5–8). По умолчанию они
 * пропускаются: повторять один и тот же блок в каждом классе — значит
 * выдумать привязку темы к году обучения, которой в программе нет.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REF_FILE = path.join(ROOT, "data", "fgos", "topics.json");
const PLAN_FILE = path.join(ROOT, "work", "fgos", "plan.json");

const WRITE = process.argv.includes("--write");
const INCLUDE_SHARED = process.argv.includes("--include-shared");

/** Транслитерация кириллицы в slug — латиница, как во всех существующих темах. */
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(title, suffix = "") {
  const base = title
    .toLowerCase()
    .split("")
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return suffix ? `${base}-${suffix}` : base;
}

const norm = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9]+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter((w) => w.length >= 4);

/** Служебные строки программы, которые темой не являются. */
const META_LINE =
  /^(инвариантные модули|виды деятельности|содержание|планируемые результаты|пояснительная записка|учебно-тематический план|тематическое планирование|основное содержание|общие сведения)/i;

function isRealTopic(text) {
  const t = text.trim();
  if (t.length < 12) return false;
  if (t.endsWith(":")) return false;
  if (META_LINE.test(t)) return false;
  if (/^(и так далее|и другие|и т\.\s?д\.)/i.test(t)) return false;
  if ((t.match(/\d/g) ?? []).length > t.length / 4) return false;
  return true;
}

/** Таксономия читается через tsx — здесь берём её из отчёта сверки. */
function readTaxonomyPairs() {
  const out = execFileSync("npx", ["tsx", path.join(ROOT, "scripts", "topic-gap-audit.mts")], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const pairs = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^([a-z]+)\s+(\d{1,2})\s+\d+.*?(общее на весь уровень|источник не отдал текст|нет федеральной программы|нет эталона|в программе этого класса нет)?\s*$/);
    if (m) pairs.push({ slug: m[1], grade: Number(m[2]), note: (m[3] ?? "").trim() });
  }
  return pairs;
}

function main() {
  const ref = JSON.parse(readFileSync(REF_FILE, "utf8"));
  const plan = [];
  const skippedShared = [];
  const dropped = [];
  const perSubject = {};

  for (const subject of Object.keys(ref.subjects).sort()) {
    for (const grade of Object.keys(ref.subjects[subject]).sort((a, b) => Number(a) - Number(b))) {
      const rec = ref.subjects[subject][grade];
      const shared = rec.sources.some((s) => s.shared);
      if (shared && !INCLUDE_SHARED) {
        skippedShared.push(`${subject} ${grade}: программа отдала один общий блок на весь уровень`);
        continue;
      }

      const source = rec.sources[0];
      const taken = new Set();
      const kept = [];
      for (const p of rec.topics) {
        if (taken.has(norm(p))) continue;
        if (!isRealTopic(p)) {
          dropped.push(`${subject} ${grade}: «${p.slice(0, 60)}»`);
          continue;
        }
        taken.add(norm(p));
        kept.push(p);
      }

      perSubject[subject] ??= {};
      perSubject[subject][grade] = kept.length;
      for (const title of kept) {
        plan.push({
          subject,
          grade: Number(grade),
          title,
          fgosRef: sectionOf(title, rec) ?? null,
          sourceUrl: source.url,
          programSection: source.section,
        });
      }
    }
  }

  // Убираем темы, которые на сайте уже есть: по названию, с допуском на
  // совпадение ключевых слов. Точное совпадение важнее, но у нас названия
  // формулируются своими словами, поэтому сравнение по словам.
  let matched = 0;
  const missing = [];
  // Точные высказывания программы, уже внесённые в таксономию на прошлых
  // прогонах. Читаем из авторских файлов: там `statement` — дословный текст
  // программы, по нему совпадение точное, без догадок.
  const authoredStatements = new Map();
  {
    const dir = path.join(ROOT, "data", "fgos", "authored");
    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const name = file.replace(/\.json$/, "");
        const m = name.match(/^(.+)-(\d+)(?:-part\d+)?$/);
        if (!m) continue;
        const pairKey = `${m[1]}:${Number(m[2])}`;
        let data;
        try {
          data = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
        } catch {
          continue;
        }
        if (!authoredStatements.has(pairKey)) authoredStatements.set(pairKey, new Set());
        const set = authoredStatements.get(pairKey);
        for (const t of data.topics ?? []) if (t?.statement) set.add(t.statement);
      }
    }
  }

  const byPair = new Map();
  for (const item of plan) {
    const key = `${item.subject}:${item.grade}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(item);
  }

  const taxonomy = readTaxonomyPairs();
  const ours = new Map();
  for (const p of taxonomy) ours.set(`${p.slug}:${p.grade}`, []);

  // Словари заголовков наших тем читаем из самого модуля таксономии.
  const ourTitles = JSON.parse(
    execFileSync("npx", ["tsx", "-e", "import { allTopics } from './src/lib/content/subjects'; console.log(JSON.stringify(allTopics().map(t => [t.subject.slug + ':' + t.grade, t.topic.title])));"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  for (const [key, title] of ourTitles) {
    if (!ours.has(key)) ours.set(key, []);
    ours.get(key).push(title);
  }

  for (const [key, items] of byPair) {
    const have = (ours.get(key) ?? []).slice();
    // Сравниваем в ту сторону, где заголовки короче: наши темы названы
    // двумя-тремя словами, а в программе это длинные предложения. Ищем для
    // каждой нашей темы подходящую тему программы, а не наоборот, иначе
    // половина совпадений теряется на разнице длины заголовков.
    const claimed = new Set();
    const mine = new Set();
    have.forEach((h) => {
      // Уточнения в скобках («Имя прилагательное (обобщение)») — это наша
      // редакторская добавка, а не часть названия темы программы. Без их
      // снятия настоящее совпадение не набирает порога.
      const hw = words(h.replace(/\([^)]*\)/g, " "));
      if (hw.length === 0) return;
      let best = -1;
      let bestShare = 0;
      items.forEach((item, i) => {
        if (claimed.has(i)) return;
        const iw = new Set(words(item.title));
        const share = hw.filter((w) => iw.has(w)).length / hw.length;
        if (share > bestShare) {
          bestShare = share;
          best = i;
        }
      });
      // Три четверти слов нашей темы должны встретиться в теме программы.
      if (best >= 0 && bestShare >= 0.75) {
        claimed.add(best);
        mine.add(best);
      }
    });
    // Темы, которые уже добавлены из этой же программы, опознаются точно:
    // в авторских файлах лежит дословное высказывание программы. Искать их
    // по словам бессмысленно — название темы у нас короткое и переписанное,
    // поэтому догадка даёт и пропуски, и повторное добавление одних и тех же
    // тем при каждом запуске планировщика.
    const already = authoredStatements.get(key) ?? new Set();
    for (const item of items) {
      if (already.has(item.title)) mine.add(items.indexOf(item));
    }
    for (let i = 0; i < items.length; i++) {
      if (mine.has(i)) matched++;
      else missing.push(items[i]);
    }
  }

  // Уникальные slug внутри пары.
  const seen = new Map();
  for (const item of missing) {
    const key = `${item.subject}:${item.grade}`;
    let slug = slugify(item.title);
    if (seen.has(key)) {
      const n = seen.get(key, new Set());
      if (n.has(slug)) {
        let i = 2;
        while (n.has(`${slug}-${i}`)) i++;
        slug = `${slug}-${i}`;
      }
      n.add(slug);
    } else {
      seen.set(key, new Set([slug]));
    }
    item.slug = slug;
  }

  const bySub = {};
  for (const m of missing) bySub[m.subject] = (bySub[m.subject] ?? 0) + 1;

  console.log("=".repeat(78));
  console.log("ПЛАН ДОЛИВА ТАКСОНОМИИ ПО ФЕДЕРАЛЬНОЙ ПРОГРАММЕ");
  console.log("=".repeat(78));
  console.log(`тем в эталоне (без общих блоков): ${plan.length}`);
  console.log(`из них уже есть на сайте:        ${matched}`);
  console.log(`НАДО ДОБАВИТЬ:                  ${missing.length}`);
  console.log(`служебных строк отброшено:      ${dropped.length}`);
  console.log();
  console.log("по предметам:");
  for (const [k, v] of Object.entries(bySub).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log();
  console.log(`примеры заданий понадобится:    ${missing.length * 2} (минимум)`);
  if (skippedShared.length) {
    console.log("\nпропущены пары с общим блоком программы:");
    skippedShared.forEach((s) => console.log("  " + s));
  }

  if (WRITE) {
    mkdirSync(path.dirname(PLAN_FILE), { recursive: true });
    writeFileSync(
      PLAN_FILE,
      JSON.stringify(
        {
          _comment:
            "План дололива: какие темы из федеральной рабочей программы ещё не добавлены на сайт. Собран scripts/fgos/build-completion-plan.mjs.",
          generatedFrom: ref.generatedFrom,
          skippedShared,
          droppedCount: dropped.length,
          topics: missing,
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\nплан записан: ${path.relative(ROOT, PLAN_FILE)} (${missing.length} тем)`);
  }
}

/** Раздел программы, к которому относится тема: ищем в списке разделов. */
function sectionOf(title, rec) {
  const t = norm(title);
  let best = null;
  for (const s of rec.sections ?? []) {
    const sw = new Set(words(s));
    const hit = words(title).filter((w) => sw.has(w)).length;
    if (hit > 0 && (!best || hit > best.hit)) best = { title: s, hit };
  }
  return best?.title ?? null;
}

main();
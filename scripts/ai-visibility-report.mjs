#!/usr/bin/env node
/**
 * Отчёт по замеру «что скажет модель, у которой есть поиск».
 *
 * Скрипт НИЧЕГО не оценивает качество текста и не решает, хорошо ли мы. Его
 * работа — превратить папку прогона в числа, которые нельзя выдумать:
 *
 *   · сколько семейств назвали верную категорию (ищут «лист», а не «учёт»);
 *   · сколько назвали цену, совпадающую с src/lib/content/plans.ts;
 *   · сколько сослались на uchlist.ru;
 *   · где ответ противоречит источнику цен (не путать с нашей ошибкой).
 *
 * Цены читаются из plans.ts, а не вписываются сюда: цифра в отчёте и цифра на
 * сайте обязаны совпадать, иначе отчёт врёт.
 *
 *   node scripts/ai-visibility-report.mjs --run-dir ai-feedback/search-context
 *   node scripts/ai-visibility-report.mjs --run-dir … --verify-sources   # + сверка публикаций
 *   node scripts/ai-visibility-report.mjs --run-dir … --check-doc docs/41-…md
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i === -1 ? d : argv[i + 1];
};

const RUN_DIR = argOf("--run-dir", "ai-feedback/search-context");
const DOC = argOf("--check-doc", null);
const VERIFY_SOURCES = flag("--verify-sources");
const OUT_MD = argOf("--out", "ai-search-context/visibility-report.md");

const ROOT = process.cwd();
const problems = [];
const note = (p) => problems.push(p);

// ─────────────────────────────────────────────────────────────────────────────
// Источники правды: цены — из планов, страницы — из сборки
// ─────────────────────────────────────────────────────────────────────────────

function readPlanPrices() {
  const path = join(ROOT, "src/lib/content/plans.ts");
  if (!existsSync(path)) {
    note("нет src/lib/content/plans.ts — нечем сверять цены");
    return [];
  }
  const src = readFileSync(path, "utf8");
  const out = [];
  const blockRe = /id:\s*"(free|base|standard|plus|school)"[\s\S]*?prices:\s*\{([\s\S]*?)\n    \},\n/sg;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const month = m[2].match(/month:\s*\{\s*amount:\s*(\d+)/);
    const year = m[2].match(/academicYear:\s*\{\s*amount:\s*(\d+)/);
    if (!month) continue;
    // Незапущенный тариф не сверяем: его цена намеренно скрыта на сайте.
    const rest = src.slice(m.index);
    const nextId = rest.slice(1).search(/\n    id:\s*"/);
    const tail = nextId === -1 ? rest.slice(1) : rest.slice(1, 1 + nextId);
    const comingSoon = /comingSoon:\s*"/.test(tail.slice(0, 1500));
    out.push({ id: m[1], month: Number(month[1]), year: year ? Number(year[1]) : null, comingSoon });
  }
  if (out.length < 4) note(`из plans.ts прочитано тарифов ${out.length}, ожидалось 4+`);
  return out;
}

/**
 * Ответы прогонов: берём ВСЕ папки прогона внутри RUN_DIR и объединяем.
 *
 * Объединение нужно, потому что потерянные ответы переспрашивают отдельно
 * (`--timeout-ms 300000`), и это даёт вторую папку. Поздний ответ по той же
 * паре «семейство+промт» перекрывает раннюю ошибку, а не добавляется рядом.
 */
function readRun() {
  const base = join(ROOT, RUN_DIR);
  if (!existsSync(base)) {
    note(`нет папки прогона ${RUN_DIR}`);
    return null;
  }

  const runDirNames = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (!runDirNames.length) {
    note(`в ${RUN_DIR} нет папок прогона`);
    return null;
  }

  const byKey = new Map();
  let searchContext = null;
  let metas = 0;

  for (const name of runDirNames) {
    const runDir = join(base, name);
    const answersDir = join(runDir, "answers");
    if (!existsSync(answersDir)) continue;

    const metaPath = join(runDir, "meta.json");
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : null;
    if (meta) {
      metas++;
      if (meta.searchContext) searchContext = meta.searchContext;
    }

    for (const f of readdirSync(answersDir).filter((x) => x.endsWith(".md"))) {
      const body = readFileSync(join(answersDir, f), "utf8");
      const [family, prompt] = f.replace(/\.md$/, "").split("__");
      // Текст ответа — всё после строки `---`: выше шапка метаданных и промт.
      const answerText = body.split("\n---\n").slice(1).join("\n---\n");
      const entry = {
        file: f,
        runDirName: name,
        family,
        prompt: prompt ?? "",
        body,
        text: answerText.trim(),
        isError: /\*\*Ошибка:\*\*/.test(body.slice(0, 600)),
      };
      const key = `${family}__${prompt}`;
      const prev = byKey.get(key);
      // Ошибку перекрывает только успешный ответ из более позднего прогона.
      if (!prev || (prev.isError && !entry.isError)) byKey.set(key, entry);
    }
  }

  if (!metas) note("ни в одном прогоне нет meta.json — непонятно, с поиском они были или без");

  return {
    runDirNames,
    runDirName: runDirNames[runDirNames.length - 1],
    meta: { searchContext, startedAt: null },
    answers: [...byKey.values()],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Что именно считаем
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Признаки верной категории: сервис про УЧЕБНЫЕ МАТЕРИАЛЫ. Слово «лист» в
 * «рабочие листы» и есть тот самый якорь, которого модели не хватало.
 *
 * Форма прилагательного пишется по-разному: «рабочие листы», «рабочий лист»,
 * «готовых рабочих листов». Первый вариант регулярки ловил только два первых и
 * объявлял Gemini «не понял категорию», хотя он написал «готовых рабочих
 * листов» — то есть всё понял. Поэтому любая форма, а не две.
 */
const CATEGORY = /рабочи[ехй][а-яё]*\s+лист|генератор\s+рабочих|готовы[ейх][а-яё]*\s+рабочи[ехй]/i;

/** Признаки выдумки из разбора: CRM, учёт финансов, маркетплейс репетиторов. */
const HALLUCINATION = /CRM|уч[её]т\s+финанс|дебиторск|маркетплейс\s+репетиторов|запись\s+на\s+при[её]м|расписани[ея]\s+занятий/i;

/** Цена в тексте: число рядом со знаком рубля. */
function pricesIn(text) {
  return [...text.matchAll(/(\d[\d\s]*)\s*(?:₽|руб\w*)/gi)].map((m) => Number(m[1].replace(/\s/g, ""))).filter(Number.isFinite);
}

/**
 * Конкуренты из выдачи. Нужны, чтобы не приписать УчЛисту чужую цену.
 *
 * В замере 13.10 четыре модели назвали «490 ₽» — но сразу с «Обучай (obuchai.com)».
 * Это не выдумка про нас, а корректно процитированная цена соседа по выдаче.
 * Считать это «ценой, которой у нас нет» нельзя: в отчёте это выглядело бы
 * как ошибка модели там, где модель как раз права.
 */
const COMPETITORS = /Обучай|obuchai|Нейрум|neuroom|fgos\.pro|TeachAny|teachany|Учи\.ру|uchi\.ru|worksheets\.ru/i;

/**
 * Разносит цены по адресату: наша или конкурента.
 *
 * Смотрим окно вокруг вхождения: если рядом имя конкурента — цена его.
 * Окно намеренно широкое (220 символов), потому что модели пишут
 * «тариф «Профи» от 490 ₽ в месяц» тремя строками ниже названия сервиса.
 */
function attributePrices(text, knownPrices) {
  const ours = new Set();
  const theirs = new Set();
  for (const m of text.matchAll(/(\d[\d\s]*)\s*(?:₽|руб\w*)/gi)) {
    const value = Number(m[1].replace(/\s/g, ""));
    if (!Number.isFinite(value)) continue;
    const near = text.slice(Math.max(0, m.index - 220), m.index + 220);
    if (COMPETITORS.test(near)) theirs.add(value);
    else if (knownPrices.has(value)) ours.add(value);
  }
  return { ours: [...ours], theirs: [...theirs] };
}

function analyse(run, plans) {
  const knownPrices = new Set(plans.flatMap((p) => [p.month, p.year].filter((v) => v && v > 0)));

  const rows = [];
  for (const a of run.answers) {
    if (a.isError) {
      rows.push({ family: a.family, prompt: a.prompt, ok: false });
      continue;
    }
    const { ours, theirs } = attributePrices(a.text, knownPrices);
    rows.push({
      family: a.family,
      prompt: a.prompt,
      ok: true,
      category: CATEGORY.test(a.text),
      cites: /uchlist\.ru/i.test(a.text),
      mentionsPrice: ours.length > 0 || theirs.length > 0,
      correct: ours,
      competitorPrices: theirs,
    });
  }

  // Итог — по срезу `first`: он самый короткий и самый честный. Модель, которая
  // не поняла категорию в одной фразе, не «поймёт» её в развёрнутом ответе.
  const first = rows.filter((r) => r.prompt === "first" && r.ok);
  const families = [...new Set(first.map((r) => r.family))];

  return {
    rows,
    first,
    families,
    summary: {
      answered: first.length,
      families: families.length,
      categoryRight: families.filter((f) => first.some((r) => r.family === f && r.category)).length,
      citesSite: families.filter((f) => first.some((r) => r.family === f && r.cites)).length,
      priceRight: families.filter((f) => first.some((r) => r.family === f && r.correct.length > 0)).length,
      competitorPrices: families.filter((f) => first.some((r) => r.family === f && r.competitorPrices.length > 0)),
      hallucinated: families.filter((f) => first.some((r) => r.family === f && HALLUCINATION.test(r.body))),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Сверка наших собственных публикаций (--verify-sources)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Модели читают не один источник, а несколько. Если наши страницы называют разные
 * цены, модель выберет любую — и «противоречие в ответе» будет виной не модели.
 * Поэтому сравниваем то, что отдаётся: llms.txt, разметку на /pricing/ и планы.
 */
function verifySources(plans) {
  const out = join(ROOT, "out");
  if (!existsSync(out)) {
    note("нет out/ — соберите проект перед сверкой публикаций");
    return null;
  }
  const llmsPath = join(out, "llms.txt");
  const pricingPath = join(out, "pricing/index.html");
  if (!existsSync(llmsPath)) note("в сборке нет llms.txt");
  if (!existsSync(pricingPath)) note("в сборке нет страницы тарифов");

  const llms = existsSync(llmsPath) ? readFileSync(llmsPath, "utf8") : "";
  const pricing = existsSync(pricingPath) ? readFileSync(pricingPath, "utf8") : "";

  const mismatches = [];
  for (const p of plans) {
    if (p.month <= 0 || p.comingSoon) continue;
    const inLlm = llms.includes(String(p.month));
    const inPricing = pricing.includes(String(p.month));
    if (!inLlm) mismatches.push(`цена ${p.id} ${p.month} ₽ не названа в llms.txt`);
    if (!inPricing) mismatches.push(`цена ${p.id} ${p.month} ₽ не названа на странице тарифов`);
  }
  for (const m of mismatches) note(`наши публикации расходятся: ${m}`);

  return { mismatches };
}

// ─────────────────────────────────────────────────────────────────────────────
// Печать отчёта
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(run, plans, result, sources) {
  const s = result.summary;
  const when = run.runDirNames.join(" + ");
  const lines = [];

  lines.push("## Замер: что ответит модель с поиском");
  lines.push("");
  lines.push(`- Прогоны: ${when}`);
  lines.push(`- Режим: ${run.meta?.searchContext ? `с выдачей поиска (\`${run.meta.searchContext}\`)` : "БЕЗ ПОИСКА — замер не по этому вопросу"}`);
  lines.push(`- Ответов в срезе «first»: ${s.answered} по ${s.families} семействам`);
  lines.push("");

  lines.push("| Показатель | Значение |");
  lines.push("|---|---|");
  lines.push(`| Назвали верную категорию | ${s.categoryRight} из ${s.families} |`);
  lines.push(`| Сослались на uchlist.ru | ${s.citesSite} из ${s.families} |`);
  lines.push(`| Назвали верную цену | ${s.priceRight} из ${s.families} |`);
  lines.push(`| Назвали чужую цену (явно с именем конкурента) | ${s.competitorPrices.length ? s.competitorPrices.join(", ") : "нет"} |`);
  lines.push(`| Ушли в выдумку (CRM / учёт / маркетплейс) | ${s.hallucinated.length ? s.hallucinated.join(", ") : "нет"} |`);
  lines.push("");

  lines.push("### Что назвали верную категорию и цену");
  lines.push("");
  lines.push("| Семейство | Категория | Ссылка на сайт | Наша цена | Чужие цены (конкуренты) |");
  lines.push("|---|---|---|---|---|");
  for (const r of result.first) {
    lines.push(
      `| ${r.family} | ${r.category ? "да" : "нет"} | ${r.cites ? "да" : "нет"} | ${
        r.correct.length ? r.correct.join(", ") : "—"
      } | ${r.competitorPrices.length ? r.competitorPrices.join(", ") : "—"} |`,
    );
  }
  lines.push("");

  if (sources) {
    lines.push("### Сверка наших публикаций");
    lines.push("");
    lines.push(
      sources.mismatches.length
        ? `Расхождений: ${sources.mismatches.length}`
        : "llms.txt и страница тарифов называют те же цены, что и plans.ts.",
    );
    lines.push("");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const plans = readPlanPrices();
  const run = readRun();
  if (!run) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("VISIBILITY_REPORT_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }

  const result = analyse(run, plans);
  const sources = VERIFY_SOURCES ? verifySources(plans) : null;

  if (!result.first.length) note("в срезе «first» нет ни одного удачного ответа — считать нечего");

  if (DOC) {
    if (!existsSync(join(ROOT, DOC))) {
      note(`нет файла отчёта ${DOC}`);
    } else {
      const doc = readFileSync(join(ROOT, DOC), "utf8");
      const s = result.summary;
      // Цифры отчёта обязаны совпадать с тем, что посчитал скрипт. Иначе через
      // месяц документ будет описывать другой прогон.
      const expected = [
        `${s.answered} по ${s.families} семействам`,
        `| Назвали верную категорию | ${s.categoryRight} из ${s.families} |`,
        `| Сослались на uchlist.ru | ${s.citesSite} из ${s.families} |`,
        `| Назвали верную цену | ${s.priceRight} из ${s.families} |`,
      ];
      for (const e of expected) {
        if (!doc.includes(e)) note(`в отчёте нет строки «${e}» — документ разошёлся с прогоном`);
      }
    }
  } else {
    writeFileSync(join(ROOT, OUT_MD), renderMarkdown(run, plans, result, sources), "utf8");
    console.log(renderMarkdown(run, plans, result, sources));
    console.log(`\nЗаписан: ${OUT_MD}`);
  }

  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error(`${DOC ? "DOC_MATCHES_RUN" : "VISIBILITY_REPORT_OK"} НЕ ПРОЙДЕНА`);
    process.exit(1);
  }

  console.log(DOC ? "DOC_MATCHES_RUN" : "VISIBILITY_REPORT_OK");
}

main();
#!/usr/bin/env node
/**
 * Гейт G2 листа 2.1.6: обходного пути для скриптов в коде больше нет.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ПУНКТ ТЕСТА. Пока `parseArgument` в
 * `latex-to-omml.ts` выбрасывал скрипты из аргумента дроби, в `docx.ts` стоял
 * костыль `keepScriptsInsideFrac`: он переписывал `^{}`/`_{}` внутри `\frac`
 * юникодом ДО конвертера. Степень не терялась, но приходила символом «²» —
 * в Word он не поднимается над базовой линией. Теперь конвертер справляется
 * сам, и костыль удалён.
 *
 * Удалённый костыль — опасный вид правки: ни один тест её не ловит, потому
 * что «²» в документе читается и выглядит почти правильно. Скрипт проверяет
 * и КОД (обходного пути нет ни в виде функции, ни в виде regex-замены), и
 * ПОВЕДЕНИЕ (реальный `m:sSup` собирается без всякой предобработки).
 *
 * Что проверяется:
 *   1. `keepScriptsInsideFrac` и его помощник `fracArgumentRanges` удалены из
 *      `src/lib/utils/docx.ts` — вместе с любыми упоминаниями в комментариях.
 *   2. В `docx.ts` не осталось юникод-замены `^{}`/`_{}` (regex по `\^`/`\_`).
 *   3. `latexToOmml` вызывается напрямую, без обёртки, которая что-то
 *      подменяет на входе.
 *   4. `latex-to-omml.ts` не содержит прежнего `slots.map((slot) => slot.node)`
 *      и рендерит аргументы `\frac`/`\sqrt` через слоты.
 *   5. Поведение: `\frac{x^{2}}{y}` даёт `m:sSup` с непустым `m:sup` и без
 *      символа «²» (проверка идёт на настоящем модуле, а не на исходнике).
 *
 * Запуск: `node scripts/check-omml-script.test.mjs`
 * Успех: `OMML_NO_WORKAROUND_OK` (код 0). Нарушение — список причин, код 1.
 *
 * Нужен Node ≥ 22.6 (снятие типов TypeScript). Без него пункт 5 не выполняется
 * и скрипт падает с кодом 1 — молча пропускать его нельзя, иначе гейт позеленеет
 * ни на чём.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DOCX_TS = join(ROOT, "src", "lib", "utils", "docx.ts");
const OMML_TS = join(ROOT, "src", "lib", "math", "latex-to-omml.ts");

/** Убираем комментарии: правило должно ловить код, а не текст в шапке. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    console.error(`OMML_NO_WORKAROUND_FAILED — не читается ${file}: ${e.message}`);
    process.exit(1);
  }
}

/* -------------------------------------------------------------------------- */
/*  1-4. Проверка по исходнику                                                  */
/* -------------------------------------------------------------------------- */

const docxRaw = read(DOCX_TS);
const docxCode = stripComments(docxRaw);
const ommlCode = stripComments(read(OMML_TS));
const problems = [];

const removed = [
  ["keepScriptsInsideFrac", DOCX_TS],
  ["fracArgumentRanges", DOCX_TS],
];
for (const [name, where] of removed) {
  // Ищем по всему файлу, включая комментарии: упоминание в шапке означает, что
  // правка где-то ещё есть или что её скоро напишут заново.
  if (docxRaw.includes(name)) {
    problems.push(`${where}: «${name}» ещё есть — обходной путь не удалён`);
  }
}

// Юникод-замена скриптов где угодно в docx.ts — это и есть костыль в другой
// форме. В коде файла regex-литералов с `\^` / `\_` быть не должно.
for (const [re, what] of [
  [/\\\^/, "regex по «^»"],
  [/\\_(?![A-Za-z(])/, "regex по «_»"],
]) {
  if (re.test(docxCode)) {
    problems.push(`docx.ts: осталась ${what} — скрипты переписываются до конвертера`);
  }
}

// Конвертер зовётся напрямую: любой вызов с выражением в аргументе означает
// предобработку на входе.
const callSites = [...docxCode.matchAll(/latexToOmml\(([^)]*)\)/g)].map((m) => m[1].trim());
if (callSites.length === 0) {
  problems.push("docx.ts: не нашлось ни одного вызова latexToOmml — конвертер отключён");
}
for (const arg of callSites) {
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$/.test(arg)) {
    problems.push(`docx.ts: latexToOmml(${arg}) — аргумент правится перед вызовом`);
  }
}

// Прежняя поломка разбора и правильный рендер аргументов.
if (/slots\s*\.\s*map\(\s*\(slot\)\s*=>\s*slot\.node\s*\)/.test(ommlCode)) {
  problems.push("latex-to-omml.ts: скрипты снова выбрасываются при разборе аргумента");
}
for (const [re, what] of [
  [/renderSlots\(\s*node\.num\s*\)/, "числитель дроби"],
  [/renderSlots\(\s*node\.den\s*\)/, "знаменатель дроби"],
  [/renderSlots\(\s*node\.body\s*\)/, "тело корня"],
]) {
  if (!re.test(ommlCode)) {
    problems.push(`latex-to-omml.ts: ${what} рендерится не через слоты — скрипт потеряется`);
  }
}

/* -------------------------------------------------------------------------- */
/*  5. Проверка поведением на настоящем модуле                                 */
/* -------------------------------------------------------------------------- */

/** Тот же приём, что в `docx.ts`: `prepForXml` отдаёт готовое OMML-дерево. */
function toXml(components) {
  return components
    .map((component) => {
      const prep = component?.prepForXml;
      if (typeof prep !== "function") return "";
      const tree = prep.call(component, { file: {}, viewWrapper: {}, stack: [] });
      const walk = (node) => {
        if (typeof node === "string") return node;
        if (Array.isArray(node)) return node.map(walk).join("");
        if (!node || typeof node !== "object") return "";
        return Object.entries(node)
          .filter(([key]) => key !== "_attr")
          .map(([key, value]) => `<${key}>${walk(value)}</${key}>`)
          .join("");
      };
      return walk(tree);
    })
    .join("");
}

const { latexToOmml } = await import(pathToFileURL(OMML_TS).href);

const frac = latexToOmml("\\frac{x^{2}}{y}");
if (!frac || frac.length !== 1) {
  problems.push("\\frac{x^{2}}{y} не разобрался в OMML — иначе нужен фолбэк");
} else {
  const xml = toXml(frac);
  if (!xml.includes("<m:sSup>")) {
    problems.push("\\frac{x^{2}}{y} без <m:sSup> — степень не поднята");
  }
  if (!/<m:sup><m:r><m:t>2<\/m:t><\/m:r><\/m:sup>/.test(xml)) {
    problems.push("\\frac{x^{2}}{y}: пустой или юникодный <m:sup> — это не степень");
  }
  if (xml.includes("²")) {
    problems.push("\\frac{x^{2}}{y}: в разметке остался юникодный «²»");
  }
}

// Нижний индекс — тот же класс поломки, только про `_`.
const sub = latexToOmml("\\frac{x_{i}}{y}");
const subXml = sub ? toXml(sub) : "";
if (!subXml.includes("<m:sSub>") || !subXml.includes("<m:sub>")) {
  problems.push("\\frac{x_{i}}{y}: нижний индекс не стал <m:sSub>/<m:sub>");
}

/* -------------------------------------------------------------------------- */

if (problems.length > 0) {
  console.error("OMML_NO_WORKAROUND_FAILED — обходной путь для скриптов снова в коде:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("OMML_NO_WORKAROUND_OK");
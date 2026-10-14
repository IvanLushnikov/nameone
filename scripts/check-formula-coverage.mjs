/**
 * Покрытие формул по типам материала (лист 2.1.5, гейт G3).
 *
 * Запуск: node scripts/check-formula-coverage.mjs
 * Успех: FORMULA_COVERAGE_OK (код 0). Нарушение: понятный список (код 1).
 *
 * ЗАЧЕМ ПРОВЕРЯТЬ ИСХОДНИКИ, А НЕ КАРТИНКУ.
 * Дефект этого листа невидим на экране одного типа: каждый модуль экспорта
 * жил своей жизнью, и карточки с КТП показывали дробь строкой, пока рабочий
 * лист уже умел её рисовать. Скриншот одного типа этого не ловит — нужен
 * разбор КАЖДОГО типа сразу.
 *
 * ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Распознавание дроби должно быть ОДНИМ на
 * весь проект. Второй разбор для карточек — это не «дублирование, которое
 * приятно разделить», а заложенная мина: сегодня совпадёт, через месяц один
 * поправят, второй забудут, и учитель получит две разные формулы в одном
 * комплекте материалов. Поэтому проверка запрещает не только «свой разбор»,
 * но и «свой конвертер» (`latexToOmml` мимо docx.ts) и «свои распознаватели».
 *
 * ЧТО СКРИПТ НЕ ПРОВЕРЯЕТ (честно). Он не открывает Word, PowerPoint и не
 * печатает. Что формула реально рисуется с чертой, доказывают артефакты листа
 * (G1/G2), а этот скрипт отвечает на другой вопрос — откуда у каждого типа
 * берётся разбор.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** Общая точка входа. Лежит в docx.ts — единственном владельце разбора. */
const SHARED_DOCX = join(SRC, "lib", "utils", "docx.ts");

/** Модули-экспортёры: каждый обязан звать общий разбор. */
const TYPE_MODULES = [
  { label: "Карточки · DOCX", file: join(SRC, "lib", "utils", "cards-docx.ts") },
  { label: "КТП · DOCX", file: join(SRC, "lib", "utils", "ktp-docx.ts") },
  { label: "План урока · DOCX", file: join(SRC, "lib", "utils", "lesson-plan-docx.ts") },
  { label: "Презентация · PPTX", file: join(SRC, "lib", "utils", "pptx.ts") },
];

/** Экраны: те же формулы, что и в выгрузке, иначе сверка распечатки с экраном бессмысленна. */
const PREVIEW_MODULES = [
  { label: "Карточки · экран", file: join(SRC, "components", "constructor", "CardsPreview.tsx") },
  { label: "КТП · экран", file: join(SRC, "components", "constructor", "KtpPreview.tsx") },
  {
    label: "План урока · экран",
    file: join(SRC, "components", "constructor", "LessonPlanPreview.tsx"),
  },
];

/** Хелперы, которые тип вправе звать вместо своего разбора. */
const SHARED_HELPERS = ["formulaChildren", "splitFormulaText", "ommlXml"];

/**
 * Признаки «свой разбор написан заново».
 *
 * `latexToUnicode` из списка НЕ запрещён: это запасной читаемый вид из того же
 * конвертера, а не второе решение о том, что такое дробь.
 */
const OWN_PARSER_MARKERS = [
  {
    marker: "latexToOmml(",
    why: "свой вызов OMML-конвертера мимо docx.ts — конвертер обязан вызываться только через ommlXml",
  },
  {
    marker: "parseMathText(",
    why: "свой разбор текста на формулы вместо splitFormulaText",
  },
  {
    marker: "parseLegacyMath(",
    why: "свой разбор текста на формулы вместо splitFormulaText",
  },
  {
    marker: "\\frac",
    why: "собственная сборка \\frac — значит, в модуле есть свой конвертер",
  },
  {
    marker: "matchParenBackward",
    why: "свой распознаватель скобочной дроби",
  },
  {
    marker: "LATEX_SAFE",
    why: "свой распознаватель скобочной дроби",
  },
];

/** Распознаватель скобочной дроби обязан быть ровно в ОДНОМ файле проекта. */
const SINGLETON_PARSERS = ["function splitComplexFractions"];

const failures = [];
const notes = [];

function read(file) {
  return readFileSync(file, "utf8");
}

function rel(file) {
  return file.slice(ROOT.length + 1);
}

function fail(where, what) {
  failures.push(`${where}: ${what}`);
}

/* -------------------------------------------------------------------------- */
/*  1. docx.ts остаётся единственным владельцем разбора                        */
/* -------------------------------------------------------------------------- */

{
  const src = read(SHARED_DOCX);
  const where = rel(SHARED_DOCX);

  for (const helper of SHARED_HELPERS) {
    if (!new RegExp(`export function ${helper}\\b`).test(src)) {
      fail(where, `не экспортирует общий хелпер ${helper}() — остальным типам нечем пользоваться`);
    }
  }

  if (!/import[^;]*latexToOmml[^;]*from "@\/lib\/math\/latex-to-omml"/.test(src)) {
    fail(where, "не импортирует OMML-конвертер — непонятно, чем собирается формула");
  }
  notes.push(`${where}: держит разбор и OMML-конвертер`);
}

/* -------------------------------------------------------------------------- */
/*  2. Каждый тип материала пользуется общим разбором                            */
/* -------------------------------------------------------------------------- */

for (const { label, file } of TYPE_MODULES) {
  const src = read(file);
  const where = `${rel(file)} (${label})`;

  const imported = SHARED_HELPERS.filter(
    (helper) => new RegExp(`import[^;]*\\b${helper}\\b[^;]*from ["'].*docx["']`).test(src)
  );

  if (imported.length === 0) {
    fail(
      where,
      `не импортирует ни одного общего хелпера (${SHARED_HELPERS.join(", ")}) из ./docx — ` +
        "у этого типа свой разбор, и он рано или поздно разойдётся с рабочим листом"
    );
    continue;
  }

  for (const { marker, why } of OWN_PARSER_MARKERS) {
    // Импорт `latexToUnicode` допустим, вызов `latexToOmml(` — нет.
    const found = src.includes(marker);
    if (found) {
      fail(where, `найдено «${marker}» — ${why}`);
    }
  }

  notes.push(`${where}: общий разбор через ${imported.join(", ")}`);
}

/* -------------------------------------------------------------------------- */
/*  3. Экраны рисуют те же формулы, что и выгрузка                              */
/* -------------------------------------------------------------------------- */

for (const { label, file } of PREVIEW_MODULES) {
  const src = read(file);
  const where = `${rel(file)} (${label})`;

  const usesMathText = /import[^;]*\bMathText\b[^;]*from "@\/components\/math\/MathText"/.test(src);
  const usesSplit =
    /import[^;]*\bsplitFormulaText\b[^;]*from "@\/lib\/utils\/docx"/.test(src);

  if (!usesMathText && !usesSplit) {
    fail(
      where,
      "не рисует формулы через MathText/splitFormulaText — на экране будет строка, " +
        "а в файле дробь, и сверка распечатки с экраном перестанет иметь смысл"
    );
    continue;
  }

  for (const { marker, why } of OWN_PARSER_MARKERS) {
    if (src.includes(marker)) fail(where, `найдено «${marker}» — ${why}`);
  }

  notes.push(`${where}: ${usesMathText ? "MathText (KaTeX)" : "splitFormulaText"}`);
}

/* -------------------------------------------------------------------------- */
/*  4. Распознаватель дроби существует в проекте ровно в одном экземпляре        */
/* -------------------------------------------------------------------------- */

for (const signature of SINGLETON_PARSERS) {
  const owners = [];
  for (const dir of ["lib", "components"]) {
    for (const file of walk(join(SRC, dir))) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (read(file).includes(signature)) owners.push(rel(file));
    }
  }
  if (owners.length === 0) {
    fail("src/**", `не найден ${signature} — разбор дроби потерян или переименован`);
  } else if (owners.length > 1) {
    fail(
      "src/**",
      `${signature} встречается в ${owners.length} файлах: ${owners.join(", ")} — ` +
        "разбор дроби продублирован и со временем разойдётся"
    );
  } else {
    notes.push(`${owners[0]}: единственный владелец ${signature}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Вывод                                                                        */
/* -------------------------------------------------------------------------- */

console.log("Покрытие формул по типам материала (лист 2.1.5)\n");
for (const note of notes) console.log(`  ok  ${note}`);

if (failures.length > 0) {
  console.error(`\nНарушений: ${failures.length}\n`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.error(
    "\nЧто делать: разбор дроби живёт в src/lib/utils/docx.ts (splitFormulaText +\n" +
      "formulaChildren + ommlXml). Типы зовут эти функции, свой разбор и свой вызов\n" +
      "latexToOmml в модулях типа запрещены — иначе формулы в карточках, КТП, плане\n" +
      "урока и презентации разъедутся с рабочим листом."
  );
  process.exit(1);
}

console.log("\nFORMULA_COVERAGE_OK");

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}
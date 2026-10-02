/**
 * Проверка того, что математика доедет до прода в рабочем виде.
 *
 * ЗАЧЕМ. Дроби рисуются KaTeX, а он тянет десятки файлов шрифтов
 * (KaTeX_Main-Regular.woff2, KaTeX_Math-Italic.woff2, …). При статическом
 * экспорте Next.js шрифты кладутся в `out/` по ходу сборки. Если CSS собран,
 * а файла шрифта нет — страница ОТКРЫВАЕТСЯ и выглядит нормально, но
 * математика рисуется системным шрифтом. На проде это читается как
 * «вроде работает, но цифры кривые», и поймать без проверки нельзя.
 *
 * ЧЕСТНОСТЬ ТЕСТА. Проверка не может быть «всегда зелёной»:
 *   — функции проверки вынесены отдельно и вызываются на СИНТЕТИЧЕСКОМ
 *     битом `out/` во временной папке; тест обязан упасть на нём;
 *   — на настоящем `out/` проверка скипается, если сборки ещё нет.
 * Никаких «заглушечных» expect'ов, которые проходят только потому, что
 * каталога не существует.
 *
 * ЗАПУСК: `npm run build && npm test`
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");

/** Шрифты, без которых дробь/степень рисуется неправильно. */
const REQUIRED_FONT_STEMS = ["KaTeX_Main", "KaTeX_Math", "KaTeX_Size1", "KaTeX_AMS"];

function collectFiles(dir: string, ext: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(full, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}

/**
 * Проверяет собранный статик. Возвращает список ПРОБЛЕМ (пустой = всё ок).
 * Ничего не бросает и не печатает — чтобы вызывать и из фикстуры, и с out/.
 */
export function checkBuild(outDir: string): string[] {
  const problems: string[] = [];

  const cssFiles = collectFiles(outDir, ".css");
  if (cssFiles.length === 0) problems.push("в сборке нет ни одного .css");

  const allFiles = collectFiles(outDir, "");
  const baseNames = new Set(allFiles.map((f) => path.basename(f)));
  const relative = new Set(
    allFiles.map((f) => path.relative(outDir, f).split(path.sep).join("/")),
  );

  const css = cssFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

  const missingStems = REQUIRED_FONT_STEMS.filter(
    (s) => !baseNames.has(s) && !Array.from(relative).some((r) => path.basename(r).startsWith(s)),
  );
  if (missingStems.length) problems.push(`нет файлов шрифтов: ${missingStems.join(", ")}`);

  // Главная проверка: CSS ссылается на файл, которого в сборке нет.
  const urls = Array.from(css.matchAll(/url\(([^)]+)\)/g))
    .map((m) => m[1].replace(/["']/g, "").trim())
    .filter((u) => /KaTeX/i.test(u));
  if (urls.length === 0) problems.push("CSS не ссылается ни на один файл KaTeX");

  const missing = urls.filter((u) => {
    const clean = u.split("?")[0];
    return !baseNames.has(path.basename(clean)) && !relative.has(clean);
  });
  if (missing.length) problems.push(`CSS ссылается на отсутствующие файлы: ${missing.slice(0, 8).join(", ")}`);

  // При `trailingSlash: true` (next.config.mjs) Next раскладывает страницы как
  // `<route>/index.html`, а не `<route>.html`. Раньше тест искал
  // `constructor.html`, которого в статике не бывает, и падал на любой
  // корректной сборке.
  const hasConstructor =
    relative.has("constructor.html") || relative.has("constructor/index.html");
  if (!hasConstructor) problems.push("нет constructor/index.html — визард не собрался");

  return problems;
}

function makeFixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nameone-build-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe("самопроверка проверки сборки", () => {
  const GOOD_CSS = `@font-face{font-family:KaTeX_Main;src:url(KaTeX_Main-Regular.woff2)}`;

  it("ловит битую сборку: CSS ссылается на файл, которого нет", () => {
    const dir = makeFixture({
      "index.html": "<html></html>",
      "constructor.html": "<html></html>",
      "_next/static/a.css": GOOD_CSS, // ссылается на KaTeX_Main-Regular.woff2
    });
    const problems = checkBuild(dir);
    expect(problems.length, "битая сборка обязана давать проблемы").toBeGreaterThan(0);
    expect(problems.join(" | ")).toMatch(/KaTeX|отсутствующие/i);
  });

  it("ловит полное отсутствие шрифтов KaTeX", () => {
    const dir = makeFixture({
      "index.html": "<html></html>",
      "constructor.html": "<html></html>",
      "_next/static/a.css": "body{color:red}",
    });
    const problems = checkBuild(dir);
    expect(problems.join(" | ")).toMatch(/KaTeX|шрифт/i);
  });

  it("НЕ ругается на корректную сборку со шрифтами на месте", () => {
    const dir = makeFixture({
      "index.html": "<html></html>",
      "constructor.html": "<html></html>",
      "_next/static/a.css": GOOD_CSS,
      "_next/static/media/KaTeX_Main-Regular.woff2": "x",
      "_next/static/media/KaTeX_Math-Italic.woff2": "x",
      "_next/static/media/KaTeX_Size1-Regular.woff2": "x",
      "_next/static/media/KaTeX_AMS-Regular.woff2": "x",
    });
    expect(checkBuild(dir)).toEqual([]);
  });
});

const built = fs.existsSync(OUT);

describe.skipIf(built)("сборка ещё не выполнялась", () => {
  it("проверка out/ пропущена — сначала `npm run build`", () => {
    // Здесь НЕТ проверки результата: честно сообщаем, что нечего проверять.
    // Настоящая проверка живёт в describe ниже и тоже скипается.
    expect(built).toBe(false);
  });
});

describe.skipIf(!built)("математика в собранном статике (out/)", () => {
  it("проверка собранного статика проходит без замечаний", () => {
    const problems = checkBuild(OUT);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

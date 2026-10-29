#!/usr/bin/env node
/**
 * Генерация лёгкой сводки таксономии — `src/lib/content/subject-index.json`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * `src/lib/content/subjects.ts` — единственный источник правды по таксономии.
 * Он тянет за собой `grade-extensions/fgos-program/data.json` (3.5 МБ: 5 492 темы
 * с текстами заданий) и базовые классы из самого `subjects.ts` (244 КБ).
 * Вместе это ~3.8 МБ исходников, которые webpack запекает в ОДИН клиентский
 * чанк на 4.2 МБ.
 *
 * Этот чанк грузился на семи маршрутах, включая главную (`/`). Для главной
 * это была самая тяжёлая страница сайта, хотя с лендинга нужны только:
 * название предмета, эмодзи, цвет, описание, номера классов, СЧЁТЧИК тем и
 * слаг первой темы. Ни текстов заданий, ни самих тем лендингу не нужны — он
 * по ним не ходит.
 *
 * Здесь рождается файл ровно с этими полями. Он весит десятки килобайт вместо
 * 3.8 МБ и уезжает в браузер вместо полной таксономии.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ГЕНЕРИРУЕМ, А НЕ ПИШЕМ РУКАМИ
 * ─────────────────────────────────────────────────────────────────────────────
 * Ручная карта «предмет → сколько тем» разъехалась бы с таксономией при первом
 * же добавлении темы, и на сайте появилось бы враньё в цифрах. Единственный
 * способ не соврать — считать из той же таксономии, из которой рисуются
 * страницы.
 *
 * Поэтому файл генерируется скриптом, а тест `tests/subject-index.test.ts`
 * проверяет, что он совпадает с реальной таксономией. Расхождение — падение
 * теста, а не тихая неправда на главной.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАПУСК
 * ─────────────────────────────────────────────────────────────────────────────
 *   node scripts/build-subject-index.mjs            # проверить и показать сводку
 *   node scripts/build-subject-index.mjs --write    # записать файл
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = path.join(ROOT, "src", "lib", "content", "subject-index.json");

const WRITE = process.argv.includes("--write");

/**
 * Сводка собирается из `subjects.ts` через tsx — так же, как это уже делает
 * `scripts/fgos/build-extension.mjs`. Источник один, поэтому расхождение между
 * сводкой и таксономией невозможно by design.
 *
 * Что берём и зачем:
 *   slug, title, shortTitle, emoji, color, description — «визитка» предмета,
 *     нужная карточкам и заголовкам;
 *   grades[].num / .title — номер и название класса;
 *   grades[].topicsCount — СЧЁТЧИК, а не список тем: лендингу нужно число
 *     («5 492 темы»), а не сами темы;
 *   grades[].firstTopicSlug — первая тема класса: по ней карточка ведёт
 *     на страницу темы.
 */
const SCRIPT = `
import { subjects } from "./src/lib/content/subjects";
const out = subjects.map((s) => ({
  slug: s.slug,
  title: s.title,
  shortTitle: s.shortTitle,
  emoji: s.emoji,
  color: s.color,
  description: s.description,
  grades: s.grades.map((g) => ({
    num: g.num,
    title: g.title,
    topicsCount: g.topics.length,
    firstTopicSlug: g.topics.length > 0 ? g.topics[0].slug : null,
  })),
}));
console.log(JSON.stringify(out));
`;

function readTaxonomy() {
  const out = execFileSync("npx", ["tsx", "-e", SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64e6,
  });
  return JSON.parse(out);
}

const subjects = readTaxonomy();

// Сводка пишется тем же JSON, что читает браузер: без отступов, чтобы файл
// не распухал от форматирования, и с ключами в стабильном порядке.
const json = JSON.stringify(subjects);

const totals = {
  subjects: subjects.length,
  grades: subjects.reduce((n, s) => n + s.grades.length, 0),
  topics: subjects.reduce(
    (n, s) => n + s.grades.reduce((m, g) => m + g.topicsCount, 0),
    0,
  ),
};

console.log("Сводка таксономии:");
console.log(`  предметов: ${totals.subjects}`);
console.log(`  пар (предмет, класс): ${totals.grades}`);
console.log(`  тем: ${totals.topics}`);
console.log(`  размер: ${(json.length / 1024).toFixed(1)} КБ`);

if (!WRITE) {
  if (existsSync(OUT_FILE)) {
    const current = readFileSync(OUT_FILE, "utf8");
    const same = current.trim() === json;
    console.log("");
    console.log(
      same
        ? "Файл на диске совпадает со сводкой — перезаписывать не нужно."
        : "РАСХОЖДЕНИЕ: файл на диске устарел. Перезапиши: node scripts/build-subject-index.mjs --write",
    );
  } else {
    console.log("");
    console.log("Файла нет. Создай: node scripts/build-subject-index.mjs --write");
  }
  process.exit(0);
}

writeFileSync(OUT_FILE, json + "\n", "utf8");
console.log("");
console.log(`Записано: ${path.relative(ROOT, OUT_FILE)} (${(json.length / 1024).toFixed(1)} КБ)`);

#!/usr/bin/env node
/**
 * Стопка фотографий: лимит страниц — один и равен десяти (лист 6.1.6, G2).
 *
 * ЗАЧЕМ СКРИПТ, ЕСЛИ ЕСТЬ ТЕСТЫ. `photoStack.test.ts` доказывает ПОВЕДЕНИЕ:
 * десять страниц принимаются, одиннадцатая отклоняется. Скрипт доказывает
 * другое — что в коде не осталось ВТОРОГО, невидимого глазами места, где
 * лимит можно раздуть. Именно это и стоило работы: лимит стоял сразу в двух
 * константах (`MAX_PHOTOS = 3` и `EXTRA_PHOTO_PAGES = [2, 3]`), и поднятие
 * потолка в первой из них оставило бы вторую на трёх — страницы 4–10 принялись
 * бы, легли бы в бакет и не показались бы учителю нигде.
 *
 * ПРОВЕРКИ:
 *   1. Лимит равен десяти. Число живёт в этом скрипте отдельно от кода —
 *      если разъедутся, скрипт падает. Это ровно то требование гейта.
 *   2. Лимит — ровно один на весь `backend/src`. Второе определение означало бы
 *      «поднять потолок» в одном месте и забыть про другое.
 *   3. Номера страниц для ключей R2 ВЫВОДЯТСЯ из лимита, а не написаны руками.
 *   4. Все три места, где код может «раздуть» приём страниц, берут лимит из
 *      константы: порог формы, потолок досылки и счётчик страниц в R2.
 *   5. В пользовательских текстах нет зашитых чисел страниц («до трёх фото»):
 *      такое сообщение разъедется с потолком и будет врать учителю.
 *
 *   node scripts/check-photo-stack.mjs
 *
 * Зависимостей нет, Node ≥ 18, ничего не устанавливается и никуда не ходит.
 * Успех — `PHOTO_STACK_OK` в stdout. Предупреждения (см. ГРАНИЦА ПРОВЕРКИ) —
 * в stderr, на код возврата не влияют.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Потолок, о котором договорились. Намеренно продублирован числом, а не
 * импортом из кода: если импортировать, то при разъезде скрипт тихо примет
 * неправильное значение и ничего не заметит.
 */
const EXPECTED_PAGES = 10;

/** Читаем .ts/.tsx, пропуская зависимости и сборочные каталоги. */
const SOURCE_EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", ".unlazy"]);

/** Все исходники проекта: рекурсивно, без symlink-погони. */
function collectSources(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectSources(full, acc);
    } else if (SOURCE_EXT.has(full.slice(full.lastIndexOf(".")))) {
      acc.push(full);
    }
  }
  return acc;
}

function read(...segments) {
  const path = join(ROOT, ...segments);
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `не удалось прочитать ${segments.join("/")} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const f06 = read("backend", "src", "routes", "f06.ts");
const backendSources = collectSources(join(ROOT, "backend", "src"));
const problems = [];

const where = (file) => relative(ROOT, file);

// ─── 1. Лимит равен десяти ────────────────────────────────────────────────────

const limitDecl = f06.match(/\bMAX_PHOTOS\s*=\s*(\d+)\s*;/);
if (!limitDecl) {
  problems.push(
    "в backend/src/routes/f06.ts не найдено объявление `MAX_PHOTOS = <число>;` — лимит страниц потерян",
  );
} else if (Number(limitDecl[1]) !== EXPECTED_PAGES) {
  problems.push(
    `лимит страниц в коде ${limitDecl[1]}, а контракт этого скрипта — ${EXPECTED_PAGES}. ` +
      `Поднять потолок можно, но тогда ЭТОТ скрипт: иначе гейт будет врать`,
  );
}

// Лимит должен быть доступен снаружи: иначе фронт и проверки не смогут
// сослаться на единственный источник правды и заведут свои копии числа.
if (!/export\s+const\s+MAX_PHOTOS\s*=/.test(f06)) {
  problems.push(
    "MAX_PHOTOS не экспортируется из f06.ts — единственный источник правды недоступен " +
      "ни тестам, ни фронту, а значит у них появятся свои копии числа",
  );
}

// ─── 2. Лимит — ровно один на весь backend/src ─────────────────────────────────

const definitions = [];
for (const file of backendSources) {
  const src = readFileSync(file, "utf8");
  const hits = [...src.matchAll(/(?:export\s+)?const\s+MAX_PHOTOS\s*=\s*(\d+)\s*;/g)];
  for (const hit of hits) {
    definitions.push({ file: where(file), value: Number(hit[1]) });
  }
}
if (definitions.length === 0) {
  problems.push("MAX_PHOTOS не объявлен ни в одном файле backend/src");
} else if (definitions.length > 1) {
  problems.push(
    `MAX_PHOTOS объявлен ${definitions.length} раза: ${definitions
      .map((d) => `${d.file} = ${d.value}`)
      .join(", ")}. ` +
      "Два места с лимитом разъедутся при первой же правке — оставить можно одно",
  );
}

// ─── 3. Номера страниц выводятся из лимита, а не написаны руками ───────────────

if (!/const\s+EXTRA_PHOTO_PAGES\b/.test(f06)) {
  problems.push("в f06.ts нет EXTRA_PHOTO_PAGES — список страниц для ключей R2 потерян");
} else {
  const block = f06.match(/const\s+EXTRA_PHOTO_PAGES[^;]*;/s)?.[0] ?? "";
  if (!/\bMAX_PHOTOS\b/.test(block)) {
    problems.push(
      "EXTRA_PHOTO_PAGES задан числами руками и не выводится из MAX_PHOTOS. " +
        "Это вторая копия лимита: поднять потолок в одном месте и забыть про " +
        "эту — значит тихо потерять страницы 4+",
    );
  }
}

// ─── 4. Ни одно место не может раздуть приём страниц ───────────────────────────

// Порог в первичной форме.
if (!/files\.length\s*>\s*MAX_PHOTOS/.test(f06)) {
  problems.push(
    "в readPhotoForm порог страниц перестал браться из MAX_PHOTOS — " +
      "приём страниц отвязался от единственного лимита",
  );
}
// Потолок при досылке: сколько ещё помещается В ЭТУ работу.
if (!/MAX_PHOTOS\s*-\s*havePages/.test(f06)) {
  problems.push(
    "в досылке страниц нет `MAX_PHOTOS - havePages` — приём страниц при досылке " +
      "не ограничен тем же лимитом",
  );
}
// Счётчик страниц в R2 тоже обязан быть ограничен тем же потолком,
// иначе он пройдёт дальше лимита по лишним запросам к бакету.
if (!/page\s*<=\s*MAX_PHOTOS/.test(f06)) {
  problems.push(
    "countPhotoPages не ограничен MAX_PHOTOS — счётчик страниц можно разогнать " +
      "за пределы лимита",
  );
}

// ─── 5. В текстах для учителя нет зашитых чисел страниц ────────────────────────

// Такие строки проходят мимо константы и потом врут учителю: сервер возьмёт
// десять страниц, а текст по-прежнему будет обещать три.
const hardcodedPagePhrases = [
  /до\s+3\s+фото/i,
  /от\s+одной\s+до\s+тр[её]х/i,
  /до\s+тр[её]х\s+страниц/i,
  /одна-три\s+страниц/i,
  /одной-тр[её]х\s+страниц/i,
];
for (const phrase of hardcodedPagePhrases) {
  if (phrase.test(f06)) {
    problems.push(
      `в f06.ts есть текст для учителя с зашитым числом страниц (${phrase}) — ` +
        "он разъедется с лимитом и будет врать",
    );
  }
}

// ─── ГРАНИЦА ПРОВЕРКИ ─────────────────────────────────────────────────────────
//
// Этот скрипт проверяет ТОЛЬКО backend/src. Фронт живёт в другом пакете, и
// его константа страниц — в другом листе. Здесь мы её НЕ правим, но и не
// делаем вид, что её нет: расхождение печатаем явно, чтобы оно не потерялось.

const uploadPath = join(ROOT, "src", "components", "f06", "PhotoUpload.tsx");
try {
  const upload = readFileSync(uploadPath, "utf8");
  const frontLimit = upload.match(/\bMAX_PAGES\s*=\s*(\d+)\s*;/);
  if (frontLimit && Number(frontLimit[1]) !== EXPECTED_PAGES) {
    console.error(
      `ВНИМАНИЕ (вне этого листа): src/components/f06/PhotoUpload.tsx показывает учителю ` +
        `лимит ${frontLimit[1]}, а сервер принимает ${EXPECTED_PAGES}. Файл загрузчика — ` +
        "чужой лист, здесь не правится: учитель увидит старый потолок, пока его не обновит владелец файла.",
    );
  }
} catch {
  // Загрузчика нет — нечего сверять, это не повод ронять проверку.
}

// ─── Итог ──────────────────────────────────────────────────────────────────────

try {
  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("PHOTO_STACK_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }
  console.log("PHOTO_STACK_OK");
} catch (err) {
  // Молчать нельзя: «скрипт ничего не напечатал» и «скрипт упал» — разные диагнозы.
  console.error(
    `ПРОВАЛ: проверку не удалось выполнить — ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error("PHOTO_STACK_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}
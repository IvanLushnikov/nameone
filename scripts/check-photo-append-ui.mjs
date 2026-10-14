#!/usr/bin/env node
/**
 * Досылка страниц доведена до экрана (лист 7.1.4, G1).
 *
 * ЗАЧЕМ СКРИПТ, А НЕ ТЕСТ. Тест доказывает поведение функции, а эта дыра была
 * НЕ в поведении: эндпоинт `POST /photo-checks/:id/pages` был написан, работал
 * и не имел ни одного вызова с фронта. Кнопки не было — ученик не мог дослать
 * страницу, а учитель в журнале не видел, сколько страниц в работе. Любой
 * тест на сервере был при этом зелёным. Скрипт проверяет другое: что путь
 * ЗАМКНУТ, то есть кнопка, запрос и число страниц в журнале связаны между
 * собой в коде. Стоит убрать любой конец — проверка падает.
 *
 * ПРОВЕРКИ:
 *   1. Роут досылки на месте на бэке.
 *   2. С фронта на этот роут уходит РЕАЛЬНЫЙ POST: строка `/pages` и
 *      `method: "POST"` должны встретиться в одном вызове `fetch`.
 *   3. Клиентская функция досылки существует и вызывается из панели.
 *   4. Кнопка «дослать» на экране проверки привязана к этой функции
 *      (обработчик, который зовёт запрос, стоит на кнопке).
 *   5. Журнал отдаёт число страниц, тип строки его знает, а строка журнала его
 *      показывает — учитель видит число, не открывая работу.
 *   6. Ошибка досылки видима словами, и при отказе разбор НЕ подменяется.
 *   7. В текстах для учителя нет зашитых чисел страниц: «до трёх страниц» —
 *      это враньё, потолок теперь десять (лист 6.1.6).
 *
 *   node scripts/check-photo-append-ui.mjs
 *
 * Зависимостей нет, Node ≥ 18, ничего не устанавливается и никуда не ходит.
 * Успех — `PHOTO_APPEND_UI_OK` в stdout.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const where = (file) => relative(ROOT, file);

function read(...segments) {
  try {
    return readFileSync(join(ROOT, ...segments), "utf8");
  } catch (err) {
    throw new Error(
      `не удалось прочитать ${segments.join("/")} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const SOURCE_EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", ".unlazy"]);

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
    if (st.isDirectory()) collectSources(full, acc);
    else if (SOURCE_EXT.has(full.slice(full.lastIndexOf(".")))) acc.push(full);
  }
  return acc;
}

// ─── 1. Роут досылки жив ────────────────────────────────────────────────────────

const f06 = read("backend", "src", "routes", "f06.ts");
if (!/f06Router\.post\(\s*"\/photo-checks\/:id\/pages"/.test(f06)) {
  problems.push(
    "в backend/src/routes/f06.ts нет `POST /photo-checks/:id/pages` — досылать нечем, " +
      "и кнопка на фронте была бы враньём",
  );
}

// ─── 2. С фронта уходит настоящий POST на этот адрес ───────────────────────────

const frontSources = collectSources(join(ROOT, "src"));

/** Все вызовы `fetch` вместе с окном кода после них — там лежат method и URL. */
function fetchCalls(src) {
  const calls = [];
  for (const hit of src.matchAll(/\bfetch\(/g)) {
    calls.push(src.slice(hit.index, hit.index + 600));
  }
  return calls;
}

const postPageCalls = [];
for (const file of frontSources) {
  const src = readFileSync(file, "utf8");
  if (src.includes("__tests__")) continue;
  for (const call of fetchCalls(src)) {
    if (/\/pages\b/.test(call) && /method:\s*"POST"/.test(call)) {
      postPageCalls.push(where(file));
    }
  }
}
if (postPageCalls.length === 0) {
  problems.push(
    "ни один вызов fetch во фронте не отправляет POST на `/pages` — эндпоинт досылки " +
      "снова остался бы без единого вызова, а кнопка обещала бы то, чего не случится",
  );
}

// ─── 3. Клиентская функция досылки и её вызов из панели ────────────────────────

const PANEL = "src/components/f06/PhotoCheckPanel.tsx";
const panel = read(PANEL);

if (!/export\s+async\s+function\s+appendPhotoPages\b/.test(panel)) {
  problems.push(`в ${PANEL} нет экспортируемой функции appendPhotoPages — запрос досылки нечем вызвать`);
}

const appendCallCount = (panel.match(/appendPhotoPages\s*\(/g) ?? []).length;
// Объявление функции + вызов из обработчика. Меньше двух — функция есть, а
// звать её некому: тот самый случай «эндпоинт без вызовов».
if (appendCallCount < 2) {
  problems.push(
    `appendPhotoPages объявлена, но ни разу не вызвана в ${PANEL} — ` +
      "кнопка без запроса была бы враньём в интерфейсе",
  );
}

// ─── 4. Кнопка на экране проверки привязана к этой функции ──────────────────────

const sendHandler = /onSend\s*=\s*\{appendPages\}/.test(panel);
const sendButton = /<Button[^>]*onClick=\{onSend\}/s.test(panel);
if (!sendHandler) {
  problems.push(
    `блок досылки в ${PANEL} не получает обработчик appendPages — ` +
      "нажатие кнопки ни к чему не приведёт",
  );
}
if (!sendButton) {
  problems.push(`в ${PANEL} нет кнопки, которая зовёт onSend — дослать нечем вручную`);
}
if (!/Дослать выбранные страницы/.test(panel)) {
  problems.push(`в ${PANEL} нет кнопки «Дослать выбранные страницы» — ученик не поймёт, что страница уходит серверу`);
}

// ─── 5. Учитель видит число страниц в строке журнала ───────────────────────────

const journalRoute = read("backend", "src", "routes", "journal.ts");
const journalClient = read("src", "lib", "photo-check", "journal.ts");
const journalView = read("src", "components", "f06", "CheckJournal.tsx");

if (!/\bpages\b/.test(journalRoute)) {
  problems.push(
    "backend/src/routes/journal.ts не отдаёт `pages` — число страниц в строке журнала " +
      "не доедет до фронта, и учитель увидит работу, не зная, сколько в ней страниц",
  );
}
if (!/pages\??:\s*number\s*\|\s*null/.test(journalClient)) {
  problems.push(
    "в типе JournalEntry нет поля pages — строка журнала не может показать число страниц",
  );
}
if (!/journalPagesText/.test(journalView)) {
  problems.push(
    "CheckJournal не показывает число страниц — требование «учитель видит объём " +
      "работы, не открывая её» не выполнено",
  );
}

// ─── 6. Отказ виден словами и не подменяет разбор ──────────────────────────────

if (!/\bappendError\b/.test(panel)) {
  problems.push(`в ${PANEL} нет состояния appendError — отказ сервера нечем показать словами`);
}
if (!/role="status"[\s\S]{0,400}appendError|\{pickError \?\? error\}/.test(panel)) {
  problems.push(`в ${PANEL} текст отказа досылки не выводится на экран — учитель решит, что «сохранилось»`);
}

// ─── 7. В текстах нет зашитых чисел страниц ─────────────────────────────────────

const hardcodedPagePhrases = [
  /до\s+3\s+фото/i,
  /до\s+тр[её]х\s+страниц/i,
  /от\s+одной\s+до\s+тр[её]х/i,
  /одной-три\s+страниц/i,
  /одной-тр[её]х\s+страниц/i,
];
for (const file of [PANEL, "src/components/f06/CheckJournal.tsx", "src/components/f06/PhotoCheckResult.tsx"]) {
  const src = read(file);
  for (const phrase of hardcodedPagePhrases) {
    if (phrase.test(src)) {
      problems.push(
        `в ${file} есть текст для учителя с зашитым числом страниц (${phrase}) — ` +
          "потолок теперь десять, и такой текст будет врать",
      );
    }
  }
}

// ─── Итог ──────────────────────────────────────────────────────────────────────

try {
  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("PHOTO_APPEND_UI_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }
  console.log("PHOTO_APPEND_UI_OK");
} catch (err) {
  console.error(
    `ПРОВАЛ: проверку не удалось выполнить — ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error("PHOTO_APPEND_UI_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}
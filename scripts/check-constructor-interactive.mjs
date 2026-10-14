#!/usr/bin/env node
/**
 * Проверка, что интерактив открыт в конструкторе учителя (лист 4.1.1, G1).
 *
 * Зачем скрипт, если есть тесты. Тесты доказывают ПОВЕДЕНИЕ компонента, который
 * уже написан. Эта штука ловит другое — что через месяц кто-то вернёт тип в
 * чёрный список или отключит превью, и всё будет зелёное, а учитель снова
 * увидит «этот формат ещё в работе» при готовом движке. Именно это уже
 * случилось один раз: движок, ранклер, шесть форматов и страница `/play/`
 * были готовы, а вход из конструктора был закрыт заглушкой.
 *
 * Что проверяем (строково, дословно — регулярки тут место тихой порчи):
 *
 *   1. «interactive» НЕ вернулся в `NOT_YET_IMPLEMENTED_TYPES`, а «image»
 *      остался (иначе чинить одну дыру можно было бы, снеся весь список).
 *   2. Превью подключено: страница его импортирует и рисует, а не просто
 *      импортирует.
 *   3. Сборка идёт в `buildInteractive()`, и `generate()` на этом типе не
 *      бросает «ещё не реализован».
 *   4. Список форматов у учителя — из реестра движка. Свой ручной список
 *      означал бы, что формат можно спрятать; ровно это запрещает лист.
 *   5. Ссылка ведёт на `/play/?t=` и из панели есть путь в кабинет.
 *   6. Стоимость названа словами: отдельный вызов модели и лимит 20 игр в час.
 *   7. Старая панель `InteractiveCreatePanel` в конструкторе больше не
 *      рисуется — иначе на экране окажутся две игры одновременно.
 *
 * Зависимостей нет, Node ≥ 18, ничего не устанавливается и никуда не ходит.
 * Успех — ровно `CONSTRUCTOR_INTERACTIVE_OK` в stdout.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Прочитать файл. Отсутствие файла — провал, но с точным текстом. */
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

const page = read("src", "app", "constructor", "page.tsx");
const preview = read("src", "components", "constructor", "InteractivePreview.tsx");
const rules = read("src", "lib", "construct", "interactive.ts");
const formats = read("src", "lib", "interactives", "formats.ts");
const types = read("src", "lib", "interactives", "types.ts");

const problems = [];

function mustContain(src, needle, why) {
  if (!src.includes(needle)) problems.push(why);
}

function mustNotContain(src, needle, why) {
  if (src.includes(needle)) problems.push(why);
}

/** Кусок исходника между двумя маркерами — чтобы проверка смотрела нужный блок. */
function slice(src, from, to) {
  const a = src.indexOf(from);
  if (a === -1) return "";
  const b = to ? src.indexOf(to, a + from.length) : -1;
  return b === -1 ? src.slice(a) : src.slice(a, b);
}

/* 1. Чёрный список типов. */
const notImplemented = slice(page, "const NOT_YET_IMPLEMENTED_TYPES", "function resultKindForType");
mustNotContain(
  notImplemented,
  '"interactive"',
  "«interactive» снова в NOT_YET_IMPLEMENTED_TYPES — учитель опять увидит «этот формат ещё в работе»",
);
mustContain(
  notImplemented,
  '"image"',
  "«image» пропал из NOT_YET_IMPLEMENTED_TYPES: у картинки своя история и свой провайдер, её чинить здесь нельзя",
);

/* 2. Превью подключено к странице. */
mustContain(
  page,
  'import InteractivePreview from "@/components/constructor/InteractivePreview"',
  "страница не импортирует InteractivePreview",
);
mustContain(
  page,
  "<InteractivePreview",
  "InteractivePreview импортирован, но нигде не рисуется — превью отключено",
);
/* Рендер именно в правой колонке результата, а не в самом низу страницы. */
mustContain(
  slice(page, "{type === \"interactive\" &&", "</section>"),
  "registerBuild",
  "панель игры не передаёт обработчик сборки в страницу — generate() на этом типе упрётся в заглушку",
);

/* 3. Сборка живёт в buildInteractive, а generate() не бросает «ещё не реализован». */
mustContain(
  page,
  "const buildInteractive = React.useCallback",
  "в странице нет buildInteractive() — кнопка «Собрать игру» не сможет собрать игру",
);
mustContain(page, "await createInteractive({", "buildInteractive() не вызывает POST /api/interactives");
const throwSite = slice(page, 'case "image":', "default:");
mustNotContain(
  throwSite,
  'case "interactive":',
  'в generate() «interactive» снова бросает «ещё не реализован» — кнопка «Создать» на этом типе ничего не сделает',
);

/* 4. Форматы — из реестра движка, без ручного списка. */
mustContain(
  rules,
  "export const CONSTRUCTOR_INTERACTIVE_FORMATS: readonly InteractiveFormat[] = INTERACTIVE_FORMATS;",
  "список форматов учителя собирается не из реестра движка — формат можно спрятать, а лист это запрещает",
);
mustNotContain(
  rules,
  '"quiz-race",',
  "в правилах появился ручной перечень форматов — форматы снова можно спрятать или забыть",
);
const registry = slice(types, "export const INTERACTIVE_FORMATS", "as const;");
for (const format of ["quiz-race", "sort-baskets", "jump-truth", "fortune-wheel", "jeopardy", "sort-sequence"]) {
  if (!registry.includes(`"${format}"`)) {
    problems.push(`в реестре движка нет формата ${format} — панель учителя покажет лишний формат`);
  }
  // Ключи в FORMAT_META часть в кавычках, часть без — проверяем оба вида,
  // чтобы запись вида `"quiz-race": {` и `jeopardy: {` проходили одинаково.
  if (!formats.includes(`"${format}": {`) && !formats.includes(`${format}: {`)) {
    problems.push(`в FORMAT_META нет формата ${format} — панель нарисует карточку без названия`);
  }
}
mustContain(
  preview,
  "CONSTRUCTOR_INTERACTIVE_FORMATS.map",
  "панель не рисует список форматов из реестра — либо ничего, либо свой ручной перечень",
);

/* 5. Ссылка на прохождение и путь в кабинет. */
mustContain(
  rules,
  'return `/play/?t=${encodeURIComponent(shareToken)}`;',
  "ссылка на прохождение собирается не как /play/?t=… — учителю нечего отдать ученикам",
);
mustContain(
  preview,
  'href="/dashboard/interactives"',
  "из панели игры нет обратно в кабинет — учитель остаётся на странице без выхода",
);
mustContain(
  preview,
  "<FormQrBlock",
  "панель игры не показывает QR-код — это половина «отдать классу»",
);

/* 6. Стоимость названа словами. */
mustContain(
  rules,
  "Игра — отдельный вызов модели",
  "в правилах нет слов про отдельный вызов модели — учитель не видит, во сколько ему обходится игра",
);
mustContain(rules, "20 игр в час", "не назван лимит сборки игр — серверный счётчик не виден");
mustContain(
  preview,
  "interactiveCostNote(",
  "панель не показывает стоимость сборки",
);

/* 7. Честные блокировки: причина вместо кнопки, которая ничего не делает. */
for (const kind of [
  'kind: "need-login"',
  'kind: "need-quota"',
  'kind: "need-worksheet"',
  'kind: "no-server-sheet"',
]) {
  mustContain(
    rules,
    kind,
    `в правилах нет состояния ${kind} — при этой нехватке панель покажет кнопку, которая ничего не сделает`,
  );
}
mustContain(
  preview,
  "block.kind === \"need-login\" ? null",
  "без входа панель всё равно рисует кнопку сборки — это обещание, которое не выполнится",
);
mustContain(
  rules,
  "outOfQuota",
  "панель не знает про бесплатный лимит: без листа для игры учитель упрётся в подписку без предупреждения",
);
mustContain(
  preview,
  "worksheetIsDemo && !error",
  "панель показывает предупреждение о заготовке рядом с ошибкой сборки — два одинаковых блока подряд",
);
mustContain(
  preview,
  "INTERACTIVE_DEMO_WARNING",
  "панель не предупреждает, что собирает игру из заготовки демо-режима",
);
mustContain(rules, "INTERACTIVE_DEMO_WARNING", "в правилах нет текста про заготовку демо-режима");

/* 8. Старая панель не рисуется рядом с новой. */
mustNotContain(
  page,
  "<InteractiveCreatePanel",
  "в конструкторе снова рисуется старая панель InteractiveCreatePanel — на экране будут две игры",
);

try {
  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("CONSTRUCTOR_INTERACTIVE_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }
  console.log("CONSTRUCTOR_INTERACTIVE_OK");
} catch (err) {
  // Молчать нельзя: «скрипт ничего не напечатал» и «скрипт упал» — разные диагнозы.
  console.error(
    `ПРОВАЛ: проверку не удалось выполнить — ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error("CONSTRUCTOR_INTERACTIVE_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}
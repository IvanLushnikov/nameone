#!/usr/bin/env node
/**
 * Проверка, что короткую ссылку `/p/<код>` невозможно подобрать перебором
 * (лист 6.1.8, гейт G2).
 *
 * Зачем скрипт, если есть тесты. Тесты доказывают ПОВЕДЕНИЕ: двенадцать
 * символов открывают нужную игру, одиннадцать — дают 404. Скрипт доказывает
 * другое — что через полгода кто-то не сократит код до «красивых» шести
 * символов ради того, чтобы ссылка выглядела опрятнее на доске.
 *
 * Порядок величин, ради которого всё затевалось:
 *
 *   код 12 символов base62  →  62^12 ≈ 3.3×10^21 вариантов
 *   при темпе 10^6 попыток/сек это ≈ 100 млн лет перебора
 *
 * Три числа в проверке НЕ берутся из исходника, а заданы здесь независимо:
 * если и длину кода, и порог взять из самого роутера, то укоротив и порог,
 * скрипт покраснеет. Порог 2^70 = 1.18×10^21: двенадцать символов проходят,
 * одиннадцать (5.4×10^19) — нет.
 *
 *   node scripts/check-short-link.mjs
 *
 * Зависимостей нет, Node ≥ 18, ничего не устанавливается и никуда не ходит.
 * Успех — ровно `SHORT_LINK_UNGUESSABLE_OK` в stdout.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Алфавит кода — base62, тот же, что у share_token (backend/src/lib/shortid.ts). */
const ALPHABET_SIZE = 62;

/** Порог стойкости: 62^L ≥ 2^70. Двенадцать символов проходят, одиннадцать — нет. */
const MIN_BITS = 70;

/** Нижняя граница длины, продублирована числом, чтобы её нельзя было сдвинуть. */
const MIN_LENGTH = 12;

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

/**
 * Оценка стойкости кода заданной длины. Вынесено отдельно, чтобы в конце
 * прогнать САМ ЧЕКЕР на заведомо плохих длинах: если проверка не умеет падать,
 * зелёный прогон ничего не доказывает.
 */
function assess(length) {
  const space = ALPHABET_SIZE ** length;
  const problems = [];
  if (!Number.isInteger(length) || length < 1) problems.push(`длина ${length} не является длиной кода`);
  if (length < MIN_LENGTH) problems.push(`длина кода ${length} < ${MIN_LENGTH}`);
  if (space < 2 ** MIN_BITS) {
    problems.push(
      `перебор ${ALPHABET_SIZE}^${length} = ${space.toExponential(2)} < 2^${MIN_BITS} — подбор дешёвый`,
    );
  }
  return { length, space, bits: Math.round((Math.log2(space) * 100) / 100), problems };
}

const problems = [];

let routeSrc;
let redirectsSrc;
try {
  routeSrc = read("backend", "src", "routes", "interactives-public.ts");
  redirectsSrc = read("public", "_redirects");
} catch (err) {
  console.error(`ПРОВАЛ: ${err instanceof Error ? err.message : String(err)}`);
  console.error("SHORT_LINK_UNGUESSABLE_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}

// ── 1. Длина кода в исходнике ────────────────────────────────────────────────
const lengthMatch = routeSrc.match(/SHORT_CODE_LENGTH\s*=\s*(\d+)/);
if (!lengthMatch) {
  problems.push("в роутере нет константы SHORT_CODE_LENGTH — длина кода объявлена неявно");
} else {
  const { space, bits, problems: lengthProblems } = assess(Number(lengthMatch[1]));
  problems.push(...lengthProblems);
  if (lengthProblems.length === 0) {
    console.info(
      `код: ${lengthMatch[1]} символов base62 → ${space.toExponential(2)} вариантов (~${bits} бит)`,
    );
  }
}

// ── 2. Алфавит не сузился ────────────────────────────────────────────────────
const alphabetMatch = routeSrc.match(/SHORT_CODE_ALPHABET_SIZE\s*=\s*(\d+)/);
if (!alphabetMatch) {
  problems.push("в роутере нет константы SHORT_CODE_ALPHABET_SIZE — размер алфавита объявлен неявно");
} else if (Number(alphabetMatch[1]) !== ALPHABET_SIZE) {
  problems.push(
    `алфавит ${alphabetMatch[1]} символов, а скрипт считает по base62 (${ALPHABET_SIZE}). ` +
      `Сужение алфавита уменьшает стойкость в ${(ALPHABET_SIZE / Number(alphabetMatch[1])).toFixed(1)} раз`,
  );
}

// ── 3. Принимаемый код не длиннее объявленного ──────────────────────────────
// Регексп строится из SHORT_CODE_LENGTH — это правильный вариант. Но если его
// перепишут руками в /^[0-9A-Za-z]{8}$/, перебор начнёт идти по коротким
// кодам при «официальной» длине 12.
const patternLine = routeSrc.match(/SHORT_CODE_PATTERN[^\n]*/)?.[0] ?? "";
if (!patternLine) {
  problems.push("SHORT_CODE_PATTERN не найден — нечем проверить, какой длины код реально принимается");
} else {
  const derived = patternLine.includes("${SHORT_CODE_LENGTH}");
  const hardcoded = patternLine.match(/\{(\d+)\}/);
  if (hardcoded && lengthMatch && Number(hardcoded[1]) !== Number(lengthMatch[1])) {
    problems.push(
      `SHORT_CODE_PATTERN принимает ${hardcoded[1]} символов, а SHORT_CODE_LENGTH = ${lengthMatch[1]}`,
    );
  } else if (!derived && !hardcoded) {
    problems.push("SHORT_CODE_PATTERN не связан с SHORT_CODE_LENGTH — длина принятого кода неясна");
  }
}

// ── 4. Поиск идёт по префиксу токена, а не по отдельной колонке ─────────────
// Отдельная колонка `code` означала бы, что код — новое секретное значение с
// собственным сроком жизни и миграцией. Префикс токена секрета не добавляет.
if (!/substr\(\s*share_token\s*,\s*1\s*,/.test(routeSrc)) {
  problems.push(
    "роутер ищет не по substr(share_token, 1, …) — короткий код перестал быть префиксом токена",
  );
}

// ── 5. Правило раздачи есть в _redirects ────────────────────────────────────
// Страница `/p/…` не попадает в статическую сборку: без этого правила ссылка
// для доски не работает, и укорочение кода было бы напрасным.
if (!/^\s*\/p\/\*\s+https:\/\/[^\s]+\/p\/:splat\s+200\s*$/m.test(redirectsSrc)) {
  problems.push("в public/_redirects нет прокси-правила `/p/* … 200` — ссылка не будет раздаваться");
}

// ── 6. Сам чекер обязан падать на укороченном коде ──────────────────────────
// Проверка самого проверяющего: если эти два пункта не выполняются, «зелёный»
// прогон ничего не значит — скрипт печатает OK, ни разу не ответив «нет».
for (const length of [11, 10, 6, 3]) {
  if (assess(length).problems.length === 0) {
    problems.push(`САМОПРОВЕРКА сломана: код длиной ${length} символов прошёл бы как стойкий`);
  }
}
for (const length of [12, 16, 32]) {
  if (assess(length).problems.length > 0) {
    problems.push(`САМОПРОВЕРКА сломана: стойкий код длиной ${length} символов отвергнут как слабый`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
  console.error("SHORT_LINK_UNGUESSABLE_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}

console.log("SHORT_LINK_UNGUESSABLE_OK");
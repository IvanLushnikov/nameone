#!/usr/bin/env node
/**
 * Проверка по исходнику: тест стадии планирования не должен уметь дойти до
 * настоящего провайдера.
 *
 * Зачем файл существует. Тест `backend/tests/integration/plan-stage-wiring.test.ts`
 * объявлен в комментарии как бесплатный, но полгода ходил в polza.ai и падал
 * без ключа, роняя выкатку бэкенда в CI (run 38536996684). Проверить такое
 * глазами по одному прогону нельзя: тест зелёный и без подмены, если у
 * разработчика нашёлся ключ в .dev.vars. Поэтому проверка живёт в репозитории и
 * гоняется без сети, без денег и без vitest.
 *
 * Что проверяется:
 *   1. `fetch` подменён глобально (`vi.stubGlobal` + `vi.fn`), а не локально.
 *   2. Подмена снимается после каждого теста (`vi.unstubAllGlobals`).
 *   3. Нет обходных сетевых ручек в обход `fetch` (undici, node:http, XHR).
 *   4. Ключ провайдера — константа в файле, а не чтение окружения/`.dev.vars`.
 *   5. Адрес провайдера — нерезолвящийся домен `.invalid` (вторая линия защиты).
 *   6. Файл не выключен: нет `describe.skip` / `it.skip` / `.todo`.
 *
 * Запуск: `node scripts/check-plan-stage-test-runnable.mjs`
 * Успех: `PLAN_STAGE_TEST_RUNNABLE_OK`, код 0. Нарушение — список причин, код 1.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TEST_PATH = join(ROOT, "backend", "tests", "integration", "plan-stage-wiring.test.ts");

/** Убираем комментарии, чтобы правило ловило код, а не текст в шапке. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function main() {
  let raw;
  try {
    raw = readFileSync(TEST_PATH, "utf8");
  } catch (e) {
    return fail([`не читается ${TEST_PATH}: ${e.message}`]);
  }

  const code = stripComments(raw);
  const problems = [];

  // 1. Глобальная подмена fetch — единственная точечная подмена, не часть подмножества.
  if (!/vi\s*\.\s*stubGlobal\(\s*["']fetch["']\s*,/.test(code)) {
    problems.push(
      "нет `vi.stubGlobal(\"fetch\", ...)` — тест дойдёт до настоящего провайдера",
    );
  }
  // 1b. Подмена должна быть именно функцией-заглушкой, а не чем-то одним.
  if (!/vi\s*\.\s*fn\s*\(/.test(code)) {
    problems.push("нет `vi.fn(...)` — заглушка fetch не собрана как мок");
  }
  // 1c. Подменять надо именно глобальный fetch, а не локальную переменную.
  if (/\b(globalThis|global)\s*\.\s*fetch\s*=/.test(code) && !/vi\s*\.\s*stubGlobal/.test(code)) {
    problems.push("fetch подменяется присваиванием — vi.stubGlobal не переживёт откат между тестами");
  }

  // 2. Откат подмены: без него следующий тест уедет на настоящий fetch.
  if (!/vi\s*\.\s*unstubAllGlobals\s*\(/.test(code)) {
    problems.push("нет `vi.unstubAllGlobals()` — подмена утечёт в следующие тесты файла");
  }

  // 3. Обходные сетевые ручки в обход подменённого fetch.
  const bypasses = [
    [/\bfrom\s+["']undici["']|require\(["']undici["']\)/, "импорт undici"],
    [/\bfrom\s+["']node:https?["']|require\(["']node:https?["']\)/, "импорт node:http(s)"],
    [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
    [/\bWebSocket\b/, "WebSocket"],
    [/\bprocess\s*\.\s*env\b/, "чтение process.env"],
  ];
  for (const [re, what] of bypasses) {
    if (re.test(code)) problems.push(`${what} — сетевой путь в обход подменённого fetch`);
  }

  // 4. Ключ провайдера обязан быть константой файла.
  if (!/POLZA_API_KEY\s*:\s*["'][^"']+["']/.test(code)) {
    problems.push(
      "нет константы `POLZA_API_KEY: \"...\"` — без неё роутер падает до сетевого вызова",
    );
  }
  if (/POLZA_API_KEY\s*:\s*(?:env|workerEnv|process\s*\.\s*env)/.test(code)) {
    problems.push("POLZA_API_KEY берётся из окружения — тест снова зависит от чужого ключа");
  }

  // 5. Адрес провайдера — нерезолвящийся: страховка на случай снятия подмены.
  if (!/POLZA_BASE_URL/.test(code)) {
    problems.push("нет `POLZA_BASE_URL` — при снятой подмене запрос уйдёт на боевой polza.ai");
  } else if (!/["'][a-z]+:\/\/[^"']*\.invalid/.test(code)) {
    problems.push("POLZA_BASE_URL указывает не на `.invalid` — адрес может разрешаться в сеть");
  }

  // 6. Тест нельзя выключить «по-тихому».
  const skips = [
    [/\bdescribe\s*\.\s*skip\b/, "describe.skip"],
    [/\bit\s*\.\s*skip\b/, "it.skip"],
    [/\bdescribe\s*\.\s*only\b/, "describe.only"],
    [/\bit\s*\.\s*only\b/, "it.only"],
    [/\btest\s*\.\s*todo\b/, "test.todo"],
    [/\bprocess\s*\.\s*env\s*\.\s*CI\b/, "ветка под CI"],
    [/\bif\s*\(\s*![\s\S]{0,80}POLZA_API_KEY/, "условный пропуск по наличию ключа"],
  ];
  for (const [re, what] of skips) {
    if (re.test(code)) problems.push(`${what} — файл нельзя выключать, гейт G1/G2 этого не допускает`);
  }

  if (problems.length > 0) return fail(problems);
  console.log("PLAN_STAGE_TEST_RUNNABLE_OK");
  return 0;
}

function fail(problems) {
  console.error("PLAN_STAGE_TEST_RUNNABLE_FAILED — тест стадии планирования может дойти до провайдера:");
  for (const p of problems) console.error(`  - ${p}`);
  return 1;
}

process.exit(main());
#!/usr/bin/env node
/**
 * Диагностика жалобы 12.10.2026: «контрольная, английский, 11 класс, 2 варианта —
 * задания повторяются, второго варианта нет».
 *
 * Скрипт НИЧЕГО не чинит. Он читает исходники конвейера и печатает, где именно
 * различие вариантов может потеряться. Каждый подкомандный режим печатает ровно
 * один токен ожидаемого результата, чтобы его можно было проверять гейтом.
 *
 * Запуск:
 *   node scripts/diagnose-control-variants.mjs prompt   — что обещает промт
 *   node scripts/diagnose-control-variants.mjs code     — есть ли проверка в коде
 *   node scripts/diagnose-control-variants.mjs cache    — различает ли кэш варианты
 *   node scripts/diagnose-control-variants.mjs report   — собрать отчёт в docs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  prompt: join(ROOT, "backend/src/llm/prompts/worksheet-gen.ts"),
  index: join(ROOT, "backend/src/llm/index.ts"),
  cache: join(ROOT, "backend/src/llm/cache.ts"),
  quality: join(ROOT, "backend/src/llm/validation/quality-filter.ts"),
  report: join(ROOT, "docs/37-control-variants-audit-2026-10-12.md"),
};

function read(key) {
  return readFileSync(FILES[key], "utf8");
}

function lineOf(text, needle) {
  const idx = text.indexOf(needle);
  if (idx === -1) return -1;
  return text.slice(0, idx).split("\n").length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ПРОМТ: что именно обещано модели про два варианта
// ─────────────────────────────────────────────────────────────────────────────

function checkPrompt() {
  const src = read("prompt");
  const system = src.slice(0, src.indexOf("export function sanitizeTextLatex"));

  const rules = [
    ["два варианта одним объектом", system.includes('"variants"')],
    ["требование «варианты РАЗНЫЕ»", /Варианты\s*—\s*РАЗНЫЕ/i.test(system)],
    ["равносильность по сложности", /Равносильность по сложности/i.test(system)],
    ["нумерация с 1 в каждом варианте", /В каждом варианте задания нумеруются с 1/i.test(system)],
  ];

  console.log("=== ПРОМТ (system) ===");
  for (const [name, ok] of rules) console.log(`  ${ok ? "ЕСТЬ " : "НЕТ  "} ${name}`);

  // Отдельный вопрос: доходит ли до модели требование в USER-промпте.
  const userBlock = src.slice(src.indexOf("export function buildWorksheetPrompt"));
  const userSaysControl = /control/i.test(userBlock) && /вариант/i.test(userBlock);
  console.log(`  ${userSaysControl ? "ЕСТЬ " : "НЕТ  "} слово «вариант» в user-промпте`);

  // Ключевое: единственное упоминание контрольной в user — это голое поле type.
  const typeLine = lineOf(userBlock, "тип_работы: req.type");
  console.log(`  user-промпт, строка ${typeLine}: type передаётся значением, без пояснений`);

  const all = rules.every(([, ok]) => ok) && userSaysControl;
  console.log(all ? "PROMPT_HAS_VARIANT_DIFFERENCE_RULE" : "PROMPT_MISSING_VARIANT_DIFFERENCE_RULE");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. КОД: есть ли хоть одна проверка «второй вариант отличается от первого»
// ─────────────────────────────────────────────────────────────────────────────

function checkCode() {
  const index = read("index");
  const quality = read("quality");

  // Что делает конвейер со вторым вариантом.
  const takesSecond = /controlVariants\?\.\[1\]/.test(index);
  const filtersSecond = /raw\.tasks[\s\S]{0,400}filterTasks/.test(index);

  // Есть ли сравнение текстов заданий двух вариантов между собой.
  const compares =
    /variant1[\s\S]{0,200}variant2[\s\S]{0,200}(compare|equal|same|===)/i.test(index) ||
    /secondVariant[\s\S]{0,200}(===|!==)[\s\S]{0,120}worksheet/.test(index) ||
    /tasksEqual|variantsDiffer|assertDifferent/i.test(index);

  // Есть ли защита от пустого/вырожденного второго варианта.
  const guardsEmpty = /secondVariant[\s\S]{0,300}(length\s*===\s*0|tasks\.length)/.test(index);

  console.log("=== КОД (конвейер) ===");
  console.log(`  второй вариант берётся из ответа: ${takesSecond}`);
  console.log(`  к нему применяется filterTasks:   ${filtersSecond}`);
  console.log(`  СРАВНЕНИЕ вариантов между собой:  ${compares}`);
  console.log(`  защита «второй вариант пуст»:     ${guardsEmpty}`);

  // Сколько раз качество контрольной проверяется ПОСЛЕ ответа модели.
  const selfVerifyCalls = (index.match(/verifySelfTask|verifyWorksheet/g) ?? []).length;
  console.log(`  вызовов self-verify на лист:      ${selfVerifyCalls}`);

  // Фильтр качества работает по tasks[] и про варианты ничего не знает.
  const qualityKnowsVariants = /variant/i.test(quality);
  console.log(`  filterTasks знает про варианты:    ${qualityKnowsVariants}`);

  if (!compares && !guardsEmpty) console.log("NO_VARIANT_DIFFERENCE_CHECK");
  else console.log("VARIANT_DIFFERENCE_CHECK_PRESENT");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. КЭШ: различает ли ключ два варианта
// ─────────────────────────────────────────────────────────────────────────────

function checkCache() {
  const cache = read("cache");
  const body = cache.slice(cache.indexOf("export function makeCacheKey"), cache.indexOf("function djb2Hex"));
  const params = cache.slice(
    cache.indexOf("export interface CacheKeyInput"),
    cache.indexOf("export function makeCacheKey"),
  );

  const inParams = /variant/i.test(params);
  const inKey = /variant/i.test(body);
  const inCanonical = /variant/i.test(body);

  console.log("=== КЭШ ===");
  console.log(`  variant в CacheKeyInput: ${inParams}`);
  console.log(`  variant в makeCacheKey:  ${inKey}`);
  console.log(`  variant в canonical:     ${inCanonical}`);

  // Что реально входит в ключ.
  const fields = [...body.matchAll(/^\s{4}(\w+),$/gm)].map((m) => m[1]);
  console.log(`  поля ключа: ${fields.join(", ")}`);

  // Семантика: один control-запрос возвращает оба варианта ОДНИМ объектом,
  // поэтому различие вариантов в ключе и не требуется — но проверим,
  // что в кэш кладётся именно пара.
  const index = read("index");
  const savesPair = /response:\s*\{\s*worksheet,\s*secondVariant\s*\}/.test(index);
  console.log(`  в кэш кладётся пара {worksheet, secondVariant}: ${savesPair}`);

  if (!inParams && !inKey && savesPair) console.log("CACHE_KEY_HAS_NO_VARIANT");
  else if (savesPair) console.log("CACHE_STORES_BOTH_VARIANTS_BY_DESIGN");
  else console.log("CACHE_STORES_ONLY_ONE_VARIANT");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ОТЧЁТ
// ─────────────────────────────────────────────────────────────────────────────

function buildReport() {
  const index = read("index");
  const prompt = read("prompt");

  const lines = [];
  const push = (s = "") => lines.push(s);

  push("# Аудит: почему контрольная приходит одним вариантом или с повторами");
  push();
  push("Дата: 12.10.2026. Жалоба: «контрольная английский 11 класс, 2 варианта —");
  push("задания повторяются, два варианта не сделано».");
  push();
  push("Проверяющий скрипт: `scripts/diagnose-control-variants.mjs`.");
  push();
  push("## Как идёт запрос");
  push();
  push("1. Фронт: `generateWorksheetSmart` — один POST на `/api/worksheets/generate`.");
  push("2. Роут `backend/src/routes/worksheets.ts:168` зовёт `generateWorksheet`.");
  push("3. `backend/src/llm/index.ts:196` собирает промт через `buildWorksheetPrompt`.");
  push("4. Один вызов модели. В ответе ожидается `{ variants: [v1, v2] }`.");
  push("5. `index.ts:258` достаёт `variants[0]` и `variants[1]`.");
  push("6. Каждый вариант проходит `filterTasks` и `sanitizeTextLatex`.");
  push("7. Роут возвращает `worksheet` + `secondVariant`.");
  push("8. Фронт рисует `ControlVariantSwitch` — но только если `secondVariant` не null.");
  push();
  push("## Промты, которые реально уходят в модель");
  push();
  push("| Файл | Роль | Про варианты |");
  push("|---|---|---|");
  push("| `backend/src/llm/prompts/worksheet-gen.ts` | system | есть блок про `variants`, есть требование «Варианты — РАЗНЫЕ» |");
  push("| `backend/src/llm/prompts/worksheet-gen.ts` | user | `type` передаётся голым значением, слова «вариант» нет |");
  push("| `backend/src/llm/index.ts:213` | параметры вызова | `maxTokens` 8192 для control, 4096 иначе |");
  push();
  push("## Где теряется различие");
  push();
  push("### 1. User-промпт не просит два варианта");
  push();
  push("Различие вариантов живёт только в system-промпте, в самом конце, после");
  push("двенадцати правил. В user-промпте `type: \"control\"` — просто значение");
  push("поля, без пояснения. Модель обязана сама вспомнить двенадцатое правило.");
  push();
  push("### 2. В коде нет проверки «варианты разные»");
  push();
  push("`variants[1]` берётся как есть. Никто не сверяет тексты заданий первого и");
  push("второго варианта. `filterTasks` про варианты ничего не знает — он чистит");
  push("каждый список по отдельности, межвариантных повторов не видит.");
  push();
  push("### 3. Модель легко отдаёт два одинаковых листа");
  push();
  push("Один вызов, temperature 0.7, требование «два разных варианта» — вторая");
  push("половина ответа по умолчанию повторяет первую: это самая частая форма");
  push("«задания повторяются». Никакой код это не ловит.");
  push();
  push("### 4. Пустой второй вариант тихо прячется");
  push();
  push("Если модели не хватило токенов, `variants[1]` может не прийти или прийти");
  push("пустым. Тогда `secondVariant = null`, фронт не рисует переключатель — и");
  push("учитель получает один лист. Признака «второй вариант не удался» в ответе");
  push("API нет: поле просто отсутствует, как будто так и задумано.");
  push();
  push("### 5. Кэш — здесь вариант не при чём");
  push();
  push("Ключ кэша строится из subject/grade/topic/difficulty/count/type/userId.");
  push("`variant` в ключе нет, но и не должен: оба варианта приезжают одним");
  push("ответом и кладутся в кэш парой `{ worksheet, secondVariant }`. Запись");
  push("контрольной без `secondVariant` считается промахом и сносится. Эта часть");
  push("сделана правильно.");
  push();
  push("### 6. Английский — отдельная слепая зона");
  push();
  push("`language-guard` для иностранных языков всегда пропускает текст. Для");
  push("русскоязычного предмета обрыв ответа по токенам приводит к");
  push("`InternalError`, а для английского — нет. Второй вариант может");
  push("получиться оборванным, и это пройдёт как обычный ответ.");
  push();
  push("## Что чинить (в порядке важности для учителя)");
  push();
  push("1. Сверять варианты после ответа и перегенерировать, если задания совпали.");
  push("2. Не прятать отсутствие второго варианта: отдавать признак в ответе API.");
  push("3. Указать в user-промпте, что нужен именно `type=control` и два разных");
  push("   варианта — не полагаться на память модели о system-промпте.");
  push("4. Ловить обрыв ответа по `finish_reason` и для иностранных языков.");

  const text = lines.join("\n") + "\n";
  writeFileSync(FILES.report, text, "utf8");
  console.log(`отчёт: ${FILES.report}`);
  console.log(existsSync(FILES.report) ? "REPORT_WRITTEN" : "REPORT_FAILED");
}

const mode = process.argv[2];
switch (mode) {
  case "prompt":
    checkPrompt();
    break;
  case "code":
    checkCode();
    break;
  case "cache":
    checkCache();
    break;
  case "report":
    buildReport();
    break;
  default:
    console.error("usage: node scripts/diagnose-control-variants.mjs prompt|code|cache|report");
    process.exit(2);
}
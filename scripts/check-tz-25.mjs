#!/usr/bin/env node
/**
 * Проверка полноты ТЗ-25 перед тем, как считать его написанным.
 *
 * Скрипт ловит то, что обычно выпадает из продакт-спеки: раздел про порядок
 * работ, критерии приёмки и тест-кейсы. Текст ТЗ глазами не проверяется —
 * проверяется структура и то, что в нём есть проверяемые утверждения, а не
 * вода вида «сделать лучше».
 *
 * Запуск: node scripts/check-tz-25.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TZ = join(ROOT, "docs/tz/25-generation-flow-quality-loss.md");

const src = readFileSync(TZ, "utf8");

/** Разделы, без которых ТЗ нельзя отдать в работу. */
const SECTIONS = [
  "## 1. Что уже работает",
  "## 2. Где теряется информация",
  "## 3. Что сделать",
  "## 4. Решения",
  "## 5. Чего не делать",
  "## 6. Критерии приёмки",
  "## 7. Тест-кейсы",
  "## 8. Порядок работ",
  "## 9. Открыто",
];

/** Решения оформлены как AD-N с рационалом — иначе это не решение, а пожелание. */
const adCount = (src.match(/^\*\*AD-\d+ ·/gm) ?? []).length;
const rationaleCount = (src.match(/^\*Рационал:\*/gm) ?? []).length;

const acceptance = (src.match(/^- \[ \] /gm) ?? []).length;
const testCases = (src.match(/^\| \d+ \|/gm) ?? []).length;
const decisions = (src.match(/^\| \d+ \| .+ \| .+ \|$/gm) ?? []).length;

/** Ссылки на реальные файлы репозитория — ТЗ обязано указывать, где менять. */
const referenced = [
  "backend/src/llm/index.ts",
  "backend/src/llm/prompts/worksheet-gen.ts",
  "backend/src/llm/validation/quality-filter.ts",
  "backend/src/llm/validation/language-guard.ts",
  "backend/src/llm/providers/polza.ts",
  "backend/src/routes/worksheets.ts",
  "src/app/constructor/page.tsx",
  "src/components/constructor/ControlVariantSwitch.tsx",
  "backend/tests/unit/control-two-variants.test.ts",
].filter((f) => src.includes(f));

/** Каждой строке в таблице «Что сделать» соответствует файл, а не «где надо». */
const vaguePlaces = (src.match(/\|\s*—\s*\|/g) ?? []).length;

const checks = [
  ["все 9 разделов на месте", SECTIONS.every((s) => src.includes(s))],
  ["решений AD не меньше 8", adCount >= 8],
  ["у каждого решения есть рационал", rationaleCount >= adCount],
  ["критериев приёмки не меньше 11", acceptance >= 11],
  ["тест-кейсов не меньше 14", testCases >= 14],
  ["строк в таблице «Что сделать» не меньше 8", decisions >= 8],
  ["процитировано 9 файлов репозитория", referenced.length >= 9],
  ["нет пустых мест в таблице правок", vaguePlaces === 0],
];

console.log("=== ТЗ-25 ===");
// Разрывы должны быть помечены по области действия: часть бьёт только по
// контрольной, часть — по всем предметам. ТЗ, где все разрывы поданы как
// частный случай английского, считаем неполным: жалоба пришла на одном
// предмете, а код бьёт по всем.
const generalGaps = (src.match(/\*\*Разрыв \d+\.[^\n]*\*\*[^\n]*все предметы/g) ?? []).length;
checks.push(["разрывы помечены по области действия", generalGaps >= 2]);
for (const [name, ok] of checks) console.log(`  ${ok ? "ОК   " : "ПРОВАЛ"} ${name}`);
console.log(`  AD: ${adCount}, рационалов: ${rationaleCount}`);
console.log(`  критериев: ${acceptance}, тест-кейсов: ${testCases}`);
console.log(`  файлов процитировано: ${referenced.length}`);

const missing = SECTIONS.filter((s) => !src.includes(s));
if (missing.length) console.log(`  отсутствуют разделы: ${missing.join(" | ")}`);

console.log(checks.every(([, ok]) => ok) ? "TZ25_COMPLETE" : "TZ25_INCOMPLETE");
/**
 * Проверка пометки «ДЕМО» на печатном листе (лист 1.1.3).
 *
 * Запуск: node scripts/check-demo-watermark.mjs
 *
 * Зачем проверять исходники, а не картинку: дефект этого листа был НЕВИДИМ
 * на экране. Знак рисуется только в режиме печати, и раньше он висел
 * обёрткой над одним типом материала — остальные семь уходили на печать
 * чистыми, а страница выглядела при этом полностью «собранной».
 * Регрессия такого рода не ловится ни тестами рендера, ни скриншотом
 * одного типа: нужен разбор КАЖДОГО превью.
 *
 * Что именно проверяется:
 *   1. Каждое превью вообще знает про метку (импорт + usage).
 *   2. Метка стоит на КАЖДОМ пути возврата компонента — включая пустые
 *      состояния («Тема не нашлась», «Комплект не собрался»). Забытый
 *      пустой state — это ровно тот случай, где заготовка печатается
 *      как обычный документ, поэтому считаем их, а не ищем «хоть одну».
 *   3. Метка условная: она ставится ТОЛЬКО по флагу `isDemo` артефакта.
 *      Безусловный `<PrintWatermark />` означал бы метку на настоящем
 *      материале — это запрещено условием листа.
 *   4. Экраны конструктора и превью метку сами не рисуют: она живёт в
 *      превью-компонентах, это единственное место. Иначе на рабочем листе
 *      метка отрисуется дважды (и станет темнее).
 *   5. Сам знак остался print-only и не перехватывает клики — иначе он
 *      появится на экране или заблокирует кнопки листа.
 *
 * Зависимостей нет: только node:fs. Выход 1 с понятным списком — если
 * хотя бы один пункт нарушен.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Типы материала и имя артефакта, по которому читается флаг заготовки.
 * Флаг живёт на самом артефакте (`isDemo?: boolean` в `src/lib/types.ts`),
 * поэтому превью не зависит от экрана, который его отрисовал.
 */
const PREVIEWS = [
  { file: "src/components/constructor/WorksheetPreview.tsx", component: "WorksheetPreview", artifact: "worksheet" },
  { file: "src/components/constructor/LessonPlanPreview.tsx", component: "LessonPlanPreview", artifact: "plan" },
  { file: "src/components/constructor/PresentationPreview.tsx", component: "PresentationPreview", artifact: "presentation" },
  { file: "src/components/constructor/KtpPreview.tsx", component: "KtpPreview", artifact: "ktp" },
  { file: "src/components/constructor/CardsPreview.tsx", component: "CardsPreview", artifact: "set" },
  { file: "src/components/constructor/MaterialsPreview.tsx", component: "MaterialsPreview", artifact: "bundle" },
  { file: "src/components/constructor/LessonBundlePreview.tsx", component: "LessonBundlePreview", artifact: "bundle" },
];

/** Экраны, где метка НЕ должна рисоваться: единственное место — превью. */
const SCREENS = ["src/app/constructor/page.tsx", "src/app/preview/page.tsx"];

const WATERMARK = "src/components/constructor/PrintWatermark.tsx";

const problems = [];

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Сколько раз встречается подстрока (без регулярки — файлы читаются как есть). */
function countOf(src, needle) {
  let n = 0;
  let at = src.indexOf(needle);
  while (at !== -1) {
    n += 1;
    at = src.indexOf(needle, at + needle.length);
  }
  return n;
}

/**
 * Сколько `return (` у экспортируемого компонента — все пути, которые
 * возвращают разметку (пустое состояние и обычное, например).
 *
 * Тело функции ищем по балансу скобок: сигнатура содержит деструктуризацию
 * пропсов, поэтому `{` берём ПОСЛЕ закрывающей скобки параметров, а `{{`
 * (например `style={{ width: "6%" }}`) считаем одной скобкой.
 *
 * `return` внутри колбэка (`.map((x) => { return (...) })`) — это не путь
 * компонента: на его месте один корень превью, и метку туда дублировать не
 * надо. Такие тела отслеживаем отдельно по `=>` и их `return` не считаем.
 */
function countComponentReturns(src, component) {
  const start = src.indexOf(`export function ${component}(`);
  if (start === -1) return -1;
  const paramsOpen = src.indexOf("(", start);
  let paren = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < src.length; i += 1) {
    if (src[i] === "(") paren += 1;
    else if (src[i] === ")") {
      paren -= 1;
      if (paren === 0) {
        paramsClose = i;
        break;
      }
    }
  }
  const open = paramsClose === -1 ? -1 : src.indexOf("{", paramsClose);
  if (open === -1) return -1;

  let depth = 0;
  let returns = 0;
  /** Глубины открытых тел вложенных функций — их `return` не наши. */
  const nestedFns = [];
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") {
      if (src[i + 1] === "{") i += 1; // `{{` — одна скобка
      depth += 1;
      if (src.slice(0, i).replace(/\s+$/, "").endsWith("=>")) nestedFns.push(depth);
    } else if (ch === "}") {
      depth -= 1;
      if (nestedFns.length > 0 && nestedFns[nestedFns.length - 1] === depth + 1) {
        nestedFns.pop();
      }
      if (depth === 0) return returns; // тело компонента закончилось
    } else if (ch === "r" && src.startsWith("return (", i)) {
      if (nestedFns.length === 0) returns += 1;
      i += 6;
    }
  }
  return returns;
}

const rows = [];

for (const preview of PREVIEWS) {
  const src = read(preview.file);
  const guarded = `{${preview.artifact}.isDemo && <PrintWatermark />}`;
  const guardedCount = countOf(src, guarded);
  const anyUsage = countOf(src, "<PrintWatermark");

  if (countOf(src, 'from "./PrintWatermark"') === 0) {
    problems.push(`${preview.file}: нет импорта PrintWatermark`);
    continue;
  }

  const returns = countComponentReturns(src, preview.component);
  if (returns < 1) {
    problems.push(`${preview.file}: не нашли тело компонента ${preview.component} — проверка не сработала`);
    continue;
  }

  // 1) Метка на каждом пути возврата, включая пустые состояния.
  if (guardedCount < returns) {
    problems.push(
      `${preview.file}: путей возврата ${returns}, а помечено ${guardedCount} — ` +
        `на части состояний метки не будет (чаще всего забывают пустое состояние)`,
    );
  }

  // 2) Никакой безусловной метки: обычный материал должен печататься без знака.
  if (anyUsage !== guardedCount) {
    problems.push(
      `${preview.file}: usages <PrintWatermark> — ${anyUsage}, из них по флагу isDemo — ${guardedCount}. ` +
        `Метка безусловна — она попадёт на печать и в обычном режиме`,
    );
  }

  // 3) Флаг берётся у артефакта, а не извне — иначе придётся тянуть пропс
  //    в девять мест вызова и новый тип снова протянет метку мимо.
  if (!src.includes(`${preview.artifact}.isDemo`)) {
    problems.push(`${preview.file}: флаг заготовки не читается с артефакта (${preview.artifact}.isDemo)`);
  }

  rows.push(
    `  ✓ ${preview.component.padEnd(20)} путей возврата: ${returns}, метка по isDemo: ${guardedCount}`,
  );
}

for (const screen of SCREENS) {
  const src = read(screen);
  if (countOf(src, "<PrintWatermark") > 0) {
    problems.push(
      `${screen}: метка рисуется на экране — она должна жить только в превью, ` +
        `иначе рабочий лист получит её дважды`,
    );
  }
}

// Сам знак: print-only и не перехватывает клики.
const wm = read(WATERMARK);
for (const [needle, why] of [
  ["hidden", "метка без `hidden` висела бы поверх превью на экране"],
  ["print:flex", "без `print:flex` метка не покажется на бумаге"],
  ["pointer-events-none", "без этого знак перехватывал бы клики по листу"],
]) {
  if (!wm.includes(needle)) problems.push(`${WATERMARK}: ${why} (нет «${needle}»)`);
}

console.log("[check-demo-watermark] Пометка «ДЕМО» на печати:");
for (const row of rows) console.log(row);

if (problems.length > 0) {
  console.error("\n[check-demo-watermark] Нарушения:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log("\n[check-demo-watermark] Все типы помечаются по флагу isDemo и только в демо-режиме.");
console.log("DEMO_WATERMARK_OK");
#!/usr/bin/env node
/**
 * Лист 2.1.8: мусор от модели не доезжает до листа.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ СКРИПТ, А НЕ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * `backend/tests/unit/svgGraphGen.test.ts` проверяет конвейер целиком (с подменённой
 * сетью). Он НЕ проверяет две вещи, которые ломаются чаще всего и тихо:
 *
 *   1) схема на бэке разошлась с той, что рисует фронт (типы, лимиты, поля) —
 *      валидатор начнёт пропускать то, что рисовальщик не умеет;
 *   2) шов в конвейере (`llm/index.ts`) не подключён или срезает поле — тогда
 *      схема проверяется, но до учителя не доходит (или доходит битой).
 *
 * Всё исполняемое исполняется по-настоящему: Node 23 умеет грузить .ts без
 * зависимостей (type stripping), плюс крючок разрешения `.ts` для соседей,
 * импортируемых без расширения. Что исполнить нельзя (фронтовые .ts/.tsx в
 * пуле Node без сборки) — читается текстом, и в выводе честно стоит «(текст)».
 *
 * Запуск: node scripts/check-svg-graph-gen.mjs
 * Нарушение → понятный текст и ненулевой код возврата.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFile(path.join(ROOT, rel), "utf8");

const failures = [];
const warnings = [];
const steps = [];

function ok(title, detail) {
  steps.push(`  ✓ ${title}${detail ? ` — ${detail}` : ""}`);
}
function bad(title, detail) {
  failures.push(`${title}${detail ? ` — ${detail}` : ""}`);
  steps.push(`  ✗ ${title}${detail ? ` — ${detail}` : ""}`);
}
function must(condition, title, detail) {
  if (condition) ok(title, detail);
  else bad(title, detail);
  return Boolean(condition);
}
function warn(title, detail) {
  warnings.push(`${title}${detail ? ` — ${detail}` : ""}`);
  steps.push(`  ! ${title}${detail ? ` — ${detail}` : ""}`);
}

console.log("Проверяем: схема графика от модели → проверка → поле в задании\n");

// ─────────────────────────────────────────────────────────────────────────────
// 0. Загрузка настоящего кода бэкенда
// ─────────────────────────────────────────────────────────────────────────────

// `svg-graph-gen.ts` тянет за собой роутер и провайдеров — они импортируют
// соседей без расширения. Крючок дописывает `.ts`; если движок не умеет —
// проверяем чтением и говорим об этом прямо (как в check-umk-reaches-prompt).
let validate = null;
let graph = null;
let router = null;
let loadMode = "";

try {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".")) return nextResolve(`${specifier}.ts`, context);
        throw err;
      }
    },
  });
  validate = await import(path.join(ROOT, "backend/src/llm/svg-validate.ts"));
  graph = await import(path.join(ROOT, "backend/src/llm/prompts/svg-graph-gen.ts"));
  router = await import(path.join(ROOT, "backend/src/llm/router.ts"));
  loadMode = "исполнено";
} catch (err) {
  loadMode = `НЕ исполнено (${err.code ?? err.name}: ${String(err.message).slice(0, 120)})`;
}

steps.push(`  · модули бэкенда: ${loadMode}`);
if (!validate || !graph) {
  console.error(
    `\nНЕ ЗАПУЩЕНО: не удалось загрузить backend/src/llm/svg-validate.ts и svg-graph-gen.ts.\nПричина: ${loadMode}\nБез исполнения проверять нечего — это не «мусор не рисуется», а «ничего не проверено».`,
  );
  process.exit(1);
}

const { validateChartSpec } = validate;
const { tasksNeedingGraph, collectCharts, MAX_GRAPHS_PER_SHEET } = graph;

// ─────────────────────────────────────────────────────────────────────────────
// 1. ВАЛИДАТОР: хорошие схемы проходят
// ─────────────────────────────────────────────────────────────────────────────

const GOOD = {
  bar: {
    type: "bar",
    title: "Динамика продаж",
    x_label: "месяц",
    y_label: "шт",
    data: { labels: ["янв", "фев", "мар"], values: [12, 7, 19] },
  },
  line: {
    type: "line",
    title: "График y = 2x",
    data: { labels: ["-1", "0", "1"], series: [{ name: "y = 2x", values: [-2, 0, 2] }] },
  },
  pie: {
    type: "pie",
    title: "Доли",
    data: { labels: ["мальчики", "девочки"], values: [30, 70] },
  },
  number_line: {
    type: "number_line",
    title: "Координатная прямая",
    range: [-3, 5],
    step: 1,
    points: [{ value: -2, label: "A", color: "highlight" }],
  },
  geometry: {
    type: "geometry",
    shape: "triangle",
    title: "Треугольник",
    annotations: [{ label: "a", side: "BC" }],
    measurements: { sides: [{ id: "AB", value: 5, unit: "см" }], angles: [{ id: "C", value: 60 }] },
  },
};

for (const [type, spec] of Object.entries(GOOD)) {
  const res = validateChartSpec(spec);
  must(res.ok && res.spec, `корректная схема «${type}» принимается`, res.ok ? "" : JSON.stringify(res.issues.map((i) => i.code)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ВАЛИДАТОР: мусор отбрасывается
// ─────────────────────────────────────────────────────────────────────────────

/** Мусор, который приходит от модели. `why` — чем именно он плох. */
const JUNK = [
  ["пустой объект", {}, "missing-type"],
  ["нет объекта вовсе", null, "not-an-object"],
  ["строка вместо схемы", "bar", "not-an-object"],
  ["число вместо схемы", 42, "not-an-object"],
  ["неизвестный тип", { type: "banana", data: {} }, "unknown-type"],
  [
    "координаты в миллионах",
    { type: "bar", title: "X", data: { labels: ["a", "b"], values: [3000000, 4] } },
    "absurd-value",
  ],
  [
    "NaN вместо числа",
    { type: "line", title: "X", data: { labels: ["a", "b"], series: [{ name: "s", values: [1, null] }] } },
    "not-finite",
  ],
  [
    "injection в заголовке",
    { type: "bar", title: '"><script>alert(1)</script>', data: { labels: ["a", "b"], values: [1, 2] } },
    "bad-text",
  ],
  [
    "injection в подписи оси",
    { type: "bar", title: "X", y_label: "<img src=x onerror=alert(1)>", data: { labels: ["a", "b"], values: [1, 2] } },
    "bad-text",
  ],
  [
    "подписи и значения разной длины",
    { type: "bar", title: "X", data: { labels: ["a", "b", "c"], values: [1, 2] } },
    "mismatched-length",
  ],
  [
    "серия не по длине подписей",
    { type: "line", title: "X", data: { labels: ["a", "b", "c"], series: [{ name: "s", values: [1, 2] }] } },
    "mismatched-length",
  ],
  ["пустые оси: все нули", { type: "bar", title: "X", data: { labels: ["a", "b"], values: [0, 0] } }, "empty-axis"],
  [
    "круг из одних нулей",
    { type: "pie", title: "X", data: { labels: ["a", "b"], values: [0, 0] } },
    "empty-axis",
  ],
  ["одна подпись", { type: "bar", title: "X", data: { labels: ["a"], values: [1] } }, "too-few-items"],
  [
    "точка числовой прямой вне шкалы",
    { type: "number_line", title: "X", range: [-3, 5], points: [{ value: 42 }] },
    "point-out-of-range",
  ],
  [
    "шкала перевёрнута",
    { type: "number_line", title: "X", range: [5, -3] },
    "bad-range",
  ],
  [
    "шкала на полстраны",
    { type: "number_line", title: "X", range: [0, 5000] },
    "bad-range",
  ],
  ["неизвестная фигура", { type: "geometry", shape: "hexagon", title: "X" }, "bad-enum"],
  [
    "несимвольный «элемент»",
    { type: "chemistry", diagram: "molecule", atoms: [{ id: "a", symbol: "H2O" }] },
    "bad-symbol",
  ],
  [
    "разметка в символе элемента",
    { type: "chemistry", diagram: "molecule", atoms: [{ id: "a", symbol: "<b" }] },
    "bad-text",
  ],
  [
    "связь на несуществующий атом",
    {
      type: "chemistry",
      diagram: "molecule",
      atoms: [{ id: "a", symbol: "O" }],
      bonds: [{ from: "a", to: "z" }],
    },
    "dangling-bond",
  ],
  [
    "повтор идентификатора",
    { type: "biology", diagram: "plant-cell", labels: [{ id: "n", text: "ядро" }, { id: "n", text: "вакуоль" }] },
    "duplicate-id",
  ],
];

for (const [title, spec, expectedCode] of JUNK) {
  let res;
  let threw = false;
  try {
    res = validateChartSpec(spec);
  } catch (e) {
    threw = true;
    res = { ok: true, issues: [{ code: String(e) }] };
  }
  const codes = (res.issues ?? []).map((i) => i.code);
  must(
    !threw && res.ok === false && res.spec === null && codes.includes(expectedCode),
    `отбракован: ${title}`,
    threw ? "ВЫКИНУЛ ИСКЛЮЧЕНИЕ" : codes.includes(expectedCode) ? expectedCode : `коды: ${codes.join(",") || "нет"}`,
  );
}

// Два графика там, где просили один.
{
  const res = validateChartSpec([GOOD.bar, GOOD.pie]);
  must(res.ok === false && res.issues.some((i) => i.code === "multiple-charts"), "отбракован: два графика вместо одного", "multiple-charts");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ВАЛИДАТОР: неизвестные поля вырезаются, но график остаётся
// ─────────────────────────────────────────────────────────────────────────────

{
  const res = validateChartSpec({
    ...GOOD.bar,
    id: "chart-42",
    createdAt: "2025-03-08T00:00:00Z",
    note: "нарисуй покрасивее",
  });
  must(
    res.ok && res.spec && !("id" in res.spec) && !("createdAt" in res.spec) && !("note" in res.spec),
    "неизвестные поля вырезаны, схема сохранена",
    res.ok ? "id/createdAt/note отсутствуют" : "схема отброшена целиком",
  );
  must(
    res.issues.some((i) => i.code === "unknown-field"),
    "вырезанные поля попали в issues (их видно в логе)",
    res.issues.map((i) => i.code).join(","),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. КОГДА ГРАФИК НУЖЕН — ДЕНЬГИ
// ─────────────────────────────────────────────────────────────────────────────

const tasksWithGraph = [
  { number: 1, text: "Сократите дробь 8/12.", type: "computation" },
  { number: 2, text: "Постройте график функции y = 2x.", type: "short-answer" },
  { number: 3, text: "Найдите площадь прямоугольника.", type: "computation" },
];

must(tasksNeedingGraph(tasksWithGraph, "math").length === 1, "математика: спросили только там, где просили нарисовать", "1 задание");
must(
  tasksNeedingGraph(tasksWithGraph, "math")[0]?.number === 2,
  "выбрано именно то задание, где нужен рисунок",
  "номер 2",
);
must(
  tasksNeedingGraph(tasksWithGraph, "biology").length === 0,
  "биология: график не запрашивается никогда",
  "0 заданий",
);
must(
  tasksNeedingGraph([{ number: 1, text: "Сократите дробь." }], "math").length === 0,
  "математика без просьбы нарисовать: модель не зовётся",
  "0 заданий",
);
must(
  tasksNeedingGraph(
    [1, 2, 3, 4].map((n) => ({ number: n, text: "Постройте график функции." })),
    "physics",
  ).length === MAX_GRAPHS_PER_SHEET,
  "потолок графиков на лист держится",
  `${MAX_GRAPHS_PER_SHEET}`,
);
must(
  tasksNeedingGraph([{ text: "График функции." }], "math").length === 0,
  "задание без номера в схему не идёт (нечего привязывать)",
  "0 заданий",
);
must(
  tasksNeedingGraph([{ number: 1, text: "График функции." }], "math").length === 1,
  "то же задание с номером — идёт",
  "1 задание",
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. РАЗБОР ОТВЕТА МОДЕЛИ
// ─────────────────────────────────────────────────────────────────────────────

const candidates = [{ number: 2, text: "Постройте график функции y = 2x." }];

{
  const { charts, dropped } = collectCharts('{"charts": [{"task_number": 2, "chart_sp', candidates);
  must(charts.length === 0 && dropped.length === 1 && /bad-json/.test(dropped[0].reasons), "обрыв JSON: ни одной схемы, причина видна", dropped[0]?.reasons);
}
{
  const { charts, dropped } = collectCharts(
    JSON.stringify({
      charts: [
        { task_number: 2, chart_spec: GOOD.bar },
        { task_number: 2, chart_spec: GOOD.pie },
      ],
    }),
    candidates,
  );
  must(charts.length === 0 && dropped.some((d) => /multiple-charts/.test(d.reasons)), "два графика на одно задание: не берём ни одного", "multiple-charts");
}
{
  const { charts, dropped } = collectCharts(
    JSON.stringify({ charts: [{ task_number: 42, chart_spec: GOOD.bar }] }),
    candidates,
  );
  must(charts.length === 0 && dropped.some((d) => /unknown-task/.test(d.reasons)), "схема для чужого задания отброшена", "unknown-task");
}
{
  const { charts } = collectCharts(JSON.stringify({ charts: [] }), candidates);
  must(charts.length === 0, "модель не вернула график — задание остаётся текстом", "0 схем");
}
{
  const { charts } = collectCharts(
    JSON.stringify({ charts: [{ task_number: 2, chart_spec: GOOD.number_line }] }),
    candidates,
  );
  must(charts.length === 1 && charts[0].spec.type === "number_line", "корректная схема привязана к своему заданию", "number_line → задание 2");
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. МАРШРУТ: задача есть и она дешёвая
// ─────────────────────────────────────────────────────────────────────────────

if (router) {
  const env = { POLZA_API_KEY: "check-key" };
  const decision = router.pickModel("svg-graph-gen", env);
  must(decision?.primary?.model === "gpt-6-luna", "схема графика идёт на дешёвую Luna", decision?.primary?.model);
  must(
    decision?.fallbacks.length === 0,
    "эскалации нет: при отказе отдаём лист без графика, а не платим второй раз",
    `fallbacks: ${decision?.fallbacks.length}`,
  );
} else {
  warn("роутер не загрузился — выбор модели не проверен");
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. КОНТРАКТ С ФРОНТОМ (чтением): типы и лимиты
// ─────────────────────────────────────────────────────────────────────────────

const frontSpec = await read("src/lib/llm/svg-spec.ts");
const frontTypes = [...frontSpec.matchAll(/type:\s*z\.literal\('([a-z_]+)'\)/g)].map((m) => m[1]);
const ourTypes = [...(await read("backend/src/llm/svg-validate.ts")).matchAll(/^\s{2}"([a-z_]+)",$/gm)].map((m) => m[1]);

must(
  frontTypes.length === 7,
  "на фронте 7 типов графика",
  frontTypes.join(", "),
);
must(
  ourTypes.length === 7 && frontTypes.every((t) => ourTypes.includes(t)) && ourTypes.every((t) => frontTypes.includes(t)),
  "типы валидатора совпадают с фронтовыми",
  ourTypes.join(", "),
);

must(
  /range\[1\] - range\[0\]\) <= 100/.test(frontSpec.replace(/\s/g, "")) ||
    /Math\.abs\(max - min\) <= 100/.test(frontSpec),
  "фронт ограничивает размах шкалы 100 — у нас тот же потолок",
  "(текст) src/lib/llm/svg-spec.ts",
);
must(
  /MAX_NUMBER_LINE_SPAN = 100/.test(await read("backend/src/llm/svg-validate.ts")),
  "у нас размах шкалы ограничен 100",
  "(текст) backend/src/llm/svg-validate.ts",
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. ШОВ (чтением): поле долетает до учителя тем же путём, что text_latex
// ─────────────────────────────────────────────────────────────────────────────

const llmIndex = await read("backend/src/llm/index.ts");
const filterCode = await read("backend/src/llm/validation/quality-filter.ts");
const frontApi = await read("src/lib/llm/index.ts");

must(
  /const next = \{ \.\.\.\(task as unknown as Record<string, unknown>\) \}/.test(llmIndex),
  "конвейер копирует задание спредом — лишние поля не срезаются",
  "(текст) llm/index.ts filterAndReport",
);
must(
  /kept\.push\(task\)/.test(filterCode),
  "фильтр качества не пересобирает задание",
  "(текст) llm/validation/quality-filter.ts",
);
must(
  /worksheet: data\.worksheet/.test(frontApi),
  "фронт отдаёт лист клиенту без пересборки",
  "(текст) src/lib/llm/index.ts",
);

const hasSeam = /attachChartSpecs/.test(llmIndex);
if (hasSeam) {
  ok("шов подключён: generateWorksheet вызывает attachChartSpecs", "(текст) llm/index.ts");
} else {
  warn(
    "шов НЕ подключён — схема проверяется, но лист её пока не несёт",
    "(текст) llm/index.ts не вызывает attachChartSpecs; это файл другого листа",
  );
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(steps.join("\n"));

if (warnings.length > 0) {
  console.log(`\nПРЕДУПРЕЖДЕНИЯ (${warnings.length}):`);
  for (const w of warnings) console.log(` ! ${w}`);
}

if (failures.length > 0) {
  console.error(`\nМУСОР НЕ ОТСЕЧЁН (${failures.length}):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log("\nSVG_GRAPH_SAFE_OK");
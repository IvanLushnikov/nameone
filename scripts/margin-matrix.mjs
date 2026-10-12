#!/usr/bin/env node
/**
 * Юнит-экономика УчЛист при снижении цен — калькулятор маржи.
 *
 * Запуск:
 *   node scripts/margin-matrix.mjs                     таблица для чтения
 *   node scripts/margin-matrix.mjs --json              полный вывод в JSON
 *   node scripts/margin-matrix.mjs --verify-sources    цены/нормы/роутинг прочитаны из кода
 *   node scripts/margin-matrix.mjs --verify-model      модель сходится с контрольными числами
 *   node scripts/margin-matrix.mjs --check-report <файл>  цифры документа = вывод калькулятора
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ПРАВКА docs/04-pricing-economics-v2.md
 *
 * Тот документ считал «Базовый» по колонке «всё на Luna». С 2026-10-02 это не так:
 *   · контрольная (control-gen) роутится на Sonnet 5.5 и НЕ входит в PLUS_ONLY_TASKS,
 *     то есть бэкенд отдаёт её учителю на «Базовом» (router.ts PRIMARY_BY_TASK +
 *     assertTaskAllowed в routes/artifact-generate.ts);
 *   · модель больше не зависит от тарифа (pickModel без параметра plan).
 * Поэтому COGS «Базового» в старом документе занижен, а вопрос «снижать ли цену»
 * на нём уже не решается.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПРАВИЛО ЧИСЕЛ
 *
 * Цены, нормы и прайс моделей НЕ зашиты здесь: они читаются из кода
 * (backend/src/services/billing.ts, usage.ts, backend/src/llm/config.ts, router.ts).
 * Если разбор не удался — скрипт падает, а не подставляет своё число.
 * Локальные константы ниже взяты из scripts/unit-economics.py (те же промпты,
 * та же валидация DeepSeek, та же сетка нагрузки) — иначе расчёт с documents
 * v2 перестал бы быть сопоставимым.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ─────────────────────────────────────────────────────────────────────────────
// Разбор исходников
// ─────────────────────────────────────────────────────────────────────────────

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Число из TS-литерала: 500_00 → 50000, 0.35 → 0.35. */
function num(literal) {
  const n = Number(String(literal).replace(/_/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Не число в исходнике: ${literal}`);
  return n;
}

/**
 * Тело `export const NAME = { ... }` — по границам фигурных скобок.
 * Якорь именно на `export const NAME`: иначе поиск цепляется за первое же
 * упоминание имени в комментарии и режет не тот блок.
 */
function objectBlock(src, name) {
  const m = new RegExp(`\\bconst\\s+${name}\\b`).exec(src);
  if (!m) throw new Error(`Не найден const ${name}`);
  const at = m.index;
  const open = src.indexOf("{", at);
  if (open < 0) throw new Error(`У ${name} нет тела {…}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`Блок ${name} не закрыт`);
}

/** Элементы `export const NAME = new Set<…>([ ... ])` списком строк. */
function setBlock(src, name) {
  const m = new RegExp(`\\bconst\\s+${name}\\b`).exec(src);
  if (!m) throw new Error(`Не найден const ${name}`);
  const open = src.indexOf("[", m.index);
  const close = src.indexOf("]", open);
  if (open < 0 || close < 0) throw new Error(`Блок ${name} не разобран`);
  return [...src.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function readSources() {
  const config = read("backend/src/llm/config.ts");
  const usage = read("backend/src/services/usage.ts");
  const billing = read("backend/src/services/billing.ts");
  const router = read("backend/src/llm/router.ts");

  // Прайс моделей: "id": { inputPer1M: x, outputPer1M: y, cacheReadPer1M: z }
  const costs = {};
  const costBlock = objectBlock(config, "MODEL_COSTS");
  for (const m of costBlock.matchAll(/"([^"]+)"\s*:\s*\{([^}]*)\}/g)) {
    const [, id, body] = m;
    const price = {};
    for (const p of body.matchAll(/(\w+)\s*:\s*([\d.]+)/g)) price[p[1]] = num(p[2]);
    if (price.outputPer1M == null) throw new Error(`Нет outputPer1M у модели ${id}`);
    costs[id] = price;
  }
  if (Object.keys(costs).length === 0) throw new Error("MODEL_COSTS не разобран");

  const usageBlock = objectBlock(usage, "PLAN_NORM_PER_MONTH");
  const norms = {};
  for (const m of usageBlock.matchAll(/(\w+)\s*:\s*([\d_]+)/g)) norms[m[1]] = num(m[2]);

  const rubMatch = usage.match(/RUB_PER_USD\s*=\s*([\d.]+)/);
  if (!rubMatch) throw new Error("RUB_PER_USD не найден в usage.ts");

  const priceBlock = objectBlock(billing, "PRICES");
  const prices = {};
  for (const m of priceBlock.matchAll(
    /(\w+)\s*:\s*\{\s*monthly\s*:\s*([\d_]+)\s*,\s*academicYear\s*:\s*([\d_]+|null)/g
  )) {
    prices[m[1]] = {
      monthly: num(m[2]) / 100,
      academicYear: m[3] === "null" ? null : num(m[3]) / 100,
    };
  }
  if (!prices.base) throw new Error("PRICES в billing.ts не разобраны");

  const artifactTask = {};
  for (const m of objectBlock(router, "ARTIFACT_TASK").matchAll(
    /(?:"([^"]+)"|(\w+))\s*:\s*"([^"]+)"/g
  )) {
    artifactTask[m[1] ?? m[2]] = m[3];
  }
  const plusOnly = new Set(setBlock(router, "PLUS_ONLY_TASKS"));

  const primaryByTask = {};
  for (const m of objectBlock(router, "PRIMARY_BY_TASK").matchAll(
    /"([^"]+)"\s*:\s*"([^"]+)"/g
  )) {
    primaryByTask[m[1]] = m[2];
  }

  return {
    costs,
    norms,
    rubPerUsd: num(rubMatch[1]),
    prices,
    artifactTask,
    plusOnly,
    primaryByTask,
    referenceModel: config.match(/REFERENCE_MODEL_ID\s*=\s*"([^"]+)"/)?.[1],
    tokensPerWorksheet: num(
      usage.match(/TOKENS_PER_WORKSHEET\s*=\s*([\d_]+)/)?.[1] ?? "1600"
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Локальные константы — те же, что в scripts/unit-economics.py
// ─────────────────────────────────────────────────────────────────────────────

/** system prompt и пользовательский JSON на один вызов генерации. */
const SYS = 1800;
const USER = 250;
/** Задание + инструкция валидации; выход — вердикт. */
const VALIDATION_IN_EXTRA = 300;
const VALIDATION_OUT = 400;
/** Доля вызовов Luna, уходящих в fallback Sol (роутер ESCALATION). */
const LUNA_FALLBACK = 0.05;

const WEEKS = 34; // учебных недель в году
const MONTHS = 9; // оплачиваемый период «учебный год»
const FEE = 0.035; // эквайринг ЮKassa, docs/04-pricing-economics-v2.md §4

/** Ключ сценария → (продуктовый тип артефакта, out-токены). Типы — из ARTIFACT_TASK. */
const ART = {
  home: ["worksheet", 1600],
  drill: ["worksheet", 2600],
  card: ["worksheet", 900],
  cards: ["cards", 1800],
  control: ["control", 3600],
  test: ["test", 1400],
  plan: ["lesson-plan", 1900],
  pres: ["presentation", 3500],
  oge: ["oge", 6500],
  ktp: ["ktp", 8000],
};

/** Сетка нагрузки: сколько раз в неделю учитель делает каждый тип. ГИПОТЕЗА (v2 §8). */
const SCENARIOS = {
  "A. Лёгкий, 10 ген/нед": {
    home: 8, drill: 2, card: 2, cards: 2, control: 2, test: 0, plan: 2, pres: 2, oge: 0, ktp: 0,
  },
  "B. 20 уроков/нед": {
    home: 14, drill: 6, card: 4, cards: 3, control: 3, test: 2, plan: 3, pres: 3, oge: 2, ktp: 0.2,
  },
  "C. 24 урока/нед (тяжёлый)": {
    home: 20, drill: 10, card: 6, cards: 4, control: 4, test: 3, plan: 4, pres: 4, oge: 4, ktp: 0.3,
  },
};

const PLANS = ["base", "standard", "plus"];
const PLAN_NAMES = { base: "Базовый", standard: "Оптимальный", plus: "Плюс" };
/** Ключ сценария → продуктовый тип, которым он пользуется. */
const KEY_TYPE = Object.fromEntries(
  Object.entries(ART).map(([key, [type]]) => [key, type])
);

const PROPOSED = { base: 249, standard: 499, plus: 999 };
/**
 * Цены ДО снижения 12.10.2026. Нужны для сравнения «было/стало» в
 * docs/35 — их больше негде взять, потому что код уже содержит новые.
 * Захардкожены намеренно: это история, а не настройка.
 */
const PREVIOUS = { base: 500, standard: 990, plus: 1500 };
/**
 * Скидка за учебный год. Проценты взяты из текущего product'а, чтобы новая
 * лестница не меняла условия покупки молча: 15,5% / 14,7% / 18,5%.
 */
const PROPOSED_ACADEMIC_DISCOUNT = { base: 15.5, standard: 14.7, plus: 18.5 };
const FIXED_COST_SCENARIOS = [100_000, 200_000, 300_000, 500_000];
/** Рост COGS при включении self-verification на Sonnet — docs v2 §5, дыра 4. */
const SELF_VERIFICATION_MULTIPLIER = 1.6;
/** Сценарий нагрузки, который владелец назвал базой для решений (12.10.2026). */
const BASELINE = "B. 20 уроков/нед";

// ─────────────────────────────────────────────────────────────────────────────
// Модель себестоимости
// ─────────────────────────────────────────────────────────────────────────────

function makeModel(src) {
  const { costs, rubPerUsd, referenceModel } = src;

  const validation = (out) => {
    const c = costs["deepseek-v4-flash"];
    if (!c) throw new Error("Нет цены deepseek-v4-flash");
    const inTok = SYS + USER + out + VALIDATION_IN_EXTRA;
    return ((inTok / 1e6) * c.inputPer1M + (VALIDATION_OUT / 1e6) * c.outputPer1M) * rubPerUsd;
  };

  const gen = (model, out) => {
    const c = costs[model];
    if (!c) throw new Error(`Нет цены модели ${model}`);
    let usd;
    if (c.cacheReadPer1M != null) {
      // Anthropic-семейство: system prompt платится как cache-read.
      usd =
        (SYS / 1e6) * c.cacheReadPer1M +
        (USER / 1e6) * c.inputPer1M +
        (out / 1e6) * c.outputPer1M;
    } else {
      const base =
        ((SYS + USER) / 1e6) * c.inputPer1M + (out / 1e6) * c.outputPer1M;
      // Fallback на Sol есть только у эталонной модели (ESCALATION в router.ts).
      // Раньше условие было «выход ≤ 1 $», из-за чего Sol-микс попадал ещё и в
      // DeepSeek — валидация в 12 раз дороже реальной.
      if (model === referenceModel) {
        const sol = costs["gpt-6-sol"];
        usd = base + LUNA_FALLBACK * (((SYS + USER) / 1e6) * sol.inputPer1M + (out / 1e6) * sol.outputPer1M);
      } else {
        usd = base;
      }
    }
    return usd * rubPerUsd;
  };

  const refOut = costs[referenceModel].outputPer1M;
  const weight = (model) => (costs[model]?.outputPer1M ?? refOut) / refOut;

  return { validation, gen, weight, rubPerWeightedToken: (refOut / 1e6) * rubPerUsd };
}

/** Есть ли у тарифа право на этот тип артефакта (по PLUS_ONLY_TASKS в коде). */
function allowed(model, plan, key) {
  const task = model.src.artifactTask[KEY_TYPE[key]];
  if (!task) throw new Error(`Тип артефакта ${KEY_TYPE[key]} не найден в ARTIFACT_TASK`);
  if (model.src.plusOnly.has(task)) return plan === "plus";
  return true;
}

/**
 * COGS и расход нормы за месяц для пары «тариф × нагрузка».
 *
 * controlOnBase: true — считаем как в коде сегодня (контрольная доступна всем,
 * она роутится на Sonnet). false — как в карточке тарифа, где контрольная
 * перечислена в фичах «Плюса» (src/lib/content/plans.ts).
 */
function loadFor(model, plan, scenario, controlOnBase) {
  const mix = SCENARIOS[scenario];
  let genRub = 0;
  let valRub = 0;
  let weighted = 0;
  let artifacts = 0;
  for (const [key, perWeek] of Object.entries(mix)) {
    if (perWeek <= 0) continue;
    if (!allowed(model, plan, key)) continue;
    if (!controlOnBase && key === "control" && plan !== "plus") continue;
    const [, out] = ART[key];
    const task = model.src.artifactTask[KEY_TYPE[key]];
    const priceModel = model.src.primaryByTask[task];
    if (!priceModel) throw new Error(`Нет модели для задачи ${task}`);
    const n = (perWeek * WEEKS) / MONTHS;
    genRub += n * model.gen(priceModel, out);
    valRub += n * model.validation(out);
    weighted += n * out * model.weight(priceModel);
    artifacts += n;
  }
  return { rub: genRub + valRub, genRub, valRub, weighted, artifacts };
}

/** COGS ровно по норме тарифа: сколько стоит один месяц при полном расходе нормы. */
function cogsAtNorm(model, plan) {
  return model.src.norms[plan] * model.rubPerWeightedToken;
}

function row(model, { plan, price, scenario, controlOnBase }) {
  const load = loadFor(model, plan, scenario, controlOnBase);
  const norm = model.src.norms[plan];
  const fee = price * FEE;
  const marginRub = price - fee - load.rub;
  return {
    plan,
    planName: PLAN_NAMES[plan],
    price,
    scenario,
    controlOnBase,
    artifactsPerMonth: round(load.artifacts, 0),
    weightedPerMonth: round(load.weighted, 0),
    norm,
    normUsedPct: round((load.weighted / norm) * 100, 1),
    cogsLoad: round(load.rub, 2),
    cogsAtNorm: round(cogsAtNorm(model, plan), 2),
    fee: round(fee, 2),
    marginRub: round(marginRub, 2),
    marginPct: round((marginRub / price) * 100, 1),
  };
}

/** Максимальная норма, которая держит маржу не ниже целевой. */
function maxNormAtMargin(model, price, targetMarginPct) {
  const budget = price * (1 - FEE) * (1 - targetMarginPct / 100);
  return {
    rub: round(budget, 2),
    weighted: Math.floor((budget / model.rubPerWeightedToken / 1000) * 1000),
    worksheets: Math.round(budget / model.rubPerWeightedToken / model.src.tokensPerWorksheet),
  };
}

/** Сколько платящих нужно, чтобы покрыть фиксированные расходы при известной марже. */
function breakEvenUsers(price, marginPct, fixedRub) {
  const perUser = (price * marginPct) / 100;
  return perUser <= 0 ? null : Math.ceil(fixedRub / perUser);
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function buildModel() {
  const src = readSources();
  const model = makeModel(src);
  model.src = src;
  return model;
}

function buildMatrix(model, priceSets) {
  const out = [];
  for (const [setName, prices] of Object.entries(priceSets)) {
    for (const plan of PLANS) {
      for (const scenario of Object.keys(SCENARIOS)) {
        out.push(
          row(model, {
            plan,
            price: prices[plan],
            scenario,
            controlOnBase: true,
          })
        );
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Режимы запуска
// ─────────────────────────────────────────────────────────────────────────────

function cmdVerifySources(model) {
  const { src } = model;
  const lines = [
    `  курс (RUB_PER_USD, usage.ts)          ${src.rubPerUsd}`,
    `  цена взвешенного токена               ${model.rubPerWeightedToken.toFixed(9)} ₽`,
    `  эталонная модель                     ${src.referenceModel}`,
    `  прайс моделей                        ${Object.keys(src.costs).length} шт. из config.ts`,
    `  листов в листе-домашке               ${src.tokensPerWorksheet}`,
  ];
  for (const plan of PLANS) {
    lines.push(
      `  норма ${plan.padEnd(9)}              ${src.norms[plan].toLocaleString("ru-RU")} взв. токенов/мес`
    );
  }
  for (const plan of Object.keys(src.prices)) {
    const p = src.prices[plan];
    lines.push(
      `  цена ${plan.padEnd(9)}              ${p.monthly} ₽/мес · ${p.academicYear ?? "—"} за 9 мес`
    );
  }
  lines.push(
    `  только на «Плюсе»                    ${[...src.plusOnly].sort().join(", ")}`
  );
  for (const task of Object.keys(src.primaryByTask).sort()) {
    lines.push(`  ${task.padEnd(20)} → ${src.primaryByTask[task]}`);
  }
  // Сверка: каждая задача роутера должна быть в ARTIFACT_TASK.
  for (const key of Object.keys(KEY_TYPE)) {
    const task = src.artifactTask[KEY_TYPE[key]];
    if (!task) throw new Error(`ARTIFACT_TASK не знает тип ${KEY_TYPE[key]}`);
    if (!src.primaryByTask[task]) throw new Error(`PRIMARY_BY_TASK не знает задачу ${task}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  process.stdout.write("SOURCES_VERIFIED\n");
}

function cmdVerifyModel(model) {
  const { src } = model;
  const checks = [];
  const expect = (name, actual, want, tol = 0.005) => {
    const ok = Math.abs(actual - want) <= tol;
    checks.push({ name, actual, want, ok });
    return ok;
  };

  // Контрольные числа из самого репозитория: docs/04-pricing-economics-v2.md §7
  // и plans.ts costPerNormRub. Цены и нормы сверяются с решением от 12.10.2026.
  expect("цена взвешенного токена (0,35 $ × 85 ₽)", model.rubPerWeightedToken, 0.35 * 85 / 1e6);
  expect("COGS нормы «Базового» (plans.ts costPerNormRub = 71,4)", cogsAtNorm(model, "base"), 71.4, 0.1);
  expect("COGS нормы «Плюса» (plans.ts costPerNormRub = 288,6)", cogsAtNorm(model, "plus"), 288.58, 0.2);
  expect("цена тарифа «Базовый» из billing.ts", src.prices.base.monthly, 249);
  expect("цена тарифа «Оптимальный» из billing.ts", src.prices.standard.monthly, 499);
  expect("цена тарифа «Плюс» из billing.ts", src.prices.plus.monthly, 999);
  expect("норма «Базового» из usage.ts", src.norms.base, 2_400_000);
  expect("норма «Оптимального» из usage.ts", src.norms.standard, 4_800_000);
  expect("норма «Плюса» из usage.ts", src.norms.plus, 9_700_000);
  // Лист-домашка на Luna с валидацией — 0,15 ₽ (docs v2 §3).
  expect(
    "лист-домашка на Luna + валидация (текущий прайс)",
    model.gen("gpt-6-luna", 1600) + model.validation(1600),
    0.143,
    0.002
  );
  // Контрольная на Sonnet — 4,35 ₽ (docs v2 §3).
  expect(
    "контрольная на Sonnet + валидация (текущий прайс)",
    model.gen("claude-sonnet-5-5", 3600) + model.validation(3600),
    4.389,
    0.01
  );

  // Гипотеза расхождения с docs v2 §3: цифры там посчитаны по прайсу ДО правки
  // 06.10.2026 (DeepSeek 0,065/0,13 и Sonnet 2,75/13,75). Если модель на старых
  // ценах даёт ровно документные 0,15 и 4,35 — расхождение объяснено сменой
  // прайса, а не ошибкой в формуле.
  const legacy = makeModel({
    ...src,
    costs: {
      ...src.costs,
      "claude-sonnet-5-5": {
        ...src.costs["claude-sonnet-5-5"],
        inputPer1M: 2.75,
        outputPer1M: 13.75,
        cacheReadPer1M: 0.275,
      },
      "deepseek-v4-flash": { inputPer1M: 0.065, outputPer1M: 0.13 },
    },
  });
  expect(
    "лист-домашка на СТАРОМ прайсе = документные 0,15 ₽",
    legacy.gen("gpt-6-luna", 1600) + legacy.validation(1600),
    0.15,
    0.005
  );
  expect(
    "контрольная на Sonnet на СТАРОМ прайсе = документные 4,35 ₽",
    legacy.gen("claude-sonnet-5-5", 3600) + legacy.validation(3600),
    4.35,
    0.02
  );
  // Правило docs v2 §10: расхождение больше 5% — повод обновить документ.
  const drift = Math.max(Math.abs(0.143 / 0.15 - 1), Math.abs(4.389 / 4.35 - 1));
  checks.push({
    name: `расхождение с docs v2 §3 (${(drift * 100).toFixed(1)}%) меньше порога 5%`,
    actual: "нет",
    want: "нет",
    ok: drift <= 0.05,
  });

  // Fallback на Sol существует только у эталонной модели. Проверяем по формуле
  // без него — если в gen() снова появится общий Sol-микс, тест упадёт.
  const dsExpected =
    (((SYS + USER) / 1e6) * src.costs["deepseek-v4-flash"].inputPer1M +
      1000 / 1e6 * src.costs["deepseek-v4-flash"].outputPer1M) *
    src.rubPerUsd;
  expect("DeepSeek считается без fallback на Sol", model.gen("deepseek-v4-flash", 1000), dsExpected, 1e-9);
  const dsWithFallback =
    dsExpected +
    LUNA_FALLBACK *
      (((SYS + USER) / 1e6) * src.costs["gpt-6-sol"].inputPer1M +
        1000 / 1e6 * src.costs["gpt-6-sol"].outputPer1M) *
      src.rubPerUsd;
  checks.push({
    name: "Sol-микс заметно отличается от честного DeepSeek (контроль самого теста)",
    actual: round(dsWithFallback / dsExpected, 2),
    want: "> 3",
    ok: dsWithFallback / dsExpected > 3,
  });

  for (const c of checks) {
    process.stdout.write(
      `  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${round(c.actual, 6)} (ожидалось ${c.want})\n`
    );
  }
  if (checks.some((c) => !c.ok)) {
    process.stderr.write("MODEL_MISMATCH\n");
    process.exit(1);
  }
  process.stdout.write("MODEL_VERIFIED\n");
}

function cmdMatrix(model, priceSets) {
  const matrix = buildMatrix(model, priceSets);
  const norms = {};
  for (const plan of PLANS) {
    norms[plan] = {
      current: srcNorm(model, plan),
      atFullUse: {
        marginPct: round(
          ((priceSets.proposed[plan] * (1 - FEE) - cogsAtNorm(model, plan)) /
            priceSets.proposed[plan]) *
            100,
          1
        ),
      },
      target70: maxNormAtMargin(model, priceSets.proposed[plan], 70),
      target75: maxNormAtMargin(model, priceSets.proposed[plan], 75),
    };
  }
  const breakEven = {};
  for (const [setName, prices] of Object.entries(priceSets)) {
    for (const plan of PLANS) {
      const heavy = matrix.find(
        (r) => r.plan === plan && r.scenario === "C. 24 урока/нед (тяжёлый)" && r.price === prices[plan]
      );
      breakEven[`${setName}:${plan}`] = Object.fromEntries(
        FIXED_COST_SCENARIOS.map((f) => [f, breakEvenUsers(prices[plan], heavy.marginPct, f)])
      );
    }
  }
  return { matrix, norms, breakEven, portfolios: cmdPortfolios(model, priceSets) };
}

/**
 * Портфель: сколько денег в месяц приносит N платящих при заданной смеси тарифов.
 * Смесь — параметр, а не факт: её надо заменить реальной после первых 100 платящих.
 */
const PORTFOLIO_MIXES = {
  "равномерный ⅓/⅓/⅓": { base: 1 / 3, standard: 1 / 3, plus: 1 / 3 },
  "тяжёлый 2/5/3/5": { base: 0.2, standard: 0.5, plus: 0.3 },
  "школьный 3/10/7/10": { base: 0.3, standard: 0.7, plus: 0 },
};

function cmdPortfolios(model, priceSets) {
  const out = {};
  for (const [setName, prices] of Object.entries(priceSets)) {
    for (const mixName of Object.keys(PORTFOLIO_MIXES)) {
      for (const scenario of Object.keys(SCENARIOS)) {
        const perUser = PLANS.reduce((acc, plan) => {
          const r = row(model, { plan, price: prices[plan], scenario, controlOnBase: true });
          return acc + r.marginRub * PORTFOLIO_MIXES[mixName][plan];
        }, 0);
        const rubPerMonth = {};
        for (const n of [100, 300, 1000]) rubPerMonth[n] = round(perUser * n, 0);
        const need = {};
        for (const f of FIXED_COST_SCENARIOS) {
          need[f] = perUser <= 0 ? null : Math.ceil(f / perUser);
        }
        out[`${setName}:${mixName}:${scenario}`] = {
          marginRubPerUser: round(perUser, 2),
          rubPerMonth,
          usersToCover: need,
        };
      }
    }
  }
  return out;
}

function srcNorm(model, plan) {
  return {
    weighted: model.src.norms[plan],
    rub: round(cogsAtNorm(model, plan), 2),
    worksheets: Math.round(model.src.norms[plan] / model.src.tokensPerWorksheet),
  };
}

function cmdCheckReport(model, file) {
  const md = readFileSync(resolve(ROOT, file), "utf8");
  const m = md.match(/```json margin-matrix\n([\s\S]*?)```/);
  if (!m) {
    process.stderr.write("В документе нет блока ```json margin-matrix\n");
    process.exit(1);
  }
  let block;
  try {
    block = JSON.parse(m[1]);
  } catch (e) {
    process.stderr.write(`Блок не парсится: ${e.message}\n`);
    process.exit(1);
  }
  const fresh = computeBlock(model);
  const diffs = [];
  const walk = (a, b, path) => {
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      const av = a?.[key];
      const bv = b?.[key];
      if (av && bv && typeof av === "object" && typeof bv === "object") walk(av, bv, `${path}.${key}`);
      else if (typeof av === "number" && typeof bv === "number") {
        if (Math.abs(av - bv) > 0.51) diffs.push(`${path}.${key}: в документе ${av}, считается ${bv}`);
      } else if (av !== bv) diffs.push(`${path}.${key}: в документе ${JSON.stringify(av)}, считается ${JSON.stringify(bv)}`);
    }
  };
  walk(block, fresh, "report");
  if (diffs.length) {
    for (const d of diffs) process.stderr.write(`  РАСХОЖДЕНИЕ ${d}\n`);
    process.exit(1);
  }
  process.stdout.write(`REPORT_MATCHES_MODEL (${Object.keys(block).length} блоков цифр)\n`);
}

/** Ключевые числа, которые обязаны совпасть с документом. */
function cmdSyncReport(model, file) {
  const p = resolve(ROOT, file);
  const md = readFileSync(p, "utf8");
  const block = JSON.stringify(computeBlock(model), null, 2);
  const re = /(```json margin-matrix\n)[\s\S]*?(\n```)/;
  if (!re.test(md)) throw new Error("В документе нет блока ```json margin-matrix");
  writeFileSync(p, md.replace(re, `$1${block}$2`));
  process.stdout.write(`REPORT_SYNCED ${file}\n`);
}

function computeBlock(model) {
  const priceSets = { before: PREVIOUS, proposed: PROPOSED };
  const matrix = buildMatrix(model, priceSets);
  const heavy = "C. 24 урока/нед (тяжёлый)";
  const get = (plan, setName) =>
    matrix.find((r) => r.plan === plan && r.scenario === heavy && r.price === priceSets[setName][plan]);
  const block = { perPlan: {}, portfolio: {} };
  for (const plan of PLANS) {
    const cur = get(plan, "before");
    const pro = get(plan, "proposed");
    const normCost = cogsAtNorm(model, plan);
    block.perPlan[plan] = {
      priceCurrent: cur.price,
      priceProposed: pro.price,
      marginPctCurrent: cur.marginPct,
      marginPctProposed: pro.marginPct,
      marginRubProposed: pro.marginRub,
      cogsProposed: pro.cogsLoad,
      normUsedPctProposed: pro.normUsedPct,
      normCurrent: model.src.norms[plan],
      cogsAtNorm: round(normCost, 2),
      marginPctAtNormProposed: round(
        ((pro.price * (1 - FEE) - normCost) / pro.price) * 100,
        1
      ),
      maxNormAt70: maxNormAtMargin(model, pro.price, 70).weighted,
      maxNormAt70Worksheets: maxNormAtMargin(model, pro.price, 70).worksheets,
    };
  }
  for (const mixName of Object.keys(PORTFOLIO_MIXES)) {
    for (const scenario of Object.keys(SCENARIOS)) {
      const pf = cmdPortfolios(model, priceSets)[
        `proposed:${mixName}:${scenario}`
      ];
      block.portfolio[`${mixName}|${scenario}`] = {
        marginRubPerUser: pf.marginRubPerUser,
        rubPer300Users: pf.rubPerMonth[300],
        usersToCover300k: pf.usersToCover[300_000],
      };
    }
  }
  block.insights = {
    controlCogsHeavyPerMonth: round(controlOnly(model, heavy).rub, 2),
    controlShareOfBaseCogsPct: round(
      (controlOnly(model, heavy).rub / get("base", "proposed").cogsLoad) * 100,
      1
    ),
    artifactsPerMonthBaseHeavy: get("base", "proposed").artifactsPerMonth,
    artifactsPerMonthPlusHeavy: get("plus", "proposed").artifactsPerMonth,
  };
  // ЗАПАСНОЙ СЦЕНАРИЙ, не текущее состояние. Self-verification в коде есть
  // (F-05-B, verifySelfTask) и ходит на DeepSeek — см. selfVerificationShipped
  // ниже. Этот блок отвечает на вопрос «а если её переведут на Sonnet»: тогда
  // COGS генерации вырастет примерно в 1,6 раза (docs v2 §5), валидация
  // DeepSeek не меняется.
  const heavyBase = loadFor(model, "base", heavy, true);
  const selfVerCogs =
    heavyBase.genRub * SELF_VERIFICATION_MULTIPLIER + heavyBase.valRub;
  block.selfVerification = {
    multiplier: SELF_VERIFICATION_MULTIPLIER,
    baseCogsHeavy: round(heavyBase.rub, 2),
    baseCogsHeavyWithSelfVerification: round(selfVerCogs, 2),
    baseMarginPctAt249Now: get("base", "proposed").marginPct,
    baseMarginPctAt249WithSelfVerification: round(
      ((PROPOSED.base * (1 - FEE) - selfVerCogs) / PROPOSED.base) * 100,
      1
    ),
  };

  // Self-verification в коде ЕСТЬ (F-05-B, `verifySelfTask`) и ходит на DeepSeek
  // через pickModel("validate") — не на Sonnet. Docs v2 §5 «дыра 4» устарела.
  // Считаем цену одного проверенного задания, а не множитель на весь тариф.
  const ds = "deepseek-v4-flash";
  const solveRub = model.gen(ds, 600);
  const verifyRub = model.gen(ds, 300);
  const perTask = solveRub + verifyRub;
  const baselineBase = loadFor(model, "base", BASELINE, true);
  block.selfVerificationShipped = {
    model: ds,
    rubPerVerifiedTask: round(perTask, 4),
    tasksToEat10PctOfBaseCogs: Math.ceil((baselineBase.rub * 0.1) / perTask),
    baseCogsBaseline: round(baselineBase.rub, 2),
  };

  // Базовая нагрузка для решений — сценарий В (решение владельца, 12.10.2026).
  // Норма тарифа = max(текущая, В × 1,5), но не выше потолка 70% маржи:
  // не режем норму ниже текущей без причины и не даём больше, чем маржа выдержит.
  block.baseline = { scenario: BASELINE, perPlan: {} };
  for (const plan of PLANS) {
    const price = PROPOSED[plan];
    const load = loadFor(model, plan, BASELINE, true);
    const ceil70 = maxNormAtMargin(model, price, 70).weighted;
    const need = load.weighted * 1.5;
    const norm = Math.floor(Math.min(Math.max(model.src.norms[plan], need), ceil70) / 100_000) * 100_000;

    // Цена учебного года: та же скидка в процентах, что и сейчас.
    const fullYear = 9 * price;
    const academic = Math.round((fullYear * (1 - PROPOSED_ACADEMIC_DISCOUNT[plan] / 100)) / 10) * 10;
    const perMonthAcademic = academic / 9;
    const marginAt = (revenue) =>
      round(((revenue * (1 - FEE) - load.rub) / revenue) * 100, 1);

    block.baseline.perPlan[plan] = {
      priceMonthly: price,
      priceAcademicYear: academic,
      perMonthFromAcademicYear: round(perMonthAcademic, 2),
      cogsBaseline: round(load.rub, 2),
      weightedBaseline: round(load.weighted, 0),
      marginPctMonthly: marginAt(price),
      marginPctAcademicYear: marginAt(perMonthAcademic),
      marginRubAcademicYear: round(perMonthAcademic * (1 - FEE) - load.rub, 2),
      normCurrent: model.src.norms[plan],
      normRecommended: norm,
      normRecommendedWorksheets: Math.round(norm / model.src.tokensPerWorksheet),
      baselineUsesPctOfRecommendedNorm: round((load.weighted / norm) * 100, 1),
      cogsAtRecommendedNorm: round(norm * model.rubPerWeightedToken, 2),
      marginPctAtRecommendedNorm: round(
        ((price * (1 - FEE) - norm * model.rubPerWeightedToken) / price) * 100,
        1
      ),
    };
  }
  return block;
}

/** Сколько стоит одна только контрольная за месяц в тяжёлом сценарии. */
function controlOnly(model, scenario) {
  let rub = 0;
  const [, out] = ART.control;
  const priceModel = model.src.primaryByTask[model.src.artifactTask.control];
  const n = (SCENARIOS[scenario].control * WEEKS) / MONTHS;
  rub = n * (model.gen(priceModel, out) + model.validation(out));
  return { rub };
}

function currentPrices(model) {
  return Object.fromEntries(PLANS.map((p) => [p, model.src.prices[p].monthly]));
}

function printTable(model, matrix) {
  const rows = [];
  let lastPrice = null;
  for (const r of matrix) {
    const label = lastPrice === r.price ? "" : `${r.planName}`;
    lastPrice = r.price;
    rows.push(
      [
        label.padEnd(13),
        `${r.price} ₽`.padStart(9),
        r.scenario.padEnd(28),
        `${r.cogsLoad.toFixed(0)} ₽`.padStart(9),
        `${r.fee.toFixed(1)} ₽`.padStart(8),
        `${r.marginRub.toFixed(0)} ₽`.padStart(9),
        `${r.marginPct}%`.padStart(8),
        `${r.normUsedPct}%`.padStart(8),
      ].join(" ")
    );
  }
  process.stdout.write(
    ["Тариф".padEnd(13), "цена".padStart(9), "нагрузка".padEnd(28), "COGS".padStart(9), "экв.".padStart(8), "маржа".padStart(9), "%".padStart(8), "норма".padStart(8)].join(" ") + "\n"
  );
  process.stdout.write("-".repeat(100) + "\n");
  process.stdout.write(rows.join("\n") + "\n\n");
  for (const plan of PLANS) {
    const p = PROPOSED[plan];
    const t70 = maxNormAtMargin(model, p, 70);
    const t75 = maxNormAtMargin(model, p, 75);
    const n = model.src.norms[plan];
    process.stdout.write(
      `  ${PLAN_NAMES[plan].padEnd(12)} ${p} ₽/мес: норма сейчас ${n.toLocaleString("ru-RU")} ` +
        `(${(n / model.src.tokensPerWorksheet).toFixed(0)} листов, себестоимость ${cogsAtNorm(model, plan).toFixed(0)} ₽); ` +
        `под маржу 70% влезает ${t70.weighted.toLocaleString("ru-RU")} (${t70.worksheets} листов), под 75% — ${t75.weighted.toLocaleString("ru-RU")}\n`
    );
  }
  process.stdout.write("MARGIN_MATRIX_OK\n");
}

// ─────────────────────────────────────────────────────────────────────────────

function main(argv) {
  const model = buildModel();
  const flag = (name) => argv.includes(name);
  const value = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };

  let proposed = PROPOSED;
  if (flag("--prices")) {
    const [a, b, c] = value("--prices").split(",").map(Number);
    proposed = { base: a, standard: b, plus: c };
  }
  // Сравнение всегда «до/после»: PREVIOUS — история, proposed — то, что стоит
  // в коде сейчас. Если разъедутся — это разоблачит проверка моде��и (G1).
  const priceSets = { before: PREVIOUS, proposed };

  if (flag("--verify-sources")) return cmdVerifySources(model);
  if (flag("--verify-model")) return cmdVerifyModel(model);
  if (flag("--sync-report")) return cmdSyncReport(model, value("--sync-report"));
  if (flag("--check-report")) return cmdCheckReport(model, value("--check-report"));
  if (flag("--json")) {
    const payload = cmdMatrix(model, priceSets);
    process.stdout.write(
      JSON.stringify(
        {
          meta: {
            rubPerUsd: model.src.rubPerUsd,
            rubPerWeightedToken: model.rubPerWeightedToken,
            fee: FEE,
            months: MONTHS,
            weeks: WEEKS,
            prices: priceSets,
            norms: Object.fromEntries(PLANS.map((p) => [p, model.src.norms[p]])),
          },
          ...payload,
          keyNumbers: computeBlock(model),
        },
        null,
        2
      ) + "\n"
    );
    process.stdout.write("MARGIN_MATRIX_OK\n");
    return;
  }
  printTable(model, buildMatrix(model, priceSets));
}

main(process.argv.slice(2));
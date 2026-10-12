#!/usr/bin/env node
/**
 * Проверка того, что цены и нормы тарифов живут в одном месте.
 *
 *   node scripts/check-price-sources.mjs              → PRICE_SOURCES_UNIQUE
 *   node scripts/check-price-sources.mjs --user-facing → NO_STALE_PRICES
 *
 * Зачем: цены дублируются в `src/lib/content/plans.ts` (фронт) и
 * `backend/src/services/billing.ts` (бэк), нормы — в `plans.ts` и
 * `backend/src/services/usage.ts`. Дубли — источник расхождения «на странице
 * одно, при оплате другое». Этот скрипт ломается, если дубли разъехались,
 * появилась третья копия или в текстах для учителя осталась старая цена.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const fails = [];
const fail = (msg) => fails.push(msg);
const ok = (msg) => process.stdout.write(`  ok   ${msg}\n`);
const num = (lit) => Number(String(lit).replace(/[_\s]/g, ""));

/** Тело `const NAME = {…}` по границам скобок. */
function obj(src, name) {
  const m = new RegExp(`\\bconst\\s+${name}\\b`).exec(src);
  if (!m) throw new Error(`Не найден const ${name}`);
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`Блок ${name} не закрыт`);
}

const close = (a, b, tol, what) => {
  if (Math.abs(a - b) <= tol) ok(`${what}: ${a} ≈ ${b}`);
  else fail(`${what}: ${a} против ${b} (допуск ${tol})`);
};

// ─── читаем источники ────────────────────────────────────────────────────────

const plans = read("src/lib/content/plans.ts");
const billing = read("backend/src/services/billing.ts");
const usage = read("backend/src/services/usage.ts");

const backPrices = {};
for (const m of obj(billing, "PRICES").matchAll(
  /(\w+)\s*:\s*\{\s*monthly\s*:\s*([\d_]+)\s*,\s*academicYear\s*:\s*([\d_]+|null)/g
)) {
  backPrices[m[1]] = {
    monthly: num(m[2]) / 100,
    academicYear: m[3] === "null" ? null : num(m[3]) / 100,
  };
}

const backNorms = {};
for (const m of obj(usage, "PLAN_NORM_PER_MONTH").matchAll(/(\w+)\s*:\s*([\d_]+)/g)) {
  backNorms[m[1]] = num(m[2]);
}

const tokensPerWorksheet = num(
  usage.match(/TOKENS_PER_WORKSHEET\s*=\s*([\d_]+)/)?.[1] ?? "1600"
);
const rubPerUsd = num(usage.match(/RUB_PER_USD\s*=\s*([\d.]+)/)?.[1] ?? "85");
const refOutputPer1M = num(
  read("backend/src/llm/config.ts").match(/REFERENCE_MODEL_ID\s*=\s*"([^"]+)"/)
    ? (read("backend/src/llm/config.ts").match(/outputPer1M:\s*([\d.]+)/) ?? [0, "0.35"])[1]
    : "0.35"
);

const NORM_CONSTANTS = {};
for (const m of plans.matchAll(/const\s+(NORM_\w+)\s*=\s*([\d_]+)/g)) {
  NORM_CONSTANTS[m[1]] = num(m[2]);
}

/** Числовые поля одного тарифа из блока PLANS в plans.ts. */
function parsePlan(block) {
  const pick = (re) => block.match(re)?.[1];
  const normRaw = pick(/normPerMonth:\s*([\d_]+|NORM_\w+)/);
  const normWorksheets = null; // подпись считается из нормы, хранится только текст
  return {
    normTokensPerMonth:
      normRaw == null ? null : NORM_CONSTANTS[normRaw] ?? num(normRaw),
    costPerNormRub: pick(/costPerNormRub:\s*([\d.]+)/) != null ? Number(pick(/costPerNormRub:\s*([\d.]+)/)) : null,
    normWorksheets,
    priceMonthly: Number(pick(/month:\s*\{\s*amount:\s*(\d+)/)),
    priceAcademicYear: Number(pick(/academicYear:\s*\{[\s\S]*?amount:\s*(\d+)/)),
    fullAcademicYearAmount: Number(pick(/fullAcademicYearAmount:\s*(\d+)/)),
    discountPercent: Number(pick(/academicYearDiscountPercent:\s*([\d.]+)/)),
  };
}

const planBlocks = {};
for (const m of plans.matchAll(
  /\n  (base|standard|plus|school):\s*\{/g
)) {
  const from = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = from; i < plans.length; i++) {
    if (plans[i] === "{") depth++;
    else if (plans[i] === "}" && --depth === 0) {
      planBlocks[m[1]] = plans.slice(from, i + 1);
      break;
    }
  }
}

const front = {};
for (const [id, block] of Object.entries(planBlocks)) front[id] = parsePlan(block);

// ─── 1. фронт и бэк совпадают ────────────────────────────────────────────────

for (const [id, bp] of Object.entries(backPrices)) {
  const fp = front[id];
  if (!fp) {
    fail(`Тариф ${id} есть в бэке, но нет в plans.ts`);
    continue;
  }
  close(fp.priceMonthly, bp.monthly, 0.01, `цена ${id} помесячно, фронт ↔ бэк`);
  if (bp.academicYear == null) continue;
  close(fp.priceAcademicYear, bp.academicYear, 0.01, `цена ${id} за год, фронт ↔ бэк`);
}

for (const [id, bn] of Object.entries(backNorms)) {
  const fp = front[id];
  if (!fp) {
    fail(`Норма ${id} есть в usage.ts, но нет в plans.ts`);
    continue;
  }
  close(fp.normTokensPerMonth, bn, 0.5, `норма ${id}, фронт ↔ бэк`);
}

// ─── 2. нормы и себестоимость сходятся внутри plans.ts ─────────────────────

for (const [id, fp] of Object.entries(front)) {
  if (fp.normTokensPerMonth == null) continue;
  close(
    fp.costPerNormRub,
    (fp.normTokensPerMonth * refOutputPer1M * rubPerUsd) / 1_000_000,
    0.1,
    `себестоимость нормы ${id} (норма × ${refOutputPer1M} $ × ${rubPerUsd} ₽)`
  );
}

// ─── 3. скидка за учебный год честная ───────────────────────────────────────

for (const [id, fp] of Object.entries(front)) {
  if (!fp.fullAcademicYearAmount || !fp.discountPercent) continue;
  close(fp.fullAcademicYearAmount, 9 * fp.priceMonthly, 0.5, `полная цена учебного года ${id}`);
  close(
    fp.discountPercent,
    (1 - fp.priceAcademicYear / fp.fullAcademicYearAmount) * 100,
    0.1,
    `скидка учебного года ${id}`
  );
}

// ─── 4. третьей копии нет ───────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (/\/(node_modules|\.next|\.git|dist|coverage)\//.test(rel)) continue;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e)) out.push(rel);
  }
  return out;
}

/**
 * Третья копия цены — это когда рядом со словом «цена» стоит число тарифа
 * или его копеечный литерал. Голое «500» в коде (HTTP-код, id, байты) — не
 * копия цены, и ловить его нельзя: проверка станет шумной и её выключат.
 */
function priceCopiesIn(src, backPrices) {
  const hits = [];
  const known = Object.entries(backPrices);
  // копейки: 500_00, 1500_00
  for (const m of src.matchAll(/(\d+)_00\b/g)) {
    const hit = known.find(([, p]) => p.monthly * 100 === Number(m[1]));
    if (hit) hits.push(`${hit[0]}=${hit[1].monthly} ₽ как ${m[0]}`);
  }
  // присвоение рядом со словом «цена»: price: 500, amount = 500, цена: 500
  for (const m of src.matchAll(
    /\b(price|Price|PRICE|amount|Amount|AMOUNT|цена|Цена|стоимост\w*)\w*\s*[:=]\s*['"`]?(\d+)/g
  )) {
    const hit = known.find(([, p]) => p.monthly === Number(m[2]));
    if (hit) hits.push(`${hit[0]}=${hit[1].monthly} ₽ в «${m[0].trim().slice(0, 40)}»`);
  }
  return hits;
}

for (const file of walk("backend/src")) {
  if (file === "backend/src/services/billing.ts") continue;
  const src = read(file);
  for (const hit of priceCopiesIn(src, backPrices)) {
    fail(`${relative(ROOT, file)} повторяет цену: ${hit} — источник должен быть один`);
  }
  for (const [id, bn] of Object.entries(backNorms)) {
    if (new RegExp(`\\b${bn}\\b`).test(src)) {
      fail(`${relative(ROOT, file)} повторяет норму ${id} (${bn}) — источник должен быть один`);
    }
  }
}

if (!fails.length) ok("третьей копии цен и норм в backend/src нет");

// ─── 5. старые цены не остались в текстах (--user-facing) ────────────────────

if (process.argv.includes("--user-facing")) {
  // Всё, что учитель читает на сайте: исходники фронта и статика.
  // Цены, снятые со снижением 12.10.2026. Хранятся здесь намеренно: это
  // список прошлого, а не настройка. Добавляешь новую снятую цену — дописывай.
  const RETIRED_PRICES = [
    500, 990, 1500, 3800, 7600, 11000, 422, 844, 1222, 900, 990, 3000,
  ];
  const surfaces = [...walk("src"), ...walk("public")];
  const stale = [];
  // Комментарии разработчика не видны учителю — их не ловим.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const file of surfaces) {
    const src = stripComments(read(file));
    // Цены в интерфейсе печатаются только через formatRub → «1 890 ₽».
    // Слово «рублей» не ловим: это тексты заданий для 5–6 класса
    // («откладывая по 500 рублей в месяц»), а не цены тарифа.
    const money = src.matchAll(/(?<![\d_])(\d[\d\s]*)\s*₽/g);
    for (const m of money) {
      const value = Number(m[1].replace(/\s/g, ""));
      const known = Object.values(backPrices).flatMap((p) => [p.monthly, p.academicYear]);
      if (RETIRED_PRICES.includes(value) && !known.includes(value)) {
        stale.push(`${relative(ROOT, file)}: «${m[0].trim()}» — цена снята, а текст остался`);
      }
    }
  }
  for (const s of stale) fail(s);
  if (!stale.length) ok("снятых цен в текстах для учителя не осталось");
}

// ─── вердикт ────────────────────────────────────────────────────────────────

if (fails.length) {
  process.stderr.write("\n" + fails.map((f) => `  FAIL ${f}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(
  process.argv.includes("--user-facing") ? "NO_STALE_PRICES\n" : "PRICE_SOURCES_UNIQUE\n"
);
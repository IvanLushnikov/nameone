/**
 * UL-D14: экономика тарифов считается по коду, а не по копии в Python.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 *
 * Расчёт юнит-экономики жил на Python и держал СВОИ копии канонических чисел:
 * цена 3800/9 ₽, норма 1 440 000 токенов, три бесплатные генерации. В коде
 * продукта к тому моменту было 249/499/999 ₽, нормы 2,4/4,8/9,7 млн и пять
 * листов. Расчёт не ошибался — он считал по старым числам, и выводы из него
 * были про другой продукт.
 *
 * Теперь единственный источник — код: scripts/economics-inputs.mts читает
 * PLANS/priceFor, PLAN_NORM_PER_MONTH, квоту, MODEL_COSTS и исторические
 * замеры, а Python получает версионированный JSON.
 *
 * ЧТО ПРОВЕРЯЕТСЯ
 *   1. Адаптер отдаёт именно те числа, что в коде: 249/499/999 ₽ в месяц,
 *      1890/3830/7330 ₽ за учебный год, нормы 2,4/4,8/9,7 млн, 5 листов
 *      бесплатно, 9 месяцев.
 *   2. У каждого числа есть единица, источник и пометка (canonical /
 *      assumption / modelRate / historicalActual / estimate).
 *   3. Изменение канонической цены меняет вывод — без правки Python.
 *   4. Python без входов или с чужими единицами падает понятно и ненулевым
 *      кодом: молчаливого отката к старым константам нет.
 *   5. Отрицательный вклад виден со знаком и НЕ ломает расчёт.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");

interface EconomicsInputs {
  version: number;
  units: Record<string, string>;
  labels: Record<string, string>;
  academicYear: { months: number; label: string; source: string; consistentWithBackend: boolean };
  free: { generationsPerMonth: number; consistent: boolean; label: string; source: string };
  tokensPerWorksheet: { value: number; label: string; source: string };
  plans: Array<{
    id: string;
    name: string;
    monthly: { amountRub: number; unit: string; label: string; source: string };
    academicYear: { amountRub: number; months: number; label: string; source: string };
    normPerMonth: { value: number; unit: string; label: string; source: string };
  }>;
  school: { id: string; monthly: { amountRub: number } };
  modelCosts: {
    label: string;
    source: string;
    referenceModelId: string;
    byModel: Record<string, { inputPer1MUsd: number; outputPer1MUsd: number }>;
  };
  fx: { rubPerUsd: number; label: string; source: string };
  paymentFee: { rate: number; label: string; source: string };
  historicalActualCosts: {
    label: string;
    measuredAt: string;
    source: string;
    perWorksheetRub: number;
    perControlRub: number;
  };
}

/** Собрать входы адаптером (как это делает человек перед запуском расчёта). */
function runAdapter(cwd: string = REPO_ROOT): EconomicsInputs {
  const out = execFileSync("node", ["--import", "tsx", "scripts/economics-inputs.mts"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(out) as EconomicsInputs;
}

/** Запустить расчёт. Бросает, если код возврата ненулевой. */
function runEconomics(inputsPath: string): string {
  return execFileSync(
    "python3",
    ["scripts/unit-economics.py", "--inputs", inputsPath],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
}

/** Запустить расчёт и вернуть код возврата вместе с выводом. */
function tryEconomics(inputsPath: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = runEconomics(inputsPath);
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/**
 * Отдельная копия канонического прайса с изменённой ценой.
 *
 * Копируются только два файла (адаптер и plans.ts — он ни от чего не
 * зависит), а каталог backend подключается символической ссылкой: нормы и
 * ставки моделей в этом тесте не меняются, а тянуть за собой весь бэкенд
 * незачем.
 */
function copyWithChangedPrice(newPrice: number): string {
  const tmp = mkdtempSync(path.join(tmpdir(), "uchlist-econ-"));
  mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  mkdirSync(path.join(tmp, "src/lib/content"), { recursive: true });

  copyFileSync(
    path.join(REPO_ROOT, "scripts/economics-inputs.mts"),
    path.join(tmp, "scripts/economics-inputs.mts"),
  );

  const plansPath = path.join(REPO_ROOT, "src/lib/content/plans.ts");
  const plans = readFileSync(plansPath, "utf8");
  const anchor = "month: { amount: 249, unit: MONTH_UNIT, perMonth: 249 },";
  expect(plans, "в plans.ts должен быть якорь месячной цены «Базового»").toContain(anchor);
  const patched = plans.replace(
    anchor,
    `month: { amount: ${newPrice}, unit: MONTH_UNIT, perMonth: ${newPrice} },`,
  );
  writeFileSync(path.join(tmp, "src/lib/content/plans.ts"), patched);

  symlinkSync(path.join(REPO_ROOT, "backend"), path.join(tmp, "backend"), "dir");
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(tmp, "node_modules"), "dir");
  return tmp;
}

/**
 * Входы собираются лениво и один раз: адаптер поднимает Node с tsx, и в
 * каждом тесте запускать его заново незачем. Лениво — чтобы при отсутствии
 * адаптера падал КАЖДЫЙ тест, а не весь набор молча пропускался.
 */
let cachedInputs: EconomicsInputs | null = null;
function inputs(): EconomicsInputs {
  if (!cachedInputs) cachedInputs = runAdapter();
  return cachedInputs;
}

describe("UL-D14: экономика считается по коду продукта", () => {
  it("D14-1: адаптер отдаёт канонические цены, нормы, квоту и длительность года", () => {
    expect(inputs().version).toBe(1);

    const byId = Object.fromEntries(inputs().plans.map((p) => [p.id, p]));
    expect(byId.base?.monthly.amountRub).toBe(249);
    expect(byId.standard?.monthly.amountRub).toBe(499);
    expect(byId.plus?.monthly.amountRub).toBe(999);

    expect(byId.base?.academicYear.amountRub).toBe(1890);
    expect(byId.standard?.academicYear.amountRub).toBe(3830);
    expect(byId.plus?.academicYear.amountRub).toBe(7330);

    expect(byId.base?.normPerMonth.value).toBe(2_400_000);
    expect(byId.standard?.normPerMonth.value).toBe(4_800_000);
    expect(byId.plus?.normPerMonth.value).toBe(9_700_000);

    expect(inputs().free.generationsPerMonth).toBe(5);
    expect(inputs().free.consistent).toBe(true);
    expect(inputs().academicYear.months).toBe(9);
    expect(inputs().academicYear.consistentWithBackend).toBe(true);
  });

  it("D14-2: у каждого входа есть единицы, источник и честная пометка", () => {
    expect(inputs().units.money).toBe("RUB");
    expect(inputs().units.norm).toBe("weighted tokens per month");
    expect(inputs().units.modelCost).toBe("USD per 1M tokens");

    for (const plan of inputs().plans) {
      expect(plan.monthly.label).toBe("canonical");
      expect(plan.monthly.source).toContain("plans.ts");
      expect(plan.normPerMonth.source).toContain("usage.ts");
    }

    // Допущения, модельные ставки и исторические замеры помечены РАЗНЫМИ
    // метками: иначе «0,18 ₽ за лист» читается как сегодняшняя цена.
    expect(inputs().fx.label).toBe("assumption");
    expect(inputs().paymentFee.label).toBe("assumption");
    expect(inputs().modelCosts.label).toBe("modelRate");
    expect(inputs().historicalActualCosts.label).toBe("historicalActual");
    expect(inputs().tokensPerWorksheet.label).toBe("estimate");
    expect(inputs().historicalActualCosts.measuredAt).toBe("2026-10-18");
    expect(inputs().historicalActualCosts.perWorksheetRub).toBe(0.18);
    expect(inputs().historicalActualCosts.perControlRub).toBe(9.77);
  });

  it("D14-3: изменение канонической цены меняет вывод без правки Python", () => {
    const tmp = copyWithChangedPrice(300);

    const patched = runAdapter(tmp);
    const base = patched.plans.find((p) => p.id === "base");
    expect(base?.monthly.amountRub).toBe(300);

    // Python тот же самый — меняются только входы.
    const patchedJson = path.join(tmp, "inputs.json");
    writeFileSync(
      patchedJson,
      JSON.stringify(patched, null, 2),
    );
    const out = runEconomics(patchedJson);

    // В выводе расчёта новая цена и новая выручка.
    expect(out).toContain("300");
    expect(out).toMatch(/base\s+300\s+1,890/);
  });

  it("D14-4: без файла входов Python падает понятно и ненулевым кодом", () => {
    const res = tryEconomics(path.join(tmpdir(), "uchlist-econ-does-not-exist.json"));
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("файл входов не найден");
    // И сказано, что делать: молчаливого отката к старым константам нет.
    expect(res.stderr).toContain("economics-inputs.mts");
  });

  it("D14-5: с чужими единицами Python падает, а не считает молча", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "uchlist-econ-units-"));
    const bad = {
      ...inputs(),
      units: { ...inputs().units, money: "USD" },
    } as unknown as EconomicsInputs;
    const badPath = path.join(tmp, "inputs.json");
    writeFileSync(badPath, JSON.stringify(bad, null, 2));

    const res = tryEconomics(badPath);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("единицы");
  });

  it("D14-6: отрицательный вклад виден со знаком и не ломает расчёт", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "uchlist-econ-run-"));
    const inputsPath = path.join(tmp, "inputs.json");
    writeFileSync(inputsPath, JSON.stringify(inputs(), null, 2));

    const res = tryEconomics(inputsPath);
    // Расчёт завершился успешно: отрицательная экономика — факт, а не ошибка.
    expect(res.code).toBe(0);

    // Знак виден: вклад отрицательный на «Базовом» (исторический замер
    // 0,18 ₽ за лист против 249 ₽ выручки при 1500 листах нормы).
    expect(res.stdout).toContain("ВКЛАД ОТРИЦАТЕЛЬНЫЙ");
    expect(res.stdout).toMatch(/«base»: -\d+ ₽\/мес/);
    // Формула и допущения названы.
    expect(res.stdout).toContain("вклад = выручка за месяц");
    expect(res.stdout).toContain("ИСТОРИЧЕСКИЕ");
  });
});

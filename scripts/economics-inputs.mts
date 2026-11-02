/**
 * Адаптер экономики: ЕДИНЫЙ источник финансовых входов (UL-D14).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ─────────────────────────────────────────────────────────────────────────────
 * Расчёт юнит-экономики живёт на Python (scripts/unit-economics.py), а цены,
 * нормы и тарифы — на TypeScript. Пока Python держал свои копии (цена 3800/9,
 * норма 1 440 000, бесплатных генераций 3), расчёт разъезжался с продуктом:
 * в коде уже было 249/499/999 ₽, нормы 2,4/4,8/9,7 млн и 5 листов.
 *
 * Теперь Python ничего не знает про цены: он получает версионированный JSON
 * и считает по нему. Меняем цену в коде — меняется расчёт, без правки
 * Python.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ЧИТАТЬ JSON
 * ─────────────────────────────────────────────────────────────────────────────
 * У каждого числа есть `label`:
 *   canonical         — значение взято из кода продукта, источник истины;
 *   assumption        — объявленное допущение (курс, комиссия), не измерение;
 *   modelRate         — опубликованная цена модели, НЕ наша фактическая стоимость;
 *   historicalActual  — замер на конкретную дату, НЕ «живая» фактическая цена
 *                       сегодня; провайдер мог поменять цены после замера;
 *   estimate          — оценочная величина (например, токенов на лист).
 *
 * Единицы названы явно: рубли, взвешенные токены в месяц, доллары за 1M
 * токенов, генерации в месяц.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАПУСК
 * ─────────────────────────────────────────────────────────────────────────────
 *   node --import tsx scripts/economics-inputs.mts > inputs.json
 *   python3 scripts/unit-economics.py --inputs inputs.json
 *
 * В stdout — только JSON. Диагностика — в stderr.
 */

import {
  PLANS,
  PLAN_IDS,
  priceFor,
  PERIODS,
  ACADEMIC_YEAR_MONTHS,
  FREE_GENERATIONS,
  TOKENS_PER_WORKSHEET,
} from "../src/lib/content/plans";
import {
  PLAN_NORM_PER_MONTH,
  FREE_TOTAL_GENERATIONS,
  ACADEMIC_YEAR_MONTHS as BACKEND_ACADEMIC_YEAR_MONTHS,
} from "../backend/src/services/usage";
import { MODEL_COSTS, REFERENCE_MODEL_ID } from "../backend/src/llm/config";
import {
  COST_PER_WORKSHEET_RUB,
  COST_PER_WORKSHEET_VERIFIED_RUB,
  COST_PER_CONTROL_RUB,
} from "../backend/src/services/pricing-cost";

/** Версия формата. Меняется, если структура JSON станет другой. */
const INPUTS_VERSION = 1;

type Label = "canonical" | "assumption" | "modelRate" | "historicalActual" | "estimate";

interface Labeled {
  label: Label;
  source: string;
}

/** Платы, у которых есть и помесячная цена, и учебный год. */
const PAID_PLAN_IDS = ["base", "standard", "plus"] as const;

const plans = PAID_PLAN_IDS.map((id) => {
  const plan = PLANS[id];
  const month = priceFor(id, "month");
  const year = priceFor(id, "academicYear");
  const norm = PLAN_NORM_PER_MONTH[id];
  return {
    id,
    name: plan.name,
    monthly: {
      amountRub: month.amount,
      unit: month.unit,
      perMonthRub: month.perMonth,
      label: "canonical" as Label,
      source: "src/lib/content/plans.ts → priceFor(plan, 'month')",
    },
    academicYear: {
      amountRub: year.amount,
      unit: year.unit,
      perMonthRub: year.perMonth,
      months: PERIODS.academicYear.months,
      fullAcademicYearAmountRub: year.fullAcademicYearAmount ?? null,
      academicYearDiscountPercent: year.academicYearDiscountPercent ?? null,
      label: "canonical" as Label,
      source: "src/lib/content/plans.ts → priceFor(plan, 'academicYear')",
    },
    normPerMonth: {
      value: norm,
      unit: "weighted tokens per month",
      label: "canonical" as Label,
      source: "backend/src/services/usage.ts → PLAN_NORM_PER_MONTH",
    },
  };
});

/** Школьный тариф — помесячный, учебного года у него нет. */
const schoolPlan = {
  id: "school",
  name: PLANS.school.name,
  monthly: {
    amountRub: priceFor("school", "month").amount,
    unit: priceFor("school", "month").unit,
    perMonthRub: priceFor("school", "month").perMonth,
    label: "canonical" as Label,
    source: "src/lib/content/plans.ts → priceFor('school', 'month')",
  },
  normPerMonth: {
    value: PLAN_NORM_PER_MONTH.base * 3,
    unit: "weighted tokens per month",
    label: "assumption" as Label,
    source:
      "backend/src/services/usage.ts → SCHOOL_NORM_PER_CLASS (норма класса = 3 × базовая, ориентир до пилота со школами)",
  },
};

const inputs = {
  version: INPUTS_VERSION,
  description:
    "Финансовые входы юнит-экономики УчЛист. Источник истины — код продукта; Python их только читает.",
  units: {
    money: "RUB",
    price: "rubles per billing period",
    norm: "weighted tokens per month",
    modelCost: "USD per 1M tokens",
    quota: "generations per month",
    share: "fraction (0.035 = 3,5 %)",
  },
  labels: {
    canonical: "значение взято из кода продукта — источник истины",
    assumption: "объявленное допущение, а не измерение",
    modelRate: "опубликованная цена модели, а не наша фактическая стоимость",
    historicalActual: "замер на конкретную дату; не «живая» цена сегодня",
    estimate: "оценочная величина, измерением не подтверждена",
  },
  academicYear: {
    months: PERIODS.academicYear.months,
    label: "canonical" as Label,
    source: "src/lib/content/plans.ts → PERIODS.academicYear.months",
    consistentWithBackend:
      PERIODS.academicYear.months === BACKEND_ACADEMIC_YEAR_MONTHS &&
      ACADEMIC_YEAR_MONTHS === PERIODS.academicYear.months,
  },
  free: {
    generationsPerMonth: FREE_TOTAL_GENERATIONS,
    frontendLabelGenerations: FREE_GENERATIONS,
    consistent: FREE_TOTAL_GENERATIONS === FREE_GENERATIONS,
    label: "canonical" as Label,
    source: "backend/src/services/usage.ts → FREE_TOTAL_GENERATIONS (лимит на стороне сервера)",
  },
  tokensPerWorksheet: {
    value: TOKENS_PER_WORKSHEET,
    unit: "weighted tokens per worksheet",
    label: "estimate" as Label,
    source:
      "src/lib/content/plans.ts → TOKENS_PER_WORKSHEET (оценка: измерением пока не подтверждена)",
  },
  plans,
  school: schoolPlan,
  modelCosts: {
    referenceModelId: REFERENCE_MODEL_ID,
    label: "modelRate" as Label,
    source: "backend/src/llm/config.ts → MODEL_COSTS (цены polza.ai в долларах за 1M токенов)",
    byModel: Object.fromEntries(
      Object.entries(MODEL_COSTS).map(([id, cost]) => [
        id,
        {
          inputPer1MUsd: cost.inputPer1M,
          outputPer1MUsd: cost.outputPer1M,
          cacheReadPer1MUsd: cost.cacheReadPer1M ?? null,
          cacheWritePer1MUsd: cost.cacheWritePer1M ?? null,
        },
      ]),
    ),
  },
  fx: {
    rubPerUsd: 85,
    label: "assumption" as Label,
    source:
      "backend/src/services/usage.ts → RUB_PER_USD (приватная константа 85; в комментариях к Sonnet встречается 86,2 — это разные допущения, здесь зафиксировано то, что используется в коде)",
  },
  paymentFee: {
    rate: 0.035,
    label: "assumption" as Label,
    source: "допущение расчёта: эквайринг 3,5 % (комиссия за СБП может отличаться)",
  },
  historicalActualCosts: {
    label: "historicalActual" as Label,
    measuredAt: "2026-10-18",
    source:
      "backend/src/services/pricing-cost.ts — списание провайдера из llm_costs_actual, замер независимого аудита 18.10.2026. Это исторический замер, а не «живая» цена сегодня",
    perWorksheetRub: COST_PER_WORKSHEET_RUB,
    perWorksheetVerifiedRub: COST_PER_WORKSHEET_VERIFIED_RUB,
    perControlRub: COST_PER_CONTROL_RUB,
  },
} satisfies Record<string, unknown>;

const meta: Labeled = { label: "canonical", source: "scripts/economics-inputs.mts" };
void meta;

process.stdout.write(`${JSON.stringify(inputs, null, 2)}\n`);

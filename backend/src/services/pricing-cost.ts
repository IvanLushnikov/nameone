/**
 * Себестоимость материала и потолок тарифа по ФАКТИЧЕСКИМ ценам.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ (аудит 18.10.2026, раздел 9.4 п.6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Внутри сервиса есть МОДЕЛЬ себестоимости: `RUB_PER_WEIGHTED_TOKEN` в
 * `services/usage.ts` считает норму тарифа по выходным токенам эталонной
 * модели Luna и по её прайсу (0,35 $/1M выхода × 85 ₽/$). Отсюда и взялась
 * цифра «2,4 млн токенов = 71,4 ₽ себестоимости нормы «Базового»».
 *
 * ФАКТИЧЕСКИЕ деньги провайдера — в 3,8 раза выше этой модели:
 *
 *   | задача              | модель            | вызовов | сумма, ₽ | среднее, ₽ |
 *   |---------------------|-------------------|---------|----------|-------------|
 *   | control-gen         | claude-sonnet-5-5 |    5    |  48,85   |    9,77     |
 *   | worksheet-gen       | gpt-6-luna        |   19    |   3,50   |    0,18     |
 *   | lesson-plan-gen     | gpt-6-luna        |    2    |   0,18   |    0,09     |
 *   | cards-gen           | gpt-6-luna        |    1    |   0,11   |    0,11     |
 *   | validate            | deepseek-v4-flash |    1    |   0,03   |    0,03     |
 *   | ИТОГО               |                   |   28    |  52,68   |             |
 *
 * Источник — таблица `llm_costs_actual`, поле `cost_rub`: это списание,
 * которое провёл провайдер, а не наша оценка по прайсу. Замер — независимого
 * аудита 18.10.2026 (UCHLIST_AUDIT_REPORT.md, раздел 9.2).
 *
 * Почему модель занижает в 3,8 раза: `RUB_PER_WEIGHTED_TOKEN` считает только
 * ВЫХОД эталонной модели по её прямой цене, а polza.ai — реселлер с наценкой,
 * и в счёт идёт ещё и вход. Норма тарифа (2,4 млн) при реальных ценах стоит
 * не 71,4 ₽, а 1500 × 0,18 = 270 ₽ — при выручке 249 ₽/мес. Это не «запас
 * на рост», это отрицательная маржа на полном расходе нормы.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЭТОТ ФАЙЛ ДЕЛАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Считает ПОТОЛОК ТАРИФА по фактической себестоимости: сколько листов
 * учитель может получить за месяц, чтобы маржа осталась не ниже целевой.
 *
 * Число возвращается, а не пишется в текст тарифа: менять цену и норму —
 * решение владельца (аудит, раздел 9.4 п.6: «вопрос к экономике тарифа
 * (нужна проверка владельцем, не утверждение)»). Здесь — считающий код,
 * чтобы решение принималось на числах, а не на ощущениях.
 */

/** Себестоимость одного рабочего листа, ₽. Замер: 19 вызовов, среднее 0,18. */
export const COST_PER_WORKSHEET_RUB = 0.18;

/**
 * Себестоимость листа С ПРОВЕРКОЙ, ₽.
 *
 * Проверка (validate, deepseek-v4-flash) стоит 0,03 ₽ за вызов. Учитель
 * запускает её сам, по кнопке «Проверить ответы», — то есть это осознанная
 * трата, а не обязательная часть материала. Поэтому два числа живут
 * отдельно: «лист» и «лист, проверенный учителем».
 */
export const COST_PER_WORKSHEET_VERIFIED_RUB = COST_PER_WORKSHEET_RUB + 0.03;

/** Себестоимость контрольной работы (2 варианта), ₽. Замер: 5 вызовов, 9,77. */
export const COST_PER_CONTROL_RUB = 9.77;

/**
 * Сколько обычных листов приходится на одну контрольную.
 *
 * Взят из сценария владельца (docs/35-price-cut-margin-2026-10-12.md):
 * 20 уроков в неделю, контрольная — раз в месяц. Число влияет на среднюю
 * себестоимость материала: контрольная дороже листа в 54 раза.
 */
export const WORKSHEETS_PER_CONTROL = 20;

/** Целевая маржа тарифа, доля выручки. Тот же ориентир, что в планах. */
export const TARGET_MARGIN = 0.7;

/**
 * Средняя себестоимость ОДНОГО материала в месяч-микс.
 *
 * Учитель за месяц делает `worksheets` листов и `controls` контрольных.
 * Смешанная себестоимость нужна, потому что считать потолок только по
 * листам — это считать потолок по самому дешёвому материалу; а считать
 * только по контрольным — по самому дорогому.
 */
export function mixedCostPerMaterialRub(args: {
  worksheets: number;
  controls: number;
}): number {
  const { worksheets, controls } = args;
  const total = worksheets + controls;
  if (total <= 0) return COST_PER_WORKSHEET_RUB;
  return (
    (worksheets * COST_PER_WORKSHEET_RUB + controls * COST_PER_CONTROL_RUB) / total
  );
}

/**
 * Потолок тарифа по фактической себестоимости.
 *
 * @param priceRub цена тарифа за месяц, ₽
 * @param targetMargin целевая маржа (0.7 = 70 %)
 * @param costPerMaterialRub себестоимость одного материала, ₽
 * @returns сколько материалов учитель может получить за месяц без ухода
 *          в отрицательную маржу
 */
export function sustainableMaterialsPerMonth(args: {
  priceRub: number;
  targetMargin?: number;
  costPerMaterialRub: number;
}): number {
  const targetMargin = args.targetMargin ?? TARGET_MARGIN;
  const allowedCost = args.priceRub * (1 - targetMargin);
  if (args.costPerMaterialRub <= 0) return 0;
  return Math.floor(allowedCost / args.costPerMaterialRub);
}

/**
 * Потолок тарифа «Базового» в листах — с учётом месячного микса.
 *
 * 249 ₽/мес, маржа 70 % → можно потратить 74,7 ₽.
 *
 *   - только листы:                 74,7 / 0,18 = 415 листов
 *   - листы с проверкой:            74,7 / 0,21 = 355 листов
 *   - микс 20 листов + 1 контрольная: 74,7 / 0,637 ≈ 117 материалов
 *
 * Обещанное в тарифе — 1 500 листов. Разница в 3,6 раза.
 */
export function basePlanCeiling(args: {
  priceRub: number;
  /** Учитель проверяет ответы (кнопка «Проверить ответы»). */
  withVerification?: boolean;
  /** Учитель делает контрольные (раз в месяц). */
  withControl?: boolean;
}): { materials: number; costPerMaterialRub: number } {
  const withVerification = args.withVerification ?? false;
  const withControl = args.withControl ?? false;
  const costPerWorksheet = withVerification
    ? COST_PER_WORKSHEET_VERIFIED_RUB
    : COST_PER_WORKSHEET_RUB;
  // Микс: 20 листов и одна контрольная на 21 материал.
  const worksheets = withControl ? WORKSHEETS_PER_CONTROL : 1;
  const controls = withControl ? 1 : 0;
  const costPerMaterialRub = withControl
    ? mixedCostPerMaterialRub({ worksheets, controls })
    : costPerWorksheet;
  return {
    materials: sustainableMaterialsPerMonth({
      priceRub: args.priceRub,
      costPerMaterialRub,
    }),
    costPerMaterialRub,
  };
}

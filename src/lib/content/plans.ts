/**
 * ЕДИНЫЙ ИСТОЧНИК ТАРИФНЫХ ДАННЫХ.
 *
 * До этого файла цены были зашиты в шести местах (pricing, PricingTeaser,
 * лендинг-FAQ, PaywallModal, страница ОГЭ, публичная оферта) и разошлись
 * между собой. Теперь все шесть читают значения отсюда.
 *
 * Календарного года (12 месяцев) в продукте НЕТ — учительница верно заметила,
 * что реально учебный год занимает 8–9 месяцев (в январе каникулы). Есть
 * ровно два периода: «учебный год» и «помесячно».
 */

export type PeriodId = "academicYear" | "month";
export type PlanId = "free" | "base" | "plus" | "school";

/**
 * Длительность учебного года.
 *
 * Учебный год = 9 месяцев подряд. Старт НЕ привязан к календарю
 * («сентябрь–май»): отсчёт идёт от даты оплаты, поэтому оплатив 15 октября
 * учитель получает доступ до 15 июля. Это осознанное решение — летом платить
 * не нужно, а «учебный год» должен совпадать с реальным рабочим временем
 * учителя, а не с календарём.
 */
export const ACADEMIC_YEAR_MONTHS = 9;

/** Подпись под переключателем периодов — объясняет, зачем нужен учебный год. */
export const ACADEMIC_YEAR_NOTE =
  "Учебный год — 9 месяцев подряд. Летом платить не нужно";

export const DEFAULT_PERIOD: PeriodId = "academicYear";

export const PERIODS: Record<
  PeriodId,
  {
    id: PeriodId;
    /** Название кнопки переключателя. */
    label: string;
    /** Подпись под переключателем. */
    note: string;
    months: number;
  }
> = {
  academicYear: {
    id: "academicYear",
    label: `Учебный год (${ACADEMIC_YEAR_MONTHS} мес)`,
    note: `${ACADEMIC_YEAR_NOTE}. Старт — от даты оплаты`,
    months: ACADEMIC_YEAR_MONTHS,
  },
  month: {
    id: "month",
    label: "Помесячно",
    note: "Оплата по месяцам, отмена в любой момент",
    months: 1,
  },
};

export const PERIOD_IDS: PeriodId[] = ["academicYear", "month"];

/**
 * Цена одного тарифа в одном периоде.
 * Никаких строк с цифрами в UI — всё собирается из чисел ниже.
 */
export type PlanPrice = {
  /** Сумма, которую платит пользователь: 3800 / 500 / 11000 / 1500. */
  amount: number;
  /** Что означает сумма: "за учебный год (9 мес)" / "в месяц". */
  unit: string;
  /** Сколько это в месяц — для честных сравнений (422 при 3 800 ₽ за 9 мес). */
  perMonth: number | null;
  /** Цена без скидки за те же 9 месяцев — нужна для честной формулировки скидки. */
  fullAcademicYearAmount?: number;
  /** Размер скидки в процентах (считается от 9 месяцев по помесячной цене). */
  academicYearDiscountPercent?: number;
};

/** У тарифа может не быть одного из периодов (у «Школы» нет учебного года). */
export type PlanPrices = {
  academicYear: PlanPrice | null;
  month: PlanPrice;
};

export type Plan = {
  id: PlanId;
  name: string;
  /** Описание для карточки тарифа. */
  description: string;
  /** Короткое описание для PaywallModal. */
  shortDescription: string;
  features: string[];
  cta: string;
  href: string;
  highlight: boolean;
  accent: string;
  /** Показывать ли карточку в лендинге (School — только на /pricing#b2b). */
  inTeaser: boolean;
  /** Тариф ещё не запущен — кнопка disabled. */
  comingSoon?: string;
  /** Подсветка в PaywallModal (на лендинге подсвечен другой тариф). */
  paywallAccent?: boolean;
  prices: PlanPrices;
  /**
   * Норма тарифа на МЕСЯЦ в взвешенных токенах (единица потребления).
   *
   * Что это такое: токены, приведённые к эталонной модели Luna. Один токен на
   * Luna = 1, на Sonnet ≈ 39, на Opus ≈ 79. Так счёт совпадает с
   * себестоимостью до копейки, но остаётся одной линейной единицей, которую
   * можно складывать. Расчёт — backend/src/services/usage.ts (PLAN_NORM_PER_MONTH),
   * экономика обоснования — docs/04-pricing-economics-v2.md §7.1.
   *
   * `null` = тариф не считается по токенам (free — квота в штуках генераций,
   * school — норма на класс появится вместе с запуском в Q1 2027).
   *
   * Показываем именно токены (решение владельца продукта) + подпись «≈ N листов»
   * в нормах. Голые токены без пояснения — риск отказа: учитель не обязан
   * понимать внутреннюю единицу. Если за первые 100 платящих выяснится, что
   * подписи не хватает, единицу переключают одной константой.
   */
  normPerMonth: number | null;
  /** Норма за месяц в копейках, только для справки в оферте. */
  costPerNormRub: number | null;
};

/**
 * Сколько взвешенных токенов в одном листе-домашки (10 заданий с ответами).
 * Backend использует ту же константу (TOKENS_PER_WORKSHEET) — расходиться не должны.
 */
export const TOKENS_PER_WORKSHEET = 1_600;

/**
 * Бесплатная квота: генераций ВСЕГО, без ежедневного сброса.
 *
 * Зеркалит `FREE_TOTAL_GENERATIONS` в backend/src/services/usage.ts. Раньше
 * квота жила в localStorage и сбрасывалась в полночь, поэтому одинаковые
 * «3 генерации» на лендинге, в модалке и в бэке означали разное. Теперь
 * число одно, а счёт ведёт сервер.
 */
export const FREE_GENERATIONS = 3;

/**
 * Подпись бесплатной квоты для интерфейса — ОДНА на весь продукт.
 *
 * Периода у квоты нет (счёт серверный, без суточного окна), поэтому в текстах
 * нигде не пишем «в день» / «ежедневно»: только «3 бесплатные генерации».
 * Читают эту строку лендинг, /pricing, FAQ и тарифные карточки.
 */
export const FREE_QUOTA_LABEL = `${FREE_GENERATIONS} бесплатные генерации`;

/**
 * Квоты F-06.1 «Вопросы для беседы» — наборов вопросов в месяц (TZ-17 §5.6).
 *
 * Считается ОТДЕЛЬНО от квоты проверки по фото: картинка не отправляется заново,
 * LLM-вызов текстовый и стоит 0,009–0,015 ₽. Даже 50 наборов на «Базовом» —
 * меньше рубля в месяц при тарифе в 500 ₽, поэтому ограничение нужно только для
 * защиты от злоупотребления.
 *
 * Зеркалит `INTERVIEW_QUESTION_LIMITS` в backend/src/routes/f06.ts.
 */
export const INTERVIEW_QUOTA_PER_MONTH: Record<
  "free" | "base" | "plus",
  number
> = {
  free: 5,
  base: 50,
  plus: 200,
};

/**
 * «Вопросы для беседы по фото: 50 наборов в месяц» — строка на тарифную карточку.
 *
 * Раньше строка была «50 наборов вопросов для беседы в месяц» — без привязки
 * к функции выглядела как остаток чужого прайса. Квота реальная (зеркалит
 * `INTERVIEW_QUESTION_LIMITS` в backend/src/routes/f06.ts), поэтому в названии
 * строки сказано, к чему она относится. Подменять её на «листов в месяц» нельзя:
 * числа листов в тарифе нет, а обещание без проверки — это то, что здесь чиним.
 */
export function interviewQuotaLabel(planId: "free" | "base" | "plus"): string {
  return `Вопросы для беседы по фото: ${INTERVIEW_QUOTA_PER_MONTH[planId]} наборов в месяц`;
}

/**
 * Канонические названия артефактов.
 *
 * Раньше в тарифах, таблице сравнения и FAQ один и тот же артефект назывался
 * по-разному («планы урока», «Планы уроков по ФГОС», «презентации PPTX»,
 * «КТП на год»). Здесь одно имя на артефакт — как в конструкторе
 * (см. ARTIFACT_TYPE_OPTIONS в ArtifactTypePicker).
 */
export const ARTIFACT_NAMES = {
  worksheet: "Рабочий лист",
  test: "Тест",
  cards: "Карточки",
  control: "Контрольная",
  lessonPlan: "План урока",
  presentation: "Презентация",
  ktp: "КТП",
} as const;

/** «1 440 000» → «1,44 млн». Токены длинные, в UI читаются млн. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2).replace(".", ",")} млн`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)} тыс.`;
  return String(n);
}

/**
 * Норма тарифа для интерфейса и FAQ.
 *
 * Токены идут ВТОРОЙ строкой, а не единственной: учитель не обязан понимать
 * внутреннюю единицу, а «1,44 млн токенов» без перевода выглядит как
 * «лимит закончится на второй неделе». Сначала — понятные листы.
 */
export function normLabel(planId: PlanId): string {
  const norm = PLANS[planId].normPerMonth;
  if (norm == null) return "Без ограничения по объёму";
  return `${tokensToWorksheetsLabel(norm)} в месяц (это ${formatTokens(norm)} токенов)`;
}

/** «≈ 900 рабочих листов» — понятная подпись к токенам. */
export function tokensToWorksheetsLabel(tokens: number): string {
  return `до ${Math.round(tokens / TOKENS_PER_WORKSHEET)} рабочих листов`;
}

const ACADEMIC_YEAR_UNIT = `за учебный год (${ACADEMIC_YEAR_MONTHS} мес)`;
const MONTH_UNIT = "в месяц";
const SCHOOL_MONTH_UNIT = "в месяц за класс";

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Бесплатно",
    description: "Попробовать и понять, нужно ли",
    shortDescription: `${FREE_QUOTA_LABEL}, без карты`,
    features: [
      FREE_QUOTA_LABEL,
      "Все предметы, 1–11 классов",
      "PDF с ответами и пояснениями",
      interviewQuotaLabel("free"),
      "Без регистрации",
    ],
    cta: "Начать бесплатно",
    href: "/constructor",
    highlight: false,
    accent: "from-warm-300 to-warm-500",
    inTeaser: true,
    // Бесплатный тариф считаем в штуках генераций, а не в токенах:
    // их всего три, и токены учителю ничего не объяснят.
    normPerMonth: null,
    costPerNormRub: null,
    prices: {
      academicYear: { amount: 0, unit: "навсегда", perMonth: 0 },
      month: { amount: 0, unit: "навсегда", perMonth: 0 },
    },
  },
  base: {
    id: "base",
    name: "Базовый",
    description: "Для репетиторов и родителей",
    shortDescription: "Для репетиторов и родителей",
    features: [
      // Список во множественном числе — ARTIFACT_NAMES здесь не подходит
      // (там имена в единственном: «Тест», «План урока»).
      "Рабочие листы, тесты, карточки, планы уроков",
      "История и шаблоны",
      "Избранное и сохранённые настройки",
      "Лимит: до 900 рабочих листов в месяц (внутренняя единица — 1,44 млн токенов)",
      interviewQuotaLabel("base"),
      "Учеников: 5",
      "Членов семьи: до 5 человек",
    ],
    cta: "Оформить подписку",
    href: "/pricing",
    highlight: true,
    accent: "from-brand-400 via-brand-500 to-brand-600",
    inTeaser: true,
    // 1 440 000 × 0,00002921 ₽ = 42 ₽ себестоимости при выручке 422 ₽/мес → 90% маржа.
    normPerMonth: 1_440_000,
    costPerNormRub: 42,
    prices: {
      // 9 месяцев по 500 ₽ = 4500 ₽, платим 3800 ₽ → −15,5% (обе цифры в UI).
      academicYear: {
        amount: 3800,
        unit: ACADEMIC_YEAR_UNIT,
        perMonth: Math.round(3800 / ACADEMIC_YEAR_MONTHS),
        fullAcademicYearAmount: 4500,
        academicYearDiscountPercent: 15.5,
      },
      month: { amount: 500, unit: MONTH_UNIT, perMonth: 500 },
    },
  },
  plus: {
    id: "plus",
    name: "Плюс",
    description: "Всё для урока: листы, планы, презентации, КТП, ОГЭ/ЕГЭ",
    shortDescription: "Подготовка к ОГЭ/ЕГЭ",
    features: [
      "Всё из Базового",
      `${ARTIFACT_NAMES.lessonPlan} по ФГОС`,
      `${ARTIFACT_NAMES.presentation} и ${ARTIFACT_NAMES.ktp}`,
      "Варианты ОГЭ/ЕГЭ с разбором",
      `${ARTIFACT_NAMES.control} с критериями оценивания`,
      interviewQuotaLabel("plus"),
      "Ранний доступ к новым темам и предметам",
    ],
    cta: "Выбрать Плюс",
    href: "/pricing",
    highlight: false,
    accent: "from-accent-400 to-accent-600",
    inTeaser: true,
    paywallAccent: true,
    // 16 000 000 × 0,00002921 ₽ = 467 ₽ при выручке 1 222 ₽/мес → 62% маржа.
    // Норма с запасом покрывает учителя, который генерирует домашку на КАЖДЫЙ урок
    // (24 урока/нед ≈ 14,9 млн в месяц).
    normPerMonth: 16_000_000,
    costPerNormRub: 467,
    prices: {
      // 9 × 1 500 ₽ = 13 500 ₽, платим 11 000 ₽ → 18,5% (оба числа показаны честно).
      academicYear: {
        amount: 11000,
        unit: ACADEMIC_YEAR_UNIT,
        perMonth: Math.round(11000 / ACADEMIC_YEAR_MONTHS),
        fullAcademicYearAmount: 13500,
        academicYearDiscountPercent: 18.5,
      },
      month: { amount: 1500, unit: MONTH_UNIT, perMonth: 1500 },
    },
  },
  school: {
    id: "school",
    name: "Школа",
    description: "Админка учителя, кабинеты учеников, отчёты по классу",
    shortDescription: "Для образовательных учреждений",
    features: [
      "Админка учителя с отчётами",
      "Личные кабинеты учеников",
      "Отслеживание прогресса по темам",
      "Шаблоны для контрольных",
      "Интеграция со Сферум / Moodle",
      "Без ограничения по числу учеников в классе",
      "Готовые КТП для администрации",
    ],
    cta: "Скоро · запуск в I квартале 2027",
    href: "/pricing#b2b",
    highlight: false,
    accent: "from-warm-300 to-warm-500",
    inTeaser: false,
    comingSoon: "I квартал 2027",
    // Ориентир: 3 × базовая норма на класс. Реальное число — после пилота
    // с 2–3 школами; ученикам генерация не выдаётся, платит учитель.
    normPerMonth: 4_320_000,
    costPerNormRub: 126,
    // Ориентир: 3 000 ₽/мес за класс (в прежней версии встречалось
    // «3 000 ₽/класс» — это читалось как «за весь год», уточнили).
    prices: {
      academicYear: null, // у класса нет учебного года — тариф помесячный
      month: { amount: 3000, unit: SCHOOL_MONTH_UNIT, perMonth: 3000 },
    },
  },
};

export const PLAN_IDS: PlanId[] = ["free", "base", "plus", "school"];

/** 3 800 → «3 800 ₽» (неразрывный пробел, чтобы не рвалось переносом). */
export function formatRub(amount: number): string {
  return `${amount.toLocaleString("ru-RU")}\u00A0₽`;
}

/**
 * Цена тарифа в периоде. Для тарифа без учебного года (Школа) отдаём месячный.
 */
export function priceFor(planId: PlanId, periodId: PeriodId): PlanPrice {
  const plan = PLANS[planId];
  const price = plan.prices[periodId];
  return price ?? plan.prices.month;
}

/** «3 800 ₽ за учебный год (9 мес)» / «500 ₽ в месяц» / «3 000 ₽ в месяц за класс». */
export function priceLabel(planId: PlanId, periodId: PeriodId): string {
  const p = priceFor(planId, periodId);
  return `${formatRub(p.amount)} ${p.unit}`;
}

/** Короткая запись для переключателей и таблиц: «500 ₽/мес», «3 800 ₽/9 мес». */
export function priceShort(planId: PlanId, periodId: PeriodId): string {
  const p = priceFor(planId, periodId);
  // У «Школы» учебного года нет — не пишем «3 000 ₽/9 мес».
  const isYear = periodId === "academicYear" && PLANS[planId].prices.academicYear != null;
  if (p.perMonth == null) return formatRub(p.amount);
  if (isYear && planId !== "free") {
    return `${formatRub(p.amount)}/${PERIODS.academicYear.months} мес`;
  }
  if (planId === "school") return `${formatRub(p.amount)}/мес за класс`;
  return `${formatRub(p.amount)}/мес`;
}

/** Строка для таблицы сравнения: «500 ₽/мес · 3 800 ₽ за учебный год». */
export function priceSummary(planId: PlanId): string {
  if (planId === "free") return formatRub(0);
  if (planId === "school") return priceShort("school", "month");
  const month = priceShort(planId, "month");
  const year = priceLabel(planId, "academicYear");
  return `${month} · ${year}`;
}

/**
 * Честная строка под скидку — сравнение с тем, что вышло бы помесячно.
 * «на 15,5 % дешевле, чем 500 ₽ × 9 месяцев».
 *
 * Раньше здесь было «3 800 ₽ вместо 4 500 ₽ за 9 месяцев»: учитель видел
 * вторую сумму, но не понимал, откуда она. Теперь видно, что 4 500 ₽ — это
 * ровно 9 × 500 ₽ по помесячному тарифу.
 */
export function academicYearSaving(planId: PlanId): string | null {
  const p = priceFor(planId, "academicYear");
  if (p.fullAcademicYearAmount == null || p.academicYearDiscountPercent == null) {
    return null;
  }
  const months = PERIODS.academicYear.months;
  const monthPrice = Math.round(p.fullAcademicYearAmount / months);
  const percent = String(p.academicYearDiscountPercent).replace(".", ",");
  return `на ${percent} % дешевле, чем ${formatRub(monthPrice)} × ${months} месяцев`;
}

/** Максимальная скидка за учебный год — для бейджа на переключателе периодов. */
export function maxAcademicYearDiscount(): string {
  const percents = PLAN_IDS.map((id) => priceFor(id, "academicYear").academicYearDiscountPercent)
    .filter((v): v is number => v != null);
  const max = Math.max(...percents);
  return String(max).replace(".", ",");
}

/**
 * Текст раздела «Стоимость и порядок оплаты» для публичной оферты.
 * Формулировки — юридические, цифры и названия тарифов — из этого файла.
 */
export function legalPricingSentence(): string {
  const baseMonth = priceLabel("base", "month");
  const baseYear = priceLabel("base", "academicYear");
  const plusMonth = priceLabel("plus", "month");
  const plusYear = priceLabel("plus", "academicYear");
  return (
    `Стоимость подписки: тариф «${PLANS.base.name}» — ${baseMonth} или ${baseYear}; ` +
    `тариф «${PLANS.plus.name}» — ${plusMonth} или ${plusYear}. ` +
    // Тариф «Школа» (запуск в 2027) в оферту не входит: обещать в юридическом
    // документе то, что ещё не продаётся, нельзя. Остальные формулировки —
    // реальный порядок денег по ТЗ-20 §3.
    `Оплата через ЮKassa, СБП или банковские карты. ` +
    // Списание сейчас разовое за выбранный период; автоматического продления
    // ещё нет, поэтому в оферте его обещать нельзя — учитель должен видеть,
    // что «отмена» означает отказ от будущей оплаты, а не возврат уже внесённого.
    `Оплата списывается единовременно за выбранный период подписки, доступ действует ` +
    `до его окончания. Автоматического списания в следующем периоде сейчас нет: ` +
    `продление выполняется новой оплатой, а отказаться от неё можно до её проведения. ` +
    `Пользователь вправе отказаться от подписки в любой момент в личном кабинете — ` +
    `оплаченный период при этом доиграется до конца. ` +
    `Возврат средств в течение 7 дней.`
  );
}

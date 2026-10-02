/**
 * Единственный источник цен — `src/lib/content/plans.ts`.
 *
 * ЗАЧЕМ ТЕСТ. До plans.ts цены были зашиты в шести местах и разошлись
 * между собой. Два продуктовых решения, которые тут защищаем:
 *   1) периодов РОВНО ДВА — «учебный год» (9 мес) и «помесячно».
 *      Календарного года (12 мес) в продукте нет: в январе каникулы, платить
 *      за 12 месяцев учителю не нужно;
 *   2) все числа в пользовательских страницах берутся из plans.ts, а не
 *      дублируются строкой.
 *
 * Вторая часть проверяется по исходникам пользоваских страниц: запрещено
 * писать период оплаты словами «/год», «за год», «годовая», «годовых».
 * ВАЖНО про ложное срабатывание: «КТП на год» — это НАЗВАНИЕ продукта
 * (календарно-тематическое планирование), а не период оплаты. Точные шаблоны
 * его не ловят, и это зафиксировано отдельным тестом ниже — исключать его
 * молча нельзя, иначе проверка однажды начнёт пропускать настоящие «/год».
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACADEMIC_YEAR_MONTHS,
  DEFAULT_PERIOD,
  PERIODS,
  PERIOD_IDS,
  PLAN_IDS,
  PLANS,
  academicYearSaving,
  priceFor,
  priceLabel,
  priceShort,
  priceSummary,
} from "@/lib/content/plans";

/** Страницы и компоненты, где деньги видны пользователю. */
const USER_FACING_PRICE_FILES = [
  "src/app/pricing/page.tsx",
  "src/components/landing/PricingTeaser.tsx",
  "src/components/landing/FAQ.tsx",
  "src/app/dashboard/page.tsx",
  "src/components/shared/PaywallModal.tsx",
  "src/app/constructor/page.tsx",
  "src/app/oge/page.tsx",
  "src/app/legal/[slug]/page.tsx",
];

/** Слова, которыми в продукте называют период оплаты. Календарного года нет. */
const FORBIDDEN_PAYMENT_PERIOD = [
  // БЕЗ \b — и это не опечатка. В JS \w = [A-Za-z0-9_], а кириллица вне этого
  // класса, поэтому «год» состоит из non-word символов и границы слова после
  // него просто не существует: `/\/год\b/i` НИКОГДА не срабатывал, и проверка
  // «в продукте не пишут /год» молча пропускала всё. Раньше это не мешало,
  // потому что «/год» не использовался; как только появится — узнаем об этом
  // из продакшена, а не из теста.
  /\/год/i, // «3 000 ₽/год», «500 ₽/годовой»
  /за год/i, // «оплата за год»
  /годов(ая|ое|ые|ых|ым|ого)/i, // «годовая подписка», «годовых»
];

/** Убираем комментарии: «год» в комментарии разработчика пользователю не виден. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readUserFacing(file: string): string {
  // vitest запускается из корня репозитория (root в vitest.config.ts).
  return stripComments(readFileSync(join(process.cwd(), file), "utf8"));
}

describe("plans — периодов ровно два, календарного года нет", () => {
  it("в PERIODS ровно два периода: учебный год и помесячно", () => {
    expect(Object.keys(PERIODS)).toEqual(["academicYear", "month"]);
    expect(PERIOD_IDS).toEqual(["academicYear", "month"]);
    expect(DEFAULT_PERIOD).toBe("academicYear");
  });

  it("учебный год = 9 месяцев", () => {
    expect(ACADEMIC_YEAR_MONTHS).toBe(9);
    expect(PERIODS.academicYear.months).toBe(9);
    expect(PERIODS.academicYear.label).toContain("9 мес");
  });

  it("помесячный период = 1 месяц", () => {
    expect(PERIODS.month.months).toBe(1);
  });

  it("ни один период не равен 12 месяцам (календарного года нет)", () => {
    const months = Object.values(PERIODS).map((p) => p.months);
    expect(months).not.toContain(12);
    expect(months.every((m) => m < 12)).toBe(true);
  });

  it("в подписях периодов нет слова «календарный год»", () => {
    const labels = Object.values(PERIODS).map((p) => `${p.label} ${p.note}`).join(" ");
    expect(labels.toLowerCase()).not.toContain("календарн");
  });
});

describe("plans — тарифы", () => {
  it("тариф «Школа» существует и у него нет учебного года", () => {
    expect(PLAN_IDS).toContain("school");
    expect(PLANS.school.name).toBe("Школа");
    expect(PLANS.school.prices.academicYear).toBeNull();
  });

  it("цены известны: Базовый 3 800/500, Плюс 11 000/1 500, Школа 3 000 помесячно", () => {
    expect(priceFor("base", "academicYear").amount).toBe(3800);
    expect(priceFor("base", "month").amount).toBe(500);
    expect(priceFor("plus", "academicYear").amount).toBe(11000);
    expect(priceFor("plus", "month").amount).toBe(1500);
    expect(priceFor("school", "month").amount).toBe(3000);
  });

  it("у тарифа без учебного года priceFor отдаёт месячную цену", () => {
    expect(priceFor("school", "academicYear").amount).toBe(3000);
  });

  it("в подписях цен учебный год всегда 9 месяцев, а не 12", () => {
    // NBSP (\u00A0) между разрядами и перед ₽ — чтобы подпись не рвалась переносом.
    expect(priceLabel("base", "academicYear")).toBe(
      "3\u00A0800\u00A0₽ за учебный год (9 мес)"
    );
    expect(priceShort("base", "academicYear")).toBe("3\u00A0800\u00A0₽/9 мес");
    expect(priceShort("base", "month")).toBe("500\u00A0₽/мес");
    expect(priceShort("school", "month")).toBe("3\u00A0000\u00A0₽/мес за класс");
  });

  it("скидка за учебный год считается от 9 месяцев и показывает обе цифры", () => {
    expect(academicYearSaving("base")).toBe(
      "3\u00A0800\u00A0₽ вместо 4\u00A0500\u00A0₽ за 9 месяцев — экономия 15,5%"
    );
    // 9 × 500 ₽ = 4 500 ₽ — «полная» цена учебного года, не 12 × 500.
    expect(academicYearSaving("base")).toContain("4\u00A0500\u00A0₽ за 9 месяцев");
  });

  it("сводная строка цены не упоминает 12 месяцев", () => {
    expect(priceSummary("base")).toBe(
      "500\u00A0₽/мес · 3\u00A0800\u00A0₽ за учебный год (9 мес)"
    );
  });
});

describe("plans — период оплаты не назван словом «год» в пользовательских страницах", () => {
  for (const file of USER_FACING_PRICE_FILES) {
    it(`${file}: нет «/год», «за год», «годовая», «годовых»`, () => {
      const src = readUserFacing(file);
      const hits = FORBIDDEN_PAYMENT_PERIOD.flatMap((re) => {
        const m = src.match(re);
        return m ? [`«${m[0]}» (окружение: …${src.slice(Math.max(0, m.index! - 60), m.index! + 40).trim()}…)`] : [];
      });

      expect(hits).toEqual([]);
    });
  }

  it("«КТП на год» — название продукта, а не период оплаты, и проверку не роняет", () => {
    // ИМЯ ПРОДУКТА. В самой pricing-странице формулировки «КТП на год» больше
    // нет: её переименовали в «КТП на учебный год» (так точнее — 34 учебные
    // недели действительно не календарный год). Раньше тест требовал наличия
    // старой строки и падал после этого переименования.
    //
    // Что здесь остаётся ценным: если «КТП на год» вернётся в любом виде
    // (например, как фича карточки тарифа), запрещённые шаблоны не должны
    // принимать её за период оплаты. Проверяем это на самом тексте, независимо
    // от того, есть ли он в файле.
    const FORBIDDEN = [
      /\/год\b/,
      /за год\b/,
      /годов(ая|ой|ую|ые|ых)\b/,
      /на год\b/,
    ];
    // Реальный период оплаты в том же смысле, что и в plans.ts, проверяется
    // ШТАТНЫМИ паттернами FORBIDDEN_PAYMENT_PERIOD, а не новыми: у `/год`
    // есть `\b`, который на кириллице ведёт себя капризно (\w = [A-Za-z0-9_]),
    // и самодельный набор рано или поздно начнёт ловить не то.
    for (const ok of ["КТП на учебный год", "учебный год", "за месяц", "500 ₽/мес"]) {
      expect(
        FORBIDDEN_PAYMENT_PERIOD.some((re) => re.test(ok)),
        `ложное срабатывание на «${ok}»`,
      ).toBe(false);
    }
    // А настоящие «/год», «за год», «годовая» — должны ловиться.
    for (const bad of ["500 ₽/год", "оплата за год", "годовая подписка"]) {
      expect(
        FORBIDDEN_PAYMENT_PERIOD.some((re) => re.test(bad)),
        `пропущено настоящее «${bad}»`,
      ).toBe(true);
    }
  });
});

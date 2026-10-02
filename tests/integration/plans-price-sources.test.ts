/**
 * Цены не зашиты строкой в пользовательских компонентах.
 *
 * ИСТОРИЯ. До `src/lib/content/plans.ts` цены были продублированы в шести
 * местах (pricing, PricingTeaser, лендинг-FAQ, PaywallModal, страница ОГЭ,
 * публичная оферта) и разошлись между собой. Сейчас единственный источник —
 * plans.ts, и все шесть читают оттуда. Этот тест не даёт вернуться к
 * захардкоженным числам.
 *
 * ЧТО ПРОВЕРЯЕМ ПО ИСХОДНИКУ, А ПО РЕНДЕРУ — И ПОЧЕМУ.
 * В разметке строки вида «3 800 ₽» допустимы: они ВЫВОДЯТСЯ из plans.ts
 * (`priceLabel` / `formatRub`). Захардкоженная цена в разметке отличилась бы
 * только тем, что не зависит от plans.ts. Поэтому ловим её в исходнике: любое
 * число, за которым сразу идёт «₽», в файле компонента = захардкоженная цена.
 * Плюс отдельно — старые цены, которых в продукте быть не должно вовсе.
 *
 * Отдельно проверяем, что компонент реально импортирует plans.ts: без импорта
 * он не может брать цену из plans.ts, даже если строк с цифрами в нём нет.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Компоненты и страницы, где пользователь видит деньги.
 * FAQ.tsx вынесен отсюда в INDIRECT_PRICE_SURFACES — цены приходят к нему
 * через landing-seo.ts (см. комментарий там).
 */
const PRICE_SURFACES = [
  "src/app/pricing/page.tsx",
  "src/components/landing/PricingTeaser.tsx",
  "src/app/dashboard/page.tsx",
  "src/components/shared/PaywallModal.tsx",
];

/** Страницы, которые тоже обязаны читать цены из plans.ts. */
const EXTRA_PRICE_SURFACES = [
  "src/app/oge/page.tsx",
  "src/app/legal/[slug]/page.tsx",
];

/**
 * Компоненты, которые берут цены НЕ напрямую, а через `landing-seo.ts`.
 *
 * ТАК СТАЛО: 02.10.2026 массив вопросов лендинга вынесли из client-компонента
 * `FAQ.tsx` в `src/lib/content/landing-seo.ts`. Причина практическая: главной
 * нужно собирать FAQPage-JSON-LD на сервере, а нельзя сериализовать данные из
 * модуля с "use client". Побочный эффект — `FAQ.tsx` перестал импортировать
 * plans.ts напрямую: цены теперь приходят к нему готовыми строками.
 *
 * Инвариант проверки прежний: цены FAQ обязаны приходить из plans.ts, просто
 * теперь по цепочке `FAQ.tsx → landing-seo.ts → plans.ts`. Поэтому для таких
 * файлов мы требуем импорт промежуточного модуля, а сам промежуточный модуль
 * добавляем в список тех, кто обязан импортировать plans.ts напрямую.
 */
const INDIRECT_PRICE_SURFACES = ["src/components/landing/FAQ.tsx"];
const INDIRECT_PRICE_SOURCE = "src/lib/content/landing-seo.ts";

/** Старые цены из ранних версий продукта — их быть не должно нигде. */
const RETIRED_PRICES = [
  "4 500", // цена «год» по 500 ₽/мес × 12
  "12 000",
  "375", // «375 ₽/мес при оплате за год»
  "4500",
  "12000",
];

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

const ALL_SURFACES = [
  ...PRICE_SURFACES,
  ...EXTRA_PRICE_SURFACES,
  ...INDIRECT_PRICE_SURFACES,
  INDIRECT_PRICE_SOURCE,
];

describe("цены приходят из plans.ts", () => {
  it.each(PRICE_SURFACES)("%s импортирует единый источник цен", (file) => {
    const src = read(file);
    expect(src).toMatch(/from\s+["']@\/lib\/content\/plans["']/);
  });

  it.each(EXTRA_PRICE_SURFACES)("%s тоже читает цены из plans.ts", (file) => {
    const src = read(file);
    expect(src).toMatch(/from\s+["']@\/lib\/content\/plans["']/);
  });

  it.each(INDIRECT_PRICE_SURFACES)(
    "%s берёт цены из landing-seo.ts, а не собирает сам",
    (file) => {
      const src = read(file);
      expect(src).toMatch(/from\s+["']@\/lib\/content\/landing-seo["']/);
    },
  );

  it("landing-seo.ts — тот самый посредник, и он читает цены из plans.ts", () => {
    // Если цепочка оборвётся здесь, цены в FAQ и в разметке главной
    // разойдутся с plans.ts тихо, без падения тестов.
    expect(read(INDIRECT_PRICE_SOURCE)).toMatch(/from\s+["']\.\/plans["']/);
  });
});

describe("в пользовательских компонентах нет захардкоженных цен", () => {
  it.each(ALL_SURFACES)("%s: ни одной цифры прямо перед ₽", (file) => {
    const src = read(file);
    // Строка вида `{amount} ₽` = цена зашита строкой, а не пришла из plans.ts.
    // Ожидаем 0 совпадений; при падении — печатаем окружение, чтобы видеть,
    // какая именно строка захардкожена.
    const hits = Array.from(src.matchAll(/\d[\d\s\u00A0]*\s*₽/g)).map((m) => {
      const line = src.slice(0, m.index!).split("\n").length;
      return `строка ${line}: …${src.slice(Math.max(0, m.index! - 60), m.index! + 40).trim()}…`;
    });

    expect(hits).toEqual([]);
  });

  it.each(ALL_SURFACES)("%s: старых цен (4 500 / 12 000 / 375) в исходнике нет", (file) => {
    const src = read(file);
    const hits = RETIRED_PRICES.filter((price) => src.includes(price));

    expect(hits).toEqual([]);
  });

  it("страница pricing берёт подписи через хелперы plans.ts, а не склейкой строк", () => {
    const src = read("src/app/pricing/page.tsx");
    expect(src).toMatch(/priceLabel\(|priceShort\(|formatRub\(|academicYearSaving\(/);
  });
});

/**
 * Сверка ФРОНТ ↔ БЭК. Живёт здесь, а не в backend/tests/unit/billing.test.ts,
 * потому что бэк-тесты идут в workerd (@cloudflare/vitest-pool-workers), где
 * `readFileSync` не существует: «not yet implemented in Workers». Это единственное
 * окружение, из которого видны оба файла.
 *
 * ЧТО ЗДЕСЬ ЛОВИТСЯ. До 2026-10-02 фронт продавал 3 800 ₽ за учебный год, а бэк
 * выставлял 5 880 ₽ за 12 месяцев, и обе стороны были «правильны» по-своему —
 * расхождение в 55% никто не замечал, потому что сверки не было. Теперь любая
 * правка цены в одном файле без другого роняет этот тест.
 */
describe("цены фронта и бэка совпадают", () => {
  const BILLING = "backend/src/services/billing.ts";
  const PLANS = "src/lib/content/plans.ts";

  /** Достаём числа из `base: { monthly: 500_00, academicYear: 3_800_00 }`. */
  function billingPrices(plan: "base" | "plus" | "school") {
    const src = read(BILLING);
    const block = new RegExp(`${plan}:\\s*\\{([^}]*)\\}`).exec(src);
    expect(block, `в ${BILLING} нет блока ${plan}`).not.toBeNull();
    const body = block![1];
    const monthly = /monthly:\s*([\d_]+)/.exec(body);
    const academic = /academicYear:\s*(?:([\d_]+)|null)/.exec(body);
    return {
      monthly: monthly ? Number(monthly[1].replace(/_/g, "")) : null,
      academicYear: academic?.[1] ? Number(academic[1].replace(/_/g, "")) : null,
    };
  }

  /** Достаём числа из plans.ts — цены там в рублях, не в копейках. */
  function planAmounts(plan: "base" | "plus" | "school") {
    const src = read(PLANS);
    // Вырезаем блок тарифа и ищем academicYear/month с amount.
    const start = src.indexOf(`  ${plan}: {`);
    expect(start, `в ${PLANS} нет тарифа ${plan}`).toBeGreaterThan(-1);
    const end = src.indexOf("\n  },", start);
    const block = src.slice(start, end === -1 ? start + 1200 : end);
    const academic = /academicYear:\s*\{\s*amount:\s*([\d_]+)/.exec(block);
    const monthly = /month:\s*\{\s*amount:\s*([\d_]+)/.exec(block);
    return {
      academicYear: academic ? Number(academic[1].replace(/_/g, "")) : null,
      monthly: monthly ? Number(monthly![1].replace(/_/g, "")) : null,
    };
  }

  it.each(["base", "plus", "school"] as const)("%s: помесячная цена одна и та же", (plan) => {
    // Бэк хранит копейки, фронт — рубли. 500_00 копеек = 500 ₽.
    expect(billingPrices(plan).monthly, `${plan}: фронт и бэк разошлись`)
      .toBe(planAmounts(plan).monthly! * 100);
  });

  it.each(["base", "plus"] as const)("%s: цена учебного года одна и та же", (plan) => {
    expect(billingPrices(plan).academicYear, `${plan}: фронт и бэк разошлись`)
      .toBe(planAmounts(plan).academicYear! * 100);
  });

  it("у тарифа «Школа» нет учебного года — ни во фронте, ни в бэке", () => {
    expect(planAmounts("school").academicYear).toBeNull();
    expect(billingPrices("school").academicYear).toBeNull();
  });

  it("учебный год = 9 месяцев в обоих файлах", () => {
    const front = /ACADEMIC_YEAR_MONTHS\s*=\s*(\d+)/.exec(read(PLANS));
    const back = /ACADEMIC_YEAR_MONTHS\s*=\s*(\d+)/.exec(read(BILLING));
    expect(front, "в plans.ts нет ACADEMIC_YEAR_MONTHS").not.toBeNull();
    expect(back, "в billing.ts нет ACADEMIC_YEAR_MONTHS").not.toBeNull();
    expect(Number(front![1])).toBe(9);
    expect(back![1]).toBe(front![1]);
  });

  it("в бэке не осталось календарного года (365 дней)", () => {
    // Старое `yearly: 365 * 86400` давало учителю доступ на 12 месяцев
    // за оплату «учебного года». Если строка вернулась — вернулась и ошибка.
    expect(read(BILLING)).not.toMatch(/365\s*\*\s*86400/);
  });
});

/**
 * Сверка типов артефактов: фронтовый `TaskType` и бэковская таблица роутинга.
 * Бэк ставит модель по типу артефакта, и тип, который там не учтён, молча
 * уехал бы на дешёвую Luna.
 */
describe("типы артефактов фронта и бэка совпадают", () => {
  it("каждый фронтовый TaskType есть в ARTIFACT_TASK роутера", () => {
    const types = read("src/lib/types.ts");
    const block = /export type TaskType =([\s\S]*?);\n/.exec(types);
    expect(block, "в src/lib/types.ts нет export type TaskType").not.toBeNull();

    // Комментарии выкидываем ДО разбора литералов. Иначе попадают строки из
    // пояснений — например «cards-real» из фразы «отдельного cards-real не
    // вводим», и тест требовал бы несуществующий тип артефакта.
    const withoutComments = block![1]
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

    const frontTypes = Array.from(withoutComments.matchAll(/"([a-z][a-z-]*)"/g)).map((m) => m[1]!);
    expect(frontTypes.length).toBeGreaterThan(5);

    const router = read("backend/src/llm/router.ts");
    const missing = frontTypes.filter((t) => !new RegExp(`^\\s*"?${t}"?:\\s*"`, "m").test(router));
    expect(
      missing,
      `эти типы есть во фронте, но не в ARTIFACT_TASK роутера: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

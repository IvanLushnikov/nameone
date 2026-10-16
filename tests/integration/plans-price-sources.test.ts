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
  // До 12.10.2026 лендинг сравнения писал «от 500 ₽ в месяц» руками и никем не
  // проверялся. Теперь берёт цену из plans.ts, а этот файл в списке — чтобы
  // следующая смена цены не оставила лендинг врать.
  "src/components/landing/Comparison.tsx",
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
  // Цены до снижения 12.10.2026 — вместе с учебным годом.
  "500 ₽",
  "990 ₽",
  "1 500 ₽",
  "3 800",
  "7 600",
  "11 000",
  // Нормы расхода до пересчёта под сценарий В.
  "1 440 000",
  "16 000 000",
];

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

/**
 * JSDoc-блок прямо над `export const PRICES` в billing.ts — то есть ровно тот
 * текст, который человек читает, открывая файл «вспомнить цену».
 *
 * Отдельная функция, а не `slice(0, indexOf(...))`, потому что весь преамбул
 * файла — это не шапка прайса, а разные комментарии, часть которых честно
 * пересказывает прошлые цены как историю ошибок.
 */
function readPricesHeader(): string {
  // Путь повторяет константу BILLING из describe ниже: она объявлена внутри
  // блока, а хелпер нужен на уровне модуля.
  const src = read("backend/src/services/billing.ts");
  const anchor = src.indexOf("export const PRICES");
  expect(anchor, "в billing.ts нет export const PRICES").toBeGreaterThan(-1);

  // Идём назад до открывающего /** последнего блока комментария.
  //
  // Ищем именно `\n/**`, а не просто `/**`: в шапке есть строка
  // «include = `tests/**`», и обычный lastIndexOf натыкался на неё — то есть
  // «шапка прайса» молча превращалась в последние три строки чужого абзаца, а
  // проверка проходила, ничего не проверяя. Якорь с новой строки отличает
  // настоящее начало JSDoc (он всегда в нулевой позиции) от `/**` внутри текста.
  const before = src.slice(0, anchor);
  const start = before.lastIndexOf("\n/**");
  expect(start, "над PRICES нет JSDoc-блока").toBeGreaterThan(-1);
  return before.slice(start + 1);
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

  it.each(ALL_SURFACES)("%s: старых цен в исходнике нет", (file) => {
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
  function billingPrices(plan: "base" | "standard" | "plus" | "school") {
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
  function planAmounts(plan: "base" | "standard" | "plus" | "school") {
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

  it.each(["base", "standard", "plus", "school"] as const)("%s: помесячная цена одна и та же", (plan) => {
    // Бэк хранит копейки, фронт — рубли. 249_00 копеек = 249 ₽.
    expect(billingPrices(plan).monthly, `${plan}: фронт и бэк разошлись`)
      .toBe(planAmounts(plan).monthly! * 100);
  });

  /**
   * ТЗ-30, AD-1: админка не знает ни одной цены.
   *
   * ДО 15.10.2026 в `backend/src/routes/admin.ts` была таблица
   * `MONTHLY_REVENUE_RUB` с ценами 500 / 990 / 1500 ₽ — это цены ДО снижения
   * 12.10. Биллинг и прайс обновились, админка — нет, и по этой выдуманной
   * цифре владелец принимал решение «хватает ли денег». Теперь выручка
   * считается по фактическим суммам платежей, а канон цен админка импортирует.
   *
   * ПОЧЕМУ ПРОВЕРКА ЖИВЁТ ЗДЕСЬ, А НЕ В БЭКЕНД-ТЕСТАХ. Бэк-тесты идут в
   * workerd, где `fs` не реализован: `readFileSync` падает с «not yet
   * implemented in Workers» (см. начало `backend/tests/unit/worksheets.test.ts`).
   * Читать исходник бэка можно только отсюда — с node-пула.
   */
  it("админка не содержит ни одного литерала цены (ТЗ-30 AD-1)", () => {
    const source = read("backend/src/routes/admin.ts");
    // Комментарии выкидываем: упоминание цены в пояснении — это документация,
    // а не зашитая цена. Ловим именно числа в коде.
    const code = source
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

    // Таблица цен — это строки вида `base: 500,` / `plus: 1_500,`, то есть
    // ключ-название ТАРИФА и число. Ловим только такие: иначе под правило
    // попадает любая константа (`limit: 240`) и проверка становится шумной,
    // которую выключат при первом же ложном срабатывании.
    const priceLiterals =
      code.match(/^\s*"?[a-z]+"?\s*:\s*[\d_]+\s*,?\s*$/gm)?.filter((line) =>
        /^\s*"?(base|standard|plus|school|free)"?\s*:/.test(line),
      ) ?? [];
    expect(
      priceLiterals,
      `в admin.ts вернулась таблица цен: ${priceLiterals.join(" | ")}`,
    ).toEqual([]);

    // Цены до снижения 12.10 не должны появляться как числа.
    for (const retired of ["500", "990", "1_500", "1500"]) {
      expect(code, `в admin.ts снова появилась старая цена ${retired}`).not.toMatch(
        new RegExp(`\\b${retired}\\b`),
      );
    }

    // Канон цен админка обязана ИМПОРТИРОВАТЬ: без импорта она не сможет
    // взять цену из billing, даже если строк с числами в ней нет.
    expect(source).toMatch(/import\s*\{[^}]*PRICES[^}]*\}\s*from\s*"\.\.\/services\/billing"/);
  });

  it.each(["base", "standard", "plus"] as const)("%s: цена учебного года одна и та же", (plan) => {
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

  it("в комментарии над PRICES нет цен, которых уже нет в прайсе", () => {
    // ТЗ-30, пробел 5. Шапка над `PRICES` — это место, куда человек заходит
    // «вспомнить цену», и она сама себя объявляет единым источником правды.
    // После снижения 12.10 она продолжала перечислять 500 ₽ и 1 500 ₽, то
    // есть рассказывала о ценах, которых больше нет, именно в том файле,
    // которому верят. Компилятор такое не видит — ловится только сканом.
    //
    // ГДЕ ИМЕННО СМОТРИМ. Только JSDoc-блок прямо над `PRICES`, а не весь
    // файл: выше есть комментарии, которые НАЗЫВАЮТ старые цены как историю
    // («раньше здесь был yearly и цены 5 880/11 880 ₽» — см. Period). Это
    // объяснение прошлой ошибки, а не утверждение о текущей цене, и проверка
    // такого места ломала бы правильный текст вместо того, чтобы ловить врать.
    const hits = RETIRED_PRICES.filter((price) => readPricesHeader().includes(price));
    expect(
      hits,
      `в шапке над PRICES снова старые цены: ${hits.join(", ")}`,
    ).toEqual([]);
  });

  it("каждая цена, названная в шапке, есть в нынешнем PRICES", () => {
    // Обратная проверка к предыдущей. Не «там нет старых», а «там написаны
    // именно эти»: иначе комментарий можно вычистить целиком, тест останется
    // доволен — а человек, открывший файл, не найдёт ничего и пойдёт считать
    // по памяти.
    const src = read(BILLING);
    const header = readPricesHeader();

    // Цена в рублях из самого PRICES. Числа там записаны как 249_00 — это
    // рубли, копейки и разделитель тысяч одновременно, поэтому берём блок
    // PRICES и переводим каждое число «рубли_копейки» в рубли.
    const pricesBlock = /export const PRICES = \{([\s\S]*?)\n\} as const;/.exec(src);
    expect(pricesBlock, "в billing.ts не нашлось объявления PRICES").not.toBeNull();
    const current = new Set(
      Array.from(pricesBlock![1]!.matchAll(/:\s*([\d_]+)/g))
        .map((m) => Number(m[1]!.replace(/_/g, "")) / 100)
        .filter((n) => Number.isFinite(n) && n > 0),
    );
    expect(current.size, "в PRICES не нашлось ни одной цены").toBeGreaterThan(0);

    // Всё, что в шапке написано со знаком «₽», обязано быть нынешней ценой.
    const mentioned = Array.from(
      header.matchAll(/(\d[\d\s\u00A0]*)\s*₽/g),
      (m) => Number(m[1]!.replace(/[\s\u00A0]/g, "")),
    ).filter((n) => Number.isFinite(n) && n > 0);

    expect(
      mentioned.filter((n) => !current.has(n)),
      "в шапке над PRICES названы цены, которых нет в самом PRICES",
    ).toEqual([]);
  });
});

/**
 * Сверка типов артефактов: фронтовый `TaskType` и бэковская таблица роутинга.
 * Бэк ставит модель по типу артефакта, и тип, который там не учтён, молча
 * уехал бы на дешёвую Luna.
 */
/**
 * Тип артефакта «картинки» снят с продукта (ТЗ-30 AD-4): провайдера генерации
 * изображений нет, роут отдавал 503, и шесть типов артефактов, из которых
 * один не работает, хуже пяти рабочих. Использования в боевой базе нет — в
 * `llm_logs` ни одного вызова `image-gen`.
 *
 * Откат сделан и на бэке (`llm/router.ts`, `llm/types.ts`), и на фронте
 * (`src/lib/types.ts`, конструктор, превью, каталог материалов, фронтовый
 * llm-роутер). Поэтому белого списка «исключений» здесь больше нет: если
 * `image` вернётся хотя бы в одном из этих файлов, проверки ниже упадут
 * сами — без ручной правки теста. Список был бы способом тихо простить
 * расхождение, а расхождение тут и было проблемой.
 */
const RETIRED_ARTIFACT_TYPES = ["image"] as const;

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
    // Фильтра по белому списку тут намеренно нет: все типы из фронтового
    // `TaskType` обязаны быть в `ARTIFACT_TASK` роутера. Снятый с продукта
    // тип тоже сюда не попадёт — он убран из `TaskType`, и это проверяет
    // следующий тест.
    const missing = frontTypes.filter(
      (t) => !new RegExp(`^\\s*"?${t}"?:\\s*"`, "m").test(router),
    );
    expect(
      missing,
      `эти типы есть во фронте, но не в ARTIFACT_TASK роутера: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("снятые с продукта типы не остались ни на бэке, ни на фронте", () => {
    const router = read("backend/src/llm/router.ts");
    const types = read("backend/src/llm/types.ts");
    for (const t of RETIRED_ARTIFACT_TYPES) {
      expect(router, `в ARTIFACT_TASK роутера снова есть "${t}"`).not.toMatch(
        new RegExp(`^\\s*"?${t}"?:\\s*"`, "m"),
      );
      // И в GenerationKind его быть не должно: иначе задача осталась бы
      // вызываемой и вернула бы 503 откуда-то, откуда мы уже убрали кнопку.
      expect(types, `в GenerationKind снова есть "${t}-gen"`).not.toMatch(
        new RegExp(`"${t}-gen"`),
      );
    }

    // Фронт проверяем отдельно и поимённо: список файлов задан руками, чтобы
    // новый экран с типом «картинки» пришлось добавить в этот тест явно, а не
    // спрятать за молчаливым «файлы не трогаем».
    const FRONT_FILES = [
      "src/lib/types.ts",                     // объявление TaskType
      "src/lib/llm/router.ts",                // список задач пикера модели
      "src/lib/llm/config.ts",                // роль модели
      "src/app/constructor/page.tsx",         // deep-link, кейсы, подпись, превью-тексты
      "src/components/constructor/ArtifactTypePreview.tsx",
      "src/components/constructor/WorksheetPreview.tsx",
      "src/lib/content/materials-catalog.ts", // каталог материалов и цель «Оформить»
    ] as const;

    for (const file of FRONT_FILES) {
      // Комментарии выкидываем: объяснение «почему типа нет» упоминать его
      // обязано, а вот литерал в коде — нет.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");
      for (const t of RETIRED_ARTIFACT_TYPES) {
        expect(code, `в ${file} снова есть литерал "${t}"`).not.toMatch(
          new RegExp(`["'\`]${t}["'\`]`),
        );
      }
    }
  });
});

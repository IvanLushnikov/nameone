/**
 * Честные обещания: блок D аудита от 11.10.2026 (docs/30, docs/31 — кейсы
 * Д-1…Д-7).
 *
 * ЗАЧЕМ ТЕСТ. Четыре находки продуктового аудита были подтверждены по коду, и
 * каждая из них вернётся при любом новом тексте, если за ней не стоит проверка:
 *   Д-1 — маркетинг обещал точность, продукт отдаёт решение учителю;
 *   Д-2 — бесплатный тариф с ценой 0 обещал «навсегда» при квоте в 3 листа;
 *   Д-3 — в шапке «Кабинет» и «Войти» стояли рядом, два входа с равным весом;
 *   Д-4 — главная предлагала на выбор девять продуктов вместо одного;
 *   Д-5 — блока «чего мы не умеем» на главной не было вовсе.
 *
 * Проверяем ИСХОДНИКИ, а не вёрстку, потому что обещание живёт в строке.
 * Комментарии вырезаются: разработчик вправе писать в комментарии о старом
 * тексте, учитель его не видит.
 *
 * Границы проверки. Договорённость «точность обещать нельзя» относится к
 * блоку про проверку ответов и к подписям тарифов. Слово «гарантия» в юридически
 * выполнимом обещании (возврат денег) — не accuracy-обещание, и ловить его
 * здесь нельзя: запрет станет формальностью, которую обойдут первым же
 * возвратом.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { readdirSync, statSync } from "node:fs";

// next/navigation обязателен ДО импорта Header: в jsdom нет app router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import { Header } from "@/components/layout/Header";
import { setProfile } from "@/lib/utils/storage";
import { FREE_GENERATIONS, PLANS, priceFor } from "@/lib/content/plans";
import type { UserProfile } from "@/lib/types";

/** Читаем файл из репозитория: vitest запускается из его корня. */
function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

/** Без комментариев: слова из комментария учителю не видны. */
function userText(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Все .ts/.tsx под каталогом. */
function tsFiles(dir: string): string[] {
  const root = join(process.cwd(), dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        out.push(full.slice(process.cwd().length + 1));
      }
    }
  };
  walk(root);
  return out;
}

describe("Д-1 — про точность не обещают", () => {
  const features = userText("src/components/landing/Features.tsx");
  const pricing = userText("src/app/pricing/page.tsx");

  it("в блоке про проверку ответов нет обещаний точности", () => {
    // Раньше на главной стояло «Листы точно по программе», а карточка
    // «Проверка ответов» обещала результат без оговорок.
    for (const file of ["src/components/landing/Features.tsx", "src/lib/content/plans.ts"]) {
      const text = userText(file);
      for (const promise of [
        /точно по\s*программе/i,
        /точные?\s+ответы/i,
        /без\s+ошибок/i,
        /гарантируем/i,
        /идеальн/i,
      ]) {
        expect(
          text,
          `«${promise}» вернулось в ${file}`,
        ).not.toMatch(promise);
      }
    }
  });

  it("про проверку ответов сказано честно: черновик и решение за учителем", () => {
    // Не «мы делаем правильно», а «вот разбор, смотрите сами»: именно эта рамка
    // описана в коде проверки (src/lib/llm/verify-sheet.ts — черновик, жёлтый
    // бейдж «Требует проверки», решение на учителе).
    expect(features).toMatch(/черновик/i);
    expect(features).toMatch(/решение остаётся за вами/i);
    // Плюс реальные, измеренные на проде цифры вместо выдуманной точности.
    expect(features).toMatch(/5–20 секунд/);
  });

  it("страница тарифов и оферта обещают одинаково: без обещания возврата", () => {
    // Аудит 18.10.2026 (BUG-008) + список правок: FAQ на /pricing/ обещал
    // «вернём деньги» и «возврат в течение 7 дней», а оферта п.6 говорит
    // «сервис предоставляется как есть» (возврат убран по решению владельца
    // 09.10.2026: в бэкенде нет механизма возврата).
    //
    // Раньше страницы обещали разное, и учитель перед оплатой опирался на
    // более сильное обещание. Теперь обещаний возврата нет ни там, ни там,
    // и страница тарифов прямо ссылается на оферту.
    const offer = userText("src/app/legal/[slug]/page.tsx");
    expect(pricing).not.toMatch(/вернём деньги/i);
    expect(pricing).not.toMatch(/возврат в течение 7 дней/i);
    expect(pricing).toMatch(/п\. ?6 оферты/i);
    // Слово «гарантия» в юридически невыполнимом обещании — тоже нет.
    expect(pricing).not.toMatch(/гарантия/i);
    // И в оферте: возврат убран из п.6 по решению владельца.
    expect(offer).not.toMatch(/вернуть деньги можно/i);
  });

  it("в тарифных подписях нет слов про вечную доступность", () => {
    const labels = [PLANS.free, PLANS.base, PLANS.standard, PLANS.plus]
      .flatMap((p) => [
        p.description,
        p.shortDescription,
        ...p.features,
        p.prices.month.unit,
        p.prices.academicYear?.unit ?? "",
      ])
      .join(" ");
    expect(labels).not.toMatch(/навсегда/i);
    expect(labels).not.toMatch(/бесконечн/i);
  });
});

// ТЗ-29 (15.10.2026): квота бесплатного тарифа стала 5 листов В МЕСЯЦ со
// сбросом 1-го числа. Проверки ниже обновлены под это, а слово «навсегда» по-
// прежнему запрещено: обещание «навсегда» было главной претензией учителя.
describe("Д-2 — бесплатный тариф не обещает «навсегда»", () => {
  it("у нулевой цены нет unit «навсегда» ни в одном периоде", () => {
    expect(PLANS.free.prices.academicYear?.amount).toBe(0);
    expect(PLANS.free.prices.month.amount).toBe(0);
    expect(PLANS.free.prices.academicYear?.unit).not.toMatch(/навсегда/i);
    expect(PLANS.free.prices.month.unit).not.toMatch(/навсегда/i);
  });

  it("в исходнике планов нет строки unit: \"навсегда\"", () => {
    expect(userText("src/lib/content/plans.ts")).not.toMatch(/unit:\s*"навсегда"/);
  });

  it("тариф честно называет, сколько это листов и когда они обновятся (ТЗ-29)", () => {
    // Число не пишем руками: обещание собирается из той же константы
    // FREE_GENERATIONS, что считает бэкенд.
    expect(PLANS.free.description).toContain(`${FREE_GENERATIONS} листов в месяц`);
    expect(PLANS.free.description).toContain("Обновляется 1-го числа");
    // Квота месячная: «не пополняется — это N листа на всё время» больше не
    // правда, и проверка на «навсегда» выше это ловит.
    expect(PLANS.free.features.join(" ")).not.toMatch(/на всё время/i);
    // Второе обещание тарифа. Раньше оно было «проверка по фото — без
    // ограничений», но код считал каждую проверку листом (решение владельца
    // от 07.10, подтверждено 16.10). Текст обязан совпадать с поведением,
    // поэтому проверяем, что обещания «без ограничений» здесь больше нет.
    expect(PLANS.free.features.join(" ")).toMatch(/Проверка по фото/);
    expect(PLANS.free.features.join(" ")).toMatch(/из той же квоты/i);
    expect(PLANS.free.features.join(" ")).not.toMatch(/без ограничений/i);
  });

  it("на странице тарифов бесплатная квота описана без слова «навсегда»", () => {
    const pricing = userText("src/app/pricing/page.tsx");
    expect(pricing).not.toMatch(/навсегда/i);
    // Слово «Квота общая» осталось правдой: счёт по-прежнему один на все типы
    // материалов. Проверка прежняя — она про «общий», а не про вечность.
    expect(pricing).toMatch(/Квота общая/);
  });

  it("в карточке расхода нет слов про исчерпание и блокировку", () => {
    // Правило из шапки UsageCard.tsx. ТЗ-29 к нему не отступает: месячная
    // квота не делает слова «исчерпано» менее обидными.
    const card = userText("src/components/shared/UsageCard.tsx");
    expect(card).not.toMatch(/исчерпан/i);
    expect(card).not.toMatch(/заблокирован/i);
  });
});

describe("Д-3 — в шапке одна кнопка на состояние", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function mkProfile(): UserProfile {
    return {
      id: "u-1",
      email: "teacher@school.ru",
      name: "Иванова Мария",
      plan: "free",
      generationsTotal: 0,
      generationsToday: 0,
      generationsLimit: 3,
      createdAt: "2026-10-11T10:00:00.000Z",
    };
  }

  it("исходник шапки не держит «Кабинет» в общем меню", () => {
    // Пункт «Кабинет» рядом с кнопкой входа давал два входа в одно место.
    // Убираем его из массива `nav`, оставляя одну кнопку входа справа.
    const src = read("src/components/layout/Header.tsx");
    const navArray = src.match(/const nav = \[[\s\S]*?\];/)?.[0] ?? "";
    expect(navArray).not.toMatch(/dashboard/);
    expect(navArray).not.toMatch(/Кабинет/);
  });

  it("гость видит «Войти» и «Кабинет» рядом (ТЗ-32, D5)", () => {
    // Раньше здесь стояло обратное утверждение: гость не видит «Кабинет».
    // Владелец 16.10.2026 решил другое (ТЗ-32, D5): кабинет открыт гостю без
    // входа, поэтому ссылка на него в шапке нужна. Проверяем главное —
    // «Войти» на месте и «Кабинет» ведёт именно в кабинет, а не в /login.
    render(createElement(Header));
    expect(screen.getByText(/^Войти$/)).toBeInTheDocument();
    const cabinet = screen.getByText(/^Кабинет$/);
    expect(cabinet).toBeInTheDocument();
    expect(cabinet.closest("a")?.getAttribute("href")).toBe("/dashboard");
  });

  it("залогиненный видит «Кабинет» и не видит «Войти»", () => {
    setProfile(mkProfile());
    render(createElement(Header));
    expect(screen.getByText(/^Кабинет$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Войти$/)).not.toBeInTheDocument();
  });
});

describe("Д-4 — главная вокруг рабочих листов", () => {
  /** Текст массива `features` — именно карточки, не шапка секции. */
  function featuresArray(): string {
    const src = read("src/components/landing/Features.tsx");
    return src.match(/const features = \[[\s\S]*?\n\];/)?.[0] ?? "";
  }

  it("на главной осталось три карточки, и все три — про рабочие листы", () => {
    const array = featuresArray();
    const titles = array.match(/title:\s*"([^"]+)"/g) ?? [];
    expect(titles).toHaveLength(3);
  });

  it("с главной убраны план урока, презентация, КТП и проверка по фото", () => {
    // Фичи живут в продукте, но предлагать их выбором на главной больше нельзя.
    const array = featuresArray();
    for (const product of ["План урока", "Презентация", "КТП", "по фото"]) {
      expect(array, `«${product}» остался карточкой на главной`).not.toContain(product);
    }
  });

  it("заголовок секции больше не обещает «точно по программе»", () => {
    expect(userText("src/components/landing/Features.tsx")).not.toMatch(/точно/i);
  });
});

describe("Д-5 — честный блок «чего мы не умеем»", () => {
  it("блок есть на главной и в нём три ограничения", () => {
    const src = read("src/components/landing/Limitations.tsx");
    const items = src.match(/const limitations = \[[\s\S]*?\n\];/)?.[0] ?? "";
    expect(items).toMatch(/title:/);
    expect((items.match(/title:/g) ?? []).length).toBe(3);
    expect(src).toMatch(/export function Limitations/);
  });

  it("ограничения настоящие: учебник, PDF, устные ответы", () => {
    const text = userText("src/components/landing/Limitations.tsx");
    expect(text).toMatch(/алгебра/i);
    expect(text).toMatch(/PDF не редактируется/i);
    expect(text).toMatch(/Устные ответы не слышны/i);
  });

  it("главная подключает блок", () => {
    const page = read("src/app/page.tsx");
    expect(page).toMatch(/import \{ Limitations \}/);
    expect(page).toMatch(/<Limitations \/>/);
  });
});

describe("Д-6/Д-7 — цены и лимиты не поехали", () => {
  it("суммы тарифов те, что заявлены в решении от 12.10.2026", () => {
    // Тест ловит сдвиг любой цифры, но после сознательного изменения цен
    // «прежними» они прежними быть не могут — здесь зафиксированы новые.
    // Правка цен: docs/36-price-cut-implementation-plan-2026-10-12.md.
    expect(priceFor("base", "month").amount).toBe(249);
    expect(priceFor("base", "academicYear").amount).toBe(1890);
    expect(priceFor("standard", "month").amount).toBe(499);
    expect(priceFor("standard", "academicYear").amount).toBe(3830);
    expect(priceFor("plus", "month").amount).toBe(999);
    expect(priceFor("plus", "academicYear").amount).toBe(7330);
    expect(PLANS.free.prices.month.amount).toBe(0);
  });

  it("лимит в листах помечен как оценка", () => {
    // «До 1 500 листов» — пересчёт нормы в токенах по среднему листу, а не
    // обещание объёма. Учитель делает один лист в день, поэтому цифру без
    // пояснения оставлять нельзя.
    expect(userText("src/app/pricing/page.tsx")).toMatch(/Лимиты в листах — оценка/);
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// ТЗ-37 (29.10.2026): четыре обещания, которых продукт не держит.
//
// Q-07 / M-08 — тариф обещает «критерии оценивания», которых в ответе API
//   нет (в схеме ответа такого поля нет вообще, слово «критери» в контрольной
//   не встречается ни разу). Контрольная стоит в 44 раза дороже рабочего
//   листа, то есть за отсутствующую фичу платят отдельно.
// M-10 — карточка «Школа» рисовала галочками семь пунктов, включая
//   интеграцию со Сферум / Moodle, которой в проекте нет вообще.
// M-11 — «за 30 секунд» верно ровно для дефолтных 10 заданий (замер
//   29.10.2026: 30,1 с), а на 12 заданиях тот же лист собирается 67,5 с.
// Q-09 — страница «Методика» обещала, что одинаковые формы подряд не идут;
//   в 7 листах из 10 живых прогонов они идут, и код этого не проверяет.
// ─────────────────────────────────────────────────────────────────────────────

describe("ТЗ-37 · Q-07/M-08: тариф не обещает критериев оценивания", () => {
  /**
   * Формулировка «Контрольная с критериями оценивания» пришла из черновика
   * ТЗ-21 и уехала в коммерческий текст. В ответе API поля для критериев нет
   * (схема ответа), а слово «критери» в контрольной не встречается ни разу.
   *
   * Правку карточек тарифа делает волна 3 (TZ-45 → TZ-46): файл тарифов
   * `plans.ts` в эту волну правят параллельно, и правка здесь создала бы
   * конфликт. Поэтому здесь проверяются все остальные места, а `plans.ts`
   * перечислен явно — когда волна 3 перепишет формулировку, список станет
   * не нужным (об этом напомнит проверка ниже).
   */
  const WAVE_3_TARIFF_FILE = "src/lib/content/plans.ts";

  it("в коде страниц нет обещания «критериями оценивания»", () => {
    const offenders = tsFiles("src")
      .filter((f) => f !== WAVE_3_TARIFF_FILE)
      .filter((f) => /критериями оценивания/i.test(userText(f)));
    expect(
      offenders,
      `«критериями оценивания» вернулось в: ${offenders.join(", ")}`,
    ).toEqual([]);
    // Проверка читает весь `src/` (около двухсот файлов, таксономия — 250 КБ),
    // а рабочая копия лежит на сетевом диске: на холодном кэше чтение занимает
    // больше стандартных пяти секунд.
  }, 60_000);

  it("в файлах для ИИ-краулеров обещания тоже нет", () => {
    for (const file of ["public/llms.txt", "public/llms-full.txt"]) {
      expect(read(file), `${file}: обещание критериев`).not.toMatch(
        /критериями оценивания/i,
      );
    }
  });

  it("«критериями оценивания» осталось только в карточках тарифа — долг волны 3", () => {
    // Пока волна 3 не переписала формулировку в карточках «Базовый» и «Плюс»,
    // обещание живёт ровно в одном файле. Когда волна 3 его перепишет, эта
    // проверка упадёт — и список исключений выше можно будет убрать.
    const stillPromised = /критериями оценивания/i.test(userText(WAVE_3_TARIFF_FILE));
    expect(
      stillPromised,
      "формулировка в plans.ts уже переписана (волна 3) — убери WAVE_3_TARIFF_FILE из проверок выше",
    ).toBe(true);
  });
});

describe("ТЗ-37 · M-10: карточка «Школа» не рисует галочки на том, чего нет", () => {
  it("интеграция со Сферум / Moodle — в планах, а не в списке того, что есть", async () => {
    const { splitSchoolPlanFeatures, SCHOOL_PLAN_PLANNED_FEATURES } = await import(
      "@/lib/content/school-plan"
    );
    const { available, planned } = splitSchoolPlanFeatures();

    expect(available.join(" "), "в списке «уже работает» появилось то, чего нет").not.toMatch(
      /Сферум|Moodle/i,
    );
    expect(planned.join(" "), "в списке планов нет интеграции").toMatch(/Сферум/);

    // Список планов ссылается на тексты из plans.ts: если волна 3 перепишет
    // формулировку пункта, тест упадёт и пункт не сможет молча уехать в
    // список «уже работает» (и получить галочку на несуществующей фиче).
    const features = PLANS.school.features;
    expect(
      [...available, ...planned].sort(),
      "пункты тарифа «Школа» не разделились полностью",
    ).toEqual([...features].sort());
    for (const f of SCHOOL_PLAN_PLANNED_FEATURES) {
      expect(features, `пункт «${f}» исчез из тарифа «Школа»`).toContain(f);
    }
  });

  it("в карточке тарифа Moodle нарисован без галочки, а работающие пункты — с галочкой", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: PricingPage } = await import("@/app/pricing/page");

    const html = renderToStaticMarkup(createElement(PricingPage));

    // Пункт не спрятан: он назван, но помечен как план.
    expect(html, "интеграция со Сферум / Moodle пропала со страницы тарифов").toContain(
      "Интеграция со Сферум / Moodle",
    );
    expect(html, "на странице тарифов нет блока «В планах»").toMatch(/В планах/);

    // Галочка (lucide-check) рядом с Moodle — нет.
    const plannedItem = html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*Moodle(?:(?!<\/li>)[\s\S])*<\/li>/)?.[0] ?? "";
    expect(plannedItem, "пункт с Moodle не найден в разметке").not.toBe("");
    expect(plannedItem, "на несуществующей интеграции нарисована галочка").not.toContain(
      "lucide-check",
    );

    // А на том, что работает сегодня, — есть.
    const liveItem = html.match(
      /<li[^>]*>(?:(?!<\/li>)[\s\S])*Админка учителя(?:(?!<\/li>)[\s\S])*<\/li>/,
    )?.[0] ?? "";
    expect(liveItem, "пункт «Админка учителя с отчётами» не найден").not.toBe("");
    expect(liveItem, "у работающего пункта нет галочки").toContain("lucide-check");
  });

  it("тариф «Школа» по-прежнему помечен «скоро» и цена — «ориентир»", () => {
    expect(PLANS.school.comingSoon, "у тарифа «Школа» нет даты запуска").toBeTruthy();
    expect(userText("src/app/pricing/page.tsx")).toMatch(/ориентир/);
  });
});

describe("ТЗ-37 · M-11: «за 30 секунд» — обещание про дефолтный лист", () => {
  /**
   * Замеры 29.10.2026: 5 заданий — 14,7 с, 10 заданий (дефолт конструктора,
   * `useState(10)`) — 30,1 с, 12 заданий — 67,5 с, контрольная — 39,2 с.
   * «За 30 секунд» верно ровно для дефолтных десяти заданий, поэтому число
   * теперь называется вместе с дефолтом: иначе учитель, выбравший 12
   * заданий, читает обещание, которого продукт не держит.
   */
  const DEFAULT_COUNT = /10\s+задани/;

  /** Текстовые узлы, в которых встречается обещание времени. */
  function timePromises(root: HTMLElement): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      if (/30\s*секунд/i.test(text)) out.push(text);
      node = walker.nextNode();
    }
    return out;
  }

  it("на главной число 30 секунд стоит рядом с дефолтом «10 заданий»", async () => {
    const { Hero } = await import("@/components/landing/Hero");
    const { container } = render(createElement(Hero));

    const promises = timePromises(container);
    expect(promises.length, "на главной не осталось обещания «за 30 секунд»").toBeGreaterThan(0);
    for (const text of promises) {
      const el = [...container.querySelectorAll("*")].find((node) =>
        (node.textContent ?? "").includes(text.trim()),
      );
      expect(el?.textContent ?? "", `обещание без дефолта: «${text.trim()}»`).toMatch(
        DEFAULT_COUNT,
      );
    }
  });

  it("в подвале то же самое: «за 30 секунд» — про лист из 10 заданий", async () => {
    const { Footer } = await import("@/components/layout/Footer");
    const { container } = render(createElement(Footer));

    const promises = timePromises(container);
    expect(promises.length, "в подвале не осталось обещания «за 30 секунд»").toBeGreaterThan(0);
    for (const text of promises) {
      const el = [...container.querySelectorAll("*")].find((node) =>
        (node.textContent ?? "").includes(text.trim()),
      );
      expect(el?.textContent ?? "", `обещание без дефолта: «${text.trim()}»`).toMatch(
        DEFAULT_COUNT,
      );
    }
  });

  it("в файле для ИИ-краулеров время тоже привязано к дефолту", () => {
    const text = read("public/llms.txt").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (!/30\s*секунд/i.test(sentence)) continue;
      expect(sentence, "в llms.txt обещание времени без дефолта «10 заданий»").toMatch(
        DEFAULT_COUNT,
      );
    }
  });
});

describe("ТЗ-37 · Q-09: страница «Методика» не обещает чередование форм", () => {
  const methodology = userText("src/app/methodology/page.tsx");

  it("утверждения «Подряд одинаковые формы не идут» больше нет", () => {
    expect(methodology).not.toMatch(/Подряд одинаковые формы не идут/i);
    expect(methodology).not.toMatch(/одинаковые формы/i);
  });

  it("обещания, что формы чередуются, тоже нет — код этого не проверяет", () => {
    // Проверку чередования форм добавляет ТЗ-40 (волна 2). До неё страница
    // не имеет права обещать то, что не держит код.
    expect(methodology).not.toMatch(/формы чередуются/i);
    expect(methodology).not.toMatch(/не идут подряд/i);
  });

  it("страница говорит правду: чередование просим, но не проверяем", () => {
    expect(methodology).toMatch(/чередовать формы/i);
    expect(methodology).toMatch(/не\s+проверяем/i);
  });
});

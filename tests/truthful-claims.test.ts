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
import { PLANS, priceFor } from "@/lib/content/plans";
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

  it("на странице тарифов обещание возврата денег осталось, но без слова «гарантия»", () => {
    expect(pricing).toMatch(/вернём деньги/i);
    expect(pricing).not.toMatch(/гарантия/i);
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

  it("тариф честно называет, сколько это генераций и зачем", () => {
    // 3 генерации — это константа FREE_GENERATIONS, текст собран из неё же.
    expect(PLANS.free.description).toContain("3 бесплатные генерации");
    expect(PLANS.free.description).toMatch(/подходит ли/i);
    expect(PLANS.free.features.join(" ")).toMatch(/не пополняется/i);
  });

  it("на странице тарифов бесплатная квота описана без слова «навсегда»", () => {
    const pricing = userText("src/app/pricing/page.tsx");
    expect(pricing).not.toMatch(/навсегда/i);
    expect(pricing).toMatch(/Квота общая/);
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

  it("гость видит «Войти» и не видит «Кабинет»", () => {
    render(createElement(Header));
    expect(screen.getByText(/^Войти$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Кабинет$/)).not.toBeInTheDocument();
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
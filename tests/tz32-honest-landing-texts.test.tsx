/**
 * ТЗ-32 часть 4 (D1) и часть 6 (AD-9) — честные тексты на главной и в подвале.
 *
 * Часть 4 / D1: план урока, презентация и КТП закрыты тарифом «Плюс»
 * (`plusOnly` в `ARTIFACT_TYPE_OPTIONS`, строки таблицы на странице тарифов).
 * На главной и в подвале эти форматы упоминались как доступные. Теперь рядом
 * с каждым упоминанием стоит тариф.
 *
 * Часть 6 / AD-9: время генерации и время сверки — разные числа. Замер 25 секунд
 * честен для генерации, поэтому «за 30 секунд» обещает только её, а сверка
 * остаётся со своими «1–3 минуты».
 *
 * Проверки на исходниках файлов, а не на отрисовке: тексты — статические
 * строки, а рендер тянет за собой анимации появления, которые здесь ничего
 * не проверяют.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Features } from "@/components/landing/Features";
import { Comparison } from "@/components/landing/Comparison";

const ROOT = process.cwd();

/** Исходник компонента: тексты лежат в константах, а не в разметке. */
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const FEATURES = src("src/components/landing/Features.tsx");
const COMPARISON = src("src/components/landing/Comparison.tsx");
const FOOTER = src("src/components/layout/Footer.tsx");
const HERO = src("src/components/landing/Hero.tsx");
const LAYOUT = src("src/app/layout.tsx");

/** Формы слов, в которых закрытый формат называется в текстах. */
const CLOSED_FORMATS = ["план урока", "презентаци", "КТП"];

/**
 * Только видимые строки, без комментариев.
 *
 * Исходники наполнены комментариями, где старые формулировки цитируются
 * («было „3 бесплатно“»), и по ним судить о тексте на сайте бессмысленно:
 * правится текст, а комментарий остаётся напоминанием. Поэтому сначала
 * вырезаются блоки комментариев, а уже потом ищутся обещания.
 */
function visibleLines(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/&nbsp;/g, " ");
}

describe("ТЗ-32 D1: закрытые форматы названы вместе с тарифом «Плюс»", () => {
  it.each([
    ["Features.tsx", FEATURES],
    ["Comparison.tsx", COMPARISON],
    ["Footer.tsx", FOOTER],
  ])("%s: закрытый формат не упоминается без «Плюс»", (_name, text) => {
    const norm = visibleLines(text);
    for (const fmt of CLOSED_FORMATS) {
      const re = new RegExp(fmt, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(norm)) !== null) {
        // Окно вокруг упоминания: тариф читается в той же строке или рядом.
        const around = norm.slice(Math.max(0, m.index - 120), m.index + 200);
        expect(
          around,
          `«${m[0]}» без упоминания тарифа «Плюс»`,
        ).toMatch(/Плюс/i);
      }
    }
  });

  it("Features.tsx: закрытые форматы названы тарифом, а не местом в кабинете", () => {
    expect(visibleLines(FEATURES)).toMatch(/План урока[\s\S]{0,80}Плюс/);
    // Старая формулировка обещала, что форматы «тоже работают», и уводила
    // в кабинет — это и было обещание, которого продукт не выполняет.
    expect(FEATURES).not.toMatch(/их место в\s+кабинете|тоже работают/);
  });

  it("Comparison.tsx: строка про планы, презентации и КТП называет тариф", () => {
    expect(COMPARISON).toMatch(/Планы уроков, презентации и КТП — в тарифе «Плюс»/);
    expect(COMPARISON).not.toMatch(/в одном сервисе/);
  });

  it("Footer.tsx: подпись не обещает КТП и презентации всем подряд", () => {
    const norm = FOOTER.replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    expect(norm).toMatch(/ИИ-генератор рабочих листов по ФГОС/);
    expect(norm).toMatch(/План урока, презентация и КТП — в тарифе «Плюс»/);
  });

  it("карточка тарифа «Базовый» не обещает план урока", async () => {
    const { PLANS } = await import("@/lib/content/plans");
    const base = PLANS.base.features.join(" ");
    expect(base.toLowerCase()).not.toMatch(/планы уроков|план урока/);
    const plus = PLANS.plus.features.join(" ");
    expect(plus).toMatch(/План урока/);
  });
});

describe("ТЗ-32 AD-9: время генерации и время сверки — разные числа", () => {
  it.each([
    ["Hero.tsx", HERO],
    ["Footer.tsx", FOOTER],
  ])("%s: «примерно за минуту» на месте генерации убрано", (_name, text) => {
    expect(visibleLines(text)).not.toMatch(/примерно за минуту/);
  });

  it.each([
    ["Hero.tsx", HERO],
    ["Footer.tsx", FOOTER],
  ])("%s: время генерации — одно, «за 30 секунд»", (_name, text) => {
    const times = visibleLines(text).match(/\d+[-–]?\d*\s*(?:секунд|минут\w*)/g) ?? [];
    // Время сверки («1–3 минуты») допустимо — оно про другую операцию.
    for (const t of times) {
      if (/минут/.test(t)) expect(t).toMatch(/1[-–]3/);
      else expect(t).toMatch(/30/);
    }
  });

  it("время сверки в Features осталось отдельной строкой со своим числом", () => {
    expect(FEATURES).toMatch(/1[-–]3 минуты на лист/);
  });
});

describe("ТЗ-32 часть 5: описание сайта не расходится с живой квотой", () => {
  it("layout.tsx берёт число квоты из plans.ts, а не пишет его руками", () => {
    expect(LAYOUT).toMatch(/FREE_GENERATIONS/);
    expect(LAYOUT.replace(/\s+/g, " ")).not.toMatch(/Без регистрации — \d/);
  });

  it("в layout.tsx нет обещания «3 бесплатно»", () => {
    expect(visibleLines(LAYOUT)).not.toMatch(/3 бесплатно/);
  });

  it("число квоты в description берётся из константы, а не вписано строкой", () => {
    const desc = LAYOUT.match(/description:\s*\n?\s*`([^`]*)`/)?.[1] ?? "";
    expect(desc).toMatch(/FREE_GENERATIONS/);
  });
});

describe("компоненты рендерятся с новыми текстами", () => {
  it("Features показывает тариф «Плюс»", async () => {
    const React = (await import("react")).default;
    const { render, screen } = await import("@testing-library/react");
    render(<Features />);
    expect(screen.getAllByText(/Плюс/i).length).toBeGreaterThan(0);
  });

  it("Comparison показывает тариф «Плюс»", async () => {
    const { render, screen } = await import("@testing-library/react");
    render(<Comparison />);
    expect(screen.getAllByText(/Плюс/i).length).toBeGreaterThan(0);
  });
});
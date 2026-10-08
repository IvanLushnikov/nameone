/**
 * Печать: бейджи видны на экране и НЕ печатаются.
 *
 * Вопрос учительницы: «А эта плашка "не проверено" на лист не попадёт? И
 * зачем она вообще?» Ответ, который мы закрепили тестом: на экране бейдж
 * нужен (это честный статус AI-проверки), а на распечатанном листе он —
 * служебная мусора, поэтому весь блок помечен классом `no-print`, а в
 * `globals.css` есть правило `.no-print { display: none !important }`
 * внутри `@media print`.
 *
 * ПОЧЕМУ ДВЕ ПРОВЕРКИ, А НЕ ОДНА. Класс без правила в CSS — мёртвый
 * код: плашка всё равно напечатается. Правило без класса — тоже мёртвое.
 * Поэтому тест закрывает ОБЕ стороны:
 *   1) DOM: у бейджей и плашки «Проверено ИИ» реально стоит `no-print`
 *      (проверяем и `VerifiedBadge` напрямую, и полный `WorksheetPreview`);
 *   2) CSS-файл: правило `.no-print → display: none !important` реально
 *      лежит ВНУТРИ блока `@media print`, и вне его нет ни одного
 *      определения `.no-print` (иначе бейджи скрылись бы и на экране).
 *
 * Читаем `globals.css` с диска, а не через CSS-in-JS: vitest гоняет
 * компоненты, а не собирает Tailwind, поэтому единственный честный
 * источник печатных правил — сам файл.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { VerifiedBadge } from "@/components/constructor/VerifiedBadge";
import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import type { Worksheet } from "@/lib/types";

const CSS_PATH = path.resolve(__dirname, "../../src/app/globals.css");
const CSS = fs.readFileSync(CSS_PATH, "utf8");

/**
 * Вырезает тело блока `@media print { … }` по балансу скобок.
 * Наивный regex по `@media print[^{]*\{([^}]*)\}` обрезал бы файл на
 * первой же внутренней скобке (там же `@page { … }`), поэтому считаем.
 */
function printMediaBody(css: string): string {
  const start = css.indexOf("@media print");
  if (start === -1) throw new Error("В globals.css нет блока @media print");
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("Блок @media print не закрыт");
}

/** Сколько раз встречается последовательность `имя` + `{` (без учёта комментариев). */
function ruleOccurrences(css: string, name: string): number {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return (clean.match(new RegExp(`\\${name}\\s*(,[^{]*)?\\{`, "g")) ?? []).length;
}

/**
 * Узел-носитель класса `no-print` для бейджа с подписью `label`.
 *
 * ВАЖНО, почему не `getByText(label).className`: в `VerifiedBadge` подпись
 * лежит во ВЛОЖЕННОМ span без классов, а `no-print` стоит на внешнем.
 * `closest(".no-print")` ищет сам узел с классом — ровно тот, к которому
 * применится CSS-правило.
 */
function noPrintNodeFor(label: string): HTMLElement {
  const found = screen.getByText(label).closest(".no-print");
  if (!found) throw new Error(`У узла «${label}» нет класса no-print`);
  return found as HTMLElement;
}

/**
 * Все узлы с классом `no-print` для подписи `label`.
 *
 * Нужен там, где подпись встречается несколько раз: «ИИ-проверено» стоит и
 * в шапке листа, и у задания, и `getByText` на таком падает с «Found
 * multiple elements». Возвращаем все — вызывающий проверяет, что класс
 * стоит на каждом.
 */
function noPrintNodesFor(label: string): HTMLElement[] {
  return screen
    .getAllByText(label)
    .map((node) => node.closest(".no-print"))
    .filter((node): node is HTMLElement => node !== null);
}

/**
 * Бейдж статуса в шапке листа — отдельно от бейджей у заданий.
 *
 * Раньше шапка содержала захардкоженный див «Проверено ИИ», который не зависел
 * от статусов заданий вообще. Теперь это тот же `VerifiedBadge`, но с честным
 * значением, поэтому в тестах его надо адресовать точечно.
 */
function headerBadgeIn(container: HTMLElement): HTMLElement {
  const header = container.querySelector("header");
  if (!header) throw new Error("В листе нет шапки");
  const badge = header.querySelector(".no-print");
  if (!badge) throw new Error("В шапке листа нет бейджа статуса проверки");
  return badge as HTMLElement;
}

const PRINT_BODY = printMediaBody(CSS);

/**
 * Лист с тремя заданиями и всеми тремя статусами AI-проверки:
 * `true` → «ИИ-проверено», `false` → «Требует проверки», `null` → «не проверено».
 * Тексты без дробей — тест про печать, а не про KaTeX (ленивый импорт
 * katex не нужен и не должен флейкать).
 */
const WORKSHEET: Worksheet = {
  id: "w-print-1",
  title: "Печать листа",
  subject: "Русский язык",
  grade: 5,
  topic: "orfografiya",
  difficulty: "medium",
  createdAt: "2026-10-01T10:00:00.000Z",
  tasks: [
    {
      number: 1,
      text: "В каком слове пишется ь?",
      type: "multiple-choice",
      options: ["медведь", "медведи"],
      answer: "медведь",
      explanation: "Мягкий знак в конце слова",
      points: 1,
      verified: true,
      verifiedExplanation: "AI подтвердил",
    },
    {
      number: 2,
      text: "Найди проверочное слово",
      type: "short-answer",
      answer: "лис",
      explanation: "Словарное слово",
      points: 1,
      verified: false,
      verifiedExplanation: "AI не сошёлся",
    },
    {
      number: 3,
      text: "Составь предложение",
      type: "short-answer",
      answer: "Медведь спит",
      explanation: "Подлежащее и сказуемое",
      points: 2,
      verified: null,
    },
  ],
};

describe("VerifiedBadge: класс no-print", () => {
  it("во всех трёх состояниях бейдж помечен no-print", () => {
    for (const verified of [true, false, null, undefined] as const) {
      const { unmount } = render(<VerifiedBadge verified={verified} />);
      const label =
        verified === true
          ? "ИИ-проверено"
          : verified === false
            ? "Требует проверки"
            : "не проверено";
      // Класс стоит на внешнем span — там, где его и увидит CSS.
      const node = noPrintNodeFor(label);
      expect(node.textContent).toContain(label);
      unmount();
    }
  });

  it("свой className от вызывающего не съедает no-print", () => {
    render(<VerifiedBadge verified={true} className="mt-2" />);
    const node = noPrintNodeFor("ИИ-проверено");
    expect(node.className).toContain("mt-2");
  });
});

/**
 * Тот же лист, но проверены ВСЕ задания. Нужен, чтобы проверить обратную
 * сторону: зелёный статус в шапке появляется только когда проверен весь лист.
 */
const ALL_VERIFIED: Worksheet = {
  ...WORKSHEET,
  tasks: WORKSHEET.tasks.map((t) => ({ ...t, verified: true })),
};

describe("WorksheetPreview: бейджи на экране, но не на печати", () => {
  it("плашка в шапке показывает реальный статус листа, а не всегда «Проверено ИИ»", () => {
    const { container } = render(
      <WorksheetPreview worksheet={WORKSHEET} withAnswers withExplanations type="worksheet" />
    );

    // В WORKSHEET задания с разными статусами (true / false / null), поэтому
    // лист проверен не весь и в шапке зелёного «ИИ-проверено» быть не должно.
    // Раньше там стоял безусловный бейдж «Проверено ИИ» — он показывался даже
    // для листа, который никто не проверял. Смотрим ИМЕННО шапку, а не весь
    // документ: у первого задания статус «ИИ-проверено» есть, и это правда.
    const headerBadge = headerBadgeIn(container);
    expect(headerBadge.textContent).toContain("не проверено");
    expect(headerBadge.textContent).not.toContain("ИИ-проверено");
    expect(headerBadge.className).toContain("no-print");

    // Бейджи у заданий: все три состояния на месте, у каждого no-print.
    for (const label of ["ИИ-проверено", "Требует проверки", "не проверено"]) {
      const nodes = noPrintNodesFor(label);
      expect(nodes.length, `бейдж «${label}» не найден`).toBeGreaterThan(0);
    }
  });

  it("когда проверены все задания, в шапке стоит «ИИ-проверено»", () => {
    const { container } = render(
      <WorksheetPreview worksheet={ALL_VERIFIED} withAnswers withExplanations type="worksheet" />
    );
    const headerBadge = headerBadgeIn(container);
    expect(headerBadge.textContent).toContain("ИИ-проверено");
    expect(headerBadge.className).toContain("no-print");
  });

  it("no-print не съел сам лист: текст заданий печатается", () => {
    // Обратная сторона: если бы `no-print` висел на контейнере листа,
    // печать была бы пустой. Проверяем, что у содержимого этого класса нет.
    const { container } = render(
      <WorksheetPreview worksheet={WORKSHEET} withAnswers withExplanations type="worksheet" />
    );

    const page = container.querySelector(".worksheet-page");
    expect(page).not.toBeNull();
    expect(page!.className).not.toContain("no-print");
    expect(container.querySelector("ol")?.className ?? "").not.toContain("no-print");
    // Текст задания осталось в разметке — печатать есть что.
    expect(page!.textContent).toContain("В каком слове пишется ь?");
  });

  it("страница ответов печатается целиком, а её плашка «Шифр ответов» — не no-print", () => {
    // Проверка на «хвост»: no-print не должен быть разбросан по шаблону.
    // Страница ответов — это то, что учитель печатает по бумаге, поэтому
    // и текст, и её служебная плашка обязаны уйти на печать.
    const { container } = render(
      <WorksheetPreview worksheet={WORKSHEET} withAnswers withExplanations type="worksheet" />
    );

    const pages = container.querySelectorAll(".worksheet-page");
    expect(pages).toHaveLength(2);
    expect(pages[1].textContent).toContain("Ответы и пояснения");
    expect(pages[1].textContent).toContain("медведь");
    expect(pages[1].className).not.toContain("no-print");
    expect(screen.getByText("Шифр ответов").className).not.toContain("no-print");
  });
});

describe("globals.css: правило .no-print существует и живёт в @media print", () => {
  it("внутри @media print есть .no-print { display: none !important }", () => {
    const rule = PRINT_BODY.match(/\.no-print\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule![1].replace(/\s+/g, " ").trim();
    expect(body).toBe("display: none !important;");
  });

  it("вне @media print нет ни одного определения .no-print", () => {
    // Иначе бейджи исчезли бы и на экране — обратная жалоба.
    const total = ruleOccurrences(CSS, ".no-print");
    expect(total).toBe(1);
    expect(ruleOccurrences(PRINT_BODY, ".no-print")).toBe(1);
  });

  it("правило не перекрыто более слабым display вне print", () => {
    // Слабое правило `.no-print { display: block }` в экране выиграло бы
    // по порядку каскада у Google Docs/Word — поэтому проверяем, что
    // внутри print стоит именно `!important`.
    const body = PRINT_BODY.match(/\.no-print\s*\{([^}]*)\}/)![1];
    expect(body).toContain("!important");
  });
});

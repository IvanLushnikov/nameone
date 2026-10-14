/**
 * Лист 2.1.4: дробь показывается ДРОБЬЮ, а не строкой `(x² − 9)/(x² + 6x + 9)`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ТУТ ЛОВИТСЯ
 *
 * 1) Скобочная дробь. `parseLegacyMath` умеет `3/4` (атом/атом), но
 *    `(x² − 9)/(x² + 6x + 9)` не узнавал вообще: по обе стороны косой черты не
 *    атом, а выражение в скобках. Такая строка уходила и на экран, и в DOCX
 *    обычным текстом — материал выдавал себя генератором.
 * 2) Тот же дефект в выгрузке. Учитель чаще отдаёт DOCX, чем смотрит превью,
 *    поэтому «красиво на экране» недостаточно: в `word/document.xml` должен быть
 *    OMML-дробь (`<m:f>` с `<m:num>`/`<m:den>`), а не скобки с чертой.
 * 3) Ответы и пояснения — те же сегменты, что и текст задания: дробь в ответе
 *    тоже обязана быть дробью, иначе сверка «что напечатано» ≠ «что на экране».
 * 4) РЕГРЕСС-ГЕЙТ. Простые случаи — `2x + 5 = 11`, `a²`, `3/4`, `км/ч`,
 *    `июль/август`, `sin(x)/2` — это большинство материала по математике и по
 *    русскому языку. Новый разбор не имеет права превращать их в формулы.
 *
 * ПРОВЕРКА ПО DOM, А НЕ ПО СКРИНШОТУ. Вертикальная дробь KaTeX = элементы
 * `.katex` и `.mfrac`, а черта внутри = `.frac-line`. Для DOCX распаковываем
 * настоящий zip и смотрим XML — так же, как это делает `tz26-docx-header`.
 *
 * НЕ JSX. Файл создан как `.ts` (владелец листа выдал именно такое имя), а JSX
 * требует расширения `.tsx`. Поэтому компонент собираем через `createElement` —
 * это ровно тот же `MathText`, просто без синтаксической обёртки.
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { MathText } from "@/components/math/MathText";
import { splitFormulaText, generateWorksheetDocx } from "@/lib/utils/docx";
import type { Worksheet } from "@/lib/types";

/** Дробь из жалобы учительницы — ровно та строка, ради которой лист и делался. */
const PAREN_FRACTION = "(x² − 9)/(x² + 6x + 9)";

/** Базовый случай из требований листа: обычное уравнение без дробей. */
const BASELINE = "2x + 5 = 11";

async function renderMathText(text: string, textLatex?: string | null): Promise<HTMLElement> {
  const { container } = render(
    createElement(MathText, { text, textLatex: textLatex ?? undefined })
  );
  // KaTeX (~300 КБ) грузится лениво — ждём его ПРИБЫТИЯ, а не «просто подождали».
  await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull(), {
    timeout: 5_000,
  });
  return container;
}

/** Текст без единой формулы — рендерим и проверяем сразу, ждать нечего. */
function renderPlain(text: string): HTMLElement {
  const { container } = render(createElement(MathText, { text }));
  return container;
}

/** `word/document.xml` из собранного DOCX. */
async function documentXml(blob: Blob): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "leaf-2-1-4-"));
  try {
    const file = join(dir, "out.docx");
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    return execFileSync("unzip", ["-p", file, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function worksheetWithFraction(): Worksheet {
  return {
    id: "w-frac",
    title: "Рациональные дроби",
    subject: "algebra",
    grade: 8,
    topic: "Рациональные дроби",
    difficulty: "medium",
    createdAt: "2026-10-14T00:00:00.000Z",
    tasks: [
      {
        number: 1,
        text: `Сократите дробь ${PAREN_FRACTION} и укажите область определения.`,
        answer: "(x − 3)/(x + 3)",
        explanation: "Раскладываем по формуле сокращения: a² − b² = (a − b)(a + b).",
        points: 2,
      },
      {
        number: 2,
        text: `Решите уравнение ${BASELINE} и запишите корень.`,
        answer: "x = 3",
        explanation: "2x = 6, значит x = 3.",
        points: 1,
      },
    ],
  } as unknown as Worksheet;
}

/* -------------------------------------------------------------------------- */

describe("превью: скобочная дробь рисуется дробью", () => {
  it(`"${PAREN_FRACTION}" → вертикальная дробь с чертой, а не строка`, async () => {
    const container = await renderMathText(`Сократите дробь ${PAREN_FRACTION}.`);

    const mfrac = container.querySelector(".mfrac");
    expect(mfrac).not.toBeNull();
    // `.frac-line` — та самая черта между числителем и знаменателем.
    expect(mfrac?.querySelector(".frac-line")).not.toBeNull();
    // Числитель и знаменатель — внутри этой дроби.
    expect(mfrac?.textContent).toContain("9");
    expect(mfrac?.textContent).toContain("6x");
  });

  it("линейной записи на экране не осталось: ни скобок, ни косой черты", async () => {
    const container = await renderMathText(`Сократите дробь ${PAREN_FRACTION}.`);

    // Прямая проверка гейта G1: если хоть где-то остался бы «(x² − 9)/(…)»,
    // это был бы тот самый вид, из-за которого материал выдаёт генератор.
    expect(container.textContent).not.toContain(PAREN_FRACTION);
    expect(container.querySelector(".mfrac")?.textContent).not.toContain("/");
    expect(container.querySelector(".mfrac")?.textContent).not.toContain("(");
  });

  it("текст задания вокруг дроби сохраняется", async () => {
    const container = await renderMathText(`Сократите дробь ${PAREN_FRACTION}.`);

    expect(container.textContent).toContain("Сократите дробь");
    expect(container.textContent).toContain(".");
  });

  it("дробь в ОТВЕТЕ тоже рисуется дробью (то, что сверяют, = то, что напечатано)", async () => {
    const container = await renderMathText("Ответ: (x − 3)/(x + 3)");

    expect(container.querySelector(".mfrac")).not.toBeNull();
  });

  it("деление на выражение 5/(x + 1) — тоже дробь", async () => {
    const container = await renderMathText("Найдите значение 5/(x + 1).");

    expect(container.querySelector(".mfrac")).not.toBeNull();
  });
});

describe("превью: простые случаи не сломаны (регресс-гейт)", () => {
  it(`${BASELINE} остаётся обычным текстом — ни формулы, ни изменения символов`, () => {
    const container = renderPlain(BASELINE);

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe(BASELINE);
  });

  it("«a²» и «2 · 5² − 18 ÷ 3» остаются текстом", () => {
    expect(renderPlain("a²").textContent).toBe("a²");
    const expr = renderPlain("Найдите значение выражения: 2 · 5² − 18 ÷ 3.");
    expect(expr.querySelector(".katex")).toBeNull();
    expect(expr.textContent).toBe("Найдите значение выражения: 2 · 5² − 18 ÷ 3.");
  });

  it("простая дробь 3/4 по-прежнему рисуется дробью (регресс parseLegacyMath)", async () => {
    const container = await renderMathText("Сколько будет 3/4 + 1/4?");

    expect(container.querySelectorAll(".mfrac")).toHaveLength(2);
  });

  it("текст по русскому с косой чертой остаётся текстом", () => {
    for (const text of ["Скорость 60 км/ч", "Каникулы в июле/августе", "Путь C:/Users/test"]) {
      const container = renderPlain(text);
      expect(container.querySelector(".katex")).toBeNull();
      expect(container.textContent).toBe(text);
    }
  });
});

describe("разбор: что мы намеренно НЕ превращаем в дробь", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["sin(x)/2 — имя функции не должно отрываться от скобок", "sin(x)/2"],
    ["50%/3 — процент не дробь", "50%/3"],
    ["(незакрытая/скобка — парная скобка не закрыта", "(незакрытая/скобка"],
    ["12/10/2026 — дата не дробь (признано ограничением)", "12/10/2026"],
  ];

  for (const [title, text] of cases) {
    it(title, () => {
      const segments = splitFormulaText(text);
      const math = segments.filter((s) => s.type === "math");

      // Для `12/10/2026` допускается уже существующее поведение parseLegacyMath
      // (`\frac{12}{10}`) — его мы не чиним, но и не ухудшаем.
      if (text.startsWith("12/10")) {
        expect(math).toHaveLength(1);
        return;
      }
      expect(math).toHaveLength(0);
    });
  }
});

describe("разбор: запасной вид остаётся читаемым", () => {
  it("fallback дроби — исходный текст со косой чертой, а не сырой LaTeX", () => {
    const math = splitFormulaText(PAREN_FRACTION).filter((s) => s.type === "math");

    expect(math).toHaveLength(1);
    expect(math[0]).toMatchObject({ type: "math", fallback: PAREN_FRACTION });
  });

  it("битый text_latex → откат на исходный текст, мусор от LaTeX не виден", async () => {
    const text = `Сократите дробь ${PAREN_FRACTION}`;
    const { container } = render(
      createElement(MathText, { text, textLatex: "Сократите дробь $\\frac{1}{$" })
    );

    // Одна битая формула уводит лист на исходный `text` (поведение зафиксировано
    // в tests/integration/math-render.test.tsx) — и он должен остаться читаемым.
    await waitFor(() => expect(container.textContent).toBe(text), { timeout: 5_000 });
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).not.toContain("frac");
  });
});

describe("выгрузка DOCX: битая формула не портит файл", () => {
  it("неразобранный text_latex → в файл уходит исходный текст задания", async () => {
    // Тот же случай, что и на экране, но в файле. Без отката `latexToUnicode`
    // на битом `\frac{1}{` выдаёт «1», и в раздаточный файл уехал бы обрывок
    // «Упростите выражение 1» вместо самого задания.
    const worksheet = {
      ...worksheetWithFraction(),
      tasks: [
        {
          number: 1,
          text: "Упростите выражение (a + 3)/(a − 3).",
          text_latex: "Упростите выражение $\\frac{1}{$",
          answer: "не упрощается",
          explanation: "приводим к общему знаменателю",
          points: 2,
        },
      ],
    } as unknown as Worksheet;

    const xml = await documentXml(await generateWorksheetDocx(worksheet));

    // Битый LaTeX выброшен целиком: ни «frac», ни одиночной «1» от огрызка.
    expect(xml).not.toContain("frac");
    expect(xml).not.toContain("Упростите выражение</w:t></w:r><m:oMath><m:r>");
    // Задание восстановлено из `text` — и, поскольку там нормальная дробь,
    // уехало дробью, а не строкой.
    expect(xml).toContain("Упростите выражение ");
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("a + 3");
    expect(xml).toContain("a − 3");
  });
});

describe("выгрузка DOCX: дробь уезжает дробью", () => {
  it("в word/document.xml есть OMML-дробь с числителем и знаменателем", async () => {
    const xml = await documentXml(await generateWorksheetDocx(worksheetWithFraction()));

    // `<m:f>` — дробь OMML. Word, LibreOffice и Google Docs рисуют её с чертой.
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:num>");
    expect(xml).toContain("<m:den>");
    // Формула вообще вставлена как математика, а не как текстовый run.
    expect(xml).toContain("oMath");
  });

  it("линейной записи со скобками в файле не осталось", async () => {
    const xml = await documentXml(await generateWorksheetDocx(worksheetWithFraction()));

    expect(xml).not.toContain(PAREN_FRACTION);
    expect(xml).not.toContain("(x − 3)/(x + 3)");
  });

  it("базовое уравнение осталось текстом, а не формулой", async () => {
    const xml = await documentXml(await generateWorksheetDocx(worksheetWithFraction()));

    expect(xml).toContain(BASELINE);
  });

  it("степень внутри дроби НЕ теряется (важно для верности материала)", async () => {
    const xml = await documentXml(await generateWorksheetDocx(worksheetWithFraction()));

    // Известная дыра `latex-to-omml.ts`: при разборе аргумента в скобках
    // скрипты отбрасываются, и `\frac{x^{2}}{y}` превратился бы в `\frac{x}{y}`.
    // Поэтому степень уходит юникодом — проверяем, что она на месте, а не
    // «оптимизировалась» вместе со знаком.
    expect(xml).toContain("x²");
    expect(xml).not.toContain("x − 9");
  });
});
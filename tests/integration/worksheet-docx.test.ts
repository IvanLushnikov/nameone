/**
 * Ж1: таблица ответов в DOCX — `src/lib/utils/docx.ts`.
 *
 * Жалоба (скрин от учительницы): файл открывается в Google Docs, а колонки
 * таблицы ответов схлопнулись в посимвольные полоски — невозможно ни читать,
 * ни печатать. Причина была в том, что ширины задавались только в строке
 * заголовка: Google Docs без явной сетки `tblGrid` и без фиксированного
 * layout пересчитывает колонки по содержимому.
 *
 * Что проверяем на РЕАЛЬНОМ файле, а не на моках `docx`:
 *   1) `w:tblLayout w:type="fixed"` — layout зафиксирован;
 *   2) ровно три `w:gridCol` — сетка колонок объявлена явно;
 *   3) `w:tcW` есть в КАЖДОЙ ячейке таблицы, а не только в шапке (это и есть
 *      исходный баг);
 *   4) дробные задания едут настоящей математикой OMML (`<m:f>`), а не
 *      строкой «3/4» — это закрывает и критерий по вертикальным дробям.
 *
 * ПОЧЕМУ РАСПАКОВЫВАЕМ, А НЕ ПРОВЕРЯЕМ «НА СЛОВА»: `Packer.toBlob` отдаёт
 * готовый zip, а `Table`/`TableCell` — это JS-объекты, в которых нет ни
 * `w:tcW`, ни `tblGrid` в читаемом виде. Единственный честный способ увидеть
 * итоговый OOXML — распаковать `word/document.xml` (jszip уже в зависимостях).
 *
 * Сеть не используется, таймеров нет.
 */

import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { generateWorksheetDocx } from "@/lib/utils/docx";
import type { Worksheet } from "@/lib/types";

/**
 * Фикстура намеренно смешивает три пути появления формулы:
 *   - задание 1: `text` с «3/4» и БЕЗ `text_latex` → LEGACY-режим
 *     `parseLegacyMath` сам превращает дробь в `\frac`;
 *   - задание 2: явный `text_latex` с `$\frac{8}{12}$`;
 *   - задание 3: обычный текст без математики (контроль: OMML не лишняя).
 * Именно так выглядит реальный контент: старые темы хранят «a/b», новые
 * приходят из LLM уже с `text_latex`.
 */
const WORKSHEET: Worksheet = {
  id: "w-docx-1",
  title: "Дроби — DOCX-тест",
  subject: "Алгебра",
  grade: 7,
  topic: "drobi",
  difficulty: "medium",
  createdAt: "2026-10-01T10:00:00.000Z",
  tasks: [
    {
      number: 1,
      text: "Сравни 3/4 и 5/8",
      type: "short-answer",
      answer: "3/4 > 5/8",
      explanation: "Приводим к знаменателю 8: 6/8 > 5/8",
      points: 2,
    },
    {
      number: 2,
      text: "Сократи дробь",
      type: "short-answer",
      answer: "2/3",
      explanation: "Сокращаем на 4",
      points: 1,
    },
    {
      number: 3,
      text: "Найди периметр прямоугольника",
      type: "computation",
      answer: "18 см",
      explanation: "Складываем длину и ширину, умножаем на 2",
      points: 2,
    },
  ],
} as Worksheet & {
  tasks: (Worksheet["tasks"][number] & { text_latex?: string })[];
};

// `text_latex` в типах ещё нет (его добавляет владелец типов) — задаём
// структурным пересечением, тем же приёмом, что и сам `docx.ts`.
// ВАЖНО: это обычный TS-объект, а не JSX-атрибут, поэтому "\\frac" здесь
// корректно превращается в `\frac`.
Object.assign(WORKSHEET.tasks[1], {
  text_latex: "Сократи дробь $\\frac{8}{12}$",
});

/** Сколько строк в таблице ответов: шапка + по одной на задание. */
const EXPECTED_ROWS = 1 + WORKSHEET.tasks.length;
const EXPECTED_CELLS = EXPECTED_ROWS * 3;

let documentXml: string;

beforeAll(async () => {
  const blob = await generateWorksheetDocx(WORKSHEET);
  expect(blob.size).toBeGreaterThan(1024);

  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("В DOCX нет word/document.xml — документ собран не полностью");
  documentXml = await file.async("string");
});

/**
 * jsdom-овский Blob. В одних версиях есть `arrayBuffer()`, в других — нет,
 * поэтому берём путь, который точно доступен, и не падаем из-за окружения.
 */
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Все вхождения тега `<w:tc>…</w:tc>` как отдельные куски. */
function tableCells(xml: string): string[] {
  return xml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
}

describe("таблица ответов в DOCX (Ж1)", () => {
  it("у таблицы зафиксирован layout: fixed", () => {
    const layout = documentXml.match(/<w:tblLayout[^>]*>/g) ?? [];
    expect(layout).toHaveLength(1);
    expect(layout[0]).toContain('w:type="fixed"');
  });

  it("объявлена сетка колонок: три gridCol", () => {
    const grid = documentXml.match(/<w:gridCol[^>]*>/g) ?? [];
    expect(grid).toHaveLength(3);
    // Ширины сетки должны быть ненулевыми, иначе сетка формально есть,
    // а колонки всё равно схлопнутся.
    for (const col of grid) {
      const w = Number(col.match(/w:w="(\d+)"/)?.[1]);
      expect(w).toBeGreaterThan(0);
    }
  });

  it("ширина задана в КАЖДОЙ ячейке, а не только в строке заголовка", () => {
    const cells = tableCells(documentXml);
    expect(cells).toHaveLength(EXPECTED_CELLS);

    const withWidth = cells.filter((c) => /<w:tcW[^>]*>/.test(c));
    // Именно этот assert ловил исходный баг: ширины были только в трёх
    // ячейках шапки, а строки данных шли без `w:tcW`.
    expect(withWidth).toHaveLength(EXPECTED_CELLS);

    // В шапке и в строке данных ширины одинаковые по колонкам — иначе
    // первая же строка растянет колонки по своему содержимому.
    const headerWidths = cells.slice(0, 3).map((c) => c.match(/w:w="(\d+)"/)?.[1]);
    const dataWidths = cells.slice(3, 6).map((c) => c.match(/w:w="(\d+)"/)?.[1]);
    expect(new Set(headerWidths).size).toBe(1);
    expect(headerWidths).toEqual(dataWidths);
  });

  it("дробные задания едут нативной математикой OMML, а не строкой «3/4»", () => {
    // Нативная дробь Word = <m:f> (fraction) с <m:num>/<m:den>.
    const fractions = documentXml.match(/<m:f>/g) ?? [];
    expect(fractions.length).toBeGreaterThanOrEqual(2);

    // Числитель и знаменатель лежат ВНУТРИ m:f, а не рядом текстом.
    // Конкретно 3/4 из первого задания: `3` в m:num, `4` в m:den.
    expect(documentXml).toMatch(
      /<m:f>\s*<m:num>(?:(?!<\/m:f>)[\s\S])*?<m:t>3<\/m:t>[\s\S]*?<\/m:num>\s*<m:den>(?:(?!<\/m:f>)[\s\S])*?<m:t>4<\/m:t>[\s\S]*?<\/m:den>\s*<\/m:f>/
    );
    // И 8/12 из задания с явным `text_latex` — второй, независимый путь
    // (LEGACY-режим и явный LaTeX) оба дают настоящую математику.
    expect(documentXml).toMatch(
      /<m:f>\s*<m:num>(?:(?!<\/m:f>)[\s\S])*?<m:t>8<\/m:t>[\s\S]*?<\/m:num>\s*<m:den>(?:(?!<\/m:f>)[\s\S])*?<m:t>12<\/m:t>[\s\S]*?<\/m:den>\s*<\/m:f>/
    );

    // Главный анти-критерий: «посимвольного» текстового хвоста вида «3/4»
    // в документе не осталось. Если OMML перестанет собираться и сработает
    // юникод-фолбэк, этот assert упадёт.
    expect(documentXml).not.toContain("3/4");
    expect(documentXml).not.toContain("8/12");

    // Каждая формула обёрнута в oMath — иначе Word/LibreOffice не покажут
    // её как редактируемую математику.
    const math = documentXml.match(/<m:oMath>[\s\S]*?<\/m:oMath>/g) ?? [];
    expect(math.length).toBeGreaterThanOrEqual(2);
  });

  it("текст задания и его текстовая часть рядом с формулой не потеряны", () => {
    // Число и номер задания на месте — формула встала ВМЕСТО «3/4»,
    // а не вытеснила весь абзац.
    expect(documentXml).toContain("Сравни");
    expect(documentXml).toContain("Сократи дробь");
    expect(documentXml).toContain("Ответы и пояснения");
  });

  it("с генерацией без таблицы ответов документ тоже собирается", async () => {
    const blob = await generateWorksheetDocx(WORKSHEET, { withAnswers: false });
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const file = zip.file("word/document.xml");
    expect(file).not.toBeNull();
    const xml = await file!.async("string");
    expect(xml).not.toContain("<w:tbl>");
    expect(xml).toContain("Сравни");
  });
});

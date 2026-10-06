import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageOrientation,
  Table,
  TableLayoutType,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Footer,
  Header,
  PageNumber,
  Math as DocxMath,
  type ParagraphChild,
} from "docx";
import type { Worksheet, WorksheetTask } from "@/lib/types";
import { parseMathText } from "@/lib/math/latex";
import { latexToOmml, latexToUnicode } from "@/lib/math/latex-to-omml";
import { SITE_HOST } from "@/lib/site";

/**
 * Генератор DOCX для рабочего листа.
 * Учитель может открыть в Word/LibreOffice и отредактировать.
 */

/**
 * Задание с опциональным LaTeX-полем (Ф-10).
 *
 * `text_latex` в `src/lib/types.ts` пока нет — берём структурным пересечением,
 * тем же приёмом, что и `chartSpec` в WorksheetPreview. `text` не подменяем:
 * он остаётся источником правды для проверки ответов, `text_latex` — только
 * для отрисовки (здесь — в виде OMML, потому что KaTeX в документ не едет).
 */
type TaskWithLatex = WorksheetTask & { text_latex?: string };

/**
 * Собирает содержимое абзаца, где формулы становятся нативной математикой Word.
 *
 * Текстовые сегменты идут обычными `TextRun`, формульные — OMML через
 * `latexToOmml`. Если формулу в OMML превести не удалось, подставляем
 * юникод-фолбэк (`⅛ ⅓ ² √ × ·`): файл должен остаться читаемым, лучше
 * «2/3», чем сломанная выгрузка.
 */
function mathChildren(text: string, textLatex?: string, size?: number): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const segment of parseMathText(text, textLatex)) {
    if (segment.type === "text") {
      if (segment.value) children.push(new TextRun({ text: segment.value, size }));
      continue;
    }
    const omml = latexToOmml(segment.latex);
    if (omml) children.push(new DocxMath({ children: omml }));
    else children.push(new TextRun({ text: latexToUnicode(segment.latex), size }));
  }
  return children;
}

/**
 * Ширины колонок таблицы ответов.
 *
 * Заданы ОДИН раз и используются в трёх местах: на `Table` (`columnWidths`),
 * на всех строках (`width` в `TableRow`) и через `layout: FIXED`. Раньше
 * ширины были только в строке заголовка, из-за чего Google Docs рисовал
 * посимвольные колонки (скрин от учительницы) — ему не хватало сетки
 * `tblGrid` и фиксированного layout.
 *
 * Единицы — DXA (twips). A4 портрет = 11906, минус поля 1000+1000 = 9906.
 * Пропорции 8 / 32 / 60 (№ / Ответ / Пояснение) от ширины 9906.
 */
const COL_NO_PCT = 8;
const COL_ANSWER_PCT = 32;
const COL_EXPLAIN_PCT = 60;
const TABLE_TOTAL_DXA = 9906;
const COLUMN_WIDTHS_DXA = [
  Math.round((TABLE_TOTAL_DXA * COL_NO_PCT) / 100),
  Math.round((TABLE_TOTAL_DXA * COL_ANSWER_PCT) / 100),
  Math.round((TABLE_TOTAL_DXA * COL_EXPLAIN_PCT) / 100),
];

/** То же самое, но в процентах — так надёжнее понимают Word и LibreOffice. */
const COLUMN_WIDTHS_PCT = [COL_NO_PCT, COL_ANSWER_PCT, COL_EXPLAIN_PCT];

/**
 * `width` для ячейки по индексу колонки. Задаём ВСЕМ строкам (и шапке, и
 * данным) — иначе строки данных растягиваются по содержимому.
 */
function cellWidthPct(colIndex: number): { size: number; type: (typeof WidthType)[keyof typeof WidthType] } {
  return { size: COLUMN_WIDTHS_PCT[colIndex] ?? 100, type: WidthType.PERCENTAGE };
}

export async function generateWorksheetDocx(
  worksheet: Worksheet,
  options: { withAnswers?: boolean; withExplanations?: boolean; isDemo?: boolean } = {}
): Promise<Blob> {
  const { withAnswers = true, withExplanations = true, isDemo = false } = options;

  const children: Array<Paragraph | Table> = [];

  // Пометка заготовки — ПЕРВОЙ строкой файла (NEW-EXPORT-1, 06.10.2026).
  //
  // На экране демо-режим помечен плашкой, на печати — водяным знаком, а вот
  // выгруженный DOCX выглядел ровно как обычный готовый материал: учитель
  // отдавал его на печать или в класс, не зная, что это типовой шаблон.
  // Заготовка обязана быть видна в самом файле — иначе пометка теряется
  // ровно там, где файл уходит из приложения.
  if (isDemo) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "ДЕМОНСТРАЦИОННАЯ ЗАГОТОВКА",
            bold: true,
            size: 22,
            color: "C0392B",
          }),
        ],
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
      })
    );
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Это типовой шаблон, а не созданный материал. Текст заданий не учительский — не раздавайте его ученикам.",
            size: 18,
            color: "C0392B",
          }),
        ],
        alignment: AlignmentType.LEFT,
        spacing: { after: 240 },
      })
    );
  }

  // Шапка листа
  children.push(
    new Paragraph({
      text: "Рабочий лист",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: worksheet.title, bold: true, size: 28 }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${worksheet.subject} · ${worksheet.grade} класс · `,
        }),
        new TextRun({
          text:
            worksheet.difficulty === "easy"
              ? "лёгкий уровень"
              : worksheet.difficulty === "medium"
                ? "средний уровень"
                : "сложный уровень",
        }),
      ],
      spacing: { after: 200 },
    })
  );

  // Поля для имени и класса
  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Имя: ____________________________________", size: 22 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Класс: ___________________________________", size: 22 })],
      spacing: { after: 240 },
    })
  );

  // Задания
  for (const task of worksheet.tasks) {
    const taskLatex = (task as TaskWithLatex).text_latex;

    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${task.number}. `, size: 24 }),
          ...mathChildren(task.text, taskLatex, 24),
        ],
        spacing: { after: 80 },
      }),
      ...(task.options ?? []).map(
        (opt, i) =>
          new Paragraph({
            children: [
              new TextRun({ text: `   ${String.fromCharCode(65 + i)}) `, size: 22 }),
              ...mathChildren(opt, undefined, 22),
            ],
            spacing: { after: 40 },
          })
      ),
      new Paragraph({
        children: [
          new TextRun({
            text: `Ответ: ________________________________________________     (${task.points} ${task.points === 1 ? "балл" : "балла"})`,
            size: 20,
            color: "888888",
          }),
        ],
        spacing: { after: 240 },
      })
    );
  }

  // Подвал листа
  // Подвал листа.
  // ВАЖНО: «проверено AI» пишем ТОЛЬКО когда проверка реально прошла.
  // Раньше строка печаталась безусловно, для любого листа: на экране бейдж
  // честно показывал «не проверено» (и исчезал на печати), а в скачанном
  // DOCX оставалось утверждение «проверено AI» — ровно тот вопрос, который
  // задала учительница.
  const allVerified =
    !isDemo &&
    worksheet.tasks.length > 0 &&
    worksheet.tasks.every((t) => t.verified === true);

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: isDemo
            ? `УчЛист · ${SITE_HOST} · демонстрационная заготовка`
            : allVerified
              ? `УчЛист · ${SITE_HOST} · проверено AI`
              : `УчЛист · ${SITE_HOST}`,
          size: 18,
          color: "999999",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
    })
  );

  // Страница ответов
  if (withAnswers) {
    children.push(
      new Paragraph({
        text: "",
        pageBreakBefore: true,
      }),
      new Paragraph({
        text: "Ответы и пояснения",
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "Только для учителя — не раздавать ученикам",
            italics: true,
            color: "C73213",
            size: 22,
          }),
        ],
        spacing: { after: 200 },
      })
    );

    const rows: TableRow[] = [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "№", bold: true })] })],
            width: cellWidthPct(0),
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Ответ", bold: true })] })],
            width: cellWidthPct(1),
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Пояснение", bold: true })] })],
            width: cellWidthPct(2),
          }),
        ],
      }),
      ...worksheet.tasks.map(
        (task) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(task.number), bold: true })] })],
                width: cellWidthPct(0),
              }),
              new TableCell({
                children: [
                  new Paragraph({ children: mathChildren(task.answer ?? "—", undefined) }),
                ],
                width: cellWidthPct(1),
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: mathChildren(
                      withExplanations && task.explanation ? task.explanation : "—"
                    ),
                  }),
                ],
                width: cellWidthPct(2),
              }),
            ],
          })
      ),
    ];

    children.push(
      new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        // Фиксированный layout + явная сетка колонок: без этого Google Docs
        // пересчитывает ширины по содержимому и «размазывает» колонки.
        layout: TableLayoutType.FIXED,
        columnWidths: COLUMN_WIDTHS_DXA,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "EEEEEE" },
          insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "EEEEEE" },
        },
      })
    );
  }

  const doc = new Document({
    creator: "УчЛист",
    title: worksheet.title,
    description: `${worksheet.subject} · ${worksheet.grade} класс`,
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.PORTRAIT },
            margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `УчЛист · ${SITE_HOST}`,
                    size: 16,
                    color: "BBBBBB",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Стр. ", size: 16, color: "BBBBBB" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "BBBBBB" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

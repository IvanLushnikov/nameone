import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageOrientation,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Footer,
  Header,
  PageNumber,
} from "docx";
import type { Worksheet } from "@/lib/types";

/**
 * Генератор DOCX для рабочего листа.
 * Учитель может открыть в Word/LibreOffice и отредактировать.
 */

export async function generateWorksheetDocx(
  worksheet: Worksheet,
  options: { withAnswers?: boolean; withExplanations?: boolean } = {}
): Promise<Blob> {
  const { withAnswers = true, withExplanations = true } = options;

  const children: Array<Paragraph | Table> = [];

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
    const lines: string[] = [];

    lines.push(`${task.number}. ${task.text}`);

    if (task.options && task.options.length > 0) {
      task.options.forEach((opt, i) => {
        lines.push(`   ${String.fromCharCode(65 + i)}) ${opt}`);
      });
    }

    children.push(
      new Paragraph({
        children: [new TextRun({ text: lines[0], size: 24 })],
        spacing: { after: 80 },
      }),
      ...lines.slice(1).map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 22 })],
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
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "ЛистAI · listai.ru · проверено AI",
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
            width: { size: 8, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Ответ", bold: true })] })],
            width: { size: 32, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Пояснение", bold: true })] })],
            width: { size: 60, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
      ...worksheet.tasks.map(
        (task) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(task.number), bold: true })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: task.answer ?? "—" })] })],
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text:
                          withExplanations && task.explanation
                            ? task.explanation
                            : "—",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          })
      ),
    ];

    children.push(
      new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
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
    creator: "ЛистAI",
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
                    text: "ЛистAI · listai.ru",
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

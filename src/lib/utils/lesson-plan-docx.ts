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
import type { LessonPlan } from "@/lib/types";

/**
 * DOCX-экспорт плана урока.
 *
 * Используется учителем для распечатки или редактирования в Word / LibreOffice.
 * Структура документа:
 *   1. Заголовок (План урока · <тема>)
 *   2. Метаданные (предмет, класс, ФГОС-раздел, дата)
 *   3. Цели (обучающие / развивающие / воспитательные)
 *   4. Оборудование
 *   5. Таблица шагов урока (4 колонки)
 *   6. Домашнее задание + альтернативы
 */
export async function generateLessonPlanDocx(plan: LessonPlan): Promise<Blob> {
  const topicTitle = plan.title.replace(/^План урока · /, "");
  const totalMin = plan.stages.reduce((s, st) => s + st.durationMin, 0);

  const children: Array<Paragraph | Table> = [];

  // Шапка
  children.push(
    new Paragraph({
      text: "План урока",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: topicTitle, bold: true, size: 28 })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: plan.fgosRef
        ? [
            new TextRun({
              text: `${plan.subject} · ${plan.grade} класс · ${totalMin} мин · ${plan.fgosRef}`,
              italics: true,
            }),
          ]
        : [
            new TextRun({
              text: `${plan.subject} · ${plan.grade} класс · ${totalMin} мин`,
            }),
          ],
      spacing: { after: 200 },
    })
  );

  // Цели
  children.push(
    new Paragraph({
      text: "Цели урока",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 120, after: 80 },
    })
  );

  const goalBlock = (title: string, items: string[]) => [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 24 })],
      spacing: { after: 40 },
    }),
    ...(items.length === 0
      ? [new Paragraph({ children: [new TextRun({ text: "—", color: "999999" })], spacing: { after: 80 } })]
      : items.flatMap((it, idx) => [
          new Paragraph({
            children: [
              new TextRun({
                text: `${idx + 1}. ${it}`,
                size: 22,
              }),
            ],
            spacing: { after: 40 },
          }),
        ])),
    new Paragraph({ text: "", spacing: { after: 80 } }),
  ];

  children.push(
    ...goalBlock("Обучающие:", plan.goals.educational),
    ...goalBlock("Развивающие:", plan.goals.developmental),
    ...goalBlock("Воспитательные:", plan.goals.nurturing)
  );

  // Оборудование
  children.push(
    new Paragraph({
      text: "Оборудование",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 120, after: 60 },
    }),
    ...plan.equipment.map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: `• ${line}`, size: 22 })],
          spacing: { after: 40 },
        })
    ),
    new Paragraph({ text: "", spacing: { after: 80 } })
  );

  // Шаги — таблица 4 колонки
  children.push(
    new Paragraph({
      text: "Ход урока",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 120, after: 80 },
    })
  );

  const stageLabel: Record<string, string> = {
    "org-moment": "1. Орг. момент",
    motivation: "2. Мотивация",
    "new-topic": "3. Новая тема",
    practice: "4. Отработка",
    reflex: "5. Рефлексия",
    homework: "6. Домашка",
  };

  const stageRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "Этап", bold: true })] })],
          width: { size: 28, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Время", bold: true })],
              alignment: AlignmentType.CENTER,
            }),
          ],
          width: { size: 9, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "Деятельность учителя", bold: true })] })],
          width: { size: 31, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: "Деятельность учеников", bold: true })] })],
          width: { size: 32, type: WidthType.PERCENTAGE },
        }),
      ],
    }),
    ...plan.stages.map(
      (stage) =>
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: stageLabel[stage.kind] ?? stage.title,
                      bold: true,
                      size: 20,
                    }),
                  ],
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: stage.title, size: 20, italics: true, color: "555555" }),
                  ],
                }),
                ...(stage.materials && stage.materials.length > 0
                  ? [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: `Материалы: ${stage.materials.join(", ")}`,
                            size: 18,
                            color: "888888",
                          }),
                        ],
                      }),
                    ]
                  : []),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: `${stage.durationMin} мин`, bold: true, size: 20 }),
                  ],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: stage.teacherActions, size: 20 })],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: stage.studentActions, size: 20 })],
                }),
              ],
            }),
          ],
        })
    ),
    new TableRow({
      children: [
        new TableCell({
          shading: { fill: "F5F5F5" },
          children: [
            new Paragraph({ children: [new TextRun({ text: "Итого", bold: true, size: 20 })] }),
          ],
          columnSpan: 2,
        }),
        new TableCell({
          shading: { fill: "F5F5F5" },
          children: [
            new Paragraph({
              children: [new TextRun({ text: `${totalMin} мин`, bold: true, size: 20 })],
            }),
          ],
          columnSpan: 2,
        }),
      ],
    }),
  ];

  children.push(
    new Table({
      rows: stageRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      },
    })
  );

  // ДЗ
  children.push(
    new Paragraph({
      text: "Домашнее задание",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: plan.homework.text, size: 22 })],
      spacing: { after: 80 },
    }),
    ...(plan.homework.alternatives && plan.homework.alternatives.length > 0
      ? [
          new Paragraph({
            children: [new TextRun({ text: "Альтернативы:", bold: true, size: 22 })],
            spacing: { after: 40 },
          }),
          ...plan.homework.alternatives.map(
            (alt) =>
              new Paragraph({
                children: [
                  new TextRun({ text: `• ${alt}`, size: 22 }),
                ],
                spacing: { after: 40 },
              })
          ),
        ]
      : [])
  );

  // Подвал
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "ЛистAI · listai.ru · план урока по ФГОС",
          size: 18,
          color: "999999",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
    })
  );

  const doc = new Document({
    creator: "ЛистAI",
    title: `План урока · ${topicTitle}`,
    description: `${plan.subject} · ${plan.grade} класс`,
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
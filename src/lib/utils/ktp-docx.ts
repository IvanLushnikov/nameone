/**
 * DOCX-экспорт КТП.
 *
 * Использует пакет `docx` (Table/TableRow/TableCell с rowSpan для merged cells).
 * Стили: шапка таблицы — bold + серый фон, control/test — peach фон, повторение/резерв/проект — мягкий серый.
 *
 * Принимает `Ktp` из `src/lib/mock/ktp.ts`. Возвращает `Blob` для скачивания
 * (совместимо с `downloadBlob` из `src/lib/utils/docx.ts`).
 *
 * TZ: docs/tz/03-ktp.md
 */
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
  ShadingType,
} from "docx";
import type { Ktp, KtpEntry, KtpLessonKind } from "@/lib/types";
import { SITE_HOST } from "@/lib/site";

/** Заголовки колонок КТП — единый источник правды для UI и DOCX. */
export const KTP_COLUMNS = [
  { key: "num", label: "№", widthPct: 6 },
  { key: "dates", label: "Даты", widthPct: 16 },
  { key: "topic", label: "Тема урока", widthPct: 38 },
  { key: "kind", label: "Тип", widthPct: 14 },
  { key: "hours", label: "Часы", widthPct: 8 },
  { key: "fgos", label: "ФГОС", widthPct: 18 },
] as const;

const HEADER_FILL = "EFEFEF"; // светло-серый для шапки
const WARM_FILL = "FFF1E5"; // peach для control/test
const REVIEW_FILL = "F4F1EC"; // тёплый кремовый для review/reserve/project

/** Разделитель диапазона дат — en-dash (как в ТЗ: «08.09–13.09»). */
const DATE_RANGE_SEP = "\u2013";

/** Русские подписи типов урока. */
const KIND_LABEL: Record<KtpLessonKind, string> = {
  lesson: "Урок",
  control: "Контрольная",
  test: "Тест",
  review: "Повторение",
  reserve: "Резерв",
  project: "Проект",
};

function bgForKind(kind: KtpLessonKind): string | undefined {
  if (kind === "control" || kind === "test") return WARM_FILL;
  if (kind === "review" || kind === "reserve" || kind === "project")
    return REVIEW_FILL;
  return undefined;
}

function fillCell(cell: TableCell, fillHex: string) {
  // Подкрашиваем через options.shading (в `docx@9.x` принимается на TableCell).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cell as any).options.shading = {
    type: ShadingType.CLEAR,
    color: "auto",
    fill: fillHex,
  };
}

function normalCell(text: string, opts?: { bold?: boolean; widthPct: number }) {
  const w = opts?.widthPct ?? 16;
  return new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts?.bold, size: 20 })],
      }),
    ],
  });
}

function styledCellForEntry(
  text: string,
  widthPct: number,
  kind: KtpLessonKind
): TableCell {
  const cell = normalCell(text, { widthPct });
  const fill = bgForKind(kind);
  if (fill) fillCell(cell, fill);
  return cell;
}

function buildHeaderRow(): TableRow {
  const cells = KTP_COLUMNS.map(
    (col) =>
      new TableCell({
        width: { size: col.widthPct, type: WidthType.PERCENTAGE },
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: col.label, bold: true, size: 20 })],
          }),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(({ shading: { type: ShadingType.CLEAR, color: "auto", fill: HEADER_FILL } } as any)),
      })
  );
  return new TableRow({ children: cells, tableHeader: true });
}

function numCellForWeek(num: number, rowSpan: number, first: boolean): TableCell {
  const cell = new TableCell({
    rowSpan,
    width: { size: KTP_COLUMNS[0].widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: "center",
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: first ? String(num) : "", bold: true, size: 22 })],
      }),
    ],
  });
  // Окрашиваем фон как у первой записи недели — единый блок.
  // Поэтому сюда fill подмешиваем снаружи через opts.kindWeek.
  return cell;
}

function makeDatesCellForWeek(
  dates: string,
  rowSpan: number,
  kind: KtpLessonKind
): TableCell {
  const [start, end] = dates.split(DATE_RANGE_SEP);
  const cell = new TableCell({
    rowSpan,
    width: { size: KTP_COLUMNS[1].widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: "center",
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: start, size: 22, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: dates, size: 18, color: "888888" })],
      }),
    ],
  });
  const fill = bgForKind(kind);
  if (fill) fillCell(cell, fill);
  return cell;
}

/**
 * Генерирует DOCX c таблицей КТП.
 *
 * Структура таблицы:
 *   [header row — bold + серый фон]
 *   [week 1 row 1 — № weekNum (rowSpan), дата, тема, тип, часы, ФГОС]
 *   [week 1 row 2 (опц., при hoursPerWeek=3) — пустой № (merged), дата, тема, тип, часы, ФГОС]
 *   ...
 *
 * Если в неделе одна запись, rowSpan=1.
 */
export async function generateKtpDocx(ktp: Ktp): Promise<Blob> {
  const headerRow = buildHeaderRow();
  const bodyRows: TableRow[] = [];

  for (const week of ktp.weeks) {
    const rowSpan = week.entries.length;
    const entries: KtpEntry[] = week.entries;
    // kind первой записи определяет фон всей "недельной" группы.
    const weekKind = entries[0].kind;
    const fill = bgForKind(weekKind);

    entries.forEach((entry, idx) => {
      const isFirstInWeek = idx === 0;
      const numCell = isFirstInWeek
        ? numCellForWeek(week.weekNum, rowSpan, true)
        : new TableCell({
            width: { size: 0, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "", size: 1 })] })],
          });

      // Если у недели особый фон, красим объединённую ячейку «№».
      if (fill) fillCell(numCell, fill);

      // Даты объединяем на всю неделю (одна и та же дата у обоих уроков).
      const datesCell = isFirstInWeek
        ? makeDatesCellForWeek(entry.dates, rowSpan, weekKind)
        : new TableCell({
            width: { size: 0, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "", size: 1 })] })],
          });
      const topicCell = styledCellForEntry(entry.topic, KTP_COLUMNS[2].widthPct, weekKind);
      const kindCell = styledCellForEntry(
        `${KIND_LABEL[entry.kind]}${
          entry.kind === "control" || entry.kind === "test" ? " ⚑" : ""
        }`,
        KTP_COLUMNS[3].widthPct,
        weekKind
      );
      const hoursCell = styledCellForEntry(
        String(entry.hours),
        KTP_COLUMNS[4].widthPct,
        weekKind
      );
      const fgosCell = styledCellForEntry(
        entry.fgosRef ?? "—",
        KTP_COLUMNS[5].widthPct,
        weekKind
      );

      bodyRows.push(new TableRow({ children: [numCell, datesCell, topicCell, kindCell, hoursCell, fgosCell] }));
    });
  }

  const table = new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
    },
  });

  const totalLessons = ktp.weeks.reduce((acc, w) => acc + w.entries.length, 0);

  const doc = new Document({
    creator: "РабочиеЛисты AI",
    title: ktp.title,
    description: `КТП · ${ktp.subject} · ${ktp.grade} класс · ${ktp.schoolYear}`,
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 800, right: 800, bottom: 800, left: 800 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: `РабочиеЛисты AI · ${SITE_HOST}`, size: 16, color: "BBBBBB" })],
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
        children: [
          new Paragraph({
            text: "Календарно-тематическое планирование",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.LEFT,
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: ktp.title, bold: true, size: 26 }),
            ],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Всего: ${ktp.totalHours} ч · ${ktp.weeks.length} недель · ${totalLessons} уроков`,
                italics: true,
                color: "666666",
                size: 20,
              }),
            ],
            spacing: { after: 200 },
          }),
          table,
        ],
      },
    ],
  });

  return await Packer.toBlob(doc);
}

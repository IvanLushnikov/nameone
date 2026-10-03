/**
 * TZ-16 §3.1: DOCX-экспорт карточек.
 *
 * Учитель режет лист по линиям — значит рамки ячеек обязательны.
 * Структура: таблица 2 колонки × 5 строк (10 карточек на лист A4),
 * в каждой ячейке `front` жирным, ниже `back`.
 * Если карточек больше 10 — лист разрывается и начинается новая таблица.
 *
 * Образец сборки (Document / Packer / Blob) — `src/lib/utils/lesson-plan-docx.ts`.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  PageOrientation,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  VerticalAlign,
} from "docx";
import type { CardSet, FlashCard } from "@/lib/types";

/** Сколько карточек помещается на один лист — сетка 2×5. */
const CARDS_PER_SHEET = 10;

/** Рамки ячеек — по ним учитель режет. */
const CARD_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
};

/** Пустая ячейка-заглушка — чтобы последний лист тоже оставался сеткой 2×5. */
function emptyCell(): TableCell {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 160, bottom: 160, left: 160, right: 160 },
    children: [new Paragraph({ text: "" })],
  });
}

/**
 * Одна карточка: `front` жирным сверху, `back` под ним, метка категории внизу.
 *
 * `card` может быть `undefined` — последний лист обычно неполный, и сетка
 * 2×5 должна доезжать пустыми рамками (учитель режет по линиям, дырки в
 * сетке ломают разметку). Раньше здесь стояло обращение к `card.front` без
 * проверки, и любая неполная последняя страница роняла экспорт с
 * «Cannot read properties of undefined».
 */
function cardCell(card: FlashCard | undefined): TableCell {
  if (!card) return emptyCell();
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 160, bottom: 160, left: 160, right: 160 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: card.front, bold: true, size: 22 })],
        spacing: { after: card.back ? 80 : 0 },
      }),
      ...(card.back
        ? [
            new Paragraph({
              children: [new TextRun({ text: card.back, size: 18, color: "444444" })],
            }),
          ]
        : []),
      ...(card.category
        ? [
            new Paragraph({
              children: [
                new TextRun({ text: card.category, size: 14, color: "999999", italics: true }),
              ],
              spacing: { before: 100 },
            }),
          ]
        : []),
    ],
  });
}

/** Таблица 2×5 на один лист. `cards` может быть короче 10 — добиваем пустыми. */
function sheetTable(cards: FlashCard[]): Table {
  const rows: TableRow[] = [];
  for (let i = 0; i < CARDS_PER_SHEET; i += 2) {
    rows.push(
      new TableRow({
        height: { value: 1400, rule: "atLeast" },
        children: [cardCell(cards[i]), cardCell(cards[i + 1])],
      })
    );
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: CARD_BORDERS,
  });
}

export async function generateCardsDocx(set: CardSet): Promise<Blob> {
  const children: Array<Paragraph | Table> = [];

  if (!set.cards || set.cards.length === 0) {
    children.push(
      new Paragraph({
        text: "Карточки",
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "Карточки не сгенерированы: тема не найдена в таксономии.",
            italics: true,
            color: "666666",
            size: 22,
          }),
        ],
      })
    );
  } else {
    const sheets: FlashCard[][] = [];
    for (let i = 0; i < set.cards.length; i += CARDS_PER_SHEET) {
      sheets.push(set.cards.slice(i, i + CARDS_PER_SHEET));
    }

    // Заголовок — только на первом листе, чтобы не съедать место под карточки.
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: set.title, bold: true, size: 26 }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `${set.subject} · ${set.grade} класс · ${set.cards.length} карт. Режьте по рамкам.`,
            size: 16,
            color: "888888",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
      })
    );

    sheets.forEach((sheet, idx) => {
      // Перед каждым листом, кроме первого, — разрыв страницы.
      children.push(
        idx > 0
          ? new Paragraph({ children: [new PageBreak()] })
          : new Paragraph({ text: "", spacing: { after: 0 } }),
        sheetTable(sheet)
      );
    });
  }

  const doc = new Document({
    creator: "УчЛист",
    title: set.title,
    description: `${set.subject} · ${set.grade} класс · ${set.cards?.length ?? 0} карточек`,
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.PORTRAIT },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

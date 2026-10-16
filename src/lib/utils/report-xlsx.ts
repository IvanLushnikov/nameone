/**
 * XLSX-выгрузка ведомости по классу (ТЗ-27, ПРОБЕЛ 4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ СОБИРАЕМ XLSX РУКАМИ, А НЕ ЧЕРЕЗ exceljs / xlsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Сборка проекта статическая (`output: "export"`), и обе популярные
 * библиотеки заточены под Node: тянут `fs`/`stream`, из-за чего статический
 * экспорт либо падает, либо требует динамического `import()` с `ssr: false`.
 * Здесь та же причина, что и в `utils/pptx.ts`: XLSX — это ZIP с несколькими
 * XML, а ZIP собирает JSZip, который в проекте УЖЕ стоит и работает в браузере.
 * Ни одной новой зависимости сборка не получает.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО НЕ «ПЕРЕИМЕНОВАННЫЙ CSV»
 * ─────────────────────────────────────────────────────────────────────────────
 * CSV с расширением `.xlsx` Excel открывает с предупреждением о несоответствии
 * формата, а колонок «Темы» в нём вообще быть не может — это отдельный лист.
 * ТЗ требует два ЛИСТА, поэтому здесь два листа и настоящий SpreadsheetML.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО В ФАЙЛЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * Лист «Класс» — те же строки, что на экране: ученик, работа, баллы, слова
 * про источник отметки. Лист «Темы» — строки разреза «тем, где просели»
 * (тема, верно, всего, процент, ошибок, когда проверяли).
 *
 * Пустой разрез — это пустой лист с одной строкой «по этому классу тем ещё
 * нет». Молчаливый пустой лист читался бы как «выгрузка сломалась».
 */

import JSZip from "jszip";
import type {
  ClassReport,
  ClassReportCell,
  ClassSkillRow,
  ClassReportStudent,
} from "@/lib/journal/types";

/** Тип ячейки: строка, число или «пусто» (значение есть null). */
type CellValue = string | number | null;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Номер колонки буквами: 1 → A, 27 → AA.
 *
 * Excel адресует ячейки буквами, и без этого файл формально верный не
 * откроется: адрес «A1» есть, а «1A1» — нет.
 */
function colName(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Лист из строк.
 *
 * Числа пишутся числами (`<v>`), а не текстом: иначе Excel считал бы «20 из
 * 28» строкой и не смог ни посчитать средний, ни построить график. Пустая
 * ячейка пропускается целиком, а не пишется пустой строкой — иначе поверх
 * листа появилось бы поле для ввода, которого в ведомости быть не должно.
 */
function sheetXml(rows: CellValue[][], freezeHeader: boolean): string {
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === null || value === undefined || value === "") return "";
          const ref = `${colName(c + 1)}${r + 1}`;
          // Шапка — первая строка: она всегда жирная и всегда на месте.
          const style = r === 0 ? ' s="1"' : "";
          if (typeof value === "number") {
            return `<c r="${ref}"${style}><v>${value}</v></c>`;
          }
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  // Закреплённая шапка: у ведомости до 30 работ, и без закрепления верхняя
  // строка уезжает за экран — учитель теряет имена колонок на середине файла.
  const pane = freezeHeader
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="${cols}" width="26" customWidth="1"/></cols>${pane}<sheetData>${body}</sheetData></worksheet>`;
}

/** Стили: 0 — обычный, 1 — жирная шапка. Остальное Excel достраивает сам. */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

/** Слова про источник отметки — те же, что на экране (см. `ClassReport.tsx`). */
function sourceWord(cell: ClassReportCell): string {
  switch (cell.source) {
    case "teacher":
      return "учитель";
    case "teacher_with_model":
      return "учитель поправил ИИ";
    case "model":
      return "ИИ, не подтверждён";
    case "auto":
      return "посчитали сами";
    default:
      return "без отметки";
  }
}

/** Одна ячейка ведомости словами — ровно то, что показывает экран. */
function cellWords(cell: ClassReportCell | undefined): string {
  if (!cell) return "не сдал";
  const parts: string[] = [cell.max > 0 ? `${cell.score} из ${cell.max}` : String(cell.score)];
  parts.push(sourceWord(cell));
  if (cell.pendingTasks > 0) parts.push(`ждёт вас: ${cell.pendingTasks}`);
  if (cell.photo) {
    parts.push(
      cell.photo.pages === null
        ? "фото работы, страниц не видно"
        : `фото работы, страниц: ${cell.photo.pages}`,
    );
  }
  return parts.join(" · ");
}

/** Лист «Класс»: ученик × работа. */
function classSheet(report: ClassReport): CellValue[][] {
  const header: CellValue[] = ["Ученик", ...report.works.map((w) => w.title)];
  const rows: CellValue[][] = [header];
  for (const student of report.students as ClassReportStudent[]) {
    rows.push([
      student.name,
      ...report.works.map((work) => {
        const cell = student.works.find((w) => w.formId === work.id);
        return cellWords(cell);
      }),
    ]);
  }
  return rows;
}

/** Лист «Темы»: разрез «тем, где просели» — те же строки, что на экране. */
function skillsSheet(skills: ClassSkillRow[]): CellValue[][] {
  const header: CellValue[] = ["Тема", "Верно", "Всего", "Процент, %", "Ошибок", "Проверок", "Проверено"];
  if (skills.length === 0) {
    return [header, ["По этому классу тем с метками пока нет — у листов, созданных до 27 октября, меток не было."]];
  }
  return [
    header,
    ...skills.map((row) => [
      row.skill,
      row.correct,
      row.total,
      // null, а не 0: «процент не считался» и «ноль процентов» — разные вещи,
      // и в Excel это видно: пустая ячейка против нуля.
      row.percent,
      Math.max(0, row.total - row.correct),
      row.attempts,
      // Дата приходит в unix-секундах. В файл кладём текстом: Excel сам по
      // себе не знает, в какой зоне отрисовать число, а «неверная дата» в
      // ведомости классному руководителю хуже, чем текст.
      row.lastCheckedAt > 0
        ? new Date(row.lastCheckedAt * 1000).toISOString().slice(0, 10)
        : null,
    ]),
  ];
}

function contentTypes(sheetCount: number): string {
  const overrides = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRels(sheetCount: number): string {
  const rels = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

const SHEET_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

/**
 * Собрать .xlsx по ведомости: два листа — «Класс» и «Темы».
 *
 * Контракт повторяет `utils/pptx.ts`: на вход отчёт с экрана, на выход Blob,
 * готовый к сохранению.
 */
export async function generateReportXlsx(report: ClassReport): Promise<Blob> {
  const zip = new JSZip();
  const sheetNames = ["Класс", "Темы"];

  zip.file("[Content_Types].xml", contentTypes(sheetNames.length));
  zip.folder("_rels")!.file(".rels", ROOT_RELS);
  zip.folder("xl")!.file("workbook.xml", workbookXml(sheetNames));
  zip.folder("xl")!.folder("_rels")!.file("workbook.xml.rels", workbookRels(sheetNames.length));
  zip.folder("xl")!.file("styles.xml", STYLES_XML);

  const sheetsFolder = zip.folder("xl")!.folder("worksheets")!;
  const sheets = [classSheet(report), skillsSheet(report.skills ?? [])];
  sheets.forEach((rows, i) => {
    sheetsFolder.file(`sheet${i + 1}.xml`, sheetXml(rows, true));
    sheetsFolder.folder("_rels")!.file(`sheet${i + 1}.xml.rels`, SHEET_RELS);
  });

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Имя файла. Класс и дата попадают в имя: у учителя в папке «Загрузки» к
 * концу года лежит несколько ведомостей, и «report.xlsx» ни о чём не говорит.
 */
export function reportXlsxFilename(report: ClassReport, nowMs: number): string {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const safe = (report.class.name || "Класс")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim();
  return `Ведомость ${safe} ${date}.xlsx`;
}
/**
 * TZ-16 §3.2: экспорт комплекта «Материалы» одним ZIP-архивом.
 *
 * Собирается через JSZip (тот же паттерн, что `src/lib/utils/pptx.ts`;
 * pptxgenjs в проект не тянем — он ломает статический экспорт).
 * DOCX внутри архива генерируются пакетом `docx` и кладутся бинарником.
 *
 * Требования, которые нельзя упрощать:
 *   • CSV — с UTF-8 BOM и разделителем `;`. Без BOM русский Excel / LibreOffice
 *     открывает файл как cp1252 и показывает кракозябры (ТЗ-16 §3.2).
 *   • Имена файлов — ASCII-латиница + порядковый номер. Русские имена внутри
 *     ZIP технически возможны (JSZip ставит флаг UTF-8 в central directory),
 *     но Windows-архиватор и часть офисных пакетов с ними капризничает,
 *     поэтому транслитерация безопаснее. Схема: `NN-kind-slug.ext`,
 *     где kind — латинский slug из MaterialFileKind, slug — короткий
 *     узнаваемый суффикс (slovar / spravka / pamyatka / spisok).
 *
 * Контракт:
 *   generateMaterialsZip(bundle) → Promise<Blob>
 *   materialsZipFilename(bundle)  → string
 *   materialFileLabel(file)       → { name, mime } (внутреннее, но полезно UI)
 */
import JSZip from "jszip";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import type { MaterialBundle, MaterialFile, MaterialFileKind } from "@/lib/types";
import { slugify } from "@/lib/utils/cn";
// ТЗ-26 Ф-3: название предмета по-русски вместо внутреннего ключа.
import { subjectDisplayName } from "@/lib/content/subject-display-name";

/** Русские суффиксы имён — короткие, чтобы учитель узнал файл в архиве. */
const KIND_SUFFIX: Record<MaterialFileKind, string> = {
  glossary: "slovar",
  reference: "spravka",
  handout: "pamyatka",
  checklist: "spisok",
};

const MIME: Record<MaterialFile["format"], string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};

/** MIME-тип файла материала (для UI и отладки). */
export function materialMime(file: MaterialFile): string {
  return MIME[file.format];
}

/** Имя файла внутри архива: `01-glossary-slovar.docx`. Только ASCII + дефисы. */
export function materialFilename(file: MaterialFile, index: number): string {
  const num = String(index + 1).padStart(2, "0");
  const kind = file.kind;
  const suffix = KIND_SUFFIX[kind] ?? (slugify(kind) || "material");
  return `${num}-${kind}-${suffix}.${file.format}`;
}

/** Имя самого архива для скачивания. */
export function materialsZipFilename(bundle: MaterialBundle): string {
  // ТЗ-26, Ф-3: предмет по-русски, не `algebra`.
  const base = `materials-${slugify(subjectDisplayName(bundle.subject))}-${bundle.grade}kl-${slugify(bundle.topic) || "topic"}`;
  return `${base}.zip`;
}

/** UTF-8 BOM — без него русский Excel показывает кракозябры. */
const BOM = "\uFEFF";

/**
 * Значение, с которого Excel или LibreOffice начинают считать формулу.
 *
 * Плюс TAB и CR: их Excel тоже считает началом формулы, хотя на глаз они
 * выглядят как обычный текст.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Число — единственное «опасное» начало, которое не надо экранировать.
 *
 * В таблице температур или оценок встречаются «-5» и «12,5»: Excel считает
 * их числами и формулой не выполнит, а апостроф перед ними превратил бы
 * число в текст (учитель потом не смог бы отсортировать столбец).
 */
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?%?$/;

/**
 * Разделитель колонок в CSV материала.
 *
 * `;` — по контракту модуля (см. шапку): так файл открывается в русском Excel
 * и в LibreOffice. Содержимое при этом пишет модель обычным текстом, и
 * запятую она может поставить — такой файл и раньше открывался одной
 * колонкой. Экранирование этого не ухудшает: строка остаётся строкой.
 */
const CSV_DELIMITER = ";";

/**
 * Экранирование CSV — ревью безопасности 30.10.2026, находка №7.
 *
 * ЧТО БЫЛО. Значения писались как есть: без кавычек и без защиты от ячеек,
 * начинающихся с `=`, `+`, `-`, `@`. Excel и LibreOffice выполняют такую ячейку
 * как формулу. Сценарий: учитель собирает комплект → отправляет архив
 * коллеге → у коллеги при открытии CSV исполняется формула. Содержимое CSV
 * приходит из ответа модели, куда попадает тема учителя, — то есть формулу
 * можно подобрать темой задания.
 *
 * ТАКЖЕ ОБЫЧНАЯ ПОЛОМКА. Запятая или точка с запятой внутри значения рвали
 * строку таблицы, потому что кавычек не было.
 *
 * ЧТО СТАЛО. Каждое значение обёрнуто в кавычки (внутренние кавычки
 * удваиваются — так требует CSV), а перед опасным началом ставится апостроф:
 * Excel и LibreOffice показывают апостроф как признак текста и не выполняют
 * ячейку.
 */
export function escapeCsvContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .split(CSV_DELIMITER)
        .map((cell) => {
          const trimmed = cell.trimStart();
          const dangerous = FORMULA_START.test(trimmed) && !PLAIN_NUMBER.test(trimmed);
          const safe = dangerous ? `'${cell}` : cell;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(CSV_DELIMITER),
    )
    .join("\r\n");
}

/** CRLF — стандарт для CSV, одинаково читается Excel и LibreOffice. */
function csvBytes(content: string): Uint8Array {
  return new TextEncoder().encode(BOM + escapeCsvContent(content) + "\r\n");
}

/**
 * Простой текст → DOCX. Правила разбора (без markdown, как требует тип):
 *   • 1-я непустая строка — заголовок документа (HEADING_1);
 *   • строка, начинающаяся с «— » — пункт списка;
 *   • пустая строка — отбивка;
 *   • всё остальное — обычный абзац.
 */
async function textToDocxBlob(title: string, content: string): Promise<Blob> {
  const lines = content.split(/\r?\n/);
  const children: Paragraph[] = [];
  let headingUsed = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      children.push(new Paragraph({ text: "", spacing: { after: 80 } }));
      continue;
    }
    if (!headingUsed) {
      headingUsed = true;
      children.push(
        new Paragraph({
          text: line,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 100 },
        })
      );
      continue;
    }
    if (line.startsWith("— ")) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${line.slice(2)}`, size: 22 })],
          spacing: { after: 50 },
        })
      );
      continue;
    }
    children.push(new Paragraph({ children: [new TextRun({ text: line, size: 22 })], spacing: { after: 60 } }));
  }

  const doc = new Document({
    creator: "УчЛист",
    title,
    description: "Комплект материалов к уроку",
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } },
        },
        children,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

/**
 * Собирает ZIP комплекта. Один MaterialFile → один файл в архиве.
 * Пустой `bundle.files` даёт валидный (пустой) архив — без исключения.
 */
export async function generateMaterialsZip(bundle: MaterialBundle): Promise<Blob> {
  const zip = new JSZip();

  for (let i = 0; i < bundle.files.length; i++) {
    const file = bundle.files[i];
    const name = materialFilename(file, i);

    if (file.format === "docx") {
      const blob = await textToDocxBlob(file.title, file.content);
      zip.file(name, await blob.arrayBuffer(), { binary: true });
    } else if (file.format === "csv") {
      zip.file(name, csvBytes(file.content), { binary: true });
    } else {
      zip.file(name, BOM + file.content.replace(/\r\n/g, "\n"), { binary: true });
    }
  }

  return await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
}

/** Человекочитаемый формат для UI-превью. */
export function materialFormatLabel(format: MaterialFile["format"]): string {
  if (format === "docx") return "Word (DOCX)";
  if (format === "csv") return "Excel (CSV)";
  return "Текст (TXT)";
}

// re-export для удобства UI (как в utils/pptx.ts)
export { downloadBlob } from "./docx";

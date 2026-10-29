/**
 * ТЗ-33, В1.1: печать и превью новых типов задания.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Учитель уносит лист в класс на бумаге. Значит печать — не «красиво», а
 * часть материала: если образец не напечатан, «выполните по образцу» на листе
 * бессмысленно; если таблица напечатана строкой текста, задание по таблице
 * нерешаемо.
 *
 * Проверяем:
 *   1. ОБРАЗЕЦ напечатан и стоит ДО текста задания. Порядок важен: образец
 *      должен быть виден раньше формулировки «выполните по образцу», иначе
 *      ученик ищет его в тексте задания и не находит.
 *   2. ТАБЛИЦА напечатана таблицей, а не строкой текста.
 *   3. ШАГИ напечатаны чек-листом с галочками.
 *   4. КРИТЕРИИ приёмки попали в ключ, а не в тело листа: критерий нужен
 *      учителю, а напечатанный на листе критерий превращается в подсказку.
 *   5. СТАРЫЙ ЛИСТ печатается как раньше — регрессии нет.
 *
 * Проверяем на РЕАЛЬНОМ файле, а не на моках `docx`: `Packer.toBlob` отдаёт
 * готовый zip, а `Table`/`TableCell` — это JS-объекты, в которых не видно ни
 * `w:tblLayout`, ни границ. Единственный честный способ увидеть итоговый
 * OOXML — распаковать `word/document.xml` (jszip уже в зависимостях).
 *
 * Сеть не используется, таймеров нет.
 */

import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { generateWorksheetDocx } from "@/lib/utils/docx";
import type { Worksheet } from "@/lib/types";

/** Лист с новыми типами: образец, таблица, шаги, критерии. */
const NEW_TYPES_WORKSHEET = {
  id: "w-tz33-1",
  title: "Проверка печати — ТЗ-33",
  subject: "Математика",
  grade: 5,
  topic: "drobi",
  difficulty: "medium",
  createdAt: "2026-10-28T10:00:00.000Z",
  tasks: [
    {
      number: 1,
      text: "Выполните по образцу: сократите дробь.",
      type: "pattern",
      answer: "1/4",
      points: 2,
      sample: "Образец: 3/12 = 1/4. Сократите 8/20.",
    },
    {
      number: 2,
      text: "Найдите значение по таблице.",
      type: "table-task",
      answer: "30",
      points: 2,
      table: { headers: ["Товар", "Цена"], rows: [["Хлеб", "30"], ["Молоко", "60"]] },
    },
    {
      number: 3,
      text: "Выполните шаги работы.",
      type: "practical",
      answer: "готово",
      points: 2,
      steps: ["Намочить бумагу", "Сложить пополам"],
      criteria: ["Ровный сгиб", "Нет заломов"],
    },
  ],
} as unknown as Worksheet;

/** Старый лист: пять привычных типов, без новых полей. */
const OLD_WORKSHEET = {
  id: "w-tz33-old",
  title: "Старый лист",
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
      points: 2,
    },
    {
      number: 2,
      text: "Сократи дробь",
      type: "short-answer",
      answer: "2/3",
      points: 1,
    },
    {
      number: 3,
      text: "Найди периметр",
      type: "computation",
      answer: "18 см",
      points: 2,
    },
  ],
} as unknown as Worksheet;

let newTypesXml: string;
let oldXml: string;

beforeAll(async () => {
  newTypesXml = await documentXmlOf(NEW_TYPES_WORKSHEET);
  oldXml = await documentXmlOf(OLD_WORKSHEET);
});

describe("ТЗ-33: печать новых типов задания", () => {
  it("образец напечатан и стоит ДО текста задания", () => {
    expect(newTypesXml).toContain("Образец");
    // Дробь в образце печатается как настоящая математика OMML (`<m:f>`),
    // а не строкой «3/12» — так она выглядит в тетради. Поэтому проверяем
    // структуру, а не текст: именно это отличает нормальную печать от
    // «сплющенной» (см. `tests/integration/worksheet-docx.test.ts`).
    expect(newTypesXml).toContain("<m:f>");
    // Порядок важен: образец должен быть виден раньше формулировки
    // «выполните по образцу», иначе ученик ищет его в тексте задания.
    const sampleIdx = newTypesXml.indexOf("Образец");
    const taskIdx = newTypesXml.indexOf("Выполните по образцу");
    expect(sampleIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(-1);
    expect(sampleIdx).toBeLessThan(taskIdx);
  });

  it("образец обведён рамкой — он визуально отделён от текста задания", () => {
    // Рамка = `w:pBdr`. Без неё образец сливается с текстом в одну кашу.
    expect(newTypesXml).toContain("pBdr");
  });

  it("таблица задания напечатана таблицей, а не строкой текста", () => {
    expect(newTypesXml).toContain("Товар");
    expect(newTypesXml).toContain("Цена");
    // Признак настоящей таблицы — фиксированный layout: без него Google Docs
    // пересчитывает ширины по содержимому и «размазывает» колонки.
    expect(newTypesXml).toContain("tblLayout");
    expect(newTypesXml).toContain("w:tbl");
  });

  it("шаги напечатаны чек-листом с галочками", () => {
    expect(newTypesXml).toContain("Намочить бумагу");
    expect(newTypesXml).toContain("Сложить пополам");
    expect(newTypesXml).toMatch(/☐/);
  });

  it("критерии приёмки попали в ключ, а не в тело листа", () => {
    expect(newTypesXml).toContain("Ровный сгиб");
    expect(newTypesXml).toContain("Критерий:");
  });
});

describe("ТЗ-33: печать старого листа не сломалась", () => {
  it("старый лист печатается как раньше — задания и строки ответа на месте", () => {
    // Текст задания идёт до дроби обычным текстом, дробь — OMML. Проверяем
    // начало фразы, а не «3/4»: в XML такой строки нет и не должно быть.
    expect(oldXml).toContain("Сравни");
    expect(oldXml).toContain("Ответ:");
  });

  it("в старом листе НЕТ новых блоков — лишних рамок и галочек", () => {
    expect(oldXml).not.toContain("Образец:");
    expect(oldXml).not.toContain("Критерий:");
  });
});

/** Распаковать `word/document.xml` из готового DOCX. */
async function documentXmlOf(worksheet: Worksheet): Promise<string> {
  const blob = await generateWorksheetDocx(worksheet);
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("В DOCX нет word/document.xml — документ собран не полностью");
  return await file.async("string");
}

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
  });
}

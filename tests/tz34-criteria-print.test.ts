/**
 * ТЗ-34: страница «Критерии оценивания» в DOCX.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Учитель покупает «Базовый» за 249 ₽, и в карточке тарифа написано:
 * «Контрольная с критериями оценивания». Критериев в файле не было вообще:
 * был ключ с голыми ответами («12», «3/4», «б)»), по которому отметку не
 * поставить — не сказано, что считается полным ответом, а что половиной.
 *
 * Проверяем на РЕАЛЬНОМ файле, а не на моках `docx`: `Packer.toBlob` отдаёт
 * готовый zip, и в JS-объектах `Table`/`TableCell` не видно ни порядка
 * страниц, ни текста. Единственный честный способ увидеть итоговый OOXML —
 * распаковать `word/document.xml`.
 *
 * Проверяем:
 *   1. СТРАНИЦА КРИТЕРИЕВ СТОИТ ПОСЛЕ СТРАНИЦЫ КЛЮЧЯ (порядок проверяется по
 *      тексту документа, а не на глаз);
 *   2. на ней есть шкала отметок с числами 85/70/50, таблица «№ задания —
 *      критерий — максимальный балл», блок «Типичные ошибки» и блок
 *      «Рекомендация учителю»;
 *   3. критериев нет — печатается честная строка, а не пустая страница;
 *   4. у обычного рабочего листа страницы критериев НЕТ;
 *   5. критерии не попадают в ТЕЛО листа — только в ключ и на отдельную
 *      страницу (иначе критерий превращается в подсказку ученику);
 *   6. строка «Критерий: …» в ключе по-прежнему печатается (регрессия).
 */

import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { generateWorksheetDocx } from "@/lib/utils/docx";
import type { Worksheet, EvaluationPart } from "@/lib/types";

/** Лист с одним развёрнутым заданием — у него есть критерии. */
const CONTROL_WORKSHEET = {
  id: "w-tz34-1",
  title: "Контрольная по дробям",
  subject: "Математика",
  grade: 5,
  topic: "drobi",
  difficulty: "medium",
  createdAt: "2026-10-29T10:00:00.000Z",
  tasks: [
    {
      number: 1,
      text: "Сократите дробь 8/20.",
      type: "computation",
      answer: "2/5",
      points: 3,
    },
    {
      number: 2,
      text: "Объясните, что такое дробь, и приведите пример.",
      type: "essay",
      answer: null,
      points: 1,
      criteria: ["Называет определение и приводит пример", "Объясняет смысл числителя и знаменателя"],
    },
  ],
} as unknown as Worksheet;

/** Блок критериев — как его собирает бэкенд. */
const EVALUATION: EvaluationPart[] = [
  {
    variant: 1,
    title: "Вариант 1",
    criteria: [
      {
        number: 2,
        criteria: ["Называет определение и приводит пример", "Объясняет смысл числителя и знаменателя"],
        maxPoints: 3,
      },
    ],
    typicalMistakes: ["Путает числитель и знаменатель при сокращении дроби"],
    recommendation: "Разобрать на доске перевод смешанного числа в неправильную дробь.",
    totalMaxPoints: 8,
    marks: [
      { mark: 5, fromPercent: 85, toPercent: 100 },
      { mark: 4, fromPercent: 70, toPercent: 84 },
      { mark: 3, fromPercent: 50, toPercent: 69 },
      { mark: 2, fromPercent: 0, toPercent: 49 },
    ],
  },
];

let controlXml: string;
let worksheetXml: string;
let emptyCriteriaXml: string;

beforeAll(async () => {
  controlXml = await documentXmlOf(CONTROL_WORKSHEET, { evaluation: EVALUATION });
  worksheetXml = await documentXmlOf(CONTROL_WORKSHEET);
  emptyCriteriaXml = await documentXmlOf(CONTROL_WORKSHEET, {
    evaluation: [
      {
        ...EVALUATION[0]!,
        criteria: [],
      },
    ],
  });
});

describe("ТЗ-34: страница «Критерии оценивания» в печати", () => {
  it("страница критериев стоит ПОСЛЕ страницы ключа", () => {
    const answersIdx = controlXml.indexOf("Ответы и пояснения");
    const criteriaIdx = controlXml.indexOf("Критерии оценивания");
    expect(answersIdx).toBeGreaterThan(-1);
    expect(criteriaIdx).toBeGreaterThan(-1);
    // Порядок проверяется по тексту документа, а не на глаз: учитель читает
    // ответы, потом — по чему он их принимает.
    expect(criteriaIdx).toBeGreaterThan(answersIdx);
  });

  it("на странице есть шкала отметок с числами 85/70/50", () => {
    expect(controlXml).toContain("Шкала отметок");
    expect(controlXml).toContain("Отметка 5");
    expect(controlXml).toContain("85%");
    expect(controlXml).toContain("70%");
    expect(controlXml).toContain("50%");
  });

  it("на странице есть таблица «№ задания — критерий — максимальный балл»", () => {
    expect(controlXml).toContain("Критерии по заданиям");
    expect(controlXml).toContain("Макс. балл");
    expect(controlXml).toContain("Называет определение и приводит пример");
    // Максимальный балл — из реестра типов, а не из модельного `points`.
    expect(controlXml).toContain("Максимальный балл работы: 8");
  });

  it("на странице есть блоки «Типичные ошибки» и «Рекомендация учителю»", () => {
    expect(controlXml).toContain("Типичные ошибки");
    expect(controlXml).toContain("Путает числитель и знаменатель при сокращении дроби");
    expect(controlXml).toContain("Рекомендация учителю");
    expect(controlXml).toContain("Разобрать на доске перевод смешанного числа");
  });

  it("критериев нет — честная строка, а не пустая страница", () => {
    expect(emptyCriteriaXml).toContain("критерии не удалось сформировать — оценивайте по ключу");
  });

  it("у обычного рабочего листа страницы критериев НЕТ", () => {
    expect(worksheetXml).not.toContain("Критерии оценивания");
    expect(worksheetXml).not.toContain("Шкала отметок");
  });
});

describe("ТЗ-34: критерии не попадают в тело листа", () => {
  it("критерий напечатан в ключе и на странице критериев, но НЕ в теле листа", () => {
    // Тело листа — до страницы ответов. Если критерий окажется там, ученик
    // получит подсказку на бумаге.
    const bodyEnd = controlXml.indexOf("Ответы и пояснения");
    const body = controlXml.slice(0, bodyEnd);
    expect(body).not.toContain("Называет определение и приводит пример");
    // В ключе критерий остаётся: это быстрый ответ на «за что я ставлю балл».
    const key = controlXml.slice(bodyEnd);
    expect(key).toContain("Критерий:");
    expect(key).toContain("Называет определение и приводит пример");
  });
});

/** Распаковать `word/document.xml` из готового DOCX. */
async function documentXmlOf(
  worksheet: Worksheet,
  options?: { evaluation?: EvaluationPart[] },
): Promise<string> {
  const blob = await generateWorksheetDocx(worksheet, options);
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

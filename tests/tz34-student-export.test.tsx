/**
 * UL-D12: раздаточный файл для ученика не содержит материалов для учителя.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 *
 * В интерфейсе есть переключатель «с ответами / без ответов» (withAnswers).
 * Он выключает страницу ключа — и на этом всё заканчивалось. Страница
 * «Критерии оценивания» (ТЗ-34) печаталась ВСЕГДА, даже когда ключ был
 * выключен. В итоге учитель, выбравший «без ответов» для раздатки ученикам,
 * получал файл, где к заданиям прилагались шкала отметок и критерии приёмки.
 * Критерий приёмки на бумаге — это подсказка: ученик читает, что именно
 * учитель считает полным ответом.
 *
 * Проверяется на РЕАЛЬНОМ файле (`word/document.xml` из готового DOCX) и на
 * ОТРЕНДЕРЕННОМ превью — то есть на том, что учитель реально раздаёт.
 *
 * ЧТО ПРОВЕРЯЕТСЯ
 *   1. Ученик (withAnswers=false): нет ни страницы ключа, ни страницы
 *      критериев, ни шкалы отметок, ни ответа, ни строки «Критерий: …».
 *   2. Учитель (withAnswers=true): порядок «тело → ключ → критерии»,
 *      учительский текст на месте, второй вариант не потерян.
 *   3. Пустой evaluation: обычный лист не получает лишней пустой страницы.
 *   4. Превью показывает то же, что файл: число страниц в подвале правдиво.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import JSZip from "jszip";

import { generateWorksheetDocx } from "@/lib/utils/docx";
import { WorksheetPreview } from "@/components/constructor/WorksheetPreview";
import type { Worksheet, EvaluationPart } from "@/lib/types";

/** Лист с развёрнутым заданием: у него есть критерии. */
const CONTROL_WORKSHEET = {
  id: "w-d12-1",
  title: "Контрольная по дробям",
  subject: "Математика",
  grade: 5,
  topic: "drobi",
  difficulty: "medium",
  createdAt: "2026-10-30T10:00:00.000Z",
  tasks: [
    {
      number: 1,
      text: "Сократите дробь 8/20.",
      type: "computation",
      // Ответ — десятичная дробь, а не дробь с чертой: «2/5» в DOCX
      // превращается в формулу OMML, и в XML его уже нет как текста.
      answer: "0,25",
      explanation: "Сокращаем на 4",
      points: 3,
    },
    {
      number: 2,
      text: "Объясните, что такое дробь, и приведите пример.",
      type: "essay",
      answer: null,
      points: 1,
      criteria: ["Называет определение и приводит пример"],
    },
  ],
} as unknown as Worksheet;

/** Два блока критериев — как у контрольной со вторым вариантом. */
const EVALUATION: EvaluationPart[] = [
  {
    variant: 1,
    title: "Вариант 1",
    criteria: [
      {
        number: 2,
        criteria: ["Называет определение и приводит пример"],
        maxPoints: 3,
      },
    ],
    typicalMistakes: ["Путает числитель и знаменатель"],
    recommendation: "Разобрать на доске сокращение дроби.",
    totalMaxPoints: 8,
    marks: [
      { mark: 5, fromPercent: 85, toPercent: 100 },
      { mark: 4, fromPercent: 70, toPercent: 84 },
      { mark: 3, fromPercent: 50, toPercent: 69 },
      { mark: 2, fromPercent: 0, toPercent: 49 },
    ],
  },
  {
    variant: 2,
    title: "Вариант 2",
    criteria: [
      {
        number: 2,
        criteria: ["Называет определение и приводит пример"],
        maxPoints: 3,
      },
    ],
    typicalMistakes: ["Путает числитель и знаменатель"],
    recommendation: "Разобрать на доске сокращение дроби.",
    totalMaxPoints: 8,
    marks: [
      { mark: 5, fromPercent: 85, toPercent: 100 },
      { mark: 4, fromPercent: 70, toPercent: 84 },
      { mark: 3, fromPercent: 50, toPercent: 69 },
      { mark: 2, fromPercent: 0, toPercent: 49 },
    ],
  },
];

/** Ответ, который не должен попасть в раздаточный файл. */
const SECRET_ANSWER = "0,25";
const SECRET_CRITERION = "Называет определение и приводит пример";

describe("UL-D12: раздаточный файл для ученика", () => {
  it("D12-1: в файле без ответов нет ни ключа, ни критериев, ни шкалы отметок", async () => {
    const xml = await documentXmlOf(CONTROL_WORKSHEET, {
      withAnswers: false,
      evaluation: EVALUATION,
    });

    // Страницы для учителя нет.
    expect(xml).not.toContain("Ответы и пояснения");
    expect(xml).not.toContain("Критерии оценивания");
    expect(xml).not.toContain("Шкала отметок");
    expect(xml).not.toContain("Отметка 5");
    // Ни ответа, ни критерия, ни учительской пометки.
    expect(xml).not.toContain(SECRET_ANSWER);
    expect(xml).not.toContain("Критерий:");
    expect(xml).not.toContain(SECRET_CRITERION);
    expect(xml).not.toContain("не раздавать ученикам");
    // Само тело листа на месте — задание ученику нужно.
    expect(xml).toContain("Сократите дробь");
  });

  it("D12-2: в файле для учителя есть ключ и критерии, порядок «тело → ключ → критерии»", async () => {
    const xml = await documentXmlOf(CONTROL_WORKSHEET, {
      withAnswers: true,
      evaluation: EVALUATION,
    });

    const bodyIdx = xml.indexOf("Сократите дробь");
    const answersIdx = xml.indexOf("Ответы и пояснения");
    const criteriaIdx = xml.indexOf("Критерии оценивания");
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(answersIdx).toBeGreaterThan(bodyIdx);
    expect(criteriaIdx).toBeGreaterThan(answersIdx);

    // Учительский текст сохранён.
    expect(xml).toContain(SECRET_ANSWER);
    expect(xml).toContain("Критерий:");
    expect(xml).toContain(SECRET_CRITERION);
    expect(xml).toContain("Шкала отметок");
    // Второй вариант не потерян.
    expect(xml).toContain("Вариант 2");
  });

  it("D12-3: у листа без критериев нет лишней пустой страницы", async () => {
    const xml = await documentXmlOf(CONTROL_WORKSHEET, { withAnswers: true });

    expect(xml).not.toContain("Критерии оценивания");
    expect(xml).not.toContain("Шкала отметок");
    // Ключ при этом остаётся.
    expect(xml).toContain("Ответы и пояснения");
  });

  it("D12-4: превью ученика показывает тело листа и ничего учительского", () => {
    render(
      <WorksheetPreview
        worksheet={CONTROL_WORKSHEET}
        withAnswers={false}
        withExplanations={false}
        evaluation={EVALUATION}
      />,
    );

    expect(screen.queryByText("Ответы и пояснения")).toBeNull();
    expect(screen.queryByText("Критерии оценивания")).toBeNull();
    expect(screen.queryByText("Шкала отметок")).toBeNull();
    // Страниц ровно одна — подвал не врёт.
    expect(screen.getByText("Лист 1 из 1")).toBeInTheDocument();
    // Тело листа на месте.
    expect(screen.getByText(/Сократите дробь/)).toBeInTheDocument();
  });

  it("D12-5: превью учителя показывает ключ и критерии, счётчик страниц правдив", () => {
    render(
      <WorksheetPreview
        worksheet={CONTROL_WORKSHEET}
        withAnswers={true}
        withExplanations={true}
        evaluation={EVALUATION}
      />,
    );

    expect(screen.getByText("Ответы и пояснения")).toBeInTheDocument();
    expect(screen.getAllByText("Критерии оценивания").length).toBe(2);
    expect(screen.getAllByText("Шкала отметок").length).toBeGreaterThan(0);
    // Тело + ключ + две страницы критериев.
    expect(screen.getByText("Лист 1 из 4")).toBeInTheDocument();
  });
});

/** Распаковать `word/document.xml` из готового DOCX. */
async function documentXmlOf(
  worksheet: Worksheet,
  options: { withAnswers: boolean; evaluation?: EvaluationPart[] },
): Promise<string> {
  const blob = await generateWorksheetDocx(worksheet, options);
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("В DOCX нет word/document.xml — документ собран не полностью");
  return await file.async("string");
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
  });
}

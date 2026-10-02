/**
 * TZ-16 §3.2: тесты «Материалов» (мок + превью + ZIP-экспорт).
 *
 * Edge cases:
 *   1. happy path — 3 файла по умолчанию, форматы по ТЗ
 *      (glossary→docx, reference→csv, handout→docx), checklist НЕ генерится.
 *   2. topic-not-found — неизвестный slug темы → files: [] без исключения.
 *   3. ZIP-экспорт — в архиве ровно 3 файла с читаемыми ASCII-именами,
 *      CSV начинается с UTF-8 BOM (без него русский Excel показывает кракозябры).
 */
import React from "react";
import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { GenerationRequest, MaterialBundle } from "@/lib/types";
import { mockMaterials } from "@/lib/mock/materials";
import { generateMaterialsZip, materialFilename } from "@/lib/utils/materials-zip";
import { MaterialsPreview } from "@/components/constructor/MaterialsPreview";

const baseReq = (
  overrides: Partial<GenerationRequest> = {}
): GenerationRequest => ({
  subject: "math",
  grade: 5,
  topic: "drobi-obyknovennye",
  difficulty: "medium",
  count: 5,
  type: "materials",
  withAnswers: false,
  withExplanations: false,
  ...overrides,
});

/** Тема из subjects.ts обязана существовать — если нет, тест бессмыслен. */
const bundleOf = async (req: GenerationRequest): Promise<MaterialBundle> => mockMaterials(req);

describe("mockMaterials — happy path", () => {
  it("math/5/drobi-obyknovennye → 3 файла с форматами по ТЗ", async () => {
    const bundle = await bundleOf(baseReq());

    // Базовые поля
    expect(bundle.id).toBeTruthy();
    expect(bundle.subject).toBe("math");
    expect(bundle.grade).toBe(5);
    expect(bundle.topic).toBe("drobi-obyknovennye");
    expect(bundle.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof bundle.generationMs).toBe("number");
    expect(bundle.title).toContain("Обыкновенные дроби");

    // Ровно 3 файла по умолчанию
    expect(bundle.files).toHaveLength(3);
    const kinds = bundle.files.map((f) => f.kind);
    expect(kinds).toEqual(["glossary", "reference", "handout"]);

    // Форматы жёстко по ТЗ
    const formats = Object.fromEntries(bundle.files.map((f) => [f.kind, f.format]));
    expect(formats).toEqual({ glossary: "docx", reference: "csv", handout: "docx" });

    // checklist не генерируется без явного выбора учителя
    expect(kinds).not.toContain("checklist");

    // У каждого файла есть id / title / непустой контент
    for (const f of bundle.files) {
      expect(f.id).toBeTruthy();
      expect(f.title.length).toBeGreaterThan(3);
      expect(f.content.trim().length).toBeGreaterThan(40);
      // Без markdown-разметки — тип обещает простой текст
      expect(f.content).not.toContain("**");
    }

    // Словарь: 8–15 записей (6 терминов + примеры из topic.examples)
    const glossary = bundle.files.find((f) => f.kind === "glossary")!;
    const termLines = glossary.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== "Примеры по теме" && !l.startsWith("Словарь") && !l.startsWith("Математика ·"));
    expect(termLines.length).toBeGreaterThanOrEqual(8);
    expect(termLines.length).toBeLessThanOrEqual(15);
    // Термины опираются на примеры из темы, а не на случайный текст
    expect(glossary.content).toContain("Примеры по теме");

    // Reference — CSV с шапкой из 3 колонок
    const reference = bundle.files.find((f) => f.kind === "reference")!;
    const header = reference.content.split("\n")[0];
    expect(header.split(";")).toHaveLength(3);

    // Раздатка — памятка на одну страницу: короткие строки, есть разделы
    const handout = bundle.files.find((f) => f.kind === "handout")!;
    expect(handout.content).toContain("Памятка к теме");
    expect(handout.content).toContain("Проверь себя");
  });

  it("другой предмет/класс → те же 3 kind'а, но контент по своей теме", async () => {
    const bundle = await bundleOf(
      baseReq({ subject: "history", grade: 5, topic: "drevniy-egipet-5" })
    );

    expect(bundle.files.map((f) => f.kind)).toEqual(["glossary", "reference", "handout"]);
    expect(bundle.title).toContain("История");
    expect(bundle.title).toContain("Древний Египет");
    expect(bundle.files[0].content).toContain("Древний Египет");
  });
});

describe("mockMaterials — topic not found", () => {
  it("несуществующий slug темы → files: [], без исключения", async () => {
    const bundle = await bundleOf(baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" }));

    expect(bundle.files).toEqual([]);
    // Заголовок осмысленный, даже без файлов
    expect(bundle.id).toBeTruthy();
    expect(bundle.subject).toBe("math");
    expect(bundle.grade).toBe(5);
    expect(bundle.topic).toBe("ne-suschestvuyuschiy-slug-xyz");
    expect(bundle.title).toContain("ne-suschestvuyuschiy-slug-xyz");
    expect(bundle.title).toContain("Материалы");
  });

  it("неизвестный subject slug → тоже не падаем, файлов нет", async () => {
    const bundle = await bundleOf(baseReq({ subject: "unknown-subject" as GenerationRequest["subject"] }));
    expect(bundle.files).toEqual([]);
    expect(bundle.title).toContain("unknown-subject");
  });
});

describe("generateMaterialsZip — экспорт", () => {
  it("в архиве 3 файла с читаемыми ASCII-именами, CSV с BOM", async () => {
    const bundle = await bundleOf(baseReq());
    const blob = await generateMaterialsZip(bundle);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(2000);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();

    // Ровно 3 файла, никаких служебных записей
    expect(names).toHaveLength(3);
    expect(names).toEqual([
      "01-glossary-slovar.docx",
      "02-reference-spravka.csv",
      "03-handout-pamyatka.docx",
    ]);

    // Имена читаемые: только латиница, цифры, дефисы, точка
    for (const n of names) {
      expect(n).toMatch(/^[a-z0-9-]+\.(docx|csv|txt)$/);
    }

    // materialFilename собирает то же имя, что и архив
    expect(materialFilename(bundle.files[0], 0)).toBe("01-glossary-slovar.docx");

    // CSV: первые байты — UTF-8 BOM (EF BB BF), иначе русский Excel даёт кракозябры
    const csvBytes = await zip.file("02-reference-spravka.csv")!.async("uint8array");
    expect([...csvBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = await zip.file("02-reference-spravka.csv")!.async("string");
    expect(csvText.charCodeAt(0)).toBe(0xfeff);
    expect(csvText).toContain(";");
    // `baseReq()` — это математика (тема «Обыкновенные дроби»), поэтому
    // ожидаем именно её текст. Раньше здесь стояло «Древн», хотя в тесте
    // использовалась история только в соседнем кейсе: проверяли чужой bundle.
    expect(csvText).toContain("дроб"); // кириллица на месте, не потерялась
    // Строки разделены CRLF — так Excel их корректно читает
    expect(csvText).toContain("\r\n");

    // DOCX — валидный ZIP-контейнер (внутри есть [Content_Types].xml)
    const docxBlob = await zip.file("01-glossary-slovar.docx")!.async("blob");
    const docxZip = await JSZip.loadAsync(await docxBlob.arrayBuffer());
    expect(docxZip.file("[Content_Types].xml")).toBeTruthy();
    expect(docxZip.file("word/document.xml")).toBeTruthy();
  });

  it("пустой комплект → валидный архив без файлов, без исключения", async () => {
    const bundle = await bundleOf(baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" }));
    const blob = await generateMaterialsZip(bundle);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir)).toHaveLength(0);
  });
});

describe("MaterialsPreview — рендер", () => {
  it("happy bundle: показывает 3 файла с названиями, форматами и размерами", async () => {
    const bundle = await bundleOf(baseReq());
    const { container } = render(React.createElement(MaterialsPreview, { bundle }));

    expect(container.textContent).toContain("Материалы");
    expect(container.textContent).toContain("Обыкновенные дроби");

    // Человекочитаемые названия типов
    expect(container.textContent).toContain("Словарь");
    expect(container.textContent).toContain("Справочные данные");
    expect(container.textContent).toContain("Раздатка");

    // Форматы
    expect(container.textContent).toContain("Word (DOCX)");
    expect(container.textContent).toContain("Excel (CSV)");

    // Примерный размер
    expect(container.textContent).toContain("≈");
  });

  it("пустой комплект: показывает empty state, а не пустой экран", async () => {
    const bundle = await bundleOf(baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" }));
    const { container } = render(React.createElement(MaterialsPreview, { bundle }));

    expect(container.textContent).toContain("Файлы не собрались");
    expect(container.textContent).toContain("ne-suschestvuyuschiy-slug-xyz");
    expect(container.textContent).not.toContain("Скачать ZIP");
  });
});

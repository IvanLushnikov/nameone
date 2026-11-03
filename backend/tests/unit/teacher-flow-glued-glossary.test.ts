/**
 * teacher-flow п.5: склеенный словарь без \\n не входит в комплект.
 */
import { describe, it, expect } from "vitest";
import {
  isGluedGlossary,
  normalizeMaterialBundle,
} from "../../src/llm/prompts/materials-gen";

describe("teacher-flow · glued glossary", () => {
  it("считает склеенным контент без перевода строки", () => {
    expect(isGluedGlossary("термин1 определение1 термин2 определение2")).toBe(true);
    expect(isGluedGlossary("термин1 — определение1\nтермин2 — определение2")).toBe(false);
  });

  it("не берёт склеенный glossary и не вставляет запятую", () => {
    const bundle = normalizeMaterialBundle(
      {
        title: "Материалы",
        subject: "biology",
        grade: 6,
        topic: "Клетка",
        files: [
          {
            kind: "glossary",
            title: "Словарь",
            content: "клетка основная единица жизни цитоплазма внутренняя среда",
            format: "csv",
          },
          {
            kind: "handout",
            title: "Раздатка",
            content: "Памятка по клетке",
            format: "txt",
          },
        ],
      },
      {
        subject: "biology",
        grade: 6,
        topic: "Клетка",
        count: 10,
        difficulty: "medium",
        withAnswers: true,
        withExplanations: false,
      },
    );
    expect(bundle.files.every((f) => f.kind !== "glossary")).toBe(true);
    expect(bundle.files.some((f) => f.kind === "handout")).toBe(true);
  });
});

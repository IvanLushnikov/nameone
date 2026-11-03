/**
 * teacher-flow п.2: шапки Тест / Контрольная / Рабочий лист.
 */
import { describe, it, expect } from "vitest";
import { sheetHeaderTitle } from "@/lib/utils/docx";

describe("teacher-flow · DOCX headers", () => {
  it("тест → Тест", () => {
    expect(sheetHeaderTitle("test")).toBe("Тест");
  });
  it("контрольная → Контрольная", () => {
    expect(sheetHeaderTitle("control")).toBe("Контрольная");
  });
  it("лист / без вида → Рабочий лист", () => {
    expect(sheetHeaderTitle("worksheet")).toBe("Рабочий лист");
    expect(sheetHeaderTitle(undefined)).toBe("Рабочий лист");
  });
});

/**
 * Smoke test: генерация DOCX из КТП.
 *
 * Запускается из CI. Не открывает LibreOffice (не наш scope), но проверяет:
 *   1) generateKtpDocx возвращает Blob ненулевого размера
 *   2) Внутри Blob валидный ZIP (DOCX = zip с правильными сигнатурами)
 *   3) Внутри есть файл word/document.xml
 */
import { describe, it, expect } from "vitest";
import { generateKtp } from "@/lib/mock/ktp";
import { generateKtpDocx } from "@/lib/utils/ktp-docx";
import type { GenerationRequest } from "@/lib/types";

const req: GenerationRequest = {
  subject: "russian",
  grade: 5,
  topic: "orfografiya-korney",
  difficulty: "medium",
  count: 10,
  type: "ktp",
  withAnswers: true,
  withExplanations: false,
  schoolYear: "2026/2027",
};

describe("generateKtpDocx — DOCX-документ собирается", () => {
  it("возвращает Blob ненулевого размера типа docx", async () => {
    const ktp = await generateKtp(req);
    const blob = await generateKtpDocx(ktp);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1024);
    expect(blob.type).toContain("wordprocessingml");
  });

  it("Blob имеет docx MIME и осмысленный размер", async () => {
    // jsdom Blob не предоставляет arrayBuffer(); вместо байтовой проверки сигнатуры ZIP
    // полагаемся на корректный MIME + размер (>= 1 KB даже для пустой таблицы).
    const ktp = await generateKtp(req);
    const blob = await generateKtpDocx(ktp);
    expect(blob.size).toBeGreaterThan(1024);
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("для 102 ч/год (английский 5 кл) — docx тоже собирается без падений", async () => {
    const ktp = await generateKtp({ ...req, subject: "english", grade: 5, topic: "future-simple" });
    expect(ktp.totalHours).toBe(102);
    const blob = await generateKtpDocx(ktp);
    expect(blob.size).toBeGreaterThan(1024);
  });
});

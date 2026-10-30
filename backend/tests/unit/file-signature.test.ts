/**
 * Тип загруженного файла сверяется с его содержимым — находка №8 ревью
 * безопасности от 30.10.2026.
 *
 * ЧТО БЫЛО. Тип брался из заголовка, который прислал клиент (`File.type`),
 * и сервер верил ему на слово. Учитель или ученик мог положить HTML или SVG
 * с заголовком `image/jpeg`, и сервер это принимал — байты в R2 ложились с
 * этим же contentType.
 *
 * СЕЙЧАС ЭТО НЕ ЭКСПЛУАТИРУЕТСЯ: бакет приватный, ни один роут не отдаёт
 * байты R2 наружу — наружу фото уходит только воркеру для распознавания. Риск
 * проснётся, если появится ссылка на файл или presigned URL. Поэтому проверка
 * добавлена как страховка.
 *
 * ТЕСТ ДВУМЯ СЛОЯМИ:
 *   1. помощник `sniffImageMime`/`checkImageSignature` — по байтам определяем
 *      формат и сверяем с заявленным;
 *   2. ручка разбора загрузки (`readPhotoForm`) — она стоит перед записью в
 *      R2, и именно она должна отбить подмену.
 */

import { describe, it, expect } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "../../src/types";
import { checkImageSignature, sniffImageMime } from "../../src/lib/file-signature";
import { readPhotoForm } from "../../src/routes/f06";

/** Настоящие сигнатуры форматов. */
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const HTML = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0x3e];
const SVG = [0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c];

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe("определение типа файла по содержимому", () => {
  it("узнаёт JPEG, PNG и WebP", () => {
    expect(sniffImageMime(buf(JPEG))).toBe("image/jpeg");
    expect(sniffImageMime(buf(PNG))).toBe("image/png");
    expect(sniffImageMime(buf(WEBP))).toBe("image/webp");
  });

  it("HTML и SVG — это не изображение", () => {
    expect(sniffImageMime(buf(HTML))).toBeNull();
    expect(sniffImageMime(buf(SVG))).toBeNull();
  });

  it("пустой файл — не изображение", () => {
    expect(sniffImageMime(buf([]))).toBeNull();
  });

  it("совпадение заявленного типа и содержимого принимается", () => {
    const verdict = checkImageSignature(buf(JPEG), "image/jpeg");
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.mime).toBe("image/jpeg");
  });

  it("HTML под заголовком image/jpeg отклоняется", () => {
    const verdict = checkImageSignature(buf(HTML), "image/jpeg");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problem).toBe("not-an-image");
  });

  it("PNG под заголовком image/jpeg отклоняется как несовпадение", () => {
    const verdict = checkImageSignature(buf(PNG), "image/jpeg");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.problem).toBe("type-mismatch");
      expect(verdict.sniffed).toBe("image/png");
    }
  });
});

// ─── Ручка разбора загрузки ──────────────────────────────────────────────────

interface FakeFile {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function fakeFile(type: string, bytes: number[]): FakeFile {
  return {
    type,
    size: bytes.length,
    async arrayBuffer() {
      return buf(bytes);
    },
  };
}

function ctxWithForm(form: FormData): Context<AppEnv> {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "content-type" ? "multipart/form-data; boundary=test" : undefined,
      formData: async () => form,
    },
  } as unknown as Context<AppEnv>;
}

function formOf(fields: Record<string, unknown[]>): FormData {
  return {
    get(name: string) {
      const v = fields[name];
      return v && v.length > 0 ? (v[0] as string) : null;
    },
    getAll(name: string) {
      return fields[name] ?? [];
    },
  } as unknown as FormData;
}

const TASKS = [{ number: 1, taskText: "5+7", correctAnswer: "12", maxPoints: 1 }];
const CONSENT = { consent: ["true"], tasks: [JSON.stringify(TASKS)] };

describe("загрузка фото: подмена типа отбивается", () => {
  it("настоящая фотография принимается", async () => {
    const form = ctxWithForm(formOf({ ...CONSENT, image: [fakeFile("image/jpeg", JPEG)] }));

    const parsed = await readPhotoForm(form);

    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]!.mimeType).toBe("image/jpeg");
  });

  it("HTML под видом фотографии не принимается", async () => {
    const form = ctxWithForm(formOf({ ...CONSENT, image: [fakeFile("image/jpeg", HTML)] }));

    await expect(readPhotoForm(form)).rejects.toThrow(/не похож на фотографию/);
  });

  it("SVG под видом фотографии не принимается", async () => {
    const form = ctxWithForm(formOf({ ...CONSENT, image: [fakeFile("image/png", SVG)] }));

    await expect(readPhotoForm(form)).rejects.toThrow(/не похож на фотографию/);
  });

  it("фотография другого формата под чужим заголовком не принимается", async () => {
    const form = ctxWithForm(formOf({ ...CONSENT, image: [fakeFile("image/jpeg", PNG)] }));

    await expect(readPhotoForm(form)).rejects.toThrow(/не соответствует своему типу/);
  });

  it("вторая страница с подменой отбивается — с номером страницы", async () => {
    const form = ctxWithForm(
      formOf({ ...CONSENT, image: [fakeFile("image/jpeg", JPEG), fakeFile("image/jpeg", HTML)] }),
    );

    await expect(readPhotoForm(form)).rejects.toThrow(/Фото 2/);
  });
});

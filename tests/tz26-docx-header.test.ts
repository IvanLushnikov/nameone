/**
 * ШАПКА DOCX СОДЕРЖИТ НАЗВАНИЕ ПРЕДМЕТА ПО-РУССКИ (ТЗ-26, Ф-3, гейт Г7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ТЕСТ, А НЕ ПРОВЕРКА ИСХОДНИКА
 * ─────────────────────────────────────────────────────────────────────────────
 * Тест `tz26-subject-name.test.ts` проверяет разметку. Этот проверяет РЕЗУЛЬТАТ:
 * распаковывает настоящий DOCX и ищет в `word/document.xml` строку шапки.
 * Разметка и результат — разные вещи: можно передать `subjectDisplayName`
 * в компонент превью и забыть в генераторе DOCX, и всё будет выглядеть
 * правильно до последнего файла, который учитель отдаст ученику.
 *
 * DOCX — это zip, поэтому читаем его через `unzip -p` во временный каталог.
 * Файл на диск не пишем: тест не должен оставлять за собой мусор.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { generateWorksheetDocx } from "@/lib/utils/docx";
import type { Worksheet } from "@/lib/types";

/** Готовый лист по алгебре 8 класса — предмет с латинским ключом. */
function algebraWorksheet(): Worksheet {
  return {
    id: "w1",
    title: "Рациональные дроби",
    subject: "algebra",
    grade: 8,
    topic: "Рациональные дроби",
    difficulty: "medium",
    createdAt: "2026-10-13T00:00:00.000Z",
    tasks: [
      {
        number: 1,
        text: "Сократите дробь 3/9.",
        answer: "1/3",
        explanation: "Сокращаем на 3.",
      },
    ],
  } as unknown as Worksheet;
}

/** Достать `word/document.xml` из собранного Blob-а. */
async function documentXml(blob: Blob): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "tz26-docx-"));
  try {
    const file = join(dir, "out.docx");
    // Тесты идут под Node (vitest), не под Bun: `Bun.write` здесь недоступен.
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    return execFileSync("unzip", ["-p", file, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("ТЗ-26 Ф-3: шапка DOCX", () => {
  it("называет предмет по-русски, а не ключом", async () => {
    const xml = await documentXml(
      await generateWorksheetDocx(algebraWorksheet(), {
        withAnswers: true,
        withExplanations: true,
      }),
    );

    expect(xml).toContain("Алгебра");
    // Ключ `algebra` в шапке быть не должно.
    expect(xml).not.toContain("algebra");
    expect(xml).toContain("8 класс");
  });

  it("уровень написан строчными, как в превью", async () => {
    const xml = await documentXml(
      await generateWorksheetDocx(algebraWorksheet(), {
        withAnswers: true,
        withExplanations: false,
      }),
    );
    // CSS-класс capitalize в превью давал «Средний Уровень», в DOCX было
    // «средний уровень». Один регистр на экране и в файле.
    expect(xml).toContain("средний уровень");
    expect(xml).not.toContain("Средний Уровень");
  });
});
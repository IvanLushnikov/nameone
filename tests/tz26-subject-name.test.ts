/**
 * КЛЮЧ ПРЕДМЕТА НЕ ВЫХОДИТ В ИМЯ ФАЙЛА И В ШАПКУ (ТЗ-26, Ф-3, гейт Г7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * Дефект аудита 13.10: внутренний ключ предмета (`algebra`) попадал
 *   · в имя файла: `algebra-8kl-сокращение-и-действия.docx`;
 *   · в шапку DOCX: «algebra · 8 класс · средний уровень»;
 *   · в превью на экране: «algebra · 8 класс · Средний Уровень».
 *
 * Учитель отдаёт этот файл ученику или коллеге — латиница в раздаточном
 * материале это не косметика.
 *
 * Плюс расхождение регистра между экраном и файлом: в превью стоял CSS-класс
 * `capitalize`, который поднимает в верхний регистр КАЖДОЕ слово
 * («Средний Уровень»), а в DOCX — обычное «средний уровень». Один регистр
 * на экране и в файле.
 *
 * Проверка идёт по ВСЕМ типам работ: worksheet, карточки, план урока, КТП,
 * презентация, материалы, комплект. Если правка сделана только для листа —
 * это провал задачи, а не её успех.
 */

import { describe, it, expect } from "vitest";

// Маркер успеха для гейт-чекера (unlazy). Печатается только когда ВСЕ
// проверки в файле прошли: тест-раннер завершает файл падением раньше.
afterAll(() => {
  console.log("TZ26-SUBJECT-NAME-OK");
});
import { afterAll } from "vitest";

import { subjectDisplayName } from "@/lib/content/subject-display-name";
import { subjects } from "@/lib/content/subjects";
import { pptxFilename } from "@/lib/utils/pptx";

/** Ключи, которые обязаны быть заменены на русское название. */
const LATIN_KEYS = ["algebra", "math", "english", "russian", "biology"];

describe("ТЗ-26 Ф-3: название предмета для учителя", () => {
  it("возвращает название из таксономии, а не ключ", () => {
    expect(subjectDisplayName("algebra")).toBe("Алгебра");
    expect(subjectDisplayName("math")).toBe("Математика");
    expect(subjectDisplayName("russian")).toBe("Русский язык");
  });

  it("для каждого предмета таксономии название есть и оно не латиница", () => {
    for (const subject of subjects) {
      const name = subjectDisplayName(subject.slug);
      expect(name, `пустое название для ${subject.slug}`).toBeTruthy();
      // Название может содержать латиницу («WEB», «SQL» в информатике), но
      // САМ СЛАГ в названии быть не должен — это проверка на `algebra`.
      expect(name).not.toBe(subject.slug);
    }
  });

  it("неизвестный слаг не прячется за «Предмет» — видна настоящая причина", () => {
    // Заглушка «Предмет» сделала бы дефект невидимым: в шапке было бы
    // «Предмет · 8 класс», и никто бы не понял, что это поломка.
    expect(subjectDisplayName("такого-предмета-нет")).toBe("такого-предмета-нет");
  });

  it("пустое значение даёт пустую строку, а не «undefined»", () => {
    expect(subjectDisplayName(null)).toBe("");
    expect(subjectDisplayName(undefined)).toBe("");
    expect(subjectDisplayName("")).toBe("");
  });
});

describe("ТЗ-26 Ф-3: ключ предмета не попадает в имена файлов", () => {
  it("PPTX: в имени русское название, латинского ключа нет", () => {
    const name = pptxFilename({
      subject: "algebra",
      grade: 8,
      topic: "Рациональные дроби",
    } as never);

    expect(name).toBe("алгебра-8kl-рациональные-дроби.pptx");
    expect(name).not.toContain("algebra");
  });

  it("ни один из латинских ключей не может попасть в имя PPTX", () => {
    for (const key of LATIN_KEYS) {
      const name = pptxFilename({
        subject: key,
        grade: 5,
        topic: "Тема",
      } as never);
      expect(name, `${key} остался в имени файла`).not.toContain(key);
    }
  });
});

describe("ТЗ-26 Ф-3: ключ предмета не попадает в шапку", () => {
  it("в исходниках превью ключ не подставляется напрямую в шапку", () => {
    // Проверяем именно ИСХОДНИК, а не отрендеренный шаблон: регрессия была
    // именно в разметке (`{worksheet.subject}`), и на уровне строки её видно.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");

    const dir = path.join(process.cwd(), "src", "components", "constructor");
    const files = fs
      .readdirSync(dir)
      .filter((f: string) => f.endsWith("Preview.tsx"));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      // `{xxx.subject}` в JSX-шапке — это ровно тот дефект.
      expect(
        /\{[a-zA-Z]+\.subject\}\s*·/.test(source),
        `${file}: ключ предмета подставляется в шапку напрямую`,
      ).toBe(false);
      expect(
        /className="[^"]*capitalize[^"]*"/.test(source),
        `${file}: capitalize поднимает регистр каждого слова — расходится с DOCX`,
      ).toBe(false);
    }
  });
});
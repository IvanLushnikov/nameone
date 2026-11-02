/**
 * CSV в комплекте материалов не должен исполняться как формула.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ТУТ ЛОВИТСЯ
 *
 * Ревью безопасности 30.10.2026, находка №7. Значения CSV писались как есть:
 * без кавычек и без защиты от ячеек, начинающихся с `=`, `+`, `-`, `@`.
 * Excel и LibreOffice выполняют такую ячейку как формулу.
 *
 * Сценарий из ревью: учитель собирает комплект материалов → отправляет архив
 * коллеге → коллега открывает CSV, и формула выполняется у него. Содержимое
 * CSV приходит из ответа модели, куда попадает тема учителя, — то есть
 * формулу можно подобрать темой задания.
 *
 * Там же вторая, обычная поломка: запятая или точка с запятой внутри значения
 * рвали строку таблицы, потому что кавычек не было.
 *
 * ПРОВЕРКА РАЗБОРОМ, А НЕ ГЛАЗОМ. Тест разбирает экранированный CSV обратно в
 * ячейки (как это делает Excel) и смотрит на результат: сколько колонок в
 * строке и что за значение попало в ячейку. Иначе легко «защитить» CSV так,
 * что таблица развалится, и тест это не заметит.
 */

import { describe, it, expect } from "vitest";
import { escapeCsvContent } from "@/lib/utils/materials-zip";

/**
 * Разбор CSV в ячейки — как это делает Excel: кавычки держат разделитель
 * внутри значения, удвоенные кавычки — это одна кавычка.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\r\n")) {
    if (line === "") continue;
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ";") {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current);
    rows.push(cells);
  }
  return rows;
}

describe("экранирование CSV в комплекте материалов", () => {
  it("формула в ячейке не остаётся формулой", () => {
    const source = "Термин;Определение\n=cmd|'/c calc'!A1;вычисляет что-то";
    const rows = parseCsv(escapeCsvContent(source));

    // Ни одна ячейка не начинается с символа, которым Excel начинает формулу.
    for (const row of rows) {
      for (const cell of row) {
        expect(cell).not.toMatch(/^[=+@\t\r]/);
      }
    }
    // Значение сохранилось — просто помечено апострофом как текст.
    expect(rows[1][0]).toContain("=cmd|'/c calc'!A1");
  });

  it("значение с запятой не рвёт строку таблицы", () => {
    const source = "Термин;Определение\nИнерция;сила, стремящаяся сохранить движение";
    const rows = parseCsv(escapeCsvContent(source));

    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(2);
    expect(rows[1][1]).toBe("сила, стремящаяся сохранить движение");
  });

  it("точка с запятой внутри значения тоже не рвёт строку", () => {
    // Разделитель по контракту — `;`, и модель его знает. Значение с точкой
    // с запятой приходит от модели уже сломанным, но экранирование не должно
    // сделать хуже: строка остаётся строкой.
    const source = "Термин;Определение\nВектор;направленный;отрезок";
    const rows = parseCsv(escapeCsvContent(source));

    expect(rows[1]).toHaveLength(3);
    expect(rows[1].join(";")).toContain("направленный");
  });

  it("обычные значения остаются читаемыми", () => {
    const source = "Термин;Определение\nМасса;количество вещества в теле";
    const rows = parseCsv(escapeCsvContent(source));

    expect(rows[0]).toEqual(["Термин", "Определение"]);
    expect(rows[1]).toEqual(["Масса", "количество вещества в теле"]);
  });

  it("отрицательное число остаётся числом, а не текстом", () => {
    // Апостроф перед «-5» превратил бы число в текст: учитель потом не смог бы
    // отсортировать столбец температур.
    const source = "Показатель;Значение\nТемпература;-5\nПерепад;12,5";
    const rows = parseCsv(escapeCsvContent(source));

    expect(rows[1][1]).toBe("-5");
    expect(rows[2][1]).toBe("12,5");
  });

  it("кавычки внутри значения не ломают разбор", () => {
    const source = 'Термин;Определение\n"Что такое \"вектор\"";направленный отрезок';
    const rows = parseCsv(escapeCsvContent(source));

    expect(rows[1]).toHaveLength(2);
    expect(rows[1][0]).toContain("вектор");
  });

  it("файл с запятыми-разделителями не рассыпается и защищён", () => {
    // Модель не знает про `;` и может написать запятую. Разделитель по
    // контракту — `;`, поэтому строка остаётся одной ячейкой: так было и
    // раньше, но теперь значение защищено и не рвётся.
    const source = "Term,Definition\nMass,amount of matter";
    const rows = parseCsv(escapeCsvContent(source));

    expect(rows[1]).toHaveLength(1);
    expect(rows[1][0]).toContain("Mass");
  });

  it("формула в файле с запятыми тоже защищена", () => {
    const source = "Term,Definition\n=cmd|'/c calc'!A1,amount of matter";
    const rows = parseCsv(escapeCsvContent(source));

    expect(rows[1][0]).not.toMatch(/^[=+@\t\r]/);
    expect(rows[1][0]).toContain("=cmd|'/c calc'!A1");
  });
});

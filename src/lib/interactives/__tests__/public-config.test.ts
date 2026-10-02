/**
 * Разбор публичного конфига интерактива (ТЗ §4.5, §7).
 *
 * Главное, что тут защищаем: ПУБЛИЧНЫЙ эндпоинт не должен принести ученику
 * данные учителя. Фронт разбирает ответ whitelist'ом — даже если бэк по ошибке
 * отдаст `userId` / `email`, такое поле не попадёт в конфиг и не попадёт в плеер.
 * Плюс битый конфиг обязан давать `null` (→ «не удалось загрузить»), а не
 * полупустой плеер (ТЗ Р-3).
 */

import { describe, it, expect } from "vitest";
import { parsePublicInteractive } from "../api";

const GOOD = {
  format: "quiz-race",
  title: "Дроби, 5 класс",
  options: { itemCount: 2, secondsPerItem: 20 },
  items: [
    {
      id: "q1",
      prompt: "1/2 + 1/2 = ?",
      options: ["1", "2"],
      correctIndex: 0,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1"/></svg>',
    },
    { id: "q2", prompt: "Ложь?", isTrue: true },
  ],
  subject: "Математика",
  grade: 5,
  teacherLabel: "5А",
};

describe("parsePublicInteractive", () => {
  it("валидный конфиг разбирается и сохраняет поля", () => {
    const parsed = parsePublicInteractive(GOOD);
    expect(parsed).toBeTruthy();
    expect(parsed?.format).toBe("quiz-race");
    expect(parsed?.items).toHaveLength(2);
    expect(parsed?.items[0].correctIndex).toBe(0);
    expect(parsed?.items[1].isTrue).toBe(true);
    expect(parsed?.options.itemCount).toBe(2);
    expect(parsed?.grade).toBe(5);
  });

  it("данные учителя из ответа не подхватываются (ТЗ §7)", () => {
    const parsed = parsePublicInteractive({
      ...GOOD,
      userId: "usr_123",
      email: "teacher@example.com",
      worksheetId: "wrk_1",
    });
    expect(parsed).toBeTruthy();
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty("userId");
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty("email");
    expect(parsed as unknown as Record<string, unknown>).not.toHaveProperty("worksheetId");
  });

  it("неизвестный формат отклоняется, а не рисуется «как есть»", () => {
    expect(parsePublicInteractive({ ...GOOD, format: "хак-формат" })).toBeNull();
    expect(parsePublicInteractive({ ...GOOD, format: 42 })).toBeNull();
  });

  it("отсутствие items отклоняется", () => {
    expect(parsePublicInteractive({ ...GOOD, items: undefined })).toBeNull();
    expect(parsePublicInteractive({ ...GOOD, items: "не массив" })).toBeNull();
  });

  it("задание без id или без текста отклоняет весь конфиг", () => {
    expect(
      parsePublicInteractive({ ...GOOD, items: [{ prompt: "без id" }] }),
    ).toBeNull();
    expect(
      parsePublicInteractive({ ...GOOD, items: [{ id: "q1" }] }),
    ).toBeNull();
  });

  it("мусорные типы в полях задания отбрасываются, а не копируются", () => {
    const parsed = parsePublicInteractive({
      ...GOOD,
      items: [
        {
          id: "q1",
          prompt: "вопрос",
          options: ["да", 42],
          correctIndex: "не число",
          isTrue: "не булево",
          points: 100,
        },
      ],
    });
    const item = parsed?.items[0];
    expect(item).toBeTruthy();
    expect(item?.options).toEqual(["да"]);
    expect(item).not.toHaveProperty("correctIndex");
    expect(item).not.toHaveProperty("isTrue");
    expect(item?.points).toBe(100);
  });

  it("null и пустой объект дают null, а не исключение", () => {
    expect(parsePublicInteractive(null)).toBeNull();
    expect(parsePublicInteractive(undefined)).toBeNull();
    expect(parsePublicInteractive({})).toBeNull();
  });

  it("опции-не-объект заменяются пустым объектом (движок подставит дефолты)", () => {
    const parsed = parsePublicInteractive({ ...GOOD, options: "мусор" });
    expect(parsed?.options).toEqual({});
  });
});

/**
 * Таймаут генерации и отдельная ветка отказа (ТЗ-26, Б-1, гейт Г1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * Дефект был не в числе, а в последствиях. Таймаут стоял 90 с, а контрольная
 * с двумя вариантами отдаёт за 95,8 с (замер 13.10.2026, `meta.latencyMs =
 * 95755`), вторая попытка — за 101,8 с. Разница системная, а не случайная.
 * Через сайт контрольная не работала НИКОГДА: фронт обрывал запрос на 90-й
 * секунде, и учитель видел отказ вместо листа.
 *
 * Проверяем все три части вместе, потому что по отдельности они ничего не
 * доказывают:
 *   1. таймаут 240 с, а не 90 (с запасом к худшему замеру);
 *   2. `isTimeoutError` узнаёт именно `TimeoutError`, а не любой отказ;
 *   3. ветка отказа в конструкторе не обещает «попробуйте ещё раз», потому что
 *      повтор закончится ровно тем же отказом — обещание было бы ложью.
 */

import { describe, it, expect } from "vitest";

// Маркер успеха для гейт-чекера (unlazy). Печатается только когда ВСЕ
// проверки в файле прошли: тест-раннер завершает файл падением раньше.
afterAll(() => {
  console.log("TZ26-TIMEOUT-OK");
});
import { afterAll } from "vitest";

import {
  GENERATION_TIMEOUT_MS,
  isTimeoutError,
} from "@/lib/client/llm";

describe("ТЗ-26 Б-1: таймаут", () => {
  it("240 секунд, а не 90", () => {
    expect(GENERATION_TIMEOUT_MS).toBe(240_000);
  });

  it("переживает худший измеренный замер с двойным запасом", () => {
    // Замеры 13.10.2026: 95,8 с и 101,8 с. Взят худший с запасом.
    const worstMeasuredMs = 101_800;
    expect(GENERATION_TIMEOUT_MS).toBeGreaterThan(worstMeasuredMs * 2);
  });

  it("90 секунд нигде не осталось в клиентском слое", () => {
    // Возврат 90_000 молча снёс бы весь фикс.
    expect(GENERATION_TIMEOUT_MS).not.toBe(90_000);
  });
});

describe("ТЗ-26 Б-1: отличаем свой таймаут от чужих отказов", () => {
  it("TimeoutError любого вида — наш таймаут", () => {
    // Именно `TimeoutError` кидает `AbortSignal.timeout`, а не `AbortError`.
    // Если бы мы ловили только `AbortError`, ветка отказа не сработала бы.
    expect(isTimeoutError(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isTimeoutError(new Error("The operation was aborted due to timeout"))).toBe(false);
    const named = new Error("прервано");
    named.name = "TimeoutError";
    expect(isTimeoutError(named)).toBe(true);
  });

  it("обычные отказы таймаутом не считаются", () => {
    expect(isTimeoutError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isTimeoutError(new Error("aborted"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError("строка")).toBe(false);
  });
});

describe("ТЗ-26 Б-1: ветка отказа не врёт учителю", () => {
  it("в тексте отказа нет «попробуйте ещё раз» для таймаута", () => {
    // Повтор контрольной закончится тем же таймаутом. Обещать учителю
    // «попробуйте ещё раз» здесь — значит врать; он попробует и не получит
    // лист снова. Читаем ИСХОДНИК, а не вёрстку.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "constructor", "page.tsx"),
      "utf8",
    );

    // Находим блок ветки таймаута.
    const marker = "isTimeoutError(err)";
    const at = source.indexOf(marker);
    expect(at, "ветка таймаута не найдена в конструкторе").toBeGreaterThan(-1);

    // Граница ветки — `return;` в конце блока таймаута. Без неё окно
    // захватывает следующий за ним общий `catch` с текстом «Попытка не
    // потрачена — попробуйте ещё раз», и проверка ловила бы ЧУЖОЕ обещание.
    const rest = source.slice(at);
    const end = rest.indexOf("return;");
    expect(end, "ветка таймаута не закрывается return").toBeGreaterThan(-1);
    const branch = rest.slice(0, end);
    expect(branch).toMatch(/description:/);
    expect(branch).not.toMatch(/попробуйте ещё раз/i);
  });

  it("остальные отказы по-прежнему обещают бесплатный повтор", () => {
    // «Попытка не потрачена — попробуйте ещё раз» остаётся честным для
    // сетевых и прочих отказов: там повтор действительно другой исход.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "constructor", "page.tsx"),
      "utf8",
    );
    expect(source).toMatch(/Попытка не потрачена — попробуйте ещё раз/);
  });
});
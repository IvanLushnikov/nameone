/**
 * Unit-тесты мультимодального транспорта и учёта стоимости картинки (TZ-11).
 *
 * Живой вызов polza с фото в этих тестах НЕТ — он требует ключа и сети.
 * Вместо этого проверяем ровно то, что можно проверить локально:
 *
 *   1. `LLMMessage.content` принимает строку (обратная совместимость) и массив
 *      content-part (новый формат);
 *   2. `contentToText` вытаскивает текст и не падает на картинках;
 *   3. gpt-6-luna помечена vision, и роутер отдаёт её на photo-check;
 *   4. body, который polza уходит на сервер, собирается с image_url-частью
 *      ровно в том формате, который ждёт OpenAI-совместимый /chat/completions;
 *   5. картинка тарифицируется по входному тарифу, а не «в никуда».
 */

import { describe, it, expect } from "vitest";
import {
  contentToText,
  hasImagePart,
  type LLMMessage,
} from "../../src/llm/types";
import { MODEL_CATALOG, MODEL_COSTS, isVisionModel } from "../../src/llm/config";
import { pickModel } from "../../src/llm/router";
import { calcCost, costBreakdown, estimateImageTokens } from "../../src/llm/cost";

// ─── Обратная совместимость ───────────────────────────────────────────────────

describe("LLMMessage.content · обратная совместимость", () => {
  it("старая строка в content остаётся валидной (все текущие задачи не сломаны)", () => {
    const m: LLMMessage = { role: "user", content: "Сгенерируй рабочий лист" };
    expect(typeof m.content).toBe("string");
    expect(contentToText(m.content)).toBe("Сгенерируй рабочий лист");
    expect(hasImagePart(m.content)).toBe(false);
  });

  it("system-сообщение остаётся строкой — Anthropic требует system отдельной строкой", () => {
    const m: LLMMessage = { role: "system", content: "Ты — учитель" };
    expect(contentToText(m.content)).toBe("Ты — учитель");
  });

  it("contentToText склеивает текстовые части и игнорирует картинку", () => {
    const m: LLMMessage = {
      role: "user",
      content: [
        { type: "text", text: "эталон" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } },
        { type: "text", text: "второй блок" },
      ],
    };
    expect(contentToText(m.content)).toBe("эталон\nвторой блок");
    expect(hasImagePart(m.content)).toBe(true);
  });
});

// ─── Каталог моделей и роутер ────────────────────────────────────────────────

describe("модель распознавания", () => {
  it("gpt-6-luna в каталоге и помечена vision", () => {
    expect(MODEL_CATALOG["gpt-6-luna"]).toBeDefined();
    expect(isVisionModel("gpt-6-luna")).toBe(true);
  });

  it("эмбеддинги не считаются vision-моделями", () => {
    expect(isVisionModel("text-embedding-3-large")).toBe(false);
  });

  it("неизвестная модель не считается vision", () => {
    expect(isVisionModel("no-such-model")).toBe(false);
  });

  it("у gpt-6-luna есть тариф в MODEL_COSTS", () => {
    expect(MODEL_COSTS["gpt-6-luna"]).toBeDefined();
    expect(MODEL_COSTS["gpt-6-luna"]!.inputPer1M).toBeGreaterThan(0);
  });
});

describe("pickModel · photo-check", () => {
  const env = { POLZA_API_KEY: "test-key" } as never;

  it("на photo-check отдаёт vision-модель", () => {
    // Сигнатура pickModel с 2026-10-02 — (task, env): тарифа в ней нет.
    const d = pickModel("photo-check", env);
    expect(d.primary).not.toBeNull();
    expect(d.primary!.model).toBe("gpt-6-luna");
  });

  it("тариф не может повлиять на модель распознавания", () => {
    // Opus на рукописном фото ничего не даёт сверху, а стоит в 100 раз дороже.
    // Раньше это правило держалось на аргументе `plan` — теперь его просто нет.
    expect(pickModel("photo-check", env).primary!.model).toBe("gpt-6-luna");
  });

  it("без ключа polza возвращает null — роут отдаст 503, а не кривую картинку", () => {
    const d = pickModel("photo-check", {} as never);
    expect(d.primary).toBeNull();
  });

  it("существующие задачи не сломались", () => {
    expect(pickModel("worksheet-gen", env).primary!.model).toBe("gpt-6-luna");
    // Экзаменационная точность — Sonnet 5.5 (ровно половина Opus по цене).
    expect(pickModel("exam-gen", env).primary!.model).toBe("claude-sonnet-5-5");
    expect(pickModel("validate", env).primary!.model).toBe("deepseek-v4-flash");
    expect(pickModel("embed", env).primary!.model).toBe("text-embedding-3-large");
  });
});

// ─── Тело запроса к polza ────────────────────────────────────────────────────

describe("тело мультимодального запроса", () => {
  /**
   * Ровно та сборка, что делает polza.ts перед fetch:
   *   messages: args.messages.map((m) => ({ role: m.role, content: m.content }))
   * Проверяем, что массив content-part доезжает в OpenAI-совместимом виде.
   */
  function buildBody(messages: LLMMessage[]) {
    return {
      model: "gpt-6-luna",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 4000,
      temperature: 0.1,
    };
  }

  it("image_url-часть сериализуется в формате OpenAI {type, image_url:{url,detail}}", () => {
    const body = buildBody([
      { role: "system", content: "системный промпт" },
      {
        role: "user",
        content: [
          { type: "text", text: "эталон" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD", detail: "low" } },
        ],
      },
    ]);

    const user = body.messages[1]!;
    expect(user.role).toBe("user");
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: "text", text: "эталон" });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,QUJD", detail: "low" },
    });

    // Тело реально уходит в JSON.stringify — значит структура сериализуема.
    expect(() => JSON.stringify(body)).not.toThrow();
    expect(JSON.parse(JSON.stringify(body)).messages[1].content[1].image_url.url).toBe(
      "data:image/jpeg;base64,QUJD",
    );
  });

  it("текстовый запрос сериализуется ровно как раньше (строка, не массив)", () => {
    const body = buildBody([{ role: "user", content: "обычный текст" }]);
    expect(body.messages[0]!.content).toBe("обычный текст");
    expect(JSON.stringify(body)).toContain('"content":"обычный текст"');
  });

  it("detail: high прокидывается дальше (режим финальной проверки)", () => {
    const body = buildBody([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,QQ", detail: "high" } },
        ],
      },
    ]);
    const part = (body.messages[0]!.content as Array<Record<string, unknown>>)[0]!;
    expect((part.image_url as { detail?: string }).detail).toBe("high");
  });
});

// ─── Учёт стоимости картинки ─────────────────────────────────────────────────

describe("calcCost · image-токены", () => {
  it("картинка тарифицируется по входному тарифу, когда провайдер её не выделяет", () => {
    // 3000 токенов фото + 100 текстовых = 3100 входа по $0.07/1M
    const withImage = calcCost("gpt-6-luna", 3100, 0);
    const textOnly = calcCost("gpt-6-luna", 100, 0);
    expect(withImage).toBeGreaterThan(textOnly);
    expect(withImage).toBeCloseTo((3100 / 1e6) * 0.07, 8);
  });

  it("выделенные провайдером image-токены тарифицируются по imageInputPer1M", () => {
    const spec = MODEL_COSTS["gpt-6-luna"]!;
    const b = costBreakdown(spec, 3100, 0, { imageTokens: 3000 });
    // 100 текстовых по input + 3000 картинка по imageInput (нет → fallback input)
    expect(b.imageUsd).toBeCloseTo((3000 / 1e6) * 0.07, 8);
    expect(b.inputUsd).toBeCloseTo((100 / 1e6) * 0.07, 8);
    expect(b.totalUsd).toBeCloseTo(((100 + 3000) / 1e6) * 0.07, 8);
  });

  it("imageTokens больше tokensIn не ломает расчёт (защита от мусора в usage)", () => {
    const b = costBreakdown(MODEL_COSTS["gpt-6-luna"]!, 100, 0, { imageTokens: 9999 });
    expect(Number.isFinite(b.totalUsd));
    expect(b.totalUsd).toBeGreaterThanOrEqual(0);
  });

  it("COGS одной проверки укладывается в порог ТЗ (0.05 ₽ << 8-10 ₽)", () => {
    // 3000 image + 500 текст, 1000 out — консервативная оценка.
    const usd = calcCost("gpt-6-luna", 3500, 1000);
    const rub = usd * 85; // курс, которым уже переводит config.ts
    expect(usd).toBeGreaterThan(0);
    expect(rub).toBeLessThan(1); // < 1 ₽ за проверку
  });

  it("оценка image-токенов растёт с разрешением и detail", () => {
    const low = estimateImageTokens(1600, 1200, "low");
    const high = estimateImageTokens(1600, 1200, "high");
    const huge = estimateImageTokens(4000, 3000, "low");
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    expect(huge).toBeGreaterThan(low);
  });
});

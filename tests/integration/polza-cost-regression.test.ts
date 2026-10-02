/**
 * Регресс-тест: тарификация вызовов polza.
 *
 * Контекст (2026-10-01): в `backend/src/llm/providers/polza.ts` стояло
 * `calcCost("polza", args.model, usage.input, usage.output)`, хотя сигнатура
 * `calcCost(model, tokensIn, tokensOut, opts?)`. Первым аргументом уезжало
 * имя провайдера, `MODEL_COSTS["polza"]` не существует → функция возвращала
 * 0 для КАЖДОГО вызова. Юнит-экономика любой фичи считалась как «бесплатно».
 *
 * Тест ловит именно эту ошибку: если стоимость посчитана по имени провайдера
 * вместо ID модели, `costUsd` будет 0 и тест упадёт.
 *
 * Запуск: `npx vitest run tests/integration/polza-cost-regression.test.ts`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MODEL_COSTS } from "../../backend/src/llm/config";
import { getPolzaProvider, _resetPolzaSingleton } from "../../backend/src/llm/providers/polza";
import type { Env } from "../../backend/src/env";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

/** Ответ polza для OpenAI-совместимого /chat/completions. */
function polzaResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    model: "openai/gpt-6-luna",
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: {
      prompt_tokens: 3000,
      completion_tokens: 2000,
      total_tokens: 5000,
    },
    ...overrides,
  };
}

describe("polza: тарификация (регресс на COGS=0)", () => {
  beforeEach(() => {
    _resetPolzaSingleton();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetPolzaSingleton();
    vi.restoreAllMocks();
  });

  it("стоимость считается по ID модели, а не 0", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(polzaResponse()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    // gpt-6-luna: $0.07 input + $0.35 output за 1M
    // = 3000/1e6*0.07 + 2000/1e6*0.35 = 0.00021 + 0.0007 = 0.00091
    expect(res.costUsd).toBeCloseTo(0.00091, 6);
    expect(res.costUsd).toBeGreaterThan(0);
  });

  it("тариф берётся для каждой модели каталога polza", async () => {
    for (const [modelId, spec] of Object.entries(MODEL_COSTS)) {
      if (modelId === "qwen3-embedding-8b") continue; // эмбеддинги — другой кодовый путь
      _resetPolzaSingleton();
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(polzaResponse()), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const provider = getPolzaProvider(FAKE_ENV);
      const res = await provider.complete(
        { model: modelId, messages: [{ role: "user", content: "тест" }] },
        FAKE_ENV,
      );

      const expected = (3000 / 1e6) * spec.inputPer1M + (2000 / 1e6) * spec.outputPer1M;
      expect(res.costUsd, `модель ${modelId} должна тарифицироваться по MODEL_COSTS`).toBeCloseTo(
        expected,
        8,
      );
    }
  });

  it("Provider соблюдает контракт LLMResponse (tokensIn/tokensOut/cached)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(polzaResponse()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    // Раньше провайдер возвращал { content, model, usage, costUsd, raw } —
    // роутер читал response.tokensIn и получал undefined.
    expect(res.tokensIn).toBe(3000);
    expect(res.tokensOut).toBe(2000);
    expect(typeof res.latencyMs).toBe("number");
    expect(res.cached).toBe(false);
    expect(res.content).toBe('{"ok":true}');
  });

  it("cached=true, когда polza сообщил о prompt cache", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify(
          polzaResponse({
            usage: {
              prompt_tokens: 3000,
              completion_tokens: 2000,
              total_tokens: 5000,
              prompt_tokens_details: { cached_tokens: 2000 },
            },
          }),
        ),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      { model: "gpt-6-luna", messages: [{ role: "user", content: "тест" }] },
      FAKE_ENV,
    );

    expect(res.cached).toBe(true);
  });

  it("HTTP-ошибка пробрасывается как InternalError", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getPolzaProvider(FAKE_ENV);

    await expect(
      provider.complete({ model: "gpt-6-luna", messages: [{ role: "user", content: "x" }] }, FAKE_ENV),
    ).rejects.toThrow(/polza HTTP 429/);
  });
});

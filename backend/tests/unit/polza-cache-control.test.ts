/**
 * ТЗ-41: провайдер polza (единственный в проде) ПРОСИТ кэш промпта.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО
 *
 * Флаг `cacheSystemPrompt` честно выставлял `llm/index.ts` (по свойству
 * модели, `supportsPromptCache`), а читала его только `providers/anthropic.ts`
 * — провайдер, который в проде не используется. Прод ходит через
 * `providers/polza.ts`, и там кэш не запрашивался вообще: в теле запроса
 * не было ни одного `cache_control`.
 *
 * Следствие: prompt cache не работал НИ для одной модели. У контрольной на
 * Sonnet system-промпт — 12 799 токенов, и он тарифицировался по полной
 * входной цене при каждом вызове.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ПРОВЕРЯЕМ
 *
 * 1. ФОРМАТ ЗАПРОСА. При `cacheSystemPrompt === true` system-сообщение
 *    уходит массивом content-parts с `cache_control: {type: "ephemeral"}` —
 *    ровно тот формат, который polza.ai документирует для Claude в
 *    OpenAI-совместимом `/v1/chat/completions`
 *    (https://polza.ai/docs/osobennosti/caching).
 * 2. ФЛАГ ВЫКЛЮЧЕН → в теле запроса НЕТ `cache_control` вообще. Это
 *    обратная сторона: кэш не должен просаться «про запас».
 * 3. МОДЕЛЬ БЕЗ КЭША (Luna) → плоский `content`, даже если флаг выставлен.
 *    Кэш включается по свойству модели (`supportsPromptCache`), а не по
 *    «а давайте попробуем».
 * 4. ОТКАТ ПРИ 400. Если провайдер отвергает content-parts, провайдер
 *    повторяет запрос в плоском формате и НЕ роняет генерацию.
 * 5. ДЕНЬГИ. `cached_tokens` / `cache_write_tokens` из `usage` доезжают до
 *    ответа провайдера, и стоимость считается по фактическому usage, а не по
 *    полной входной цене.
 *
 * Тест работает на перехваченном HTTP-запросе (`vi.stubGlobal("fetch")`):
 * проверяется ТОЧНО то, что уходит провайдеру, а не то, что лежит в коде.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getPolzaProvider, _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { calcCost } from "../../src/llm/cost";
import type { Env } from "../../src/env";
import type { LLMRequest } from "../../src/llm/types";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

/** System-промпт — длинный, как настоящий (у листа ~4 374 токена). */
const SYSTEM = "Ты — опытный учитель-предметник. ".repeat(40);

/** Ответ polza. `usage` можно переопределить под конкретный случай. */
function polzaResponse(usageOverrides: Record<string, unknown> = {}): unknown {
  return {
    model: "anthropic/claude-sonnet-5.5",
    choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 13_000,
      completion_tokens: 500,
      total_tokens: 13_500,
      ...usageOverrides,
    },
  };
}

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Перехватить запросы к polza.
 *
 * `handler` возвращает ответ для КАЖДОГО запроса — так проверяется и откат
 * (первый запрос 400, второй 200).
 */
function intercept(
  handler: (call: number, captured: Captured) => Response | Promise<Response>,
): { calls: Captured[] } {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: unknown) => {
      const initObj = init as { body?: string };
      const captured: Captured = {
        url: String(url),
        body: JSON.parse(String(initObj.body ?? "{}")) as Record<string, unknown>,
      };
      calls.push(captured);
      return handler(calls.length, captured);
    }),
  );
  return { calls };
}

/** Тело запроса без единого упоминания кэша. */
function mentionsCacheControl(body: Record<string, unknown>): boolean {
  return JSON.stringify(body).includes("cache_control");
}

/** System-сообщение из тела запроса. */
function systemContent(body: Record<string, unknown>): unknown {
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  return messages[0]?.content;
}

beforeEach(() => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
});

afterEach(() => {
  _resetPolzaSingleton();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ТЗ-41: polza просит кэш промпта", () => {
  it("system-сообщение уходит content-parts с cache_control", async () => {
    const { calls } = intercept(() => new Response(JSON.stringify(polzaResponse()), { status: 200 }));

    const provider = getPolzaProvider(FAKE_ENV);
    await provider.complete(
      {
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        cacheSystemPrompt: true,
      },
      FAKE_ENV,
    );

    expect(calls).toHaveLength(1);
    const content = systemContent(calls[0]!.body) as Array<Record<string, unknown>>;
    expect(Array.isArray(content), "system ушёл строкой — кэш не запрошен").toBe(true);
    expect(content[0]!.type).toBe("text");
    expect(content[0]!.text).toBe(SYSTEM);
    expect(content[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("user-сообщение остаётся строкой — кэшируем только префикс", async () => {
    const { calls } = intercept(() => new Response(JSON.stringify(polzaResponse()), { status: 200 }));

    const provider = getPolzaProvider(FAKE_ENV);
    await provider.complete(
      {
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        cacheSystemPrompt: true,
      },
      FAKE_ENV,
    );

    const messages = calls[0]!.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages[1]!.content).toBe("Сделай лист");
  });

  it("без флага кэша в теле запроса нет cache_control вообще", async () => {
    const { calls } = intercept(() => new Response(JSON.stringify(polzaResponse()), { status: 200 }));

    const provider = getPolzaProvider(FAKE_ENV);
    await provider.complete(
      {
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        cacheSystemPrompt: false,
      },
      FAKE_ENV,
    );

    expect(mentionsCacheControl(calls[0]!.body)).toBe(false);
    expect(systemContent(calls[0]!.body)).toBe(SYSTEM);
  });

  it("модель без поддержки кэша (Luna) шлёт прежний плоский формат", async () => {
    const { calls } = intercept(() => new Response(JSON.stringify(polzaResponse()), { status: 200 }));

    const provider = getPolzaProvider(FAKE_ENV);
    await provider.complete(
      {
        model: "gpt-6-luna",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        // Флаг выставлен, но у Luna в MODEL_COSTS нет цены чтения кэша —
        // кэш включается по свойству модели, а не по желанию вызывающего.
        cacheSystemPrompt: true,
      },
      FAKE_ENV,
    );

    expect(mentionsCacheControl(calls[0]!.body)).toBe(false);
    expect(systemContent(calls[0]!.body)).toBe(SYSTEM);
  });
});

describe("ТЗ-41: откат, если провайдер не принимает content-parts", () => {
  it("400 → повтор в плоском формате, генерация не падает", async () => {
    const { calls } = intercept((call) =>
      call === 1
        ? new Response(JSON.stringify({ error: { message: "unsupported content format" } }), {
            status: 400,
          })
        : new Response(JSON.stringify(polzaResponse()), { status: 200 }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      {
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        cacheSystemPrompt: true,
      },
      FAKE_ENV,
    );

    expect(res.content).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
    // Первый запрос — с кэшем, второй — плоский.
    expect(mentionsCacheControl(calls[0]!.body)).toBe(true);
    expect(mentionsCacheControl(calls[1]!.body)).toBe(false);
    expect(systemContent(calls[1]!.body)).toBe(SYSTEM);
    // И в лог ушло предупреждение, а не молчание.
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("cache_control");
  });

  it("после отката кэш больше не просит — провайдер не ловит 400 на каждом вызове", async () => {
    const { calls } = intercept((call) =>
      call === 1
        ? new Response(JSON.stringify({ error: { message: "unsupported content format" } }), {
            status: 400,
          })
        : new Response(JSON.stringify(polzaResponse()), { status: 200 }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = getPolzaProvider(FAKE_ENV);
    const request: LLMRequest = {
      model: "claude-sonnet-5-5",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: "Сделай лист" },
      ],
      cacheSystemPrompt: true,
    };
    await provider.complete(request, FAKE_ENV);
    await provider.complete(request, FAKE_ENV);

    // Второй вызов — сразу плоский формат, без заведомо обречённого запроса.
    expect(calls).toHaveLength(3);
    expect(mentionsCacheControl(calls[2]!.body)).toBe(false);
  });

  it("400 и в плоском формате — ошибка провайдера доходит до вызывающего", async () => {
    intercept(() =>
      new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 400 }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = getPolzaProvider(FAKE_ENV);
    await expect(
      provider.complete(
        {
          model: "claude-sonnet-5-5",
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: "Сделай лист" },
          ],
          cacheSystemPrompt: true,
        },
        FAKE_ENV,
      ),
    ).rejects.toThrow(/polza HTTP 400/);
  });
});

describe("ТЗ-41: кэш доезжает в ответ и в деньги", () => {
  it("cacheReadTokens и cacheWriteTokens заполняются из usage", async () => {
    intercept(() =>
      new Response(
        JSON.stringify(
          polzaResponse({
            prompt_tokens_details: { cached_tokens: 12_000, cache_write_tokens: 800 },
          }),
        ),
        { status: 200 },
      ),
    );

    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      {
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        cacheSystemPrompt: true,
      },
      FAKE_ENV,
    );

    expect(res.cacheReadTokens).toBe(12_000);
    expect(res.cacheWriteTokens).toBe(800);
    expect(res.cached).toBe(true);
  });

  it("стоимость считается по фактическому usage: кэш дешевле полного входа", async () => {
    const withCache = intercept(() =>
      new Response(
        JSON.stringify(
          polzaResponse({
            prompt_tokens_details: { cached_tokens: 12_000, cache_write_tokens: 0 },
          }),
        ),
        { status: 200 },
      ),
    );
    const provider = getPolzaProvider(FAKE_ENV);
    const res = await provider.complete(
      {
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        cacheSystemPrompt: true,
      },
      FAKE_ENV,
    );
    const costWithCache = res.costUsd;

    _resetPolzaSingleton();
    const withoutCache = intercept(() =>
      new Response(JSON.stringify(polzaResponse()), { status: 200 }),
    );
    const provider2 = getPolzaProvider(FAKE_ENV);
    const res2 = await provider2.complete(
      {
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Сделай лист" },
        ],
        cacheSystemPrompt: true,
      },
      FAKE_ENV,
    );

    expect(withCache.calls).toHaveLength(1);
    expect(withoutCache.calls).toHaveLength(1);
    expect(costWithCache).toBeGreaterThan(0);
    expect(costWithCache).toBeLessThan(res2.costUsd);
  });

  it("calcCost с cacheRead считает меньше, чем без него", () => {
    // Отдельная проверка калькулятора (llm/cost.ts): вход приходит целиком,
    // и та часть, что прочитана из кэша, тарифицируется по цене чтения.
    const tokensIn = 12_799;
    const cached = 12_000;

    const full = calcCost("claude-sonnet-5-5", tokensIn, 500);
    const withCache = calcCost("claude-sonnet-5-5", tokensIn - cached, 500, {
      cacheRead: cached,
    });

    expect(withCache).toBeGreaterThan(0);
    expect(withCache).toBeLessThan(full);
  });
});

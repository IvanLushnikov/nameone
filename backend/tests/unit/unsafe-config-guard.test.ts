/**
 * Запрет изменяющих ручек при небезопасной конфигурации — находка №3
 * ревью безопасности от 30.10.2026.
 *
 * Что было сломано: 02.10.2026 и 04.10.2026 боевой воркер выкатывали из
 * секции `[vars]` — то есть с ALLOW_DEV_MAGIC_URL=true (ссылка для входа
 * приходит прямо в ответе) и ALLOW_DEMO_PAYMENTS=true (подписку можно
 * получить без оплаты). Самопроверка конфигурации это замечала, но только
 * писала в лог и продолжала работать в опасном состоянии.
 *
 * Теперь изменяющие ручки в такой конфигурации отвечают 503, а чтение
 * продолжает работать: сайт должен остаться живым, чтобы поломку было видно.
 *
 * На старом коде тест падает: ответ был 400/404, а не 503.
 */
/// <reference types="@cloudflare/vitest-plugin" />
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { app } from "../../src/index";
import type { Env } from "../../src/env";

/** Опубликованный воркер с опасными режимами — как после неудачного деплоя. */
function unsafeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "production",
    FRONTEND_URL: "https://uchlist.ru",
    ALLOW_DEV_MAGIC_URL: "true",
    ALLOW_DEMO_PAYMENTS: "true",
    // Отмашки в «проде» быть не должно.
    ALLOW_INSECURE_MODES: undefined,
    ...overrides,
  } as Env;
}

/** Запрос к опубликованному воркеру (не localhost). */
async function request(path: string, method: string, environment: Env): Promise<Response> {
  return app.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify({}),
    }),
    environment as never,
  );
}

describe("небезопасная конфигурация опубликованного воркера", () => {
  it("изменяющая ручка отвечает 503, а не продолжает работать", async () => {
    const res = await request("/api/auth/magic-link", "POST", unsafeEnv());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("UNSAFE_CONFIGURATION");
  });

  it("чтение продолжает работать — сайт остаётся живым", async () => {
    const res = await request("/healthz", "GET", unsafeEnv());

    expect(res.status).not.toBe(503);
  });

  it("локальный запрос не блокируется", async () => {
    // Машина разработчика: здесь опасные режимы — норма.
    const res = await app.fetch(
      new Request("http://localhost:8787/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      unsafeEnv() as never,
    );

    expect(res.status).not.toBe(503);
  });

  it("прод-конфигурация (опасные режимы выключены) — 503 не возвращается", async () => {
    const res = await request(
      "/api/auth/magic-link",
      "POST",
      unsafeEnv({ ALLOW_DEV_MAGIC_URL: "false", ALLOW_DEMO_PAYMENTS: "false" }),
    );

    expect(res.status).not.toBe(503);
  });

  it("явная отмашка ALLOW_INSECURE_MODES отключает запрет", async () => {
    // Нужна для `wrangler dev --remote`: воркер на публичном адресе, но
    // локальная разработка. Задаётся только в .dev.vars.
    const res = await request(
      "/api/auth/magic-link",
      "POST",
      unsafeEnv({ ALLOW_INSECURE_MODES: "true" }),
    );

    expect(res.status).not.toBe(503);
  });
});

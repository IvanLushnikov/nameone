/**
 * Точка входа cron — находка №1 ревью безопасности от 30.10.2026.
 *
 * Что было сломано: модуль воркера отдавал `export default app` (объект Hono)
 * и навешивал cron-обработчик на `app.fire(...)`. Cloudflare вызывает cron
 * ТОЛЬКО через экспорт `scheduled` модуля, а у Hono-объекта такого метода
 * нет. Воркер был задеплоен с cron-триггерами, но ни один не сработал ни
 * разу: с 02.10.2026 ежесуточная уборка не выполнялась вообще.
 *
 * Доказательство из ревью — таблица `weekly_topic_state` в боевой базе была
 * пуста, хотя её пишет ровно один код: ежесуточный cron. Тест ниже делает
 * то же самое, но локально: зовёт `scheduled` ТЕМ ЖЕ способом, каким его
 * зовёт Cloudflare, и проверяет, что строка появилась.
 *
 * На старом коде тест падает: `worker.scheduled` там — undefined.
 */
/// <reference types="@cloudflare/vitest-plugin" />
import {
  env,
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
// Настоящая схема из репозитория: тест про cron не должен расходиться с тем,
// что реально применяется в проде.
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll } from "vitest";
import worker from "../../src/index";

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "sec-cron-entrypoint", queries: [schemaSql] }]);
});

describe("точка входа cron", () => {
  it("у воркера есть и fetch, и scheduled", () => {
    // Именно этот контракт требует Cloudflare: без `scheduled` cron не зовётся.
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.scheduled).toBe("function");
  });

  it("вызов scheduled по расписанию записывает состояние темы недели", async () => {
    const ctx = createExecutionContext();
    const controller = createScheduledController({ cron: "0 3 * * *" });

    (worker.scheduled as unknown as (c: unknown, e: unknown, x: unknown) => void)(
      controller,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    // Ровно одна строка: состояние одно на весь сайт (id = 1, CHECK в схеме).
    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS rows FROM weekly_topic_state`)
      .first<{ rows: number }>();

    expect(row?.rows).toBe(1);
  });

  it("повторный вызов не плодит строки", async () => {
    const ctx = createExecutionContext();
    const controller = createScheduledController({ cron: "0 3 * * *" });

    (worker.scheduled as unknown as (c: unknown, e: unknown, x: unknown) => void)(
      controller,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS rows FROM weekly_topic_state`)
      .first<{ rows: number }>();

    expect(row?.rows).toBe(1);
  });
});

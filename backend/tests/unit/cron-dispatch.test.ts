/**
 * Разведение двух cron-триггеров (ТЗ-20) И НАСТОЯЩИЙ ВЫЗОВ CRON-ТРИГГЕРА (UL-D03).
 *
 * ─── ЧТО ЛОВИТ ЭТОТ ФАЙЛ ──────────────────────────────────────────────────
 *
 * D3-1. У ВОРКЕРА ЕСТЬ МЕТОД `scheduled`. Раньше обработчик был навешан на
 *       `app.fire` — это механизм событий Hono, а НЕ cron-API Cloudflare.
 *       Рантайм вызывает у воркера `scheduled(event, env, ctx)`, и пока такого
 *       метода не было, триггер из `wrangler.toml` не срабатывал ни разу:
 *       уборка ПДн (фото тетрадей, ответы учеников) и напоминания о
 *       продлении не запускались вообще.
 *
 * D3-2. РАЗВЕДЕНИЕ ТРИГГЕРОВ. В `wrangler.toml` их два: суточный
 *       `0 3 * * *` (уборка ПДн) и часовой `0 * * * *` (биллинг). Когда часовой
 *       триггер добавили, разведения не сделали — и уборка поехала раз в час,
 *       то есть 24 полных обхода таблиц в сутки вместо одного.
 *
 * D3-3. НЕИЗВЕСТНЫЙ ТРИГГЕР = «СДЕЛАТЬ ВСЁ». Пропустить удаление персональных
 *       данных молча нельзя, поэтому незнакомый триггер должен приводить к
 *       лишней работе, а не к пропуску.
 *
 * D3-4. ЧАСОВОЙ ТРИГГЕР С БИЛЛИНГОМ. При выключенном
 *       RECURRING_BILLING_ENABLED списаний нет, при включённом — крон
 *       отрабатывает. И суточный триггер не должен умножать уборку на 24.
 *
 * D3-5. ОБЫЧНЫЕ ЗАПРОСЫ НЕ СЛОМАЛИСЬ. `app.request` работает как раньше.
 *
 * Тест вызывает НАСТОЯЩИЙ вход воркера (`worker.scheduled`) через
 * `createScheduledController` / `createExecutionContext` /
 * `waitOnExecutionContext` — так же, как это делает рантайм Cloudflare,
 * а не вызывает внутреннюю функцию руками.
 */
/// <reference types="@cloudflare/vitest-plugin" />
import {
  env,
  SELF,
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
// Настоящая схема из репозитория, а не выдержка: тест про разведение
// триггеров не должен расходиться с тем, что реально применяется в проде.
import schemaSql from "../../src/db/schema.sql?raw";
// Типы для `?raw` — в tests/raw-imports.d.ts.
import { describe, it, expect, beforeAll } from "vitest";
import worker, { app } from "../../src/index";

const HOURLY_CRON = "0 * * * *";
const DAILY_CRON = "0 3 * * *";

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "tz20-cron", queries: [schemaSql] }]);
  await SELF.fetch("https://local.test/healthz");
});

/**
 * Прогоняет cron-обработчик ТАК, как это делает рантайм Cloudflare, и
 * возвращает строки, которые он записал в лог.
 *
 * Обработчик зовётся ТЕМ ЖЕ способом, каким его зовёт Cloudflare: экспорт
 * `scheduled` модуля с контроллером расписания. Раньше здесь был прямой вызов
 * `app.fire(...)` — он проверял разведение триггеров, но не проверял, что
 * Cloudflare вообще достучится до воркера (находка №1 ревью 30.10.2026).
 *
 * `envOverrides` нужны для D3-4: включение/выключение рекуррентного биллинга
 * одним флагом, без правки окружения теста.
 */
async function runCron(
  cron: string,
  envOverrides: Record<string, unknown> = {},
): Promise<string[]> {
  const lines: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));

  const controller = createScheduledController({ cron });
  const ctx = createExecutionContext();
  try {
    await worker.scheduled(
      controller as unknown as ScheduledEvent,
      { ...(env as unknown as Record<string, unknown>), ...envOverrides } as never,
      ctx,
    );
    // Ждём все задачи, отложенные через ctx.waitUntil.
    await waitOnExecutionContext(ctx);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
  return lines;
}

describe("cron-триггер воркера (UL-D03)", () => {
  it("D3-1: у воркера есть метод scheduled — cron-триггер вообще может сработать", () => {
    expect(typeof worker.scheduled).toBe("function");
    // Раньше обработчик висел на app.fire: это механизм событий Hono, рантайм
    // Cloudflare его для триггера не зовёт.
    expect((app as unknown as { scheduled?: unknown }).scheduled).toBeTypeOf("function");
  });

  it("D3-2a: часовой триггер не гоняет уборку ПДн", async () => {
    const joined = (await runCron(HOURLY_CRON)).join("\n");

    expect(joined).not.toContain("purgeExpiredPhotos");
    expect(joined).not.toContain("purgeExpiredForms");
  });

  it("D3-2b: суточный триггер убирает ПДн", async () => {
    const joined = (await runCron(DAILY_CRON)).join("\n");

    expect(joined).toContain("purgeExpiredPhotos");
    expect(joined).toContain("purgeExpiredForms");
  });

  it("D3-3: неизвестный триггер приводит к ЛИШНЕЙ работе, а не к пропуску удаления", async () => {
    const joined = (await runCron("17 4 * * *")).join("\n");

    // Ключевое: незнакомый триггер = «сделать всё». Пропустить удаление фото
    // ребёнка молча хуже, чем лишний обход таблицы.
    expect(joined).toContain("purgeExpiredPhotos");
    expect(joined).toContain("purgeExpiredForms");
  });

  it("D3-4a: часовой триггер с выключенным биллингом ничего не списывает", async () => {
    const joined = (
      await runCron(HOURLY_CRON, { RECURRING_BILLING_ENABLED: "false" })
    ).join("\n");

    // Джобы выключены флагом: проход ничего не делает и честно об этом пишет.
    expect(joined).toContain("пропущен: RECURRING_BILLING_ENABLED=false");
    // До проверки ключей дело не доходит — значит, до списаний тоже.
    expect(joined).not.toContain("нет YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY");
  });

  it("D3-4b: часовой триггер с включённым биллингом запускает джобы", async () => {
    const joined = (
      await runCron(HOURLY_CRON, { RECURRING_BILLING_ENABLED: "true" })
    ).join("\n");

    // Флаг включён → джобы дошли до своей проверки. В тестовом окружении
    // ключей ЮKassa нет, поэтому списания не происходит — это видно по
    // отдельному сообщению, а не по «пропущен: выключено».
    expect(joined).toContain("нет YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY");
    expect(joined).not.toContain("RECURRING_BILLING_ENABLED=false");
    // Уборка ПДн на часовом триггере не запускается — и не 24 раза.
    expect(joined).not.toContain("purgeExpiredPhotos");
  });

  it("D3-5: обычный запрос через app.request работает как раньше", async () => {
    const res = await app.request("/healthz", {}, env as never);
    expect(res.status).toBe(200);
  });
});

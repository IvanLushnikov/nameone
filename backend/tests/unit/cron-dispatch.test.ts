/**
 * Разведение двух cron-триггеров (ТЗ-20).
 *
 * В `wrangler.toml` их два: суточный `0 3 * * *` (уборка ПДн) и часовой
 * `0 * * * *` (биллинг). Когда часовой триггер добавили, разведения не сделали
 * — и уборка фото тетрадей и ответов учеников поехала раз в час, то есть
 * 24 полных обхода таблиц в сутки вместо одного.
 *
 * Тест ловит именно эту ошибку: проверяем, какой триггер что запускает, и
 * отдельно — что НЕИЗВЕСТНЫЙ триггер запускает всё. Пропустить удаление
 * персональных данных молча нельзя, поэтому незнакомый триггер должен
 * приводить к лишней работе, а не к пропуску.
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
import worker from "../../src/index";

const HOURLY_CRON = "0 * * * *";
const DAILY_CRON = "0 3 * * *";

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "tz20-cron", queries: [schemaSql] }]);
  await SELF.fetch("https://local.test/healthz");
});

/**
 * Прогоняет cron-обработчик и возвращает строки, которые он записал в лог.
 *
 * Обработчик зовётся ТЕМ ЖЕ способом, каким его зовёт Cloudflare: экспорт
 * `scheduled` модуля с контроллером расписания. Раньше здесь был прямой вызов
 * `app.fire(...)` — он проверял разведение триггеров, но не проверял, что
 * Cloudflare вообще достучится до воркера (находка №1 ревью 30.10.2026).
 */
async function runCron(cron: string): Promise<string[]> {
  const lines: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));

  try {
    const ctx = createExecutionContext();
    const controller = createScheduledController({ cron });
    (worker.scheduled as unknown as (c: unknown, e: unknown, x: unknown) => void)(
      controller,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
  return lines;
}

describe("разведение cron-триггеров", () => {
  it("часовой триггер не гоняет уборку ПДн", async () => {
    const lines = await runCron(HOURLY_CRON);
    const joined = lines.join("\n");

    expect(joined).not.toContain("purgeExpiredPhotos");
    expect(joined).not.toContain("purgeExpiredForms");
  });

  it("суточный триггер убирает ПДн", async () => {
    const joined = (await runCron(DAILY_CRON)).join("\n");

    expect(joined).toContain("purgeExpiredPhotos");
    expect(joined).toContain("purgeExpiredForms");
  });

  it("неизвестный триггер приводит к ЛИШНЕЙ работе, а не к пропуску удаления", async () => {
    const joined = (await runCron("17 4 * * *")).join("\n");

    // Ключевое: незнакомый триггер = «сделать всё». Пропустить удаление фото
    // ребёнка молча хуже, чем лишний обход таблицы.
    expect(joined).toContain("purgeExpiredPhotos");
    expect(joined).toContain("purgeExpiredForms");
  });
});

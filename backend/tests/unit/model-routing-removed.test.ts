/**
 * ТЗ-43: таблица `model_routing` убрана — из схемы и из базы.
 *
 * ─── ЧТО БЫЛО ───────────────────────────────────────────────────────────────
 * `model_routing` была объявлена в `db/schema.sql`, в ней не было ни одной
 * строки, и кода, который туда пишет, не существовало вообще: роутинг живёт
 * в константе `PRIMARY_BY_TASK` (`backend/src/llm/router.ts`).
 *
 * Это была ложная точка наблюдаемости: человек открывает базу, видит таблицу
 * роутинга и решает, что «настройки потерялись», вместо того чтобы понять,
 * что настроек не было никогда.
 *
 * ─── ЧТО ПРОВЕРЯЕМ ──────────────────────────────────────────────────────────
 *
 * M1. Чистая база, поднятая по `schema.sql`, НЕ содержит `model_routing`.
 *     Это и есть «соответствие схемы и миграций»: накатываем схему на пустое
 *     хранилище — лишней таблицы там нет.
 *
 * M2. Миграция 0010 удаляет таблицу, которая ещё есть (боевая база, где схема
 *     уже применена).
 *
 * M3. Миграция идемпотентна: повторный прогон не падает и ничего не портит.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect } from "vitest";
import { migrateDropModelRouting } from "../../src/db/migrations/0010_drop_model_routing";

/** Есть ли в базе таблица или индекс с таким именем. */
async function objectExists(name: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name = ?1`,
  )
    .bind(name)
    .first<{ name: string }>();
  return Boolean(row?.name);
}

describe("ТЗ-43: таблица model_routing убрана", () => {
  it("M1: чистая база по schema.sql не содержит model_routing", async () => {
    await applyD1Migrations(env.DB, [{ name: "tz43-schema", queries: [schemaSql] }]);

    expect(await objectExists("model_routing")).toBe(false);
    expect(await objectExists("idx_model_routing_enabled")).toBe(false);
  });

  it("M2: миграция удаляет таблицу, которая ещё есть в базе", async () => {
    // Схема на чистой базе таблицу уже не создаёт — воспроизводим боевое
    // состояние (таблица была до миграции).
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS model_routing (
         task TEXT NOT NULL, plan TEXT NOT NULL,
         primary_model TEXT NOT NULL, primary_provider TEXT NOT NULL,
         fallback_json TEXT NOT NULL DEFAULT '[]',
         enabled INTEGER NOT NULL DEFAULT 1,
         updated_at INTEGER NOT NULL, updated_by TEXT,
         PRIMARY KEY (task, plan)
       )`,
    ).run();
    expect(await objectExists("model_routing")).toBe(true);

    const result = await migrateDropModelRouting(env.DB);

    expect(result.applied).toBe(true);
    expect(await objectExists("model_routing")).toBe(false);
  });

  it("M3: повторный прогон миграции ничего не ломает", async () => {
    const result = await migrateDropModelRouting(env.DB);

    expect(result.applied).toBe(false);
    expect(await objectExists("model_routing")).toBe(false);
  });
});

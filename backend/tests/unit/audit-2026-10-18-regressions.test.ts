/// <reference types="@cloudflare/vitest-plugin" />
/**
 * Регрессии аудита 18.10.2026 на стороне бэкенда.
 *
 * Четыре инварианта, каждый из которых уже стоил денег или нервов:
 *
 *   1. МИГРАЦИЯ 0009 идемпотентна. `ALTER TABLE ADD COLUMN` в SQLite
 *      неидемпотентен, а миграция должна быть безопасна при повторном запуске
 *      (деплой, откат, ручной перезапуск).
 *
 *   2. РАСХОД ПРИВЯЗАН К ЛИСТУ. Без `worksheet_id` нельзя было посчитать,
 *      сколько стоит ОДИН лист: в таблицах был только `user_id` и `task`.
 *
 *   3. АНТИФРОД НЕ БЛОКИРУЕТ, КАПЧА НЕ НАСТРОЕНА. Требовать подтверждение,
 *      которое взять нечем, — значит отказать человеку, который ничего не
 *      может сделать. Сигнал при этом не теряется.
 *
 *   4. УПАВШАЯ ГЕНЕРАЦИЯ ВОЗВРАЩАЕТ ПОПЫТКУ. Попытка занимается до вызова
 *      провайдера; если генерация упала, занятый слот должен освободиться
 *      сразу, а не держаться до TTL (5 минут).
 */
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

import { migrateWorksheetCostLink } from "../../src/db/migrations/0009_worksheet_cost_link";
import { logLlmCall } from "../../src/llm/index";
import { guardGeneration } from "../../src/llm/ratelimit";
import {
  checkFreeQuota,
  freeQuotaOwnerKey,
  holdFreeQuotaSlot,
} from "../../src/services/usage";
import { fingerprintHash } from "../../src/lib/antifraud";
import type { Env } from "../../src/env";

const SALT = "test-salt-audit-2026-10-18";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

/**
 * Локальный workerd не умеет `D1Database.withSession` (тот же трюк, что в
 * freeQuotaAccounting.test.ts): сессия = сам биндинг.
 */
const db: D1Database = new Proxy(env.DB as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    if (prop === "withSession") return () => target;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
}) as unknown as D1Database;

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "audit-schema", queries: [schemaSql] }]);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 1 + 2. Миграция и привязка расхода к листу
 * ──────────────────────────────────────────────────────────────────────────── */

describe("миграция 0009: worksheet_id", () => {
  it("на свежей базе колонка уже есть, и миграция ничего не ломает", async () => {
    // Схема создана с колонкой — повторный запуск миграции должен быть
    // тихим, а не «duplicate column name».
    const result = await migrateWorksheetCostLink(db);
    expect(result.applied).toBe(false);

    // И ещё раз — тоже тихо.
    const again = await migrateWorksheetCostLink(db);
    expect(again.applied).toBe(false);
  });

  it("logLlmCall пишет worksheet_id в обе таблицы расхода", async () => {
    const worksheetId = "ws_audit_20261018";
    const userId = "usr_audit_20261018";

    await db
      .prepare(
        `INSERT OR REPLACE INTO users
           (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
         VALUES (?1, ?2, 'Учитель', 'free', 0, 0, 0, 0, 0)`,
      )
      .bind(userId, `audit-${worksheetId}@example.test`)
      .run();

    await logLlmCall(db, {
      userId,
      task: "worksheet-gen",
      provider: "polza",
      model: "openai/gpt-6-luna",
      plan: "free",
      tokensIn: 2417,
      tokensOut: 1544,
      costUsd: 0.0021,
      costRub: 0.18,
      latencyMs: 17000,
      cached: false,
      fallback: false,
      worksheetId,
    } as never);

    const log = await db
      .prepare(`SELECT worksheet_id FROM llm_logs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`)
      .bind(userId)
      .first<{ worksheet_id: string | null }>();
    expect(log?.worksheet_id).toBe(worksheetId);

    const cost = await db
      .prepare(
        `SELECT worksheet_id, cost_rub FROM llm_costs_actual WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(userId)
      .first<{ worksheet_id: string | null; cost_rub: number }>();
    expect(cost?.worksheet_id).toBe(worksheetId);
    expect(cost?.cost_rub).toBeCloseTo(0.18, 5);
  });

  it("вызов без листа остаётся с NULL — привязка не выдумывается", async () => {
    const userId = "usr_audit_no_sheet";
    await db
      .prepare(
        `INSERT OR REPLACE INTO users
           (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
         VALUES (?1, ?2, 'Учитель', 'free', 0, 0, 0, 0, 0)`,
      )
      .bind(userId, "audit-no-sheet@example.test")
      .run();

    await logLlmCall(db, {
      userId,
      task: "validate",
      provider: "polza",
      model: "deepseek/deepseek-v4-flash",
      plan: "free",
      tokensIn: 699,
      tokensOut: 1032,
      costUsd: 0.0004,
      costRub: 0.03,
      latencyMs: 12200,
      cached: false,
      fallback: false,
    } as never);

    const cost = await db
      .prepare(`SELECT worksheet_id FROM llm_costs_actual WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`)
      .bind(userId)
      .first<{ worksheet_id: string | null }>();
    expect(cost?.worksheet_id).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Антифрод: капча не настроена — генерация не блокируется
 * ──────────────────────────────────────────────────────────────────────────── */

describe("антифрод без настроенной капчи", () => {
  /** Всплеск генераций с одного отпечатка — сигнал, который просит капчу. */
  async function makeBurst(fingerprint: string, count = 12): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < count; i += 1) {
      await db
        .prepare(
          `INSERT INTO events (id, user_id, name, data_json, created_at)
           VALUES (?1, NULL, 'generation', ?2, ?3)`,
        )
        .bind(
          `ev_audit_${now}_${i}_${Math.random().toString(36).slice(2, 8)}`,
          JSON.stringify({ fp: fingerprint.slice(0, 16) }),
          now,
        )
        .run();
    }
  }

  it("подозрение логируется, но генерацию не отменяет", async () => {
    const ip = "203.0.113.77";
    const fingerprint = await fingerprintHash({ ip, userAgent: UA }, SALT);
    await makeBurst(fingerprint);

    // КАПЧА НЕ НАСТРОЕНА → fail-open: сигнал есть, отказа нет.
    const guard = await guardGeneration({
      db,
      userId: null,
      plan: "standard",
      ip,
      userAgent: UA,
      cf: undefined,
      salt: SALT,
      challengePassed: false,
      turnstileConfigured: false,
    });
    expect(guard.fingerprint).toBe(fingerprint);
    expect(guard.challenged).toBe(false);
  });

  it("капча настроена — тот же сигнал приводит к 409, а не к тихой генерации", async () => {
    const ip = "203.0.113.78";
    const fingerprint = await fingerprintHash({ ip, userAgent: UA }, SALT);
    await makeBurst(fingerprint);

    await expect(
      guardGeneration({
        db,
        userId: null,
        plan: "standard",
        ip,
        userAgent: UA,
        cf: undefined,
        salt: SALT,
        challengePassed: false,
        turnstileConfigured: true,
      }),
    ).rejects.toThrow(/подтвердить/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Упавшая генерация возвращает попытку
 * ──────────────────────────────────────────────────────────────────────────── */

describe("упавшая генерация не сжигает попытку", () => {
  it("занятый слот освобождается сразу, а не висит до TTL", async () => {
    const ip = "203.0.113.88";
    const fingerprint = await fingerprintHash({ ip, userAgent: UA }, SALT);
    const owner = freeQuotaOwnerKey(null, fingerprint);

    // Занимаем попытку, как это делает guardGeneration.
    const hold = await holdFreeQuotaSlot(db, owner, [owner]);
    expect(hold.allowed).toBe(true);
    expect(hold.remaining).toBe(4);
    // Занятая попытка видна в остатке: учителю показывают 4, а не 5.
    expect((await checkFreeQuota(db, owner)).used).toBe(1);

    // Генерация упала → маршрут возвращает занятое (releaseFreeQuotaHold).
    const { releaseFreeQuotaHold } = await import("../../src/services/usage");
    await releaseFreeQuotaHold(db, owner);

    // Попытка сразу вернулась: без TTL в 5 минут.
    expect((await checkFreeQuota(db, owner)).used).toBe(0);
    const second = await holdFreeQuotaSlot(db, owner, [owner]);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(4);
  });

  it("маршрут генерации при ошибке провайдера отдаёт попытку", async () => {
    // Провайдера в тестах нет (нет ключа), поэтому вызов упадёт — и это
    // ровно тот случай, который обязан освобождать попытку.
    const ip = "203.0.113.89";
    const res = await SELF.fetch("https://uchlist.test/api/worksheets/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({
        request: {
          subject: "math",
          grade: 5,
          topic: "Обыкновенные дроби",
          difficulty: "medium",
          count: 6,
          type: "worksheet",
          withAnswers: true,
          withExplanations: true,
        },
      }),
    });

    // Ошибка провайдера — это не отказ по квоте.
    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(402);

    const fingerprint = await fingerprintHash({ ip, userAgent: UA }, SALT);
    const owner = freeQuotaOwnerKey(null, fingerprint);
    const quota = await checkFreeQuota(db, owner);
    // Ни одна попытка не сгорела: генерация не удалась — виноват провайдер.
    expect(quota.used).toBe(0);
  });
});

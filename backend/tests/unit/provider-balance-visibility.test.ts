/**
 * ТЗ-43: экран денег должен отличать «не знаем» от «ноль».
 *
 * ─── ЧТО БЫЛО ───────────────────────────────────────────────────────────────
 * `getTopups` возвращала `totalRub: number` — и ноль в этом поле означал
 * «пополнений не было». Но если за месяц снимок баланса был только ОДИН, то
 * о пополнениях не известно ничего: первый снимок не знает, что было до него.
 * Экран в этом случае показывал «0 ₽ пополнено» — это утверждение, которого
 * никто не проверял.
 *
 * ─── ЧТО ПРОВЕРЯЕМ ──────────────────────────────────────────────────────────
 *
 * B1. Снимок один — `totalRub` = null («нет данных»), а не 0. Ноль здесь был
 *     бы выдуманной цифрой.
 *
 * B2. Снимков два, кошелёк не вырос — `totalRub` = 0. Вот тут ноль означает
 *     ровно то, что означает: пополнения не было.
 *
 * B3. Снимков два, кошелёк вырос — `totalRub` = сумма роста.
 *
 * B4. `getOverview` отдаёт время последнего снимка (`at`): без него экран не
 *     может отличить сегодняшний снимок от вчерашнего и написать «сегодня ещё
 *     не снимали».
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getOverview, getTopups, currentMonth } from "../../src/services/admin-stats";

const NOW = Math.floor(Date.now() / 1000);

async function addSnapshot(id: string, amountRub: number, createdAt: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO polza_balance_snapshots
       (id, amount_rub, available_rub, reserved_rub, spent_rub, provider_updated_at, created_at)
     VALUES (?1, ?2, ?3, NULL, NULL, NULL, ?4)`,
  )
    .bind(id, amountRub, amountRub, createdAt)
    .run();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "tz43-balance-visibility", queries: [schemaSql] }]);
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM polza_balance_snapshots`).run();
});

describe("ТЗ-43: пополнения и свежесть снимка в данных админки", () => {
  it("B1: один снимок — пополнения не посчитаны, а не «ноль»", async () => {
    await addSnapshot("pbs_1", 1000, NOW - 3600);

    const topups = await getTopups(env.DB, NOW - 30 * 24 * 3600, NOW + 3600);

    expect(topups.snapshots).toBe(1);
    expect(topups.totalRub).toBeNull();
  });

  it("B2: два снимка без роста — ноль означает «пополнений не было»", async () => {
    await addSnapshot("pbs_1", 1000, NOW - 7200);
    await addSnapshot("pbs_2", 1000, NOW - 3600);

    const topups = await getTopups(env.DB, NOW - 30 * 24 * 3600, NOW + 3600);

    expect(topups.snapshots).toBe(2);
    expect(topups.totalRub).toBe(0);
  });

  it("B3: два снимка с ростом — сумма роста", async () => {
    await addSnapshot("pbs_1", 1000, NOW - 7200);
    await addSnapshot("pbs_2", 1500, NOW - 3600);

    const topups = await getTopups(env.DB, NOW - 30 * 24 * 3600, NOW + 3600);

    expect(topups.totalRub).toBe(500);
    expect(topups.byDay).toHaveLength(1);
  });

  it("B4: обзор отдаёт время снимка — экран может сказать «сегодня ещё не снимали»", async () => {
    await addSnapshot("pbs_1", 1250.5, NOW - 3600);

    const overview = await getOverview(env.DB, currentMonth());

    expect(overview.providerBalance).not.toBeNull();
    expect(overview.providerBalance!.amountRub).toBe(1250.5);
    expect(overview.providerBalance!.at).toBe(NOW - 3600);
  });
});

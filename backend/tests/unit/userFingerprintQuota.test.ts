/**
 * Лимит бесплатных генераций: человек, а не браузер (09.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Счёт вёлcя по отпечатку (IP + User-Agent). Это закрыло обход «выйти/зайти»,
 * но открыло «поменять браузер»: другой User-Agent — другой отпечаток — новые
 * три попытки. Обход не требовал ничего, кроме смены браузера.
 *
 * Это не теория: живой прогон генерации (scripts/live-gen-check.ts) случайно
 * подтвердил дыру — контрольная прошла с другого User-Agent после того, как
 * лимит на первом был исчерпан.
 *
 * Иван, 09.10.2026: «надо закрывать, запоминать юзеров в базе».
 *
 * Теперь отпечатки привязываются к пользователю (`user_fingerprints`), а счёт
 * считается СУММОЙ по всем его устройствам. Тесты ниже проверяют именно это.
 */
import { env, applyD1Migrations } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  FREE_TOTAL_GENERATIONS,
  quotaOwnerKeys,
  holdFreeQuotaSlot,
  linkUserFingerprint,
} from "../../src/services/usage";
import { fingerprintHash } from "../../src/lib/antifraud";
import type { Env } from "../../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const SALT = "test-salt-user-fp";
// Тот же Proxy, что и в freeQuotaAccounting.test.ts: воркерский `env.DB`
// не имеет метода `withSession`, а `freeQuotaState` его зовёт, чтобы читать
// счётчик с первичной реплики (иначе после успешной записи чтение с
// реплики могло не увидеть только что занятое — BL-06).
const db: D1Database = new Proxy(env.DB as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    if (prop === "withSession") return () => target;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
}) as unknown as D1Database;

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "uf-user-fingerprints", queries: [schemaSql] }]);
});

/** Создать пользователя — привязке нужна реальная строка в users. */
async function makeUser(email: string): Promise<string> {
  const id = `usr_fp_${Math.random().toString(36).slice(2, 10)}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (id, email, created_at, updated_at, plan)
       VALUES (?1, ?2, ?3, ?3, 'free')`,
    )
    .bind(id, email, now)
    .run();
  return id;
}

async function fpOf(ip: string, ua: string): Promise<string> {
  return fingerprintHash({ ip, userAgent: ua }, SALT);
}

describe("смена браузера не выдаёт новые попытки (09.10.2026)", () => {
  it("три попытки в одном браузере, потом другой браузер — лимит исчерпан", async () => {
    const userId = await makeUser(`bp1-${Date.now()}@example.com`);
    const laptop = await fpOf("10.0.0.1", "Mozilla/5.0 (Macintosh) Chrome/120");
    const phone = await fpOf("10.0.0.1", "Mozilla/5.0 (iPhone) Safari/17");

    // Три попытки с ноутбука — лимит честно расходуется.
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      await linkUserFingerprint(db, userId, laptop);
      const keys = await quotaOwnerKeys(db, userId, laptop);
      const hold = await holdFreeQuotaSlot(db, `fp:${laptop}`, keys);
      expect(hold.allowed).toBe(true);
    }

    // Переключились на телефон. Раньше здесь были бы три свежие попытки.
    await linkUserFingerprint(db, userId, phone);
    const phoneKeys = await quotaOwnerKeys(db, userId, phone);
    const hold = await holdFreeQuotaSlot(db, `fp:${phone}`, phoneKeys);
    expect(hold.allowed).toBe(false);
  });

  it("обход через возврат в анонимный режим тоже закрыт", async () => {
    const userId = await makeUser(`bp2-${Date.now()}@example.com`);
    const browser = await fpOf("10.0.0.2", "Chrome/120");

    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      await linkUserFingerprint(db, userId, browser);
      const keys = await quotaOwnerKeys(db, userId, browser);
      expect((await holdFreeQuotaSlot(db, `fp:${browser}`, keys)).allowed).toBe(true);
    }

    // Вышел из аккаунта — запрос без userId. Отпечаток тот же, счёт тот же:
    // выход не обнуляет лимит.
    const anonKeys = await quotaOwnerKeys(db, null, browser);
    expect((await holdFreeQuotaSlot(db, `fp:${browser}`, anonKeys)).allowed).toBe(false);
  });

  it("аноним без аккаунта по-прежнему ограничен тремя попытками", async () => {
    // Регрессия на противоположную сторону: привязка не должна была сломать
    // лимит для тех, кто ещё не вошёл.
    const anon = await fpOf(`10.0.0.${3 + Math.floor(Math.random() * 200)}`, `anon-${Date.now()}`);
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      const keys = await quotaOwnerKeys(db, null, anon);
      expect((await holdFreeQuotaSlot(db, `fp:${anon}`, keys)).allowed).toBe(true);
    }
    const keys = await quotaOwnerKeys(db, null, anon);
    expect((await holdFreeQuotaSlot(db, `fp:${anon}`, keys)).allowed).toBe(false);
  });

  it("у человека с двумя устройствами счёт суммируется", async () => {
    const userId = await makeUser(`bp3-${Date.now()}@example.com`);
    const a = await fpOf("10.0.0.4", "Chrome-A");
    const b = await fpOf("10.0.0.4", "Chrome-B");

    await linkUserFingerprint(db, userId, a);
    await linkUserFingerprint(db, userId, b);

    // Два попадания с устройства A.
    for (let i = 0; i < 2; i++) {
      const keys = await quotaOwnerKeys(db, userId, a);
      expect((await holdFreeQuotaSlot(db, `fp:${a}`, keys)).allowed).toBe(true);
    }
    // Одно с устройства B — это ТРЕТЬЯ попытка, а не первая.
    const keysB = await quotaOwnerKeys(db, userId, b);
    expect((await holdFreeQuotaSlot(db, `fp:${b}`, keysB)).allowed).toBe(true);

    // Четвёртая — уже нет, и она пришла с устройства A, где раньше потратили
    // только две.
    const keysA = await quotaOwnerKeys(db, userId, a);
    expect((await holdFreeQuotaSlot(db, `fp:${a}`, keysA)).allowed).toBe(false);
  });
});
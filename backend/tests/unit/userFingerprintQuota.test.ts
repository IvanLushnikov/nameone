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
  consumeFreeQuota,
  linkUserFingerprint,
} from "../../src/services/usage";
import { fingerprintHash } from "../../src/lib/antifraud";

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

    // Занимаем всю квоту месяца с устройства A.
    for (let i = 0; i < FREE_TOTAL_GENERATIONS; i++) {
      const keys = await quotaOwnerKeys(db, userId, a);
      expect((await holdFreeQuotaSlot(db, `fp:${a}`, keys)).allowed).toBe(true);
    }
    // С устройства B — уже нет, хотя там не потрачено ничего: счёт общий на
    // человека, а не на браузер (ТЗ-29 квота помесячная, принцип тот же).
    const keysB = await quotaOwnerKeys(db, userId, b);
    expect((await holdFreeQuotaSlot(db, `fp:${b}`, keysB)).allowed).toBe(false);

    // И с устройства A, где потрачено было всё, — тоже нет.
    const keysA = await quotaOwnerKeys(db, userId, a);
    expect((await holdFreeQuotaSlot(db, `fp:${a}`, keysA)).allowed).toBe(false);
  });
});
/**
 * Переход «занято → использовано» должен быть ОДНОЙ транзакцией (UL-D07).
 *
 * ─── ЧТО ЛОВИТ ЭТОТ БЛОК ──────────────────────────────────────────────────
 *
 * D07-1. АТОМАРНОСТЬ ПЕРЕХОДА. Списание занимало слот ДВУМЯ операциями подряд:
 *       сначала снималось занятие, потом записывалось использование. Между
 *       этими шагами другой запрос видел «4 использовано + 0 занято» и успевал
 *       занять шестой слот. Теперь прибавление и снятие занятия — одна
 *       транзакция D1, и наблюдатель снаружи не видит промежуточного состояния.
 *       Проверяется триггером: в момент записи использования занятие ещё
 *       должно существовать.
 *
 * D07-2. ОТКАТ ПРИ СБОЕ. Если внутри пачки что-то падает, не должно остаться
 *       ни частичного прибавления, ни потерянного занятия. Повтор после сбоя
 *       не должен создать лишнюю генерацию.
 *
 * D07-3. КОНКУРИРУЮЩИЙ РЕЗЕРВ. Резерв, попавший в прежний промежуток, не
 *       должен получать шестой слот: committed + holds ≤ лимита.
 *
 * ─── ПОЧЕМУ ТРИГГЕРЫ, А НЕ SLEEP И НЕ МОК ──────────────────────────────────
 * Триггер — это управляемая точка вмешательства ВНУТРИ настоящей транзакции
 * D1: он срабатывает ровно в том месте, где старая реализация оставляла окно.
 * Никаких задержек, никаких подменённых баз — только реальный workerd D1.
 */
describe("переход «занято → использовано» атомарен (UL-D07)", () => {
  const OWNER = "fp:ul-d07-owner";
  const NOW_MS = Date.UTC(2026, 9, 30, 12, 0, 0); // 30.10.2026, полдень UTC
  const NOW_SEC = Math.floor(NOW_MS / 1000);
  const MONTH = "2026-10";
  const HOLD_PREFIX = `freehold:${OWNER}:`;
  const HOLD_RANGE_END = `${HOLD_PREFIX}\uffff`;

  /** Кладёт состояние «4 использовано + 1 занято» при лимите 5. */
  async function seedFourPlusHold(): Promise<void> {
    // Чистим за собой: база общая для всех тестов файла.
    await db.prepare(`DELETE FROM free_usage WHERE owner_key = ?1`).bind(OWNER).run();
    await db.prepare(`DELETE FROM rate_limits WHERE key >= ?1 AND key < ?2`).bind(HOLD_PREFIX, HOLD_RANGE_END).run();
    await db
      .prepare(
        `INSERT INTO free_usage (owner_key, month, generations, user_id, updated_at)
         VALUES (?1, ?2, 4, NULL, ?3)`,
      )
      .bind(OWNER, MONTH, NOW_SEC)
      .run();
    await db
      .prepare(
        `INSERT INTO rate_limits (id, key, count, window_start)
         VALUES ('rl_ul_d07_hold', ?1, 1, ?2)`,
      )
      .bind(`${HOLD_PREFIX}seed`, NOW_SEC)
      .run();
  }

  async function generations(): Promise<number> {
    const row = await db
      .prepare(`SELECT generations FROM free_usage WHERE owner_key = ?1 AND month = ?2`)
      .bind(OWNER, MONTH)
      .first<{ generations: number }>();
    return row?.generations ?? 0;
  }

  async function holdCount(): Promise<number> {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM rate_limits WHERE key >= ?1 AND key < ?2 AND window_start > ?3`)
      .bind(HOLD_PREFIX, HOLD_RANGE_END, NOW_SEC - 300)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async function dropProbeObjects(): Promise<void> {
    await db.prepare(`DROP TRIGGER IF EXISTS ul_d07_watch_bump`).run();
    await db.prepare(`DROP TRIGGER IF EXISTS ul_d07_fail_bump`).run();
    await db.prepare(`DROP TRIGGER IF EXISTS ul_d07_probe_reserve`).run();
    await db.prepare(`DROP TABLE IF EXISTS ul_d07_probe`).run();
  }

  it("D07-1: в момент записи использования занятие ещё существует — переход цельный", async () => {
    await seedFourPlusHold();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS ul_d07_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, holds_at_bump INTEGER)`,
      )
      .run();
    await db
      .prepare(
        `CREATE TRIGGER ul_d07_watch_bump AFTER UPDATE ON free_usage
         BEGIN
           INSERT INTO ul_d07_probe (holds_at_bump) VALUES (
             (SELECT COUNT(*) FROM rate_limits WHERE key >= '${HOLD_PREFIX}' AND key < '${HOLD_RANGE_END}')
           );
         END`,
      )
      .run();

    await consumeFreeQuota(db, OWNER, { nowMs: NOW_MS, userId: null });

    // Слот переехал из «занято» в «использовано» ровно один раз.
    expect(await generations()).toBe(5);
    expect(await holdCount()).toBe(0);

    // Занятие на момент прибавления ещё было: значит, «снять занятие» и
    // «записать использование» — одна транзакция, а не две операции подряд.
    const probe = await db
      .prepare(`SELECT holds_at_bump FROM ul_d07_probe ORDER BY id DESC LIMIT 1`)
      .first<{ holds_at_bump: number }>();
    expect(probe?.holds_at_bump).toBe(1);

    await dropProbeObjects();
  });

  it("D07-2: сбой внутри пачки откатывает всё — занятие не теряется, повтор не двоит", async () => {
    await seedFourPlusHold();

    // Сбой прямо на записи использования.
    await db
      .prepare(
        `CREATE TRIGGER ul_d07_fail_bump BEFORE UPDATE ON free_usage
         BEGIN SELECT RAISE(ABORT, 'ul-d07 fault'); END`,
      )
      .run();

    await expect(consumeFreeQuota(db, OWNER, { nowMs: NOW_MS, userId: null })).rejects.toThrow();
    await db.prepare(`DROP TRIGGER IF EXISTS ul_d07_fail_bump`).run();

    // Ни частичного прибавления, ни потерянного занятия.
    expect(await generations()).toBe(4);
    expect(await holdCount()).toBe(1);

    // Повтор после сбоя списывает ровно одну генерацию.
    await consumeFreeQuota(db, OWNER, { nowMs: NOW_MS, userId: null });
    expect(await generations()).toBe(5);
    expect(await holdCount()).toBe(0);
  });

  it("D07-3: конкурирующий резерв не получает шестой слот", async () => {
    await seedFourPlusHold();

    // Резерв, который в старой реализации успевал попасть в окно между
    // «сняли занятие» и «записали использование». Сейчас он срабатывает
    // внутри той же транзакции и видит её состояние.
    await db
      .prepare(
        `CREATE TRIGGER ul_d07_probe_reserve AFTER DELETE ON rate_limits
         BEGIN
           INSERT INTO rate_limits (id, key, count, window_start)
           SELECT 'rl_ul_d07_race', '${HOLD_PREFIX}race', 1, ${NOW_SEC}
           WHERE (SELECT COALESCE(SUM(generations), 0) FROM free_usage
                   WHERE month = '${MONTH}' AND owner_key IN ('${OWNER}'))
               + (SELECT COUNT(*) FROM rate_limits
                   WHERE (key >= '${HOLD_PREFIX}' AND key < '${HOLD_RANGE_END}') AND window_start > ${NOW_SEC - 300}) < 5;
         END`,
      )
      .run();

    await consumeFreeQuota(db, OWNER, { nowMs: NOW_MS, userId: null });
    await db.prepare(`DROP TRIGGER IF EXISTS ul_d07_probe_reserve`).run();

    // Резерв отклонён: свободного слота не появилось.
    const race = await db
      .prepare(`SELECT COUNT(*) AS n FROM rate_limits WHERE id = 'rl_ul_d07_race'`)
      .first<{ n: number }>();
    expect(race?.n).toBe(0);

    expect(await generations()).toBe(5);
    expect(await holdCount()).toBe(0);
    // Использовано + занято ≤ лимита.
    expect((await generations()) + (await holdCount())).toBeLessThanOrEqual(FREE_TOTAL_GENERATIONS);
  });
});

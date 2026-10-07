/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * BL-07 (учёт) + BL-06 (жёсткий предел квоты): анонимный расход виден И три
 * попытки остаются тремя.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * 1) УЧЁТ. Анонимный вызов LLM стоит денег, но у анонима нет ни userId, ни
 *    нормы, поэтому в usage_counters он не попадает и раньше был виден только
 *    в llm_logs. Теперь он попадает в агрегат по ключу счёта (отпечатку):
 *    сколько бесплатного трафика отдаём и сколько разных посетителей его
 *    получили. Откат этого свойства — тихая дыра в расходах.
 *
 * 2) ЖЁСТКИЙ ПРЕДЕЛ. Решение владельца (07.10.2026): анонимным ровно 3
 *    бесплатные попытки. Проверка лимита и списание были двумя разными
 *    обращениями, и два параллельных запроса с одного отпечатка оба проходили
 *    проверку — счётчик уезжал на 4+. Тест ниже гоняет параллельные попытки и
 *    требует, чтобы четвёртая генерация была невозможна.
 *
 * 3) КАПЧА НЕ ОБХОДИТ ЛИМИТ. Раньше условие было `!allowed && !challengePassed`:
 *    ответив на капчу, посетитель получал генерации сверх трёх. Это прямое
 *    противоречие решению владельца, а не «особый случай для людей».
 *
 * 4) УПАВШАЯ ГЕНЕРАЦИЯ НЕ СЖИГАЕТ ПОПЫТКУ. Попытка занимается до вызова
 *    провайдера (иначе гонку не закрыть), поэтому освободить её должен любой
 *    неуспех — иначе учитель теряет генерацию из-за 5xx у провайдера.
 *
 * 5) ПЛАТЯЩИЕ НЕ СЛОМАНЫ. У них есть userId и норма: usage_counters растёт как
 *    раньше, анонимных событий в их вызовы не добавляется.
 *
 * Схема — настоящая src/db/schema.sql, а не выдержка: тест про «жёсткий предел
 * в D1» обязан проверять те же индексы и ограничения, что и прод.
 */
import { env, applyD1Migrations } from "cloudflare:test";
import schemaSql from "../../src/db/schema.sql?raw";
import { describe, it, expect, beforeAll } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  ANON_ACCESS_EVENT,
  ANON_USAGE_EVENT,
  FREE_TOTAL_GENERATIONS,
  checkFreeQuota,
  consumeFreeQuota,
  freeQuotaOwnerKey,
  holdFreeQuotaSlot,
  recordAnonymousAccess,
  recordUsage,
  releaseFreeQuotaHold,
  summarizeAnonymousUsage,
} from "../../src/services/usage";
import { consumeGenerationQuota, guardGeneration } from "../../src/llm/ratelimit";
import { fingerprintHash } from "../../src/lib/antifraud";
import type { Env } from "../../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const SALT = "test-salt-free-quota";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

/**
 * Локальный workerd в этом репозитории не умеет `D1Database.withSession` —
 * vitest об этом предупреждает («latest compatibility date … falling back»),
 * и на нём падает даже `checkFreeQuota`, написанная до этого изменения.
 * Поэтому в тесте подставляем «сессия = сам биндинг»: на проде D1-сессии
 * есть, код их по-прежнему использует (это починка BL-06), и тест её не
 * отменяет — он просто не может её проверить.
 */
const db: D1Database = new Proxy(env.DB as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    if (prop === "withSession") return () => target;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
}) as unknown as D1Database;

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "bl07-free-quota", queries: [schemaSql] }]);
});

/** Отпечаток конкретного анонимного посетителя. */
function guardInput(ip: string) {
  return {
    db,
    userId: null,
    plan: "free" as const,
    ip,
    userAgent: UA,
    salt: SALT,
  };
}

/** Проверить генерацию анонима: занять попытку и сразу её зачесть. */
async function generateAnon(ip: string): Promise<void> {
  const guard = await guardGeneration(guardInput(ip));
  await consumeGenerationQuota(db, {
    userId: null,
    plan: "free",
    fingerprint: guard.fingerprint,
  });
}

/** Текущее число зачтённых попыток по счётчику квоты. */
async function committedQuota(ownerKey: string): Promise<number> {
  const quota = await checkFreeQuota(db, ownerKey);
  return quota.used;
}

describe("бесплатная квота: ровно три попытки", () => {
  it("три анонимные генерации проходят, четвёртая — отказ 429", async () => {
    const ip = "198.51.100.10";
    await generateAnon(ip);
    await generateAnon(ip);
    await generateAnon(ip);

    // Четвёртая попытка с ТОГО ЖЕ отпечатка обязана быть отклонена.
    await expect(generateAnon(ip)).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMIT",
    });
  });

  it("в отказе видно те же числа, что и раньше: limit 3, used 3", async () => {
    const owner = freeQuotaOwnerKey(null, "unknown-owner-for-shape");
    await consumeFreeQuota(db, owner);
    await consumeFreeQuota(db, owner);
    await consumeFreeQuota(db, owner);

    const quota = await checkFreeQuota(db, owner);
    expect(quota).toMatchObject({ allowed: false, used: 3, limit: 3, remaining: 0 });
  });

  it("капча не открывает генерации сверх трёх", async () => {
    const ip = "198.51.100.30";
    await generateAnon(ip);
    await generateAnon(ip);
    await generateAnon(ip);

    // Тот же отпечаток, ответ на капчу: лимит это не подозрение.
    await expect(
      guardGeneration({ ...guardInput(ip), challengePassed: true }),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMIT" });
  });

  it("лимит не сдвигается сменой аккаунта: счёт по отпечатку", async () => {
    // Один и тот же посетитель, другой id userId: у анонима его нет, но если
    // бы появился — ключ счёта стал бы другим. Фиксируем, что ключ счёта
    // анонима определяется отпечатком, а не чем-то подконтрольным клиенту.
    expect(freeQuotaOwnerKey(null, "abc")).toBe("fp:abc");
    expect(freeQuotaOwnerKey("usr_1", "fp:abc")).toBe("usr_1");
  });
});

describe("гонка: параллельные запросы с одного отпечатка", () => {
  it("шесть одновременных попыток дают ровно три генерации, а не шесть", async () => {
    const ip = "203.0.113.77";
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => generateAnon(ip)),
    );

    const granted = results.filter((r) => r.status === "fulfilled").length;
    expect(granted).toBe(FREE_TOTAL_GENERATIONS);

    // Счётчик зачтённых попыток — ровно 3. Четвёртой генерации не было.
    const owner = freeQuotaOwnerKey(null, await fingerprintHash({ ip, userAgent: UA }, SALT));
    expect(await committedQuota(owner)).toBe(FREE_TOTAL_GENERATIONS);
  });

  it("занятые попытки тоже входят в предел: 2 использованы + 6 параллельных = 1", async () => {
    const ip = "203.0.113.78";
    await generateAnon(ip);
    await generateAnon(ip);

    const owner = freeQuotaOwnerKey(null, await fingerprintHash({ ip, userAgent: UA }, SALT));
    const holds = await Promise.all(
      Array.from({ length: 6 }, () => holdFreeQuotaSlot(db, owner)),
    );
    // Из шести параллельных попыток заняться может ровно одна: третья уже
    // использована, а четвёртая была бы лишней.
    expect(holds.filter((h) => h.allowed)).toHaveLength(1);

    await consumeFreeQuota(db, owner);
    expect(await committedQuota(owner)).toBe(FREE_TOTAL_GENERATIONS);
  });

  it("занятая попытка не съедает лимит: вернули её — снова можно", async () => {
    const owner = freeQuotaOwnerKey(null, "released-owner");
    const first = await holdFreeQuotaSlot(db, owner);
    expect(first.allowed).toBe(true);

    // Генерация упала (провайдер 5xx) — маршрут возвращает занятое.
    await releaseFreeQuotaHold(db, owner);

    const second = await holdFreeQuotaSlot(db, owner);
    expect(second.allowed).toBe(true);
    // И зачесть её можно: предел не пострадал.
    await consumeFreeQuota(db, owner);
    expect((await checkFreeQuota(db, owner)).used).toBe(1);
  });

  it("повторное списание не выводит счётчик за 3", async () => {
    const owner = freeQuotaOwnerKey(null, "double-spend-owner");
    for (let i = 0; i < 5; i += 1) {
      await consumeFreeQuota(db, owner);
    }
    expect((await checkFreeQuota(db, owner)).used).toBe(FREE_TOTAL_GENERATIONS);
  });
});

describe("учёт анонимного расхода (BL-07)", () => {
  it("анонимный вызов попадает в агрегат, хотя в норму его записать нельзя", async () => {
    const before = await summarizeAnonymousUsage(db, { fromSec: 0, toSec: nowSec() + 60 });

    const status = await recordUsage(db, env as unknown as Env, {
      userId: null,
      plan: "free",
      weightedTokens: 12_345,
    });
    // Возврата нормы у анонима нет и быть не может — норма у него отсутствует.
    expect(status).toBeNull();

    const after = await summarizeAnonymousUsage(db, { fromSec: 0, toSec: nowSec() + 60 });
    expect(after.weightedTokens).toBe(before.weightedTokens + 12_345);
    expect(after.costRub).toBeGreaterThan(0);

    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE name = ?1`)
      .bind(ANON_USAGE_EVENT)
      .first<{ n: number }>();
    expect(Number(row?.n ?? 0)).toBeGreaterThan(0);
  });

  it("бесплатная генерация анонима видна по отпечатку: сколько отпечатков", async () => {
    const window = { fromSec: 0, toSec: nowSec() + 60 };
    const before = await summarizeAnonymousUsage(db, window);

    await generateAnon("192.0.2.201");
    await generateAnon("192.0.2.202");

    const after = await summarizeAnonymousUsage(db, window);
    // Два РАЗНЫХ посетителя → два разных ключа счёта.
    expect(after.owners).toBe(before.owners + 2);
    expect(after.accesses).toBe(before.accesses + 2);

    const row = await db
      .prepare(`SELECT data_json FROM events WHERE name = ?1 ORDER BY created_at DESC LIMIT 1`)
      .bind(ANON_ACCESS_EVENT)
      .first<{ data_json: string }>();
    const data = JSON.parse(row?.data_json ?? "{}") as { owner?: string; fp?: string };
    expect(data.owner?.startsWith("fp:")).toBe(true);
    // В аналитике — префикс хэша, а не сам отпечаток.
    expect((data.fp ?? "").length).toBeGreaterThan(0);
    expect(data.fp).not.toBe(data.owner?.replace("fp:", ""));
  });

  it("анонимный /verify и /embeddings тоже учитываются по отпечатку", async () => {
    const window = { fromSec: 0, toSec: nowSec() + 60 };
    const before = await summarizeAnonymousUsage(db, window);

    await recordAnonymousAccess(db, {
      ownerKey: "fp:anonymous-endpoint",
      plan: "free",
      task: "self-verify",
    });

    const after = await summarizeAnonymousUsage(db, window);
    expect(after.accesses).toBe(before.accesses + 1);
    expect(after.owners).toBe(before.owners + 1);
  });
});

describe("платящие не сломаны", () => {
  it("норма платного тарифа растёт как раньше, анонимных событий нет", async () => {
    const userId = await seedPaidUser();

    const anonBefore = await summarizeAnonymousUsage(db, { fromSec: 0, toSec: nowSec() + 60 });
    const status = await recordUsage(db, env as unknown as Env, {
      userId,
      plan: "plus",
      weightedTokens: 5_000,
    });
    expect(status).not.toBeNull();
    expect(status?.over).toBe(false);

    const counters = await db
      .prepare(
        `SELECT metric, count FROM usage_counters WHERE user_id = ?1 ORDER BY metric`,
      )
      .bind(userId)
      .all<{ metric: string; count: number }>();
    const byMetric = new Map(counters.results.map((r) => [r.metric, r.count]));
    expect(byMetric.get("weighted_tokens")).toBe(5_000);
    expect(byMetric.get("generations")).toBe(1);

    // Взвешенные токены платного идут в норму, а НЕ в анонимный агрегат.
    const anonAfter = await summarizeAnonymousUsage(db, { fromSec: 0, toSec: nowSec() + 60 });
    expect(anonAfter.weightedTokens).toBe(anonBefore.weightedTokens);
  });

  it("платящий тариф не занимает бесплатную квоту", async () => {
    const userId = await seedPaidUser();
    const guard = await guardGeneration({
      db,
      userId,
      plan: "plus",
      ip: "198.51.100.90",
      userAgent: UA,
      salt: SALT,
    });
    expect(guard.freeRemaining).toBeNull();

    await consumeGenerationQuota(db, {
      userId,
      plan: "plus",
      fingerprint: guard.fingerprint,
    });

    // Счётчик бесплатной квоты платящего не тронут.
    expect((await checkFreeQuota(db, userId)).used).toBe(0);
  });
});

/**
 * Пользователь с активной подпиской «Плюс».
 *
 * Строка создаётся ВНУТРИ каждого теста: у vitest-pool-workers хранилище
 * изолировано по тестам, и пользователь, заведённый в соседнем `it`, в этот
 * не попадает (об этом же напоминала ошибка FOREIGN KEY).
 */
async function seedPaidUser(): Promise<string> {
  const userId = "usr_bl07_paid";
  await db
    .prepare(
      `INSERT OR REPLACE INTO users
         (id, email, name, plan, generations_total, generations_today, is_admin, created_at, updated_at)
       VALUES (?1, 'paid@test.local', 'Платящий', 'plus', 0, 0, 0, 0, 0)`,
    )
    .bind(userId)
    .run();
  const startsAt = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR REPLACE INTO subscriptions
         (id, user_id, plan, status, period, starts_at, ends_at, auto_renew, created_at, updated_at)
       VALUES ('sub_bl07', ?1, 'plus', 'active', 'monthly', ?2, ?3, 0, ?2, ?2)`,
    )
    .bind(userId, startsAt, startsAt + 30 * 86400)
    .run();
  return userId;
}

/** Текущая секунда — для интервалов отчёта. */
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
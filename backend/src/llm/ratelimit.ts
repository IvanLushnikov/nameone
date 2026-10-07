/**
 * Ограничения генерации: бесплатная квота (жёстко) + сигналы фрода (капча).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Что изменилось 2026-10-02
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше здесь было окно в сутки с лимитами {anonymous: 3, free: 10, base: ∞,
 * plus: ∞} и сообщением «сброс в полночь UTC». У этого решения две проблемы:
 *
 *   1) Три разных числа в трёх местах: фронт показывал «3 в сутки» из
 *      localStorage, бэк ставил 10, и всё это обнулялось в полночь.
 *      Смена системного времени в браузере обнуляла счётчик на клиенте.
 *   2) «В сутки» — неправильная единица для учителя: домашка задаётся на КАЖДЫЙ
 *      урок, то есть 20-24 генерации в неделю только на листах. Норма в сутках
 *      либо не защищает, либо мешает.
 *
 * Теперь:
 *   * Бесплатный тариф — 3 генерации ВСЕГО, без сброса, счёт на сервере.
 *     Привязан к аккаунту, а у анонима — к отпечатку устройства. Обнулить
 *     квоту сменой браузера или часов нельзя. Попытка занимается до вызова
 *     провайдера и зачитывается после успеха — иначе два параллельных
 *     запроса с одного отпечатка проходили бы проверку одновременно и лимит
 *     превышался (подробности — в services/usage.ts → holdFreeQuotaSlot).
 *   * Платные тарифы — МЯГКИЙ порог по взвешенным токенам (services/usage.ts).
 *     Пересечение нормы не блокирует: генерация продолжается, UI показывает
 *     «докупить», пишется событие и уходит алерт админу.
 *   * Фрод — капча Turnstile, а не блокировка (lib/antifraud.ts).
 */

import type { D1Database } from "@cloudflare/workers-types";
import { RateLimitError, ChallengeRequiredError } from "../lib/errors";
import { sha256Hex } from "../lib/hash";
import {
  checkFreeQuota,
  consumeFreeQuota,
  freeQuotaOwnerKey,
  holdFreeQuotaSlot,
  recordAnonymousAccess,
  releaseFreeQuotaHold,
  type UsagePlan,
} from "../services/usage";
import {
  decideFraud,
  fingerprintHash,
  generationsInLastHour,
  logFraudDecision,
  markChallengeIssued,
  markChallengePassed,
  recordGeneration as recordFraudGeneration,
  recordVisit,
  type CfObject,
  type FraudSignals,
} from "../lib/antifraud";

export type RateLimitKind = "anonymous" | "free" | "base" | "standard" | "plus";

/**
 * Старые суточные лимиты удалены намеренно.
 *
 * Лимит, который не виден учителю и не выводится из его нагрузки, — это не
 * лимит, а сюрприз. Нормы тарифов живут в services/usage.ts (PLAN_NORM_PER_MONTH),
 * бесплатная квота — в services/usage.ts (FREE_TOTAL_GENERATIONS).
 */

/** Стабильный «анонимный» отпечаток для локальной разработки без CF-заголовков. */
const DEV_FINGERPRINT = "dev-anonymous";

/**
 * Достать IP из CF request и захешировать.
 * Если нет (тесты) — отдаём стабильный anonymous fallback.
 */
export async function ipHashFromHeaders(
  headers: Headers,
  fallback = "0.0.0.0",
): Promise<string> {
  const cfIp = headers.get("CF-Connecting-IP") || headers.get("X-Forwarded-For");
  const ip = (cfIp || fallback).split(",")[0]?.trim() || fallback;
  return sha256Hex(`rl-ip:${ip}`);
}

export interface GenerationGuardInput {
  db: D1Database;
  userId: string | null;
  plan: UsagePlan;
  ip: string;
  userAgent: string;
  cf?: CfObject;
  /** Соль для отпечатка (env FINGERPRINT_SALT). */
  salt: string;
  /** Кто уже прошёл капчу в этом запросе (токен Turnstile). */
  challengePassed?: boolean;
}

export interface GenerationGuardResult {
  fingerprint: string;
  signals: FraudSignals;
  /** Капча потребовалась и была пройдена в этом вызове. */
  challenged: boolean;
  /** Сколько генераций осталось на бесплатном тарифе (null = не применимо). */
  freeRemaining: number | null;
}

/**
 * Единая точка проверки перед генерацией.
 *
 * Порядок важен: сначала бесплатная квота (жёсткое ограничение, которое
 * пользователь видит и понимает), потом антифрод (мягкое, невидимое).
 * Обратный порядок приводил бы к тому, что честный бесплатный пользователь,
 * исчерпавший квоту, сначала увидел бы капчу вместо внятного объяснения.
 */
export async function guardGeneration(
  input: GenerationGuardInput,
): Promise<GenerationGuardResult> {
  const { db, userId, plan, ip, userAgent, cf, salt } = input;

  // Отпечаток один и тот же и до, и после капчи: капча подтверждает человека
  // за ЭТИМ отпечатком, а не создаёт новый.
  const fingerprint = await fingerprintHash({ ip, userAgent, cf }, salt);
  const signals = await recordVisit(db, fingerprint, userId, cf);

  // ── Бесплатный тариф: 3 генерации всего ──
  //
  // Попытка ЗАНИМАЕТСЯ здесь, до вызова провайдера, и зачитывается после
  // успеха (consumeGenerationQuota). Проверка чтением + последующая запись
  // давали зазор на всю длительность генерации: два параллельных запроса с
  // одного отпечатка оба проходили проверку и счётчик уезжал на 4+. Занятие
  // атомарно и ограничено сверху — подробности в services/usage.ts
  // (holdFreeQuotaSlot).
  let freeRemaining: number | null = null;
  if (plan === "free") {
    const owner = freeQuotaOwnerKey(userId, fingerprint);
    const quota = await holdFreeQuotaSlot(db, owner);
    if (!quota.allowed) {
      // Квота кончилась — это лимит, а не подозрение. Капча тут не помогает:
      // решение владельца от 07.10.2026 — анонимным ровно 3 попытки, и обход
      // через «а я человек» делал бы лимит бессмысленным (раньше именно так и
      // было: `!quota.allowed && !challengePassed`).
      throw new RateLimitError(
        `Бесплатные генерации закончились (${quota.limit} на весь период). Оформите подписку, чтобы продолжить.`,
        { limit: quota.limit, used: quota.used, kind: "free_total" },
      );
    }
    freeRemaining = quota.remaining;
    try {
      return await runFraudGuard({
        db,
        fingerprint,
        signals,
        userId,
        cf,
        challengePassed: input.challengePassed,
        freeRemaining,
      });
    } catch (err) {
      // Генерация не начнётся (капча 409, отказ на входе) — занятую попытку
      // возвращаем сразу, а не ждём TTL: иначе учитель, которому фронт
      // показал капчу, потратил бы попытку на пустой ответ 409.
      await releaseFreeQuotaHold(db, owner).catch(() => {
        /* вернуть не удалось — попытка освободится по TTL */
      });
      throw err;
    }
  }

  return runFraudGuard({
    db,
    fingerprint,
    signals,
    userId,
    cf,
    challengePassed: input.challengePassed,
    freeRemaining,
  });
}

interface FraudGuardInput {
  db: D1Database;
  fingerprint: string;
  signals: FraudSignals;
  userId: string | null;
  cf?: CfObject;
  challengePassed?: boolean;
  freeRemaining: number | null;
}

/** Антифрод после проверки квоты: капча, а не блокировка. */
async function runFraudGuard(input: FraudGuardInput): Promise<GenerationGuardResult> {
  const { db, fingerprint, signals, userId, cf, challengePassed, freeRemaining } = input;

  // ── Антифрод: капча, а не блокировка ──
  const burst = await generationsInLastHour(db, fingerprint);
  const verdict = decideFraud(signals, { cf, burstGenerationsInHour: burst });
  logFraudDecision(fingerprint, verdict, userId);

  if (verdict.decision === "challenge") {
    if (challengePassed) {
      // Капчу уже прошли в этом запросе — доверяем и идём дальше.
      await markChallengePassed(db, fingerprint);
      return { fingerprint, signals, challenged: true, freeRemaining };
    }
    await markChallengeIssued(db, fingerprint);
    throw new ChallengeRequiredError(
      "Нужно подтвердить, что запрос отправлен человеком",
      { reason: verdict.reason },
    );
  }

  return { fingerprint, signals, challenged: false, freeRemaining };
}

/**
 * Зачесть занятую попытку ПОСЛЕ успешной генерации.
 *
 * Списываем после, а не до: если генерация упала (5xx от провайдера, невалидный
 * JSON), учитель не должен терять генерацию из-за чужой ошибки. Попытка, за
 * которую заплатили, при этом уже была занята в guardGeneration — здесь мы
 * только переводим «занято» в «использовано» (и снимаем занятое, если
 * генерация не дошла до этого места — освободит TTL).
 */
/**
 * Вернуть занятую попытку, если генерация не удалась.
 *
 * Симметрично `consumeGenerationQuota`: та же логика ключа, тот же тариф.
 * Нужна маршрутам, которые занимают попытку до вызова провайдера — иначе
 * упавшая генерация держала бы занятый слот до истечения TTL (5 минут).
 * Для платных планов функция ничего не делает: там квота в токенах.
 */
export async function releaseFreeQuotaForGeneration(
  db: D1Database,
  params: { userId: string | null; plan: UsagePlan; fingerprint: string },
): Promise<void> {
  if (params.plan !== "free") return;
  await releaseFreeQuotaHold(db, freeQuotaOwnerKey(params.userId, params.fingerprint));
}

export async function consumeGenerationQuota(
  db: D1Database,
  params: { userId: string | null; plan: UsagePlan; fingerprint: string },
): Promise<void> {
  if (params.plan === "free") {
    const owner = freeQuotaOwnerKey(params.userId, params.fingerprint);
    await consumeFreeQuota(db, owner);
    if (!params.userId) {
      // BL-07: бесплатный доступ анониму виден в учёте по отпечатку, а не
      // «где-то там». Кто именно получил бесплатную генерацию — вопрос, на
      // который раньше не отвечала ни одна таблица.
      await recordAnonymousAccess(db, { ownerKey: owner, plan: params.plan, task: "generation" });
    }
  }
  // Событие пишется для платных тоже: из него берётся сигнал «всплеск»
  // (10+ генераций в час с отпечатка) в decideFraud.
  await recordFraudGeneration(db, params.fingerprint, params.userId);
  // Для платных квоту списывает services/usage.ts → recordUsage (по факту токенов).
}

/**
 * Старый интерфейс сохранён как тонкая обёртка: вызывающий код в llm/index.ts
 * импортирует checkLlmRateLimit. Платарифы проходят без проверки (мягкая норма),
 * бесплатные — через guardGeneration.
 *
 * ВНИМАНИЕ: здесь осталось ЧТЕНИЕ счётчика, а не занятие попытки. Занятие
 * живёт в guardGeneration, и там оно атомарно; если бы эта обёртка тоже
 * занимала, одна генерация съедала бы две попытки (маршрут зовёт guard, а потом
 * generateWorksheet зовёт сюда). Побочный эффект чтения без занятия — в том,
 * что параллельные запросы сводятся к решению занятия в guardGeneration.
 *
 * @deprecated Пользуйтесь guardGeneration: он умеет отпечаток, капчу и
 * бесплатную квоту. Эта функция осталась, чтобы не расползалась правка вызовов.
 */
export async function checkLlmRateLimit(
  db: D1Database,
  params: { userId: string | null; ipHash: string; plan?: UsagePlan | null },
): Promise<{ allowed: true; remaining: number | null }> {
  const plan: UsagePlan = params.plan ?? "free";
  if (plan === "free") {
    const owner = params.userId ?? `iphash:${params.ipHash}`;
    const quota = await checkFreeQuota(db, owner);
    if (!quota.allowed) {
      throw new RateLimitError(
        `Бесплатные генерации закончились (${quota.limit} на весь период). Оформите подписку, чтобы продолжить.`,
        { limit: quota.limit, used: quota.used, kind: "free_total" },
      );
    }
    return { allowed: true, remaining: quota.remaining };
  }
  return { allowed: true, remaining: null };
}

/** Сигнал для тестов: стабильный отпечаток для локальной разработки. */
export const DEV_FINGERPRINT_HASH = DEV_FINGERPRINT;

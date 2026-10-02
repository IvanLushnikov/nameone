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
 *     квоту сменой браузера или часов нельзя.
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

export type RateLimitKind = "anonymous" | "free" | "base" | "plus";

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
  let freeRemaining: number | null = null;
  if (plan === "free") {
    const owner = userId ?? `fp:${fingerprint}`;
    const quota = await checkFreeQuota(db, owner);
    if (!quota.allowed && !input.challengePassed) {
      // Квота кончилась — капча тут не поможет, это не подозрение, а лимит.
      throw new RateLimitError(
        `Бесплатные генерации закончились (${quota.limit} на весь период). Оформите подписку, чтобы продолжить.`,
        { limit: quota.limit, used: quota.used, kind: "free_total" },
      );
    }
    freeRemaining = quota.remaining;
  }

  // ── Антифрод: капча, а не блокировка ──
  const burst = await generationsInLastHour(db, fingerprint);
  const verdict = decideFraud(signals, { cf, burstGenerationsInHour: burst });
  logFraudDecision(fingerprint, verdict, userId);

  if (verdict.decision === "challenge") {
    if (input.challengePassed) {
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
 * Списать бесплатную квоту ПОСЛЕ успешной генерации.
 *
 * Списываем после, а не до: если генерация упала (5xx от провайдера, невалидный
 * JSON), учитель не должен терять генерацию из-за чужой ошибки.
 */
export async function consumeGenerationQuota(
  db: D1Database,
  params: { userId: string | null; plan: UsagePlan; fingerprint: string },
): Promise<void> {
  if (params.plan === "free") {
    const owner = params.userId ?? `fp:${params.fingerprint}`;
    await consumeFreeQuota(db, owner);
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

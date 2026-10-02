/**
 * Антифрод: отпечаток посетителя и накопленные сигналы.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ ПРАВИЛО: подозрение ≠ блокировка
 * ─────────────────────────────────────────────────────────────────────────────
 * Решение владельца продукта — «мягко»: считаем IP + User-Agent + отпечаток,
 * а подозрительным показываем невидимый Cloudflare Turnstile. Нормальный
 * учитель капчу не видит вообще, сценарий «создал 10 аккаунтов в разных
 * браузерах» перестаёт окупаться, а реального человека за школьным NAT или
 * с VPN мы не отрезаем.
 *
 * Блокировки здесь нет намеренно. Учитель — это B2B2C: одно решение принимает
 * завуч, покупает на весь класс, и блок по «аномалии» стоит нам всей школы.
 * Финансово фрод почти ничего не съедает: лист на Luna стоит 0,06 ₽.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Что хранится
 * ─────────────────────────────────────────────────────────────────────────────
 * Только SHA-256 отпечатка. Сырые IP, ASN и User-Agent в таблицу не попадают —
 * это персональные данные, и хранить их ради счётчика фрода незачем.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { sha256Hex } from "./hash";
import { logLlmEvent } from "../llm/log";

/** Cloudflare кладёт гео/устройство/сеть сюда; в dev её нет — всё будет fallback. */
export interface CfObject {
  country?: string;
  colo?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  asn?: number | string;
  botManagement?: { verified?: boolean };
}

export interface FingerprintInput {
  ip: string;
  userAgent: string;
  cf?: CfObject;
}

/**
 * Отпечаток = хэш от соли + сетевых и клиентских признаков.
 *
 * Что и почему входит:
 *   ip        — базовый признак, без него отпечаток не работает вовсе;
 *   userAgent — отсеивает «один и тот же браузер» на разных устройствах;
 *   cf.*      — Cloudflare уже посчитал страну, ОС, браузер, тип устройства и
 *               ASN. Считать это на своей стороне бессмысленно.
 *
 * Чего НЕ входит: время, referer, размер окна. Иначе отпечаток менялся бы
 * при каждом действии и перестал бы накапливать историю аккаунтов.
 *
 * Соль обязательна: без неё хэш от IP подбирается перебором за секунды, и
 * таблица отпечатков сама становится справочником по пользователям.
 */
export async function fingerprintHash(
  input: FingerprintInput,
  salt: string,
): Promise<string> {
  const parts = [
    salt,
    input.ip || "0.0.0.0",
    input.userAgent || "unknown-ua",
    input.cf?.country ?? "-",
    input.cf?.colo ?? "-",
    input.cf?.deviceType ?? "-",
    input.cf?.browser ?? "-",
    input.cf?.os ?? "-",
    String(input.cf?.asn ?? "-"),
  ];
  return sha256Hex(`fp:${parts.join("|")}`);
}

export interface FraudSignals {
  /** Сколько разных аккаунтов заходило с этого отпечатка. */
  accounts: number;
  /** Сколько разных ASN наблюдалось с одного IP. */
  asns: number;
  /** Генераций всего по этому отпечатку. */
  generations: number;
  /** Сколько раз выдавали капчу. */
  challenges: number;
  /** Сколько раз капчу успешно прошли. */
  passes: number;
  /** Время последнего успешного прохождения капчи, 0 = не проходил. */
  lastPassedAt: number;
}

export const EMPTY_SIGNALS: FraudSignals = {
  accounts: 0,
  asns: 0,
  generations: 0,
  challenges: 0,
  passes: 0,
  lastPassedAt: 0,
};

const asnOf = (v: CfObject | undefined): string | null => {
  const raw = v?.asn;
  if (raw === undefined || raw === null || raw === "") return null;
  return String(raw);
};

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    // Битое значение в БД не должно ронять проверку — трактуем как пустое.
    return [];
  }
}

/**
 * Записать визит: связать отпечаток с аккаунтом, запомнить ASN.
 *
 * userId = null для анонимов — такие визиты в счёт аккаунтов не идут,
 * иначе один неавторизованный посетитель с общим школьным IP набил бы
 * счётчик «мультиаккаунт» всем, кто заходит с того же NAT.
 */
export async function recordVisit(
  db: D1Database,
  fingerprint: string,
  userId: string | null,
  cf?: CfObject,
): Promise<FraudSignals> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT user_ids, asns, generations_total, challenges_issued, challenge_passes, last_passed_at
       FROM fraud_signals WHERE fingerprint_hash = ?1`,
    )
    .bind(fingerprint)
    .first<{
      user_ids: string;
      asns: string;
      generations_total: number;
      challenges_issued: number;
      challenge_passes: number;
      last_passed_at: number | null;
    }>();

  const userIds = new Set(parseJsonArray(row?.user_ids));
  if (userId) userIds.add(userId);

  const asns = new Set(parseJsonArray(row?.asns));
  const asn = asnOf(cf);
  if (asn) asns.add(asn);

  const signals: FraudSignals = {
    accounts: userIds.size,
    asns: asns.size,
    generations: row?.generations_total ?? 0,
    challenges: row?.challenges_issued ?? 0,
    passes: row?.challenge_passes ?? 0,
    lastPassedAt: row?.last_passed_at ?? 0,
  };

  await db
    .prepare(
      `INSERT INTO fraud_signals
         (fingerprint_hash, first_seen, last_seen, user_ids, asns,
          generations_total, challenges_issued, challenge_passes, last_passed_at)
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(fingerprint_hash) DO UPDATE SET
         last_seen = ?2,
         user_ids = ?3,
         asns = ?4,
         generations_total = ?5,
         challenges_issued = ?6,
         challenge_passes = ?7,
         last_passed_at = ?8`,
    )
    .bind(
      fingerprint,
      now,
      JSON.stringify([...userIds].slice(0, 20)),
      JSON.stringify([...asns].slice(0, 10)),
      signals.generations,
      signals.challenges,
      signals.passes,
      signals.lastPassedAt || null,
    )
    .run();

  return signals;
}

/**
 * Учесть состоявшуюся генерацию по отпечатку.
 *
 * Делает две вещи, и обе нужны:
 *   1) инкремент счётчика в fraud_signals — это история отпечатка;
 *   2) событие `generation` с отпечатком внутри data_json — из него
 *      generationsInLastHour считает всплеск за последний час.
 *
 * Второе можно было бы посчитать и по fraud_signals, но там только сумма за
 * всю жизнь, а нужен именно часовой срез. Отдельный счётчик с окном заводить
 * незачем ради одного сигнала.
 *
 * Отпечаток кладём в data_json первыми 16 символами хэша — этого хватает для
 * группировки, и в логах аналитики не оказывается ничего личного.
 */
export async function recordGeneration(
  db: D1Database,
  fingerprint: string,
  userId: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE fraud_signals SET generations_total = generations_total + 1
       WHERE fingerprint_hash = ?1`,
    )
    .bind(fingerprint)
    .run();

  const short = fingerprint.slice(0, 16);
  await db
    .prepare(`INSERT INTO events (id, user_id, name, data_json, created_at) VALUES (?1, ?2, 'generation', ?3, ?4)`)
    .bind(
      `ev_gen_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      JSON.stringify({ fp: short }),
      now,
    )
    .run();
}

/** Отметить, что капча была выдана. */
export async function markChallengeIssued(db: D1Database, fingerprint: string): Promise<void> {
  await db
    .prepare(
      `UPDATE fraud_signals SET challenges_issued = challenges_issued + 1
       WHERE fingerprint_hash = ?1`,
    )
    .bind(fingerprint)
    .run();
}

/**
 * Отметить успешное прохождение капчи: увеличиваем счётчик И устанавливаем
 * last_passed_at — после этого тот же отпечаток признаётся доверенным.
 */
export async function markChallengePassed(db: D1Database, fingerprint: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE fraud_signals SET challenge_passes = challenge_passes + 1, last_passed_at = ?2
       WHERE fingerprint_hash = ?1`,
    )
    .bind(fingerprint, now)
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Пороги сигналов
// ─────────────────────────────────────────────────────────────────────────────

/** После успешной капчи доверяем отпечатку 30 дней. */
export const TRUST_WINDOW_SECONDS = 30 * 86400;

/** 2+ аккаунта с одного отпечатка — типичный мультиаккаунт. */
export const SIGNAL_MULTI_ACCOUNT = 2;
/** 3+ разных ASN с одного IP — смена оператора или прокси. */
export const SIGNAL_MULTI_ASN = 3;
/** 10+ генераций в час с отпечатка — всплеск, характерный для автоматизации. */
export const SIGNAL_BURST_PER_HOUR = 10;

export type FraudDecision = "ok" | "challenge";

export interface FraudVerdict {
  decision: FraudDecision;
  /** Почему решили — пишется в лог, чтобы админ мог разобрать спорный случай. */
  reason: string;
  signals: FraudSignals;
}

/**
 * Решение по сигналам: нужна капча или нет.
 *
 * Ни одна ветка не приводит к отказу. Ветка «botManagement.verified === false
 * плюс не-браузерный User-Agent» — единственная, где капча показывается с
 * первого раза: это подделка, а не живой человек.
 */
export function decideFraud(
  signals: FraudSignals,
  opts: { cf?: CfObject; burstGenerationsInHour?: number; now?: number } = {},
): FraudVerdict {
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  // Недавно прошёл капчу — не мучаем повторно.
  if (signals.lastPassedAt > 0 && now - signals.lastPassedAt < TRUST_WINDOW_SECONDS) {
    return { decision: "ok", reason: "recently_passed_challenge", signals };
  }

  const ua = opts.cf?.browser == null && opts.cf?.deviceType == null;
  if (ua && opts.cf?.botManagement?.verified === false) {
    return { decision: "challenge", reason: "bot_unverified", signals };
  }

  if (signals.accounts >= SIGNAL_MULTI_ACCOUNT) {
    return { decision: "challenge", reason: "multi_account", signals };
  }

  if (signals.asns >= SIGNAL_MULTI_ASN) {
    return { decision: "challenge", reason: "multi_asn", signals };
  }

  const burst = opts.burstGenerationsInHour ?? 0;
  if (burst >= SIGNAL_BURST_PER_HOUR) {
    return { decision: "challenge", reason: "burst", signals };
  }

  return { decision: "ok", reason: "no_signals", signals };
}

/**
 * Число генераций с отпечатка за последний час — используется как один из
 * сигналов. Читает events, а не отдельный счётчик: событие уже пишется
 * на каждую генерацию, дублировать счётчик незачем.
 */
export async function generationsInLastHour(
  db: D1Database,
  fingerprint: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM events
       WHERE name = 'generation' AND created_at > ?1 AND data_json LIKE ?2`,
    )
    .bind(Math.floor(Date.now() / 1000) - 3600, `%${fingerprint.slice(0, 16)}%`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Логируем решение — без содержимого запроса, только метаданные. */
export function logFraudDecision(
  fingerprint: string,
  verdict: FraudVerdict,
  userId: string | null,
): void {
  if (verdict.decision === "ok" && verdict.reason === "no_signals") return;
  logLlmEvent(verdict.decision === "ok" ? "info" : "warn", "antifraud: decision", {
    fingerprint: fingerprint.slice(0, 12),
    userId,
    decision: verdict.decision,
    reason: verdict.reason,
    accounts: verdict.signals.accounts,
    asns: verdict.signals.asns,
    generations: verdict.signals.generations,
  });
}

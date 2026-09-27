/**
 * Rate limit для LLM-вызовов.
 *
 * Per-user окно 24ч (reset в midnight UTC). Лимиты:
 *   * anonymous (по IP hash): 3 генерации/день
 *   * free plan (user):       10 генераций/день
 *   * base plan:              без лимита (только логируем)
 *   * plus plan:              без лимита (только логируем)
 *
 * Хранение — таблица `rate_limits` (ключ UNIQUE, count, window_start).
 * "Insert-or-increment" делается двумя SQL (атомарность обеспечивается тем,
 * что D1 сериализует statements per-connection — на практике и для нашей
 * нагрузки этого достаточно; для серьёзного contention нужен PRAGMA).
 */

import type { D1Database } from "@cloudflare/workers-types";
import { RateLimitError } from "../lib/errors";

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export type RateLimitKind = "anonymous" | "free" | "base" | "plus";

export const LIMITS: Record<RateLimitKind, number> = {
  anonymous: 3,
  free: 10,
  base: Number.POSITIVE_INFINITY,
  plus: Number.POSITIVE_INFINITY,
};

const WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Проверить + заинкрементить счётчик за один вызов.
 *
 * @param db         D1 binding.
 * @param userId     Если задан — используется user-key (например `user:usr_x`).
 * @param ipHash     SHA-256 от IP (для анонимов — `ip:<hash>`). Если есть userId —
 *                   ipHash игнорируется.
 *
 * Бросает RateLimitError, если лимит превышен.
 */
export async function checkLlmRateLimit(
  db: D1Database,
  params: {
    userId: string | null;
    ipHash: string;
    plan?: "free" | "base" | "plus" | null;
  },
): Promise<RateLimitDecision> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % WINDOW_SECONDS); // выравниваем по midnight UTC
  const resetAt = windowStart + WINDOW_SECONDS;

  const planKind: RateLimitKind = !params.userId
    ? "anonymous"
    : (params.plan ?? "free");
  const limit = LIMITS[planKind];

  if (!Number.isFinite(limit)) {
    // unlimited — только логируем (для аналитики).
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, resetAt };
  }

  const key = params.userId ? `user:${params.userId}` : `ip:${params.ipHash}`;

  // 1. Читаем текущий bucket.
  const row = await db
    .prepare(
      `SELECT count, window_start FROM rate_limits
       WHERE key = ?1`,
    )
    .bind(key)
    .first<{ count: number; window_start: number }>();

  const curCount = row?.count ?? 0;
  const curWindow = row?.window_start ?? 0;

  let newCount: number;
  if (curWindow === windowStart) {
    // тот же bucket — инкремент.
    newCount = curCount + 1;
    await db
      .prepare(
        `UPDATE rate_limits SET count = ?1 WHERE key = ?2`,
      )
      .bind(newCount, key)
      .run();
  } else if (curWindow === 0 || curWindow < windowStart) {
    // новый bucket — сброс и запись.
    newCount = 1;
    const id = `rl_${key.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40)}_${windowStart}`;
    await db
      .prepare(
        `INSERT OR REPLACE INTO rate_limits (id, key, count, window_start)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(id, key, newCount, windowStart)
      .run();
  } else {
    // curWindow > windowStart невозможно при том, что windowStart вычислен.
    // Защищаемся на всякий случай.
    newCount = 1;
    await db
      .prepare(
        `INSERT OR REPLACE INTO rate_limits (id, key, count, window_start)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(`rl_${key.slice(0, 30)}`, key, newCount, windowStart)
      .run();
  }

  const remaining = Math.max(0, limit - newCount);
  const allowed = newCount <= limit;

  if (!allowed) {
    throw new RateLimitError(
      `Достигнут дневной лимит (${limit} генераций). Сброс в ${new Date(resetAt * 1000).toISOString()}`,
      {
        limit,
        used: newCount,
        resetAt,
        kind: planKind,
      },
    );
  }

  return { allowed: true, remaining, resetAt };
}

/**
 * SHA-256 от строки. В CF Workers достаточно crypto.subtle.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

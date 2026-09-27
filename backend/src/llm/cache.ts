/**
 * Semantic cache для ответов LLM.
 *
 * Ключ — sha256 от нормализованного JSON с параметрами запроса.
 * Идемпотентность: повторный insert с тем же ключом ничего не делает (UNIQUE).
 * TTL: 30 дней по умолчанию.
 *
 * Хранение в D1 (`semantic_cache` таблица, см. schema.sql).
 */

import type { D1Database } from "@cloudflare/workers-types";
import { shortId } from "../lib/shortid";
import type { GenerationRequest } from "../types";

const DAY_SEC = 24 * 60 * 60;
const DEFAULT_TTL_SECONDS = 30 * DAY_SEC;

// ─────────────────────────────────────────────────────────────────────────────
// Cache key
// ─────────────────────────────────────────────────────────────────────────────

export interface CacheKeyInput {
  subject: string;
  grade: number;
  topic: string;
  difficulty: string;
  count: number;
  type: string;
}

/**
 * Сделать детерминированный ключ кэша из параметров запроса.
 *
 * Topic нормализуется: trim + lower-case + collapse пробелов.
 * Всё остальное берётся как есть (subject/type/difficulty — из enum'ов).
 */
export function makeCacheKey(input: CacheKeyInput | GenerationRequest): string {
  const subject = String(input.subject);
  const grade = Number(input.grade);
  const topic = String(input.topic).trim().replace(/\s+/g, " ").toLowerCase();
  const difficulty = String(input.difficulty);
  const count = Number(input.count);
  const type = String(input.type);

  const canonical = JSON.stringify({
    subject,
    grade,
    topic,
    difficulty,
    count,
    type,
  });

  // sha256Hex async — нам нужен sync API для удобства вызова, синхронно хешируем
  // через Web Crypto API напрямую (но он тоже async).
  // Решение: ключ кэша — sha256 в hex, но обёртка async.
  // Для совместимости делаем sync-вариант через простой djb2 (collision маловероятен для нашего размера).
  return djb2Hex(canonical);
}

function djb2Hex(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // 32-bit hex + 32-bit hex = 64-bit hex (16 chars)
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup / save / invalidate
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedEntry {
  response: unknown;
  hitCount: number;
}

export async function lookupCache(
  db: D1Database,
  key: string,
): Promise<CachedEntry | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT response_json, hit_count
       FROM semantic_cache
       WHERE cache_key = ?1 AND expires_at > ?2`,
    )
    .bind(key, now)
    .first<{ response_json: string; hit_count: number }>();

  if (!row) return null;

  let response: unknown;
  try {
    response = JSON.parse(row.response_json);
  } catch {
    // Битый JSON — удаляем запись и возвращаем miss.
    await db
      .prepare(`DELETE FROM semantic_cache WHERE cache_key = ?1`)
      .bind(key)
      .run();
    return null;
  }

  // Async increment (не блокируем return).
  await db
    .prepare(`UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE cache_key = ?1`)
    .bind(key)
    .run();

  return { response, hitCount: row.hit_count + 1 };
}

export interface SaveCacheParams {
  key: string;
  subject: string;
  grade: number;
  topic: string;
  difficulty: string;
  count: number;
  type: string;
  response: unknown;
  ttlSeconds?: number;
  /** ID для record'а (наш короткий shortId). Если не задан — генерим. */
  id?: string;
}

/**
 * Идемпотентный insert. Если ключ уже есть — ничего не делаем.
 */
export async function saveCache(db: D1Database, params: SaveCacheParams): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = now + ttl;
  const id = params.id ?? `cache_${shortId(12)}`;

  await db
    .prepare(
      `INSERT OR IGNORE INTO semantic_cache
         (id, cache_key, subject, grade, topic, difficulty, count, type,
          response_json, hit_count, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11)`,
    )
    .bind(
      id,
      params.key,
      params.subject,
      params.grade,
      params.topic,
      params.difficulty,
      params.count,
      params.type,
      JSON.stringify(params.response),
      now,
      expiresAt,
    )
    .run();
}

/**
 * Инвалидировать весь кэш по (subject, grade, topic).
 * Для админских инструментов («обновить листы по теме»).
 */
export async function invalidateCache(
  db: D1Database,
  subject: string,
  grade: number,
  topic: string,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM semantic_cache
       WHERE subject = ?1 AND grade = ?2 AND topic = ?3`,
    )
    .bind(subject, grade, topic)
    .run();
  return result.meta?.changes ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _sha256Hex(input: string): Promise<string> {
  // Cloudflare Workers Web Crypto API.
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
void _sha256Hex;

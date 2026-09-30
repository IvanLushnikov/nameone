"use client";

/**
 * Rate-limit на бесплатные генерации. Хранится в localStorage.
 * На сервере (Cloudflare Pages Direct Upload, static) cookies бы не сработали
 * надёжно между статикой и edge — localStorage проще и прозрачнее.
 */

const KEY = "rabochielisty_gens_v1";
const LIMIT = 3;

interface Counter {
  count: number;
  resetAt: number;
}

function getNextMidnight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function read(): Counter {
  if (typeof window === "undefined") return { count: 0, resetAt: getNextMidnight() };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { count: 0, resetAt: getNextMidnight() };
    const parsed = JSON.parse(raw) as Counter;
    if (parsed.resetAt < Date.now()) {
      return { count: 0, resetAt: getNextMidnight() };
    }
    return parsed;
  } catch {
    return { count: 0, resetAt: getNextMidnight() };
  }
}

function write(c: Counter): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(c));
  } catch {}
}

export function getRemaining(): number {
  return Math.max(0, LIMIT - read().count);
}

export function canGenerate(): boolean {
  return getRemaining() > 0;
}

export function consume(): Counter {
  const cur = read();
  const next: Counter = {
    count: cur.count + 1,
    resetAt: cur.resetAt,
  };
  write(next);
  return next;
}

export function getResetAt(): number {
  return read().resetAt;
}

/**
 * Сброс счётчика (например, после успешной оплаты).
 */
export function reset(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export const FREE_LIMIT = LIMIT;
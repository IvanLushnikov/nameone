"use client";

/**
 * Клиентский счётчик бесплатных генераций — ТОЛЬКО оптимистичный прогноз.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО НЕ ИСТОЧНИК ПРАВДЫ (2026-10-02)
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше здесь стоял главный счётчик: 3 генерации в сутки, счёт в localStorage,
 * resetAt = ближайшая полночь. Три проблемы, каждая из которых стоила денег
 * или репутации:
 *
 *   1) Сменой системного времени счётчик обнулялся — «бесплатно» значило
 *      «бесплатно пока не перевёл часы».
 *   2) Бэк считал по-своему (3 для анонимных, 10 для free), то есть реальный
 *      потолок был один, а обещание — другое.
 *   3) Счётчик жил в браузере, поэтому очистка localStorage давала новые
 *      3 генерации без всякой регистрации.
 *
 * Теперь счёт ВЕДЁТ СЕРВЕР (backend/src/services/usage.ts → usage_counters),
 * и он не сбрасывается по суткам: 3 генерации на весь период.
 *
 * ЧТО ОСТАЛОСЬ В ЭТОМ ФАЙЛЕ. Быстрый ответ на «можно ли нажать кнопку» без
 * похода в сеть. UI не должен мигать «бесплатно» на 300 мс после того, как
 * квота кончилась. Но решение о доступе принимает бэк: он вернёт 429
 * (FREE_TOTAL), если квота исчерпана, и 409 TURNSTILE_REQUIRED, если нужен
 * antifraud-челлендж. Оптимистичный счётчик в обоих случаях приводится к
 * фактическому состоянию через GET /api/users/usage.
 */

import { FREE_GENERATIONS } from "@/lib/content/plans";

const KEY = "uchlist_gens_v1";

interface Counter {
  count: number;
  /** ISO-дата, до какого момента счётчик в оптимистичном состоянии. */
  syncedAt: string | null;
}

const EMPTY: Counter = { count: 0, syncedAt: null };

function read(): Counter {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Counter;
    if (typeof parsed?.count !== "number") return EMPTY;
    return { count: Math.max(0, parsed.count), syncedAt: parsed.syncedAt ?? null };
  } catch {
    return EMPTY;
  }
}

function write(c: Counter): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Приватный режим / переполнение — не повод ломать генерацию.
  }
}

export function getRemaining(): number {
  return Math.max(0, FREE_GENERATIONS - read().count);
}

export function canGenerate(): boolean {
  return getRemaining() > 0;
}

export function consume(): Counter {
  const cur = read();
  const next: Counter = { count: cur.count + 1, syncedAt: cur.syncedAt };
  write(next);
  return next;
}

/**
 * Возврат попытки после НЕудачной генерации.
 *
 * Счётчик списывается в оптимистичном порядке (до запроса), чтобы двойной клик
 * не съел две квоты. Если генерация не прошла — возвращаем попытку.
 */
export function refund(): Counter {
  const cur = read();
  const next: Counter = { count: Math.max(0, cur.count - 1), syncedAt: cur.syncedAt };
  write(next);
  return next;
}

/**
 * Привести счётчик к серверному состоянию.
 *
 * Сервер — единственный источник правды, поэтому после каждой успешной
 * генерации и при открытии профиля вызываем это. Значения выше серверного
 * (например, после очистки localStorage) обнуляем, а не берём max: иначе
 * счётчик мог бы уехать вперёд навсегда.
 */
export function syncFromServer(serverCount: number | null | undefined): void {
  if (typeof serverCount !== "number" || !Number.isFinite(serverCount)) return;
  write({ count: Math.max(0, serverCount), syncedAt: new Date().toISOString() });
}

export function reset(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

/**
 * Суток больше нет, поэтому `getResetAt()` как публичный API исчез: он
 * возвращал бы время «сброса», которого не происходит. Счётчик не сбрасывается
 * до новой оплаты.
 */
export const FREE_LIMIT = FREE_GENERATIONS;

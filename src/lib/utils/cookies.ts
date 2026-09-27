/**
 * Утилиты для работы с cookies (rate-limit на бесплатные генерации).
 * Используются на сервере в API routes (Next.js Route Handlers).
 */

import { cookies } from "next/headers";

const COOKIE_GENERATIONS = "listai_gens";
const COOKIE_LIMIT = 3;

export interface GenerationCounter {
  count: number;
  resetAt: number; // unix ms
}

export async function getGenerationCounter(): Promise<GenerationCounter> {
  const store = await cookies();
  const raw = store.get(COOKIE_GENERATIONS)?.value;
  if (!raw) {
    return { count: 0, resetAt: getNextMidnight() };
  }
  try {
    const parsed = JSON.parse(raw) as GenerationCounter;
    if (parsed.resetAt < Date.now()) {
      // Сброс прошёл
      return { count: 0, resetAt: getNextMidnight() };
    }
    return parsed;
  } catch {
    return { count: 0, resetAt: getNextMidnight() };
  }
}

export async function incrementGenerationCounter(): Promise<GenerationCounter> {
  const store = await cookies();
  const counter = await getGenerationCounter();
  const next: GenerationCounter = {
    count: counter.count + 1,
    resetAt: counter.resetAt,
  };
  store.set(COOKIE_GENERATIONS, JSON.stringify(next), {
    httpOnly: false, // чтобы фронт мог показать "осталось X"
    sameSite: "lax",
    path: "/",
    expires: new Date(next.resetAt),
  });
  return next;
}

export async function checkCanGenerate(): Promise<{
  canGenerate: boolean;
  remaining: number;
  resetAt: number;
}> {
  const counter = await getGenerationCounter();
  return {
    canGenerate: counter.count < COOKIE_LIMIT,
    remaining: Math.max(0, COOKIE_LIMIT - counter.count),
    resetAt: counter.resetAt,
  };
}

function getNextMidnight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}
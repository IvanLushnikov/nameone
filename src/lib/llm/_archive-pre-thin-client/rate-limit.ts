/**
 * In-memory rate-limit для API. Простая защита от спама.
 * В single-process сервере (VPS/Docker) работает; в serverless каждый инвок
 * получает свежий счётчик — TODO: перенести в Redis/KV для serverless.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60 * 60 * 1000; // 1 час
const LIMIT_PER_HOUR = 30;

/** Проверить и инкрементировать счётчик. Возвращает ok=false если превышен лимит. */
export function checkRateLimit(key: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }
  if (b.count >= LIMIT_PER_HOUR) {
    return { ok: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count += 1;
  return { ok: true, remaining: LIMIT_PER_HOUR - b.count, resetAt: b.resetAt };
}

/** Получить ключ для rate-limit. Берём x-forwarded-for / x-real-ip / "anon". */
export function getClientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const xri = req.headers.get("x-real-ip");
  return (xff?.split(",")[0]?.trim() ?? xri?.trim() ?? "anon");
}

/** Периодическая очистка старых buckets, чтобы Map не пухла. */
let lastPrune = 0;
export function pruneOld(): void {
  const now = Date.now();
  if (now - lastPrune < 60_000) return; // не чаще раза в минуту
  lastPrune = now;
  for (const [k, v] of Array.from(buckets.entries())) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

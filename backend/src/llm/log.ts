/**
 * Структурный логгер для LLM-слоя.
 *
 * Печатает JSON-строку в console — Cloudflare Workers собирает это
 * через `wrangler tail` / Logpush.
 *
 * Уровни:
 *   info  — штатный успех (latency, cost, hit-cache, fallback)
 *   warn  — recoverable деградация (fallback включился, cost=0 для неизвестной модели)
 *   error — fatal (всё упало, включая fallback chain)
 */

type Level = "info" | "warn" | "error";

export function logLlmEvent(
  level: Level,
  message: string,
  data?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    src: "llm",
    level,
    msg: message,
    ...(data || {}),
  });
  // Cloudflare Workers логи: console.log/info/warn/error идут в один поток,
  // но separation по уровню удобно для фильтрации.
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.info(line);
  }
}

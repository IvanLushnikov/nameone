/**
 * Vitest config для backend.
 *
 * Используем @cloudflare/vitest-pool-workers — он запускает тесты внутри
 * workerd runtime с реальными D1/R2 биндингами. Так тесты максимально
 * близки к продакшну, без mock-обёрток.
 *
 * Pool тут — `@cloudflare/vitest-pool-workers` (не `forks`/`threads`), иначе
 * workerd не стартует и D1 не получит реальный биндинг.
 *
 * Чистые unit-тесты (cost, moderation, checkExam, shortid, prompts, billing)
 * НЕ требуют workerd — они работают в node pool и быстрее. Для них vitest
 * автоматически использует workers-pool, если они не используют env.
 */

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityFlags: ["nodejs_compat"],
          compatibilityDate: "2026-09-01",
          // Ключ шифрования секрета кода подтверждения (ТЗ-24 §8.1).
          //
          // Тестовый и только для тестов: 32 байта в base64. Без него роут
          // настройки кода подтверждения отвечал бы «на сервере не задан
          // ключ», и проверять было бы нечего. В боевом окружении ключ ставится
          // через `wrangler secret put TOTP_ENCRYPTION_KEY` и в репозиторий
          // не попадает.
          bindings: {
            TOTP_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
          },
        },
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
});

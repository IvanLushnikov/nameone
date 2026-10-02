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
        },
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],

    // Бэкенд — Cloudflare Worker, CSS в нём нет вообще. Без этой строки vite
    // при поиске конфига PostCSS поднимается вверх по дереву и находит корневой
    // postcss.config.mjs от Next.js, который требует `tailwindcss`. Локально это
    // не проявляется: там есть корневой node_modules с tailwindcss. В CI джоб
    // делает `cd backend && npm ci`, корневого node_modules нет — и тесты падают
    // с «Cannot find module 'tailwindcss'», хотя код в порядке.
    //
    // Явный пустой список плагинов останавливает поиск: конфиг не поднимается
    // наверх, и бэк больше не зависит от того, что установлено в корне.
    css: { postcss: { plugins: [] } },
  },
});

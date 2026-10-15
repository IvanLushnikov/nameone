/**
 * Vitest config для backend.
 *
 * Используем @cloudflare/vitest-plugin — он запускает тесты внутри
 * workerd runtime с реальными D1/R2 биндингами. Так тесты максимально
 * близки к продакшну, без mock-обёрток.
 *
 * Pool тут — `@cloudflare/vitest-plugin` (не `forks`/`threads`), иначе
 * workerd не стартует и D1 не получит реальный биндинг.
 *
 * Чистые unit-тесты (cost, moderation, checkExam, shortid, prompts, billing)
 * НЕ требуют workerd — они работают в node pool и быстрее. Для них vitest
 * автоматически использует workers-pool, если они не используют env.
 */

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Флаг разрешает платные прогоны. Пусто — обычный `npm test`, без них.
const LIVE_TESTS = process.env.LIVE === "1";

export default defineConfig({
  // Настройка Workers-окружения живёт в плагине, а не в `test.poolOptions`:
  // с Vitest 4 `defineWorkersConfig` и пул «workers» удалены, их заменил
  // плагин `cloudflareTest()`. Опции, которые раньше лежали в
  // `test.poolOptions.workers`, передаются плагину напрямую.
  plugins: [
    cloudflareTest({
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
    }),
  ],
  test: {
    // ЖИВЫЕ прогоны (реальные деньги) НЕ входят в обычный `npm test`.
    //
    // Без этого исключения `npm test` в CI платил бы за генерацию листов на
    // каждом запуске и падал бы от того, что модель в конкретный момент
    // выдала другой текст. Обычный пайплайн должен быть быстрым, бесплатным и
    // детерминированным.
    //
    // Исключение сделано через флаг, а не безусловным `exclude`: `exclude`
    // в vitest действует И на явный путь в командной строке, и прогон с
    // `npx vitest run tests/integration/...` отвечал бы «No test files found».
    // С флагом обычный запуск не видит файл, а целевой — видит.
    //
    //   cd backend && LIVE=1 npx vitest run tests/integration/tz26-live-quality.test.ts
    exclude: LIVE_TESTS ? undefined : [
      "**/node_modules/**",
      "tests/integration/tz26-live-quality.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
});

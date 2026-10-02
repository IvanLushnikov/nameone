import { defineConfig } from 'vitest/config';
import path from 'path';

// Алиас hono нужен интеграционным тестам корня: они поднимают Hono-приложение
// бэкенда, а hono лежит только в backend/node_modules и из root не резолвится
// ("Cannot find package 'hono'"). Реально этим пользуется
// tests/integration/polza-cost-regression.test.ts и его соседи.
// Комментарии 27.09.2026 ссылались на tests/integration/photo-check.test.ts —
// такого файла нет; настройки остались, имена приведены в соответствие (02.10).
const HONO_FROM_BACKEND = path.resolve(__dirname, './backend/node_modules/hono');
const BACKEND_DIR = path.resolve(__dirname, './backend');

export default defineConfig({
  // F-test: tests/regression/*.test.tsx — это RTL + JSX.
  // tsconfig.json "jsx":"preserve" рассчитан на Next.js/SWC, а vitest идёт через esbuild.
  // esbuild default = "transform" (classic runtime), который требует `import React from 'react'`.
  // Переключаем на "automatic" — JSX-трансформ как в современных React-проектах, без React import.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
    ],
    // По умолчанию vitest НЕ inline'ит CJS-зависимости нод-модулей (идёт через
    // delegate). Без `inline` `vi.mock('node-fetch')` не перехватывает вызовы
    // OpenAI SDK и реальные запросы идут на polza.ai — то есть тест стучится
    // в платный API вместо проверки расчёта цены.
    // inline node-fetch + openai, чтобы vi.mock работал на production-коде.
    //
    // hono добавляется для интеграционных тестов корня, которые поднимают
    // Hono-приложение бэкенда (см. алиас выше).
    server: {
      deps: {
        inline: [/node-fetch/, /openai/, /hono/],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // backend-only пакет, недоступный из root. Алиасим на конкретный
      // entry-point внутри backend/node_modules (там есть свой package.json).
      hono: HONO_FROM_BACKEND,
    },
  },
  // Интеграционные тесты корня читают backend/src напрямую — например
  // tests/integration/polza-cost-regression.test.ts импортирует
  // "../../backend/src/llm/config", а plans-price-sources.test.ts сверяет
  // цены фронта с backend/src/services/billing.ts. По умолчанию Vite блокирует
  // выход за пределы cwd — добавляем backend/ в allow.
  server: {
    fs: {
      allow: [BACKEND_DIR],
    },
  },
});
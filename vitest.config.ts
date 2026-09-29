import { defineConfig } from 'vitest/config';
import path from 'path';

// F-06 fix (27.09.2026): tests/integration/photo-check.test.ts поднимает
// Hono-app для behavior-тестов. Hono живёт только в backend/node_modules —
// резолвим через alias, чтобы vitest не падал на "Cannot find package 'hono'".
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
    // F-test: tests/integration/polza-provider.test.ts мокает node-fetch.
    // По умолчанию vitest НЕ inline'ит CJS-зависимости нод-модулей (идёт через
    // delegate). Без `inline` `vi.mock('node-fetch')` не перехватывает вызовы
    // OpenAI SDK и реальные запросы идут на polza.ai.
    // inline node-fetch + openai, чтобы vi.mock работал на production-код.
    //
    // F-06 fix (27.09.2026): photo-check.test.ts поднимает f06Router на
    // тестовом Hono app — hono лежит только в backend/node_modules, не в
    // root. Inline'им hono, чтобы vitest нашёл его по абсолютному path.
    server: {
      deps: {
        inline: [/node-fetch/, /openai/, /hono/],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // F-06: backend-only пакеты, недоступные из root. Алиасим на конкретные
      // entry-points внутри backend/node_modules (там есть свой package.json).
      hono: HONO_FROM_BACKEND,
    },
  },
  // F-06 fix (27.09.2026): tests/integration/photo-check.test.ts ходит в
  // backend/src через require("../../backend/src/routes/f06"). По умолчанию
  // Vite блокирует выход за пределы cwd — добавляем backend/ в allow, чтобы
  // require видел backend-исходники.
  server: {
    fs: {
      allow: [BACKEND_DIR],
    },
  },
});
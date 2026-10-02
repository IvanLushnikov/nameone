/**
 * Пустой PostCSS-конфиг для бэкенда.
 *
 * Зачем он здесь, если CSS в бэкенде нет вообще: vite ищет postcss.config
 * по дереву вверх от своей корневой папки. Без этого файла поиск доходит до
 * корня репозитория и находит postcss.config.mjs от Next.js, который требует
 * `tailwindcss`. Локально это незаметно — в корневом node_modules tailwindcss
 * есть. В CI джоб делает `cd backend && npm ci`, корневого node_modules нет,
 * и тесты падают с «Cannot find module 'tailwindcss'», хотя код в порядке.
 *
 * Этот файл останавливает поиск на backend/ и ничего не подключает.
 * ВАЖНО: `backend/tsconfig.json` собирает только `src`, `tests` и
 * `vitest.config.ts` — этот файл в сборку воркера не попадает.
 */
export default {
  plugins: {},
};

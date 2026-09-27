#!/bin/sh
# dev.sh — запуск backend в dev-режиме с Miniflare.
#
# Использование:
#   ./scripts/dev.sh                 # http://localhost:8787
#   CF_PAGES=1 ./scripts/dev.sh      # + режим Cloudflare Pages (если нужно)
#
# Требования:
#   - .dev.vars с API-ключами (или без — тогда часть фич вернёт 500)
#   - D1 миграции выполнены: npm run db:migrate:local
#
# Что делает:
#   1) Проверяет wrangler.toml
#   2) Запускает wrangler dev --local на порту 8787
#   3) Доступные endpoints: /healthz, /readyz, /api/{llm,worksheets,exams,auth,users,billing}

set -e
cd "$(dirname "$0")/.."

echo "▶ Запуск backend (Cloudflare Workers + Hono + D1) на http://localhost:8787"
echo "  Endpoints:"
echo "    GET  /healthz"
echo "    GET  /readyz"
echo "    GET  /api/llm/models"
echo "    POST /api/llm/embeddings"
echo "    POST /api/worksheets/generate   (требует API-ключ)"
echo "    POST /api/worksheets/validate   (требует DEEPSEEK_API_KEY)"
echo "    POST /api/exams/generate         (требует API-ключ)"
echo "    POST /api/auth/magic-link"
echo "    POST /api/auth/callback"
echo "    GET  /api/auth/me"
echo "    GET  /api/users/me              (требует session)"
echo "    POST /api/billing/create        (требует session)"
echo "    POST /api/billing/yookassa-webhook (no auth)"
echo ""

# Миграция если нет .wrangler/state
if [ ! -d ".wrangler/state" ]; then
  echo "▶ Применяю миграции D1..."
  npm run db:migrate:local || true
fi

exec npx --yes wrangler dev --local --port 8787 --persist-to .wrangler/state

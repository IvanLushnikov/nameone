#!/bin/sh
# deploy.sh — деплой backend в Cloudflare Workers.
#
# Использование:
#   ./scripts/deploy.sh                       # деплой в production (env.production из wrangler.toml)
#   ./scripts/deploy.sh staging               # деплой в Workers без env.production (preview URL)
#
# Требования:
#   - wrangler logged in (npx wrangler login) или CLOUDFLARE_API_TOKEN в env
#   - database_id в wrangler.toml заменён на реальный (wrangler d1 create rabochielisty)
#   - secrets: wrangler secret put OPENAI_API_KEY ... (или .dev.vars для локального)
#
# Что делает:
#   1) Type-check
#   2) Lint
#   3) Test (vitest)
#   4) D1 migrations в remote
#   5) wrangler deploy

set -e
cd "$(dirname "$0")/.."

echo "▶ Type-check..."
npm run typecheck

echo "▶ Lint..."
ESLINT_USE_FLAT_CONFIG=false npx eslint src/

echo "▶ Tests..."
npm test -- --run

echo "▶ D1 migrations (remote)..."
if grep -q "PLACEHOLDER" wrangler.toml; then
  echo "⚠ database_id = PLACEHOLDER — обнови wrangler.toml:"
  echo "    wrangler d1 create rabochielisty"
  echo "    затем подставь ID в wrangler.toml"
  exit 1
fi
npm run db:migrate:prod

echo "▶ Deploy..."
npx --yes wrangler deploy

echo ""
echo "✅ Backend задеплоен. Проверь /healthz:"
echo "   curl https://rabochielisty-api.<your-subdomain>.workers.dev/healthz"

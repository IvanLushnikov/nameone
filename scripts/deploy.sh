#!/usr/bin/env bash
# Деплой на Cloudflare Pages (Direct Upload).
# Использует токен из .env (НЕ коммитится — см. .gitignore).
#
# Использование:
#   1. Скопируй .env.example в .env:
#        cp .env.example .env
#   2. Положи свой CLOUDFLARE_API_TOKEN в .env (см. .env.example для инструкции)
#   3. Запусти:
#        bash scripts/deploy.sh
#
# Или разово через env-переменные (CI):
#   CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy bash scripts/deploy.sh

set -euo pipefail

# Загрузить .env если есть
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN не задан. Положи его в .env или передай через env}"
: "${CLOUDFLARE_ACCOUNT_ID:=9fe2955fcf08aecf91754823a7aae0aa}"
# TODO: после регистрации uchlist.ru и переключения DNS CNAME — переименовать
# CF_PAGES_PROJECT в Pages Dashboard (или создать новый Pages-проект uchlist.ru
# и поменять значение по умолчанию тут). До тех пор держим listai-prototype — это
# реальное имя Pages-проекта, который сейчас обслуживает прод-трафик (см. docs/BRAND.md).
: "${CF_PAGES_PROJECT:=listai-prototype}"

# PATH для node/npm (на этой машине они не в PATH по умолчанию)
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"

cd "$PROJECT_ROOT"

# Билд если нет out/
if [ ! -d "out" ] || [ ! -f "out/index.html" ]; then
  echo "→ out/ не найден, билдим..."
  npm run build
fi

echo "→ Деплой УчЛист (out/) → $CF_PAGES_PROJECT"
npx --yes wrangler pages deploy out \
  --project-name="$CF_PAGES_PROJECT" \
  --commit-dirty=true

echo ""
echo "✓ Готово. URL: https://$CF_PAGES_PROJECT.pages.dev/"
echo "  Бренд: УчЛист (см. docs/BRAND.md). Прод-домен после регистрации: uchlist.ru."

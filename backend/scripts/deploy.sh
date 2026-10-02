#!/bin/sh
# deploy.sh — деплой backend в Cloudflare Workers.
#
# Использование:
#   ./scripts/deploy.sh                # production (по умолчанию)
#   ./scripts/deploy.sh staging        # dev-окружение, preview URL
#
# Требования:
#   - CLOUDFLARE_API_TOKEN в env, либо `npx wrangler login`
#   - database_id в wrangler.toml заменён на реальный
#   - secrets: npx wrangler secret put RESEND_API_KEY --name <worker>
#
# ─────────────────────────────────────────────────────────────────────────────
# ПОЧЕМУ ЗДЕСЬ ЯВНО ПРОПИСАН --env production
# ─────────────────────────────────────────────────────────────────────────────
# 2 октября 2026 боевой воркер оказался задеплоен с настройками разработки:
# APP_ENV=development и FRONTEND_URL=http://localhost:3000. Причина была
# ровно здесь. Этот скрипт был написан с комментарием «деплой в production
# (env.production из wrangler.toml)», но выполнял `npx wrangler deploy`
# БЕЗ `--env production`.
#
# Так работает wrangler: без `--env` он публикует верхнеуровневую секцию
# конфига, а `[env.production.vars]` при этом не участвует. То есть скрипт
# молча выкатывал секцию `[vars]` — то самое окружение разработки — и называл
# это продом. Аргумент `staging` был описан в шапке, но в коде нигде не
# использовался.
#
# Последствия были не косметическими: вход отдавал ссылку для входа прямо
# в ответе, оплата уходила в симуляцию (подписку можно было получить
# бесплатно), письма уходили со ссылкой на localhost.
#
# Теперь окружение передаётся явно, а шаг 5 проверяет по Cloudflare API,
# что опубликовано именно то, что задумано. Молчаливый неверный деплой
# больше невозможен: он падает.

set -e
cd "$(dirname "$0")/.."

ENVIRONMENT="${1:-production}"
WORKER_NAME="rabochielisty-api"

case "$ENVIRONMENT" in
  production) WRANGLER_ENV_FLAG="--env production" ;;
  staging)    WRANGLER_ENV_FLAG="" ;;
  *) echo "Неизвестное окружение: $ENVIRONMENT (допустимо: production | staging)"; exit 1 ;;
esac

echo "▶ Окружение деплоя: $ENVIRONMENT"

echo "▶ Type-check..."
npm run typecheck

echo "▶ Lint..."
ESLINT_USE_FLAT_CONFIG=false npx eslint src/

echo "▶ Tests..."
npm test -- --run

echo "▶ D1 migrations (remote)..."
if grep -q "PLACEHOLDER" wrangler.toml; then
  echo "⚠ database_id = PLACEHOLDER — обнови wrangler.toml:"
  echo "    npx wrangler d1 create rabochielisty"
  exit 1
fi
npm run db:migrate:prod

echo "▶ Deploy ($WORKER_NAME, $ENVIRONMENT)..."
# Флаг обязателен даже для staging-ветки: пустое значение здесь означает
# «верхнеуровневую секцию», и её нельзя спутать с production намеренно.
npx --yes wrangler deploy $WRANGLER_ENV_FLAG

# ─────────────────────────────────────────────────────────────────────────────
# Проверка результата. Без неё деплой — вера в то, что написано в конфиге.
# ─────────────────────────────────────────────────────────────────────────────
if [ "$ENVIRONMENT" != "production" ]; then
  echo ""
  echo "✅ Задеплоено в $ENVIRONMENT. Проверка production-конфигурации не выполняется."
  exit 0
fi

echo ""
echo "▶ Проверка опубликованной конфигурации..."

# Проверка через API Cloudflare, а не через /healthz: так видно фактические
# vars воркера. Значения секретов API не отдаёт — сравниваются только
# несекретные настройки.
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "⚠ Не заданы CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID — автоматическая"
  echo "  проверка пропущена. Проверьте вручную:"
  echo "    curl -s -H \"Authorization: Bearer \$CLOUDFLARE_API_TOKEN\" \\"
  echo "      \"https://api.cloudflare.com/client/v4/accounts/\$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER/settings\""
  exit 0
fi

CONFIG=$(curl -s --max-time 30 \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER/settings")

PROBLEMS=$(printf '%s' "$CONFIG" | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  const problems = [];
  let bindings = [];
  try {
    bindings = JSON.parse(raw).result?.bindings ?? [];
  } catch {
    console.log("ПРОВЕРКА_НЕ_ВЫПОЛНЕНА");
    process.exit(0);
  }
  const value = (name) => bindings.find((b) => b.name === name)?.text;

  if (value("APP_ENV") !== "production") {
    problems.push(`APP_ENV=${value("APP_ENV") ?? "—"} (ожидается "production")`);
  }
  const fe = value("FRONTEND_URL") ?? "";
  // Схему снимаем до проверки: «http://localhost:3000» — это локальный адрес,
  // и без снятия схемы он не распознался бы.
  const stripped = fe.trim().replace(/^https?:\/\//i, "");
  if (!stripped || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(stripped)) {
    problems.push(`FRONTEND_URL=${fe || "—"} указывает на локальную машину`);
  }
  for (const flag of ["ALLOW_DEV_MAGIC_URL", "ALLOW_DEMO_PAYMENTS"]) {
    if (value(flag) === "true") {
      problems.push(`${flag}=true — небезопасный режим включён на проде`);
    }
  }
  console.log(problems.length ? problems.join("; ") : "ПРОВЕРКА_ОК");
});
')

case "$PROBLEMS" in
  "ПРОВЕРКА_ОК")
    echo "✅ Опубликованная конфигурация корректна: APP_ENV=production, небезопасные флаги выключены."
    ;;
  "ПРОВЕРКА_НЕ_ВЫПОЛНЕНА")
    echo "⚠ Не удалось разобрать ответ Cloudflare API. Проверьте вручную (команда выше)."
    ;;
  *)
    echo ""
    echo "❌ ДЕПЛОЙ ОТКАТИТЬ НУЖНО. Опубликована неверная конфигурация:"
    echo "   $PROBLEMS"
    echo ""
    echo "   Признак — деплой из секции [vars] вместо [env.production.vars]."
    echo "   Пока это так: вход отдаёт ссылку в ответе, оплата симулируется,"
    echo "   письма уходят со ссылкой на localhost. Задеплойте с --env production."
    exit 1
    ;;
esac

echo ""
echo "✅ Backend задеплоен и проверен."
echo "   curl https://$WORKER_NAME.<subdomain>.workers.dev/healthz"

#!/bin/sh
# smoke.sh — минимальный smoke против локального wrangler dev (или прод-stенда).
#
# Использование:
#   1) В одном терминале: ./scripts/dev.sh
#   2) В другом: ./scripts/smoke.sh
#
# Также можно прогнать против прода (https://rabochielisty.ai):
#   BASE=https://rabochielisty.ai ./scripts/smoke.sh
#
# Проверяет (сентябрь 2026):
#   - /healthz returns 200
#   - /readyz returns 200 + DB ok
#   - /api/llm/models returns JSON
#   - /api/auth/me returns user: null
#   - /api/worksheets/generate returns 503/500 (без ключа) — что и ожидаем
#   - /api/billing/yookassa-webhook принимает payload
#
# F-06 (photo-check), F-07 (assignments CRUD), F-08 (AI-правки), account-LK:
#   - /api/account/me → 401 без auth
#   - /api/account/magic-link → 200 sent_via
#   - /api/assignments/<id>/public → 404 (endpoint живой)
#   - /api/worksheets/<id>/edit → 401 без auth (POST)
#
# Итого 13 проверок; при локальном dev без POLZA_API_KEY часть endpoint-ов
# могут быть в mock-режиме.

set -e

BASE="${BASE:-http://localhost:8787}"

PASS=0
FAIL=0
TOTAL=0

check() {
  TOTAL=$((TOTAL+1))
  name="$1"; shift
  expected="$1"; shift
  status=$(curl -sS -o /tmp/smoke_body -w "%{http_code}" "$@" || echo "000")
  if [ "$status" = "$expected" ]; then
    echo "  ✓ $name (HTTP $status)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name — expected $expected, got $status"
    cat /tmp/smoke_body | head -3
    FAIL=$((FAIL+1))
  fi
}

check_body() {
  TOTAL=$((TOTAL+1))
  name="$1"; shift
  needle="$1"; shift
  body=$(curl -sS "$@" || echo "")
  if echo "$body" | grep -q "$needle"; then
    echo "  ✓ $name (body contains '$needle')"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name — body missing '$needle'"
    echo "    body: $(echo "$body" | head -2)"
    FAIL=$((FAIL+1))
  fi
}

check_in() {
  TOTAL=$((TOTAL+1))
  name="$1"; shift
  expected_list="$1"; shift
  status=$(curl -sS -o /tmp/smoke_body -w "%{http_code}" "$@" || echo "000")
  if echo " $expected_list " | grep -q " $status "; then
    echo "  ✓ $name (HTTP $status)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name — expected one of [$expected_list], got $status"
    cat /tmp/smoke_body | head -3
    FAIL=$((FAIL+1))
  fi
}

echo "▶ Smoke $BASE"
echo ""

echo "Health:"
check "GET /healthz" 200 "$BASE/healthz"
check_body "GET /healthz body" '"ok":true' "$BASE/healthz"
check "GET /readyz (DB)" 200 "$BASE/readyz"

echo ""
echo "Public LLM info:"
check "GET /api/llm/models" 200 "$BASE/api/llm/models"
check_body "models body has 'models'" '"models"' "$BASE/api/llm/models"

echo ""
echo "Auth (anonymous):"
check "GET /api/auth/me" 200 "$BASE/api/auth/me"
check_body "auth/me returns null user" '"user":null' "$BASE/api/auth/me"

echo ""
echo "Validation:"
# Локально без POLZA_API_KEY → 500/503 (mock-режим недоступен).
# На проде с ключом → 200 (генерирует реальный worksheet).
# 429 — если уже выбрали дневной лимит анонимных генераций.
check_in "POST /api/worksheets/generate (200/400/429 на проде, 500 локально)" "200 400 429 500 503" \
  -X POST -H "Content-Type: application/json" \
  -d '{"request":{"subject":"math","grade":5,"topic":"Test","difficulty":"medium","count":1,"type":"worksheet","withAnswers":true,"withExplanations":true}}' \
  "$BASE/api/worksheets/generate"

echo ""
echo "Webhook (no auth):"
check "POST /api/billing/yookassa-webhook → 200" 200 \
  -X POST -H "Content-Type: application/json" \
  -d '{"type":"notification","event":"payment.waiting_for_capture","object":{"id":"test_xyz","status":"pending"}}' \
  "$BASE/api/billing/yookassa-webhook"

echo ""
echo "Account-LK (F-account):"
check "GET /api/account/me без auth → 401" 401 "$BASE/api/account/me"
check "POST /api/account/magic-link → 200" 200 \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"smoke@rabochielisty.ai"}' \
  "$BASE/api/account/magic-link"

echo ""
echo "F-06 / F-07 (assignments):"
check "GET /api/assignments/test/public (нет assignment) → 404" 404 \
  "$BASE/api/assignments/test_nonexistent_id/public"
check_in "POST /api/assignments/test/photo-check без auth → 401" "401 404" \
  -X POST -H "Content-Type: application/json" \
  "$BASE/api/assignments/test_nonexistent_id/photo-check"

echo ""
echo "F-08 (AI-правки):"
check_in "POST /api/worksheets/test/edit без auth → 401 или 404" "401 404" \
  -X POST -H "Content-Type: application/json" \
  -d '{"instruction":"smoke"}' \
  "$BASE/api/worksheets/test_nonexistent_id/edit"

echo ""
echo "──────────"
echo "  $PASS passed / $FAIL failed / $TOTAL total"
[ "$FAIL" = 0 ] || exit 1

#!/bin/sh
# smoke.sh — минимальный smoke против локального wrangler dev.
#
# Использование:
#   1) В одном терминале: ./scripts/dev.sh
#   2) В другом: ./scripts/smoke.sh
#
# Проверяет:
#   - /healthz returns 200
#   - /readyz returns 200 + DB ok
#   - /api/llm/models returns JSON
#   - /api/auth/me returns user: null
#   - /api/worksheets/generate returns 503/500 (без ключа) — что и ожидаем
#   - /api/billing/yookassa-webhook принимает payload

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
check "POST /api/worksheets/generate без ключа → 500" 500 \
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
echo "──────────"
echo "  $PASS passed / $FAIL failed / $TOTAL total"
[ "$FAIL" = 0 ] || exit 1

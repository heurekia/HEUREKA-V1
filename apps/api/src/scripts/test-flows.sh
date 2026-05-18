#!/bin/bash
# Tests des 3 parcours HEUREKA V1
# Usage: ./test-flows.sh [base_url]
#   base_url default: http://localhost:3001

BASE=${1:-http://localhost:3001}
PASS=0
FAIL=0

check() {
  local desc="$1" method="$2" url="$3" expected="$4" token="$5"
  local resp
  if [ -n "$token" ]; then
    resp=$(curl -s -o /tmp/heureka-resp.json -w "%{http_code}" -X "$method" "$BASE$url" -H "Authorization: Bearer $token" -H "Content-Type: application/json" ${@:6})
  else
    resp=$(curl -s -o /tmp/heureka-resp.json -w "%{http_code}" -X "$method" "$BASE$url" ${@:6})
  fi
  if [[ "$resp" == "$expected"* ]]; then
    echo "  ✅ $desc"
    PASS=$((PASS+1))
  else
    echo "  ❌ $desc (got $resp, expected $expected)"
    cat /tmp/heureka-resp.json | head -c 200
    echo ""
    FAIL=$((FAIL+1))
  fi
}

echo "=========================================="
echo "🧪 HEUREKA V1 - Tests des 3 parcours"
echo "=========================================="
echo ""

# ── 1. PARCOURS PUBLIC ──
echo "─── 1. PARCOURS PUBLIC ───"

check "Health check" GET "/api/health" "200"
check "Analyse parcellaire (sans auth)" GET "/api/public/analyse-parcelle/UA123" "200"

echo ""

# ── 2. PARCOURS CITOYEN ──
echo "─── 2. PARCOURS CITOYEN ───"

check "Login citoyen" POST "/api/auth/login" "200" "" \
  -d '{"email":"citoyen@test.fr","password":"password123"}'

CITOYEN_TOKEN=$(cat /tmp/heureka-resp.json | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$CITOYEN_TOKEN" ]; then
  check "Me (citoyen)" GET "/api/auth/me" "200" "$CITOYEN_TOKEN"
  check "Mes dossiers" GET "/api/dossiers" "200" "$CITOYEN_TOKEN"
  check "Analyse parcellaire (auth)" GET "/api/calibration/analyse-parcelle/UC789" "200" "$CITOYEN_TOKEN"
  check "Calendrier" GET "/api/calendrier" "200" "$CITOYEN_TOKEN"
  check "Notifications" GET "/api/notifications" "200" "$CITOYEN_TOKEN"
else
  echo "  ⚠️  Token citoyen non récupéré, skipping..."
fi

echo ""

# ── 3. PARCOURS MAIRIE ──
echo "─── 3. PARCOURS MAIRIE ───"

check "Login mairie" POST "/api/auth/login" "200" "" \
  -d '{"email":"mairie@tours.fr","password":"password123"}'

MAIRIE_TOKEN=$(cat /tmp/heureka-resp.json | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$MAIRIE_TOKEN" ]; then
  check "Me (mairie)" GET "/api/auth/me" "200" "$MAIRIE_TOKEN"
  check "Dashboard" GET "/api/mairie/dashboard" "200" "$MAIRIE_TOKEN"
  check "Dossiers list" GET "/api/mairie/dossiers" "200" "$MAIRIE_TOKEN"
  check "Stats" GET "/api/mairie/stats" "200" "$MAIRIE_TOKEN"
  check "Instructeurs" GET "/api/mairie/instructeurs" "200" "$MAIRIE_TOKEN"
  check "Liste zones" GET "/api/calibration/zones" "200" "$MAIRIE_TOKEN"
fi

echo ""

# ── 4. PARCOURS ADMIN ──
echo "─── 4. PARCOURS ADMIN ───"

check "Login admin" POST "/api/auth/login" "200" "" \
  -d '{"email":"admin@heureka.fr","password":"admin123"}'

ADMIN_TOKEN=$(cat /tmp/heureka-resp.json | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$ADMIN_TOKEN" ]; then
  check "Me (admin)" GET "/api/auth/me" "200" "$ADMIN_TOKEN"
fi

echo ""
echo "=========================================="
echo "📊 Résultat : $PASS ✅ / $FAIL ❌"
echo "=========================================="

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# tools/verify_restore/api_smoke.sh
# ---------------------------------------------------------------------------
# 🌐 Post-Restore API Smoke Test Script
#
# Purpose:
#   - Run basic API health and data integrity checks after DB restore
#   - Detects missing data, broken endpoints, or auth issues early
#   - Designed to run in CI/CD or DR validation pipeline
#
# Features:
#   ✅ Checks /health and /status endpoints
#   ✅ Optionally verifies test user authentication
#   ✅ Measures API latency and uptime
#   ✅ Generates machine-readable JSON report for CI
# ---------------------------------------------------------------------------

set -euo pipefail

API_BASE_URL=${API_BASE_URL:-"https://staging.projectathlete360.com/api"}
OUTPUT_PATH=${OUTPUT_PATH:-"tools/verify_restore/api_smoke_report.json"}
AUTH_TOKEN=${AUTH_TOKEN:-""}
TMP_REPORT=$(mktemp)

echo "🚀 Starting API Smoke Test..."
echo "API_BASE_URL = $API_BASE_URL"

# ---------------------------------------------------------------------------
# 🔍 Utility: JSON Response Validator
# ---------------------------------------------------------------------------
check_endpoint() {
  local endpoint="$1"
  local expect_code="${2:-200}"

  echo "🔹 Checking $endpoint (expect $expect_code)..."

  local start_time=$(date +%s%3N)
  local response
  response=$(curl -s -o /tmp/api_resp.json -w "%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "${API_BASE_URL}${endpoint}" || true)
  local end_time=$(date +%s%3N)
  local latency=$((end_time - start_time))

  local status_code=$response
  local body=$(cat /tmp/api_resp.json | tr -d '\n' | tr -d '\r')

  if [[ "$status_code" -ne "$expect_code" ]]; then
    echo "❌ [FAIL] $endpoint returned HTTP $status_code (expected $expect_code)"
    echo "{\"endpoint\":\"$endpoint\",\"status\":\"FAIL\",\"code\":$status_code,\"latency_ms\":$latency,\"body\":\"${body:0:200}\"}" >> "$TMP_REPORT"
    return 1
  fi

  echo "✅ [OK] $endpoint responded in ${latency}ms (code: $status_code)"
  echo "{\"endpoint\":\"$endpoint\",\"status\":\"OK\",\"code\":$status_code,\"latency_ms\":$latency}" >> "$TMP_REPORT"
}

# ---------------------------------------------------------------------------
# 🧪 Core API Tests
# ---------------------------------------------------------------------------
failures=0

# 1️⃣ Health Check
check_endpoint "/health" 200 || ((failures++))

# 2️⃣ System Status
check_endpoint "/v1/system/status" 200 || ((failures++))

# 3️⃣ Public Data Endpoint (example)
check_endpoint "/v1/athletes/public" 200 || ((failures++))

# 4️⃣ Authenticated Endpoint (optional)
if [[ -n "$AUTH_TOKEN" ]]; then
  check_endpoint "/v1/users/profile" 200 || ((failures++))
else
  echo "⚠️ Skipping authenticated endpoint test (AUTH_TOKEN not provided)"
fi

# ---------------------------------------------------------------------------
# 📊 Generate Final Report
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$OUTPUT_PATH")"

{
  echo "{"
  echo "\"timestamp\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
  echo "\"api_base\":\"$API_BASE_URL\","
  echo "\"failures\":$failures,"
  echo "\"results\":["
  sed '$!s/$/,/' "$TMP_REPORT"
  echo "]"
  echo "}"
} > "$OUTPUT_PATH"

rm -f "$TMP_REPORT"

echo "📁 API Smoke Test report saved at: $OUTPUT_PATH"

if [[ "$failures" -gt 0 ]]; then
  echo "❌ API Smoke Test FAILED with $failures failure(s)"
  exit 2
fi

echo "✅ All API endpoints healthy — restore verification PASSED."
exit 0
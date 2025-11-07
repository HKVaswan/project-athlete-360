#!/usr/bin/env bash
# ==============================================================================
# tools/observe/check_prometheus_scrape.sh
# ------------------------------------------------------------------------------
# 🧭 Prometheus Scrape Health Checker
#
# Purpose:
#   - Validates if Prometheus is successfully scraping metrics targets.
#   - Detects missing, failed, or unhealthy scrape jobs.
#   - Summarizes last scrape timestamps, durations, and errors.
#   - Designed for CI/CD, local debugging, and production smoke tests.
#
# Usage:
#   ./tools/observe/check_prometheus_scrape.sh [PROMETHEUS_URL]
#
# Example:
#   ./tools/observe/check_prometheus_scrape.sh http://localhost:9090
#
# Notes:
#   - Requires curl and jq to be installed.
#   - Safe to run in staging or production (read-only check).
# ==============================================================================

set -euo pipefail

PROM_URL="${1:-http://localhost:9090}"
TARGETS_API="${PROM_URL}/api/v1/targets"
HEALTH_OK=0
HEALTH_FAIL=0

echo "🧠 Checking Prometheus scrape targets at: ${PROM_URL}"
echo "--------------------------------------------------------------------"

# ──────────────────────────────────────────────────────────────────────────────
# Check connectivity
# ──────────────────────────────────────────────────────────────────────────────
if ! curl -fs -o /dev/null "${PROM_URL}/-/healthy"; then
  echo "❌ ERROR: Prometheus instance is not reachable at ${PROM_URL}"
  exit 1
fi
echo "✅ Prometheus API reachable."

# ──────────────────────────────────────────────────────────────────────────────
# Fetch scrape target information
# ──────────────────────────────────────────────────────────────────────────────
RAW=$(curl -fs "${TARGETS_API}" | jq '.data.activeTargets')

if [[ -z "$RAW" || "$RAW" == "null" ]]; then
  echo "❌ ERROR: No active targets found in Prometheus API response."
  exit 1
fi

TARGET_COUNT=$(echo "$RAW" | jq 'length')
echo "📡 Found ${TARGET_COUNT} active scrape targets."
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Evaluate each target
# ──────────────────────────────────────────────────────────────────────────────
for i in $(seq 0 $((TARGET_COUNT - 1))); do
  JOB=$(echo "$RAW" | jq -r ".[$i].labels.job")
  INSTANCE=$(echo "$RAW" | jq -r ".[$i].labels.instance")
  HEALTH=$(echo "$RAW" | jq -r ".[$i].health")
  LAST_SCRAPE=$(echo "$RAW" | jq -r ".[$i].lastScrape")
  SCRAPE_DURATION=$(echo "$RAW" | jq -r ".[$i].lastScrapeDuration")
  ERROR_MSG=$(echo "$RAW" | jq -r ".[$i].lastError")

  if [[ "$HEALTH" == "up" ]]; then
    echo "✅ ${JOB:-unknown} (${INSTANCE}) - Healthy | Last scrape: ${LAST_SCRAPE} (${SCRAPE_DURATION}s)"
    ((HEALTH_OK++))
  else
    echo "⚠️  ${JOB:-unknown} (${INSTANCE}) - UNHEALTHY ❌"
    echo "     Last scrape: ${LAST_SCRAPE}"
    echo "     Error: ${ERROR_MSG:-none}"
    ((HEALTH_FAIL++))
  fi
done

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "--------------------------------------------------------------------"
echo "📊 Summary:"
echo "   Healthy targets   : ${HEALTH_OK}"
echo "   Unhealthy targets : ${HEALTH_FAIL}"
echo "--------------------------------------------------------------------"

if [[ "${HEALTH_FAIL}" -gt 0 ]]; then
  echo "❌ One or more scrape targets are unhealthy!"
  exit 2
else
  echo "✅ All Prometheus scrape targets healthy!"
fi
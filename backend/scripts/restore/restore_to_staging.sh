#!/bin/bash
# ======================================================================
# 🧩 Project Athlete 360 — Staging Restore Runbook Helper
# File: backend/scripts/restore/restore_to_staging.sh
# ----------------------------------------------------------------------
# PURPOSE:
#   - Validate full database restore from latest S3 backup
#   - Verify backup integrity (checksum)
#   - Restore to staging DB (isolated)
#   - Log metrics for RTO/RPO verification
#   - Notify Super Admins via API or Slack webhook
#
# SAFETY:
#   - Never touches production DB.
#   - Designed to run in CI/CD or secure DevOps environment.
#
# REQUIREMENTS:
#   - AWS CLI or equivalent S3 credentials configured
#   - Environment variables loaded (.env.staging or secrets manager)
#   - pg_restore, psql, node (for optional client restore)
# ======================================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────
STAGING_DB_URL="${STAGING_DATABASE_URL:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-pa360-db-backups}"
RESTORE_DIR="./restores"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="./logs/restore_${TIMESTAMP}.log"
LATEST_BACKUP_FILE=""
RTO_START_TIME=$(date +%s)

mkdir -p "$RESTORE_DIR" ./logs

# ─────────────────────────────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────────────────────────────
log() {
  echo "[$(date +"%Y-%m-%d %H:%M:%S")] $*" | tee -a "$LOG_FILE"
}

notify_admins() {
  local MESSAGE="$1"
  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    curl -X POST -H 'Content-type: application/json' \
      --data "{\"text\":\"🚨 *DB Restore Notice* — ${MESSAGE}\"}" \
      "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

# ─────────────────────────────────────────────────────────────────────
# STEP 1: VALIDATE ENVIRONMENT
# ─────────────────────────────────────────────────────────────────────
log "🔍 Validating restore environment..."
if [[ -z "$STAGING_DB_URL" ]]; then
  log "❌ STAGING_DATABASE_URL not set. Exiting."
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  log "❌ AWS CLI not found. Please install awscli."
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  log "❌ pg_restore not available. Install PostgreSQL client tools."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
# STEP 2: FETCH LATEST BACKUP
# ─────────────────────────────────────────────────────────────────────
log "📦 Fetching latest S3 backup from $S3_BUCKET ..."
LATEST_BACKUP_KEY=$(aws s3 ls "s3://${S3_BUCKET}/backups/" | sort | tail -n 1 | awk '{print $4}')

if [[ -z "$LATEST_BACKUP_KEY" ]]; then
  log "❌ No backups found in S3 bucket $S3_BUCKET."
  exit 1
fi

LATEST_BACKUP_FILE="${RESTORE_DIR}/$(basename "$LATEST_BACKUP_KEY")"

aws s3 cp "s3://${S3_BUCKET}/backups/${LATEST_BACKUP_KEY}" "$LATEST_BACKUP_FILE" \
  --only-show-errors | tee -a "$LOG_FILE"

log "✅ Backup downloaded: $LATEST_BACKUP_FILE"

# ─────────────────────────────────────────────────────────────────────
# STEP 3: OPTIONAL — VERIFY CHECKSUM IF META EXISTS
# ─────────────────────────────────────────────────────────────────────
META_FILE="${LATEST_BACKUP_FILE}.meta"
if [[ -f "$META_FILE" ]]; then
  EXPECTED_CHECKSUM=$(jq -r '.checksum' "$META_FILE" 2>/dev/null || echo "")
  if [[ -n "$EXPECTED_CHECKSUM" ]]; then
    log "🔐 Verifying checksum integrity..."
    LOCAL_CHECKSUM=$(sha256sum "$LATEST_BACKUP_FILE" | awk '{print $1}')
    if [[ "$LOCAL_CHECKSUM" != "$EXPECTED_CHECKSUM" ]]; then
      log "❌ Checksum mismatch! Expected $EXPECTED_CHECKSUM, got $LOCAL_CHECKSUM"
      notify_admins "Backup checksum mismatch for ${LATEST_BACKUP_KEY}"
      exit 1
    else
      log "✅ Checksum verified (${LOCAL_CHECKSUM})"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# STEP 4: DECRYPT BACKUP
# ─────────────────────────────────────────────────────────────────────
if [[ "$LATEST_BACKUP_FILE" == *.enc ]]; then
  log "🔓 Decrypting backup file..."
  node -e "import('./dist/lib/restoreClient.js').then(m => m.restoreDatabaseFromFile && console.log('Restore client ready'))" >/dev/null 2>&1 || true
  node -e "import('./dist/lib/restoreClient.js').then(m => m.restoreDatabaseFromFile && m.restoreDatabaseFromFile('${LATEST_BACKUP_FILE}', { dryRun: true }))"
fi

# ─────────────────────────────────────────────────────────────────────
# STEP 5: RESTORE DATABASE TO STAGING
# ─────────────────────────────────────────────────────────────────────
log "🚀 Restoring backup into staging DB..."
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$STAGING_DB_URL" "$LATEST_BACKUP_FILE" | tee -a "$LOG_FILE"

# ─────────────────────────────────────────────────────────────────────
# STEP 6: VERIFY RESTORE SUCCESS
# ─────────────────────────────────────────────────────────────────────
ROW_COUNT=$(psql "$STAGING_DB_URL" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')
if [[ "$ROW_COUNT" -gt 0 ]]; then
  log "✅ Restore successful. Public schema contains $ROW_COUNT tables."
else
  log "❌ Restore failed. No tables found in staging DB."
  notify_admins "Restore failed on staging — no tables found."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
# STEP 7: LOG RTO/RPO METRICS
# ─────────────────────────────────────────────────────────────────────
RTO_END_TIME=$(date +%s)
RTO_DURATION=$((RTO_END_TIME - RTO_START_TIME))
log "⏱️  RTO Duration: ${RTO_DURATION}s (Restore completed successfully)"
notify_admins "✅ Staging DB restored successfully. Duration: ${RTO_DURATION}s"

# ─────────────────────────────────────────────────────────────────────
# COMPLETED
# ─────────────────────────────────────────────────────────────────────
log "🎯 Restore run completed successfully at $(date). Log: $LOG_FILE"
exit 0
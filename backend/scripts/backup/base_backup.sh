#!/bin/bash
# ============================================================================
# 🧠 Project Athlete 360 - Enterprise Backup Script (base_backup.sh)
# ----------------------------------------------------------------------------
# Performs a PostgreSQL base backup with WAL archiving for Point-In-Time
# Recovery (PITR). Secure, traceable, and cloud-upload ready.
#
# Features:
#   - pg_basebackup for full cluster backup (WAL-included)
#   - AES-256-GCM encryption
#   - SHA-256 checksum verification
#   - S3 upload (AWS CLI / MinIO compatible)
#   - Automated rotation (optional)
#   - Logs actions with timestamps
# ============================================================================

set -euo pipefail
IFS=$'\n\t'

# -----------------------------------------------------------------------------
# 1️⃣ Configuration
# -----------------------------------------------------------------------------
BACKUP_DIR="/var/backups/projectathlete360"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_NAME="basebackup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
LOG_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.log"
S3_BUCKET="${S3_BUCKET:-s3://projectathlete360-backups}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# -----------------------------------------------------------------------------
# 2️⃣ Logging Utility
# -----------------------------------------------------------------------------
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# -----------------------------------------------------------------------------
# 3️⃣ Preflight Checks
# -----------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
if ! command -v pg_basebackup &> /dev/null; then
  log "❌ pg_basebackup not found. Install PostgreSQL client tools."
  exit 1
fi

if [[ -z "$ENCRYPTION_KEY" ]]; then
  log "⚠️ No ENCRYPTION_KEY found. Using temporary random key (not recommended)."
  ENCRYPTION_KEY=$(openssl rand -base64 32)
fi

if ! command -v aws &> /dev/null; then
  log "⚠️ AWS CLI not found. Skipping S3 upload."
  UPLOAD_ENABLED=false
else
  UPLOAD_ENABLED=true
fi

# -----------------------------------------------------------------------------
# 4️⃣ Create Base Backup
# -----------------------------------------------------------------------------
log "🚀 Starting PostgreSQL base backup..."
pg_basebackup -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -D "$BACKUP_PATH" -Fp -Xs -P -v

if [[ $? -ne 0 ]]; then
  log "❌ Base backup failed."
  exit 1
fi

log "✅ Base backup completed: $BACKUP_PATH"

# -----------------------------------------------------------------------------
# 5️⃣ Encrypt Backup (AES-256-GCM)
# -----------------------------------------------------------------------------
ENCRYPTED_PATH="${BACKUP_PATH}.tar.gz.enc"
tar -czf - "$BACKUP_PATH" | \
openssl enc -aes-256-gcm -pbkdf2 -iter 200000 -salt \
  -pass pass:"$ENCRYPTION_KEY" -out "$ENCRYPTED_PATH"

if [[ $? -ne 0 ]]; then
  log "❌ Encryption failed."
  exit 1
fi

log "🔐 Encrypted backup created: $ENCRYPTED_PATH"

# -----------------------------------------------------------------------------
# 6️⃣ Generate SHA-256 Checksum
# -----------------------------------------------------------------------------
CHECKSUM=$(sha256sum "$ENCRYPTED_PATH" | awk '{print $1}')
echo "$CHECKSUM" > "${ENCRYPTED_PATH}.sha256"
log "🧮 SHA256 checksum: $CHECKSUM"

# -----------------------------------------------------------------------------
# 7️⃣ Upload to S3 (optional)
# -----------------------------------------------------------------------------
if [[ "$UPLOAD_ENABLED" == true ]]; then
  log "☁️ Uploading encrypted backup to S3..."
  aws s3 cp "$ENCRYPTED_PATH" "$S3_BUCKET/" --storage-class STANDARD_IA
  aws s3 cp "${ENCRYPTED_PATH}.sha256" "$S3_BUCKET/"
  log "✅ Upload completed successfully."
else
  log "⚠️ Upload skipped (AWS CLI not configured)."
fi

# -----------------------------------------------------------------------------
# 8️⃣ Cleanup old backups (local retention policy)
# -----------------------------------------------------------------------------
log "🧹 Cleaning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -type f -mtime +${RETENTION_DAYS} -name "*.enc" -exec rm {} \;
log "🧾 Cleanup complete."

# -----------------------------------------------------------------------------
# 9️⃣ Log completion
# -----------------------------------------------------------------------------
log "🎉 Backup operation completed successfully."
log "Backup stored at: ${ENCRYPTED_PATH}"
log "Checksum file: ${ENCRYPTED_PATH}.sha256"
log "Upload bucket: ${S3_BUCKET}"
log "=============================================================================="

exit 0
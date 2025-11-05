# 🧠 Backup & Restore Runbook  
**Document Version:** 1.0  
**Last Updated:** {{ date }}  
**Author:** Infrastructure Team – Project Athlete 360  

---

## 🎯 Objective

This runbook defines **standard operating procedures** (SOPs) for database and file backup, restoration, and disaster recovery (DR) for the Project Athlete 360 platform.

It ensures:

- Business continuity in case of critical data loss or infrastructure failure.  
- Verified recovery point (RPO) and recovery time (RTO) objectives.  
- Compliance with enterprise data protection, auditing, and operational reliability standards.

---

## 📚 Scope

This applies to:

- All PostgreSQL database instances (production, staging).  
- Encrypted S3 object backups (via backup workers).  
- WAL archive and point-in-time recovery (PITR) setup.  
- Application secrets (Vault/AWS Secrets Manager).  
- File storage buckets (user uploads, media).

---

## ⚙️ Key Components

| Component | Responsibility |
|------------|----------------|
| `src/lib/backupClient.ts` | Performs full PostgreSQL backup → encryption → upload |
| `src/lib/restoreClient.ts` | Securely decrypts & restores backups to DB |
| `src/lib/walArchiver.ts` | WAL log archiving for point-in-time recovery |
| `src/workers/backups/backup.worker.ts` | Automates recurring backups & S3 uploads |
| `src/services/backupMonitor.service.ts` | Monitors success, retention & checksum health |
| `scripts/backup/base_backup.sh` | System-level base backup via `pg_basebackup` |
| `infra/terraform/postgres_backups.tf` | Infrastructure configuration for backup buckets |
| `tests/e2e/backup_restore.spec.ts` | Automated test validating full backup→restore pipeline |

---

## 🧩 Backup Strategy

### 1. Full Database Backups
- **Frequency:** Daily at 02:00 UTC (via backup worker).  
- **Retention:** 7 days locally + 30 days on S3.  
- **Encryption:** AES-256-CBC using `BACKUP_ENCRYPTION_KEY`.  
- **Compression:** `.sql → .enc` before cloud upload.  
- **Integrity:** SHA-256 checksum verification post-upload.

### 2. Incremental Backups
- WAL (Write-Ahead Logs) archived every 15 minutes.  
- Enables **Point-In-Time Recovery (PITR)**.  
- Managed by `walArchiver.ts`.

### 3. Application & File Backups
- Media/uploads directory archived every 24 hours.  
- Uploaded to `s3://projectathlete360-backups/files/YYYY-MM-DD.zip`.

### 4. Secrets & Config
- Critical secrets managed by Vault/AWS Secrets Manager.  
- Rotated every 30–60 days via `rotateKeys.worker.ts`.

---

## 🧠 Restore Procedures

### ⚡ Emergency Database Restore (Production)

> **Use only during confirmed data corruption, accidental deletion, or DR event.**

#### Prerequisites
- Confirm Super Admin access.  
- `ALLOW_DB_RESTORE=true` set in environment.  
- Backup key (`s3Key`) known and verified.

#### Steps
1. **Login to Super Admin Panel → System → Restore**
   - Provide `s3Key` of backup (from S3 bucket).  
   - Confirm operation (`confirm=true`).

2. **Automated Flow:**
   - Downloads encrypted backup → decrypts → restores schema.  
   - Drops existing `public` schema → recreates fresh instance.  
   - Sends critical alerts + audit trail.

3. **Verification:**
   - Run smoke tests: user login, schema integrity checks.  
   - Validate app metrics and logs for restoration success.

#### Estimated Metrics:
| Metric | Target |
|---------|--------|
| RTO (Recovery Time Objective) | ≤ 30 minutes |
| RPO (Recovery Point Objective) | ≤ 15 minutes (via WAL) |

---

### 🧪 Staging Restore Test (Monthly)
Performed automatically by CI/CD job or manually by DevOps.

```bash
bash scripts/restore/restore_to_staging.sh s3://projectathlete360-backups/db/db-2025-11-01.enc
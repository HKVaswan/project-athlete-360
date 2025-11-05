# 🧩 Restore Verification & Readiness Checklist  
**Document Version:** 1.0  
**Last Updated:** {{ date }}  
**Owner:** Site Reliability Engineering (SRE) – Project Athlete 360  

---

## 🎯 Purpose

This checklist ensures **safe, validated, and compliant restore operations** for any Project Athlete 360 environment (Production, Staging, or Sandbox).  
It acts as a step-by-step validation before, during, and after any database or file restore to ensure **data integrity**, **minimal downtime**, and **security compliance**.

---

## ⚙️ Applicable Scenarios

- Database corruption or accidental data loss  
- Application misconfiguration or security compromise  
- Disaster Recovery (DR) testing or environment replication  
- Controlled restore in staging for investigation or validation  

---

## 🧭 PRE-RESTORE VALIDATION (MANDATORY)

| # | Validation Step | Description | Status |
|---|------------------|--------------|---------|
| 1️⃣ | ✅ **Admin Approval** | Super Admin or SRE Lead must authorize restore. Document ticket ID. | ☐ |
| 2️⃣ | 🔒 **Environment Freeze** | Lock writes to the target database (`READ ONLY MODE`). | ☐ |
| 3️⃣ | 🧠 **Backup Integrity Check** | Run checksum validation (`SHA-256`) on selected backup file. | ☐ |
| 4️⃣ | ☁️ **S3 Access Test** | Confirm `s3:GetObject` permission for target backup key. | ☐ |
| 5️⃣ | 🔑 **Encryption Key Availability** | Confirm valid `BACKUP_ENCRYPTION_KEY` and `MASTER_KEY` are available. | ☐ |
| 6️⃣ | 🧩 **Network Access** | Verify restore node can reach database and S3 endpoints. | ☐ |
| 7️⃣ | 🧾 **Audit Logging Enabled** | Confirm `audit.service` is online to record all restore actions. | ☐ |
| 8️⃣ | ⚡ **Resource Availability** | Ensure ≥ 30% disk space and stable memory before restore. | ☐ |

---

## 🚀 RESTORE EXECUTION CHECKLIST

| # | Task | Expected Output | Status |
|---|------|-----------------|---------|
| 1️⃣ | Run restore command or panel action | `Restore initiated` logged in system console | ☐ |
| 2️⃣ | Backup file downloaded | File size & checksum verified successfully | ☐ |
| 3️⃣ | Decryption successful | Output file `.sql` or `.tar` accessible | ☐ |
| 4️⃣ | Database schema recreated | Migration or `pg_restore` completed cleanly | ☐ |
| 5️⃣ | WAL logs applied (if available) | Point-In-Time recovery successful | ☐ |
| 6️⃣ | Restore verification script executed | Automated verification passes 100% | ☐ |
| 7️⃣ | Application restarted | Health endpoint returns HTTP 200 | ☐ |
| 8️⃣ | Super Admin alert sent | Confirmation message received in alert dashboard | ☐ |
| 9️⃣ | Audit log entry created | `RESTORE_EXECUTED` event visible in admin audit log | ☐ |

---

## 🧪 POST-RESTORE VALIDATION (CRITICAL)

| # | Validation | Description | Status |
|---|-------------|--------------|---------|
| 1️⃣ | Schema Integrity | Compare schema structure with reference (`pg_dump --schema-only`). | ☐ |
| 2️⃣ | Record Count Consistency | Table counts match the last backup report (±1% tolerance). | ☐ |
| 3️⃣ | User Authentication | Admin & sample user login successful. | ☐ |
| 4️⃣ | API Smoke Test | `/health`, `/auth/login`, `/data/metrics` return valid JSON responses. | ☐ |
| 5️⃣ | App Logs | No `ERROR` or `PANIC` entries in the first 5 minutes post-start. | ☐ |
| 6️⃣ | Audit Events | Restore actions recorded by `audit.service`. | ☐ |
| 7️⃣ | BackupMonitor Sync | Monitor recognizes restored dataset and updates metadata. | ☐ |
| 8️⃣ | External Integrations | Payments, emails, and external APIs connected successfully. | ☐ |

---

## 🧰 ROLLBACK PROCEDURE (IF RESTORE FAILS)

| Step | Action | Command/Notes |
|------|---------|----------------|
| 1️⃣ | Stop restore process immediately | `CTRL+C` or cancel job in queue |
| 2️⃣ | Restore from previous stable backup | `restoreClient --s3key=<previous_backup>` |
| 3️⃣ | Validate database integrity | Run `verify_backup_integrity.sql` |
| 4️⃣ | Re-enable read/write mode | After verification passes |
| 5️⃣ | Escalate to DevOps lead | File incident report & mark restore attempt failed |

---

## 🧾 VERIFICATION SCRIPT TEMPLATE

Example restore verification command:

```bash
# 1. Verify database accessibility
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"

# 2. Run checksum comparison
node scripts/verifyChecksum.js --file restored.sql --hash backup.sha256

# 3. Trigger internal consistency test
npm run test:e2e -- --grep "backup_restore"
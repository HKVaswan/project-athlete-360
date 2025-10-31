// src/lib/backupClient.ts
/**
 * Backup Client (Enterprise-Grade v2)
 * ---------------------------------------------------------
 *  - Secure PostgreSQL backups using pg_dump
 *  - AES-256-CBC encryption (IV + Salt via PBKDF2)
 *  - SHA256 checksum (stream-based for large files)
 *  - Retry mechanism for S3 uploads
 *  - Full backup + cleanup + notification pipeline
 *  - Super Admin alert integration
 *  - Unique job ID for traceability
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../logger";
import { config } from "../config";
import { uploadToS3 } from "./s3";
import { addNotificationJob } from "../workers/notification.worker";

const execAsync = promisify(exec);
const BACKUP_DIR = path.join(process.cwd(), "backups");

/* ─────────────────────────────── */
/* 🧱 Ensure backup directory exists */
/* ─────────────────────────────── */
const ensureBackupDir = () => {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    logger.info(`[BACKUP] 📁 Created directory: ${BACKUP_DIR}`);
  }
};

/* ─────────────────────────────── */
/* 🧮 Generate unique job + filename */
/* ─────────────────────────────── */
const generateBackupFilename = (prefix = "backup") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uuid = crypto.randomUUID().slice(0, 8);
  return `${prefix}-${timestamp}-${uuid}.sql`;
};

/* ─────────────────────────────── */
/* 🔢 Stream-based SHA256 checksum  */
/* ─────────────────────────────── */
const generateChecksum = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
};

/* ─────────────────────────────── */
/* 🔐 AES-256-CBC encryption (secure) */
/* ─────────────────────────────── */
const encryptFile = async (inputPath: string, password: string): Promise<string> => {
  const outputPath = `${inputPath}.enc`;
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);

  input.pipe(cipher).pipe(output);

  await new Promise((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
  });

  fs.writeFileSync(`${outputPath}.meta`, JSON.stringify({
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
  }));

  return outputPath;
};

/* ─────────────────────────────── */
/* 🔁 Retry utility for reliability */
/* ─────────────────────────────── */
const retryOperation = async (fn: Function, retries = 3, delayMs = 3000, label = "operation") => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === retries) throw err;
      logger.warn(`[BACKUP] Retry ${attempt}/${retries} for ${label}: ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
};

/* ─────────────────────────────── */
/* 💾 Create PostgreSQL backup     */
/* ─────────────────────────────── */
export const createDatabaseBackup = async (): Promise<string> => {
  ensureBackupDir();
  const jobId = crypto.randomUUID();
  const backupFile = path.join(BACKUP_DIR, generateBackupFilename("db"));

  try {
    const databaseUrl = config.databaseUrl;
    if (!databaseUrl) throw new Error("Database URL not found");

    const dbUrl = new URL(databaseUrl);
    const pgPassword = dbUrl.password;
    dbUrl.password = "";

    const cmd = `pg_dump --no-owner --no-privileges -Fc -f "${backupFile}" "${dbUrl.toString()}"`;
    await execAsync(cmd, {
      env: { ...process.env, PGPASSWORD: pgPassword },
    });

    logger.info(`[BACKUP:${jobId}] ✅ Created database backup at ${backupFile}`);
    return backupFile;
  } catch (err: any) {
    logger.error(`[BACKUP:${jobId}] ❌ Database backup failed: ${err.message}`);
    await addNotificationJob({
      type: "criticalAlert",
      title: "Database Backup Failure",
      message: `Backup failed: ${err.message}`,
      severity: "high",
    });
    throw new Error("Database backup failed");
  }
};

/* ─────────────────────────────── */
/* ☁️ Upload encrypted backup to S3 */
/* ─────────────────────────────── */
export const uploadBackupToCloud = async (backupPath: string) => {
  const jobId = crypto.randomUUID();
  try {
    const encryptionPassword = config.backupEncryptionKey || "default-key";
    const encryptedPath = await encryptFile(backupPath, encryptionPassword);
    const checksum = await generateChecksum(encryptedPath);
    const fileName = path.basename(encryptedPath);
    const fileStream = fs.createReadStream(encryptedPath);

    const result = await retryOperation(
      () => uploadToS3({
        key: `backups/${fileName}`,
        body: fileStream,
        contentType: "application/octet-stream",
        metadata: { checksum },
      }),
      3,
      5000,
      "S3 upload"
    );

    logger.info(`[BACKUP:${jobId}] ☁️ Uploaded encrypted backup: ${result.key}`);
    return { ...result, checksum };
  } catch (err: any) {
    logger.error(`[BACKUP:${jobId}] ❌ Cloud upload failed: ${err.message}`);
    await addNotificationJob({
      type: "criticalAlert",
      title: "Backup Upload Failure",
      message: `Cloud upload failed: ${err.message}`,
      severity: "high",
    });
    throw new Error("Cloud backup upload failed");
  }
};

/* ─────────────────────────────── */
/* 🧹 Clean up old local backups   */
/* ─────────────────────────────── */
export const cleanupOldBackups = async (retentionDays = 7) => {
  ensureBackupDir();
  const now = Date.now();
  let deletedCount = 0;

  try {
    const files = fs.readdirSync(BACKUP_DIR);
    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > retentionDays * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logger.info(`[BACKUP] 🧹 Deleted ${deletedCount} old backups`);
      await addNotificationJob({
        type: "info",
        title: "Old Backups Cleaned",
        message: `${deletedCount} backups deleted after ${retentionDays} days`,
      });
    }
  } catch (err: any) {
    logger.error(`[BACKUP] ⚠️ Cleanup failed: ${err.message}`);
  }
};

/* ─────────────────────────────── */
/* 🪄 Full backup pipeline         */
/* ─────────────────────────────── */
export const runFullBackup = async () => {
  const jobId = crypto.randomUUID();
  logger.info(`[BACKUP:${jobId}] 🚀 Starting full backup pipeline...`);
  try {
    const backupPath = await createDatabaseBackup();
    const cloudResult = await uploadBackupToCloud(backupPath);
    await cleanupOldBackups(7);

    await addNotificationJob({
      type: "info",
      title: "Database Backup Completed",
      message: `Backup uploaded: ${cloudResult.key}\nChecksum: ${cloudResult.checksum}`,
    });

    logger.info(`[BACKUP:${jobId}] ✅ Full backup completed successfully.`);
  } catch (err: any) {
    logger.error(`[BACKUP:${jobId}] ❌ Full backup failed: ${err.message}`);
    await addNotificationJob({
      type: "criticalAlert",
      title: "Backup Pipeline Failure",
      message: `Full backup failed: ${err.message}`,
      severity: "high",
    });
  }
};

/* ─────────────────────────────── */
/* 🧩 (Future) Super Admin Restore */
/* ─────────────────────────────── */
export const restoreDatabaseBackup = async (backupKey: string, adminUserRole?: string) => {
  if (adminUserRole !== "superadmin") {
    throw new Error("Unauthorized: Only Super Admins can restore backups.");
  }

  if (!process.env.ALLOW_DB_RESTORE) {
    throw new Error("Database restoration is disabled for safety.");
  }

  logger.warn(`[RESTORE] ⚠️ Restoration triggered for key: ${backupKey}`);
  // Future: download from S3, decrypt with stored salt/iv, then use pg_restore
  return { success: true, message: "Restore process initiated (placeholder)." };
};
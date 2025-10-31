// src/lib/backupClient.ts
/**
 * Backup Client (Enterprise-Grade)
 * ----------------------------------
 *  - Secure PostgreSQL backups using pg_dump
 *  - Local + Cloud (S3) backup pipeline
 *  - AES encryption + SHA256 checksum
 *  - Super Admin notifications on failure/success
 *  - Configurable retention
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
/* 🧮 Generate filename + checksum */
/* ─────────────────────────────── */
const generateBackupFilename = (prefix = "backup") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}.sql`;
};

const generateChecksum = (filePath: string): string => {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
};

/* ─────────────────────────────── */
/* 🔐 Optional AES-256 encryption   */
/* ─────────────────────────────── */
const encryptFile = (inputPath: string, password: string): string => {
  const outputPath = inputPath + ".enc";
  const cipher = crypto.createCipher("aes-256-cbc", password);
  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);
  input.pipe(cipher).pipe(output);
  return outputPath;
};

/* ─────────────────────────────── */
/* 💾 Create PostgreSQL backup     */
/* ─────────────────────────────── */
export const createDatabaseBackup = async (): Promise<string> => {
  ensureBackupDir();
  const backupFile = path.join(BACKUP_DIR, generateBackupFilename("db"));

  try {
    const databaseUrl = config.databaseUrl;
    if (!databaseUrl) throw new Error("Database URL not found");

    // Safer password handling (avoids leaking password via process list)
    const { PGPASSWORD, ...env } = process.env;
    const dbUrl = new URL(databaseUrl);
    const pgPassword = dbUrl.password;
    dbUrl.password = "";

    const cmd = `pg_dump --no-owner --no-privileges -Fc -f "${backupFile}" "${dbUrl.toString()}"`;

    await execAsync(cmd, {
      env: { ...env, PGPASSWORD: pgPassword },
    });

    logger.info(`[BACKUP] ✅ Created backup at ${backupFile}`);
    return backupFile;
  } catch (err: any) {
    logger.error(`[BACKUP] ❌ Database backup failed: ${err.message}`);
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
/* ☁️ Upload backup to S3 securely */
/* ─────────────────────────────── */
export const uploadBackupToCloud = async (backupPath: string) => {
  try {
    const encryptionPassword = config.backupEncryptionKey || "default-key";
    const encryptedPath = encryptFile(backupPath, encryptionPassword);

    const checksum = generateChecksum(encryptedPath);
    const fileName = path.basename(encryptedPath);
    const fileStream = fs.createReadStream(encryptedPath);

    const result = await uploadToS3({
      key: `backups/${fileName}`,
      body: fileStream,
      contentType: "application/octet-stream",
      metadata: { checksum },
    });

    logger.info(`[BACKUP] ☁️ Uploaded encrypted backup: ${result.key}`);
    return { ...result, checksum };
  } catch (err: any) {
    logger.error(`[BACKUP] ❌ Cloud upload failed: ${err.message}`);
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
        message: `${deletedCount} old backups deleted after ${retentionDays} days`,
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
  logger.info("[BACKUP] 🚀 Starting full backup pipeline...");
  try {
    const backupPath = await createDatabaseBackup();
    const cloudResult = await uploadBackupToCloud(backupPath);
    await cleanupOldBackups(7);

    await addNotificationJob({
      type: "info",
      title: "Database Backup Completed",
      message: `Backup uploaded: ${cloudResult.key}\nChecksum: ${cloudResult.checksum}`,
    });

    logger.info("[BACKUP] ✅ Full backup completed successfully.");
  } catch (err: any) {
    logger.error(`[BACKUP] ❌ Full backup failed: ${err.message}`);
    await addNotificationJob({
      type: "criticalAlert",
      title: "Backup Pipeline Failure",
      message: `Full backup failed: ${err.message}`,
      severity: "high",
    });
  }
};
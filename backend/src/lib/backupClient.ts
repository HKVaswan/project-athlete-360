import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../logger";
import { config } from "../config";
import { uploadToS3 } from "./s3";

const execAsync = promisify(exec);

/**
 * Default backup directory (local cache before cloud sync)
 */
const BACKUP_DIR = path.join(process.cwd(), "backups");

/**
 * Utility: ensure backup directory exists
 */
const ensureBackupDir = () => {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    logger.info(`[BACKUP] Created local backup directory at ${BACKUP_DIR}`);
  }
};

/**
 * Generate timestamped backup file name
 */
const generateBackupFilename = (prefix = "backup") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}.sql`;
};

/**
 * Perform PostgreSQL database backup using pg_dump
 * Works for both NeonDB / Supabase / RDS / Local Postgres.
 */
export const createDatabaseBackup = async (): Promise<string> => {
  ensureBackupDir();
  const backupFile = path.join(BACKUP_DIR, generateBackupFilename("db"));

  try {
    const databaseUrl = config.databaseUrl;
    if (!databaseUrl) throw new Error("Database URL not found in config.");

    const cmd = `pg_dump "${databaseUrl}" > "${backupFile}"`;
    await execAsync(cmd);

    logger.info(`[BACKUP] ✅ Database backup created at ${backupFile}`);
    return backupFile;
  } catch (err: any) {
    logger.error(`[BACKUP] ❌ Database backup failed: ${err.message}`);
    throw new Error("Database backup failed");
  }
};

/**
 * Uploads local backup file to S3 with encryption and retention policy
 */
export const uploadBackupToCloud = async (backupPath: string) => {
  try {
    const fileStream = fs.createReadStream(backupPath);
    const fileName = path.basename(backupPath);

    const result = await uploadToS3({
      key: `backups/${fileName}`,
      body: fileStream,
      contentType: "application/octet-stream",
    });

    logger.info(`[BACKUP] ☁️ Backup uploaded to S3: ${result.key}`);
    return result;
  } catch (err: any) {
    logger.error(`[BACKUP] ❌ Failed to upload backup to cloud: ${err.message}`);
    throw new Error("Cloud backup upload failed");
  }
};

/**
 * Cleanup local backups older than X days (default: 7)
 */
export const cleanupOldBackups = async (retentionDays = 7) => {
  ensureBackupDir();
  const now = Date.now();

  try {
    const files = fs.readdirSync(BACKUP_DIR);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > retentionDays * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    if (deletedCount > 0)
      logger.info(`[BACKUP] 🧹 Deleted ${deletedCount} old backups`);
  } catch (err: any) {
    logger.error(`[BACKUP] ⚠️ Cleanup failed: ${err.message}`);
  }
};

/**
 * Full backup pipeline — can be scheduled by worker
 */
export const runFullBackup = async () => {
  logger.info("[BACKUP] 🚀 Initiating full backup pipeline...");
  try {
    const backupPath = await createDatabaseBackup();
    await uploadBackupToCloud(backupPath);
    await cleanupOldBackups(7);
    logger.info("[BACKUP] ✅ Full backup completed successfully.");
  } catch (err: any) {
    logger.error(`[BACKUP] ❌ Full backup pipeline failed: ${err.message}`);
  }
};
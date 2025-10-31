import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../logger";
import { config } from "../config";
import { downloadFromS3 } from "./s3";

const execAsync = promisify(exec);

/**
 * Default restore directory
 */
const RESTORE_DIR = path.join(process.cwd(), "restores");

/**
 * Ensure restore directory exists
 */
const ensureRestoreDir = () => {
  if (!fs.existsSync(RESTORE_DIR)) {
    fs.mkdirSync(RESTORE_DIR, { recursive: true });
    logger.info(`[RESTORE] Created local restore directory at ${RESTORE_DIR}`);
  }
};

/**
 * Restore database from a given .sql file path
 */
export const restoreDatabaseFromFile = async (filePath: string): Promise<void> => {
  ensureRestoreDir();

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Backup file not found: ${filePath}`);
    }

    const databaseUrl = config.databaseUrl;
    if (!databaseUrl) throw new Error("Database URL not found in config.");

    // Drop & recreate DB schema before restore (optional)
    const dropCmd = `psql "${databaseUrl}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`;
    await execAsync(dropCmd);

    // Restore from .sql dump file
    const restoreCmd = `psql "${databaseUrl}" < "${filePath}"`;
    await execAsync(restoreCmd);

    logger.info(`[RESTORE] ✅ Successfully restored database from ${filePath}`);
  } catch (err: any) {
    logger.error(`[RESTORE] ❌ Restore failed: ${err.message}`);
    throw new Error(`Database restore failed: ${err.message}`);
  }
};

/**
 * Download a backup from S3 and restore it automatically
 */
export const restoreFromCloudBackup = async (s3Key: string): Promise<void> => {
  ensureRestoreDir();

  try {
    const filePath = path.join(RESTORE_DIR, path.basename(s3Key));
    logger.info(`[RESTORE] ☁️ Downloading backup from S3: ${s3Key}`);

    await downloadFromS3(s3Key, filePath);

    logger.info(`[RESTORE] 📦 Backup downloaded locally. Beginning restore...`);
    await restoreDatabaseFromFile(filePath);

    logger.info(`[RESTORE] ✅ Cloud restore completed successfully.`);
  } catch (err: any) {
    logger.error(`[RESTORE] ❌ Cloud restore failed: ${err.message}`);
    throw new Error("Cloud restore process failed.");
  }
};

/**
 * List available local restore files
 */
export const listLocalRestores = (): string[] => {
  ensureRestoreDir();
  return fs.readdirSync(RESTORE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.join(RESTORE_DIR, f));
};
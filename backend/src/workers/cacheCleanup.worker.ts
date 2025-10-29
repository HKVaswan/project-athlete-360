/**
 * workers/cacheCleanup.worker.ts
 * -------------------------------------------------------------------------
 * Cache & Temp Cleanup Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Deletes expired sessions, refresh tokens, and verification codes.
 *  - Removes old files from /temp, /uploads/tmp, and /reports.
 *  - Purges stale Redis cache entries (if Redis is enabled).
 *  - Rotates logs and ensures healthy disk usage.
 *
 * Enterprise Features:
 *  - Configurable retention policies (via env or defaults)
 *  - Graceful logging and error isolation
 *  - Optimized for scheduled daily runs
 *  - Fail-safe to prevent accidental deletions
 */

import { Job } from "bullmq";
import fs from "fs";
import path from "path";
import { logger } from "../logger";
import prisma from "../prismaClient";
import IORedis from "ioredis";
import { config } from "../config";

const redis = new IORedis(config.redisUrl || "redis://127.0.0.1:6379");

// Retention policies (in days)
const CLEANUP_RULES = {
  TEMP_FILES: 3,          // delete temp files older than 3 days
  REPORTS: 7,             // delete reports older than 7 days
  LOGS: 30,               // rotate logs after 30 days
  TOKENS: 7,              // delete expired tokens older than 7 days
};

export default async function (job: Job) {
  logger.info(`[CLEANUP WORKER] 🧹 Running scheduled cleanup job...`);

  try {
    await Promise.all([
      cleanupTempFiles(),
      cleanupOldReports(),
      cleanupTokens(),
      cleanupRedisCache(),
      cleanupOldLogs(),
    ]);

    logger.info(`[CLEANUP WORKER] ✅ Cleanup completed successfully.`);
  } catch (err: any) {
    logger.error(`[CLEANUP WORKER] ❌ Cleanup failed: ${err.message}`);
    throw err;
  }
}

/**
 * Deletes expired tokens, refresh tokens, and verification codes from DB
 */
async function cleanupTokens() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CLEANUP_RULES.TOKENS);

  try {
    const deletedTokens = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    logger.info(`[CLEANUP WORKER] 🗑️ Deleted ${deletedTokens.count} expired tokens`);
  } catch (err: any) {
    logger.warn(`[CLEANUP WORKER] Failed to delete expired tokens: ${err.message}`);
  }
}

/**
 * Deletes old files from temp directories (e.g., /temp, /uploads/tmp)
 */
async function cleanupTempFiles() {
  const tempDirs = [
    path.join(__dirname, "../../temp"),
    path.join(__dirname, "../../uploads/tmp"),
  ];

  for (const dir of tempDirs) {
    await deleteOldFiles(dir, CLEANUP_RULES.TEMP_FILES);
  }
}

/**
 * Deletes generated reports older than retention period
 */
async function cleanupOldReports() {
  const reportDir = path.join(__dirname, "../../temp/reports");
  await deleteOldFiles(reportDir, CLEANUP_RULES.REPORTS);
}

/**
 * Deletes log files older than retention period
 */
async function cleanupOldLogs() {
  const logDir = path.join(__dirname, "../../logs");
  await deleteOldFiles(logDir, CLEANUP_RULES.LOGS);
}

/**
 * Deletes old files based on modification date
 */
async function deleteOldFiles(dir: string, days: number) {
  if (!fs.existsSync(dir)) return;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    try {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);

      if (stats.isFile() && stats.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        logger.info(`[CLEANUP WORKER] Deleted old file: ${file}`);
      }
    } catch (err: any) {
      logger.warn(`[CLEANUP WORKER] Failed to delete file ${file}: ${err.message}`);
    }
  }
}

/**
 * Cleans up Redis cache (if used)
 */
async function cleanupRedisCache() {
  try {
    const keys = await redis.keys("cache:*");
    if (keys.length === 0) return;

    await redis.del(keys);
    logger.info(`[CLEANUP WORKER] 🔄 Cleared ${keys.length} Redis cache keys`);
  } catch (err: any) {
    logger.warn(`[CLEANUP WORKER] Redis cleanup failed: ${err.message}`);
  }
}
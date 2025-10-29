/**
 * restore.manager.ts
 * ---------------------------------------------------------------------
 * Enterprise-Grade Restore Manager
 * ---------------------------------------------------------------------
 * Responsibilities:
 *  - Safely coordinate restore jobs
 *  - Verify integrity & compatibility of backups
 *  - Handle dry-run verification (no write mode)
 *  - Trigger rollback if restore fails
 *  - Maintain audit logs and versioning data
 */

import { Queue } from "bullmq";
import fs from "fs";
import path from "path";
import { logger } from "../../logger";
import { prisma } from "../../prismaClient";
import { queues } from "../index";
import { config } from "../../config";
import { Errors } from "../../utils/errors";

const RESTORE_QUEUE = "restore";

/**
 * Helper: Verify that the queue exists
 */
function getRestoreQueue(): Queue {
  const q = queues[RESTORE_QUEUE];
  if (!q) throw new Error(`[RESTORE MANAGER] Queue '${RESTORE_QUEUE}' not registered`);
  return q;
}

/**
 * Verify integrity of the backup file before attempting restore
 */
export function verifyBackupFile(backupPath: string): boolean {
  try {
    if (!fs.existsSync(backupPath)) throw Errors.NotFound("Backup file not found");
    const stats = fs.statSync(backupPath);
    if (stats.size < 1024) throw Errors.BadRequest("Backup file appears incomplete");
    logger.info(`[RESTORE MANAGER] ✅ Backup verified (${(stats.size / 1024).toFixed(2)} KB)`);
    return true;
  } catch (err: any) {
    logger.error(`[RESTORE MANAGER] ❌ Verification failed: ${err.message}`);
    throw err;
  }
}

/**
 * Schedule a restore job
 */
export async function triggerRestore(backupKey: string, initiatedBy: string, dryRun = false) {
  try {
    const restoreQueue = getRestoreQueue();

    // Resolve actual file path
    const backupPath = path.resolve(config.backupDir || "backups", backupKey);
    verifyBackupFile(backupPath);

    const job = await restoreQueue.add(
      "restoreBackup",
      { backupKey, dryRun, initiatedBy },
      {
        attempts: 2,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    await prisma.restoreHistory.create({
      data: {
        backupFile: backupKey,
        initiatedBy,
        dryRun,
        status: "QUEUED",
        jobId: job.id as string,
      },
    });

    logger.info(`[RESTORE MANAGER] ♻️ Restore job queued (${job.id})`);
    return { success: true, jobId: job.id };
  } catch (err: any) {
    logger.error(`[RESTORE MANAGER] ❌ Failed to queue restore: ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Rollback mechanism (only metadata level here, not DB)
 */
export async function triggerRollback(lastKnownGoodBackup: string, initiatedBy: string) {
  try {
    logger.warn(`[RESTORE MANAGER] ⚠️ Initiating rollback using ${lastKnownGoodBackup}`);
    return await triggerRestore(lastKnownGoodBackup, initiatedBy, false);
  } catch (err: any) {
    logger.error(`[RESTORE MANAGER] ❌ Rollback failed: ${err.message}`);
    throw err;
  }
}

/**
 * Validate post-restore environment consistency
 */
export async function validateRestoreIntegrity() {
  try {
    const users = await prisma.user.count();
    const athletes = await prisma.athlete.count();

    const stats = { users, athletes, validatedAt: new Date() };

    logger.info(`[RESTORE MANAGER] ✅ Restore integrity check complete: ${JSON.stringify(stats)}`);
    await prisma.restoreAudit.create({ data: stats });

    return { success: true, stats };
  } catch (err: any) {
    logger.error(`[RESTORE MANAGER] ❌ Restore integrity validation failed: ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Get restore history
 */
export async function listRestoreHistory(limit = 10) {
  try {
    const records = await prisma.restoreHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return records;
  } catch (err: any) {
    logger.error(`[RESTORE MANAGER] ❌ Failed to fetch restore history: ${err.message}`);
    throw Errors.Server("Failed to fetch restore history");
  }
}
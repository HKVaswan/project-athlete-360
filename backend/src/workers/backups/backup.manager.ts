/**
 * backup.manager.ts
 * ---------------------------------------------------------------------
 * Enterprise-Grade Backup & Restore Manager
 * ---------------------------------------------------------------------
 * Responsibilities:
 *  - Coordinate backup and restore worker jobs
 *  - Schedule periodic backups (daily/weekly)
 *  - Allow manual admin-triggered backups and restores
 *  - Maintain logs and metadata in database
 *  - Integrate with Redis queue + workers for reliability
 */

import { Queue } from "bullmq";
import { logger } from "../../logger";
import { prisma } from "../../prismaClient";
import { config } from "../../config";
import { queues } from "../index";

// Queue names
const BACKUP_QUEUE = "backup";
const RESTORE_QUEUE = "restore";

/**
 * Helper: Ensure queues are registered before use
 */
function ensureQueue(name: string): Queue {
  if (!queues[name]) {
    throw new Error(`[BACKUP MANAGER] Queue '${name}' not registered.`);
  }
  return queues[name];
}

/**
 * Schedule a new backup job (manual or automatic)
 */
export async function scheduleBackup(manual = false, initiator = "system") {
  try {
    const queue = ensureQueue(BACKUP_QUEUE);

    const job = await queue.add(
      "createBackup",
      { manual, initiator },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 60000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    // Log in DB
    await prisma.backup.create({
      data: {
        jobId: job.id as string,
        fileName: `backup-${new Date().toISOString()}.enc`,
        initiatedBy: initiator,
        manual,
        status: "QUEUED",
      },
    });

    logger.info(`[BACKUP MANAGER] 🗄️ Backup job queued (${job.id})`);
    return { success: true, jobId: job.id };
  } catch (err: any) {
    logger.error(`[BACKUP MANAGER] ❌ Failed to queue backup: ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Schedule a restore job
 */
export async function scheduleRestore(backupKey: string, initiator: string, dryRun = false) {
  try {
    const queue = ensureQueue(RESTORE_QUEUE);

    const job = await queue.add(
      "restoreBackup",
      { backupKey, dryRun, initiator },
      {
        attempts: 2,
        backoff: { type: "fixed", delay: 60000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    await prisma.restoreHistory.create({
      data: {
        backupFile: backupKey,
        initiatedBy: initiator,
        status: "QUEUED",
        jobId: job.id as string,
      },
    });

    logger.info(`[BACKUP MANAGER] ♻️ Restore job queued (${job.id})`);
    return { success: true, jobId: job.id };
  } catch (err: any) {
    logger.error(`[BACKUP MANAGER] ❌ Failed to queue restore: ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Schedule automated recurring backups
 * (Can be called by cron or external scheduler)
 */
export async function scheduleAutomatedBackups() {
  try {
    const now = new Date();
    const queue = ensureQueue(BACKUP_QUEUE);

    const job = await queue.add(
      "automatedBackup",
      { manual: false, initiator: "system", timestamp: now },
      {
        repeat: { cron: config.backupCron || "0 2 * * *" }, // default: 2 AM daily
        removeOnComplete: true,
      }
    );

    logger.info(`[BACKUP MANAGER] ⏰ Scheduled recurring backup (CRON: ${config.backupCron || "daily"})`);
    return job;
  } catch (err: any) {
    logger.error(`[BACKUP MANAGER] ❌ Failed to schedule recurring backup: ${err.message}`);
  }
}

/**
 * Check the health and last backup status
 */
export async function checkBackupHealth() {
  try {
    const lastBackup = await prisma.backup.findFirst({
      orderBy: { createdAt: "desc" },
    });

    if (!lastBackup) return { healthy: false, message: "No backups found" };

    const ageHours = (Date.now() - lastBackup.createdAt.getTime()) / (1000 * 60 * 60);
    const isHealthy = ageHours < 48; // healthy if recent within 2 days

    return {
      healthy: isHealthy,
      lastBackup: lastBackup.createdAt,
      ageHours,
      message: isHealthy ? "Backup recent and healthy" : "Last backup is older than 48 hours",
    };
  } catch (err: any) {
    logger.error(`[BACKUP MANAGER] ❌ Failed to check health: ${err.message}`);
    return { healthy: false, message: err.message };
  }
}

/**
 * Clean up old backups (keep N latest)
 */
export async function cleanupOldBackups(limit = 5) {
  try {
    const backups = await prisma.backup.findMany({
      orderBy: { createdAt: "desc" },
      skip: limit,
    });

    for (const b of backups) {
      try {
        await prisma.backup.delete({ where: { id: b.id } });
        logger.info(`[BACKUP MANAGER] 🧹 Deleted old backup ${b.fileName}`);
      } catch (err: any) {
        logger.warn(`[BACKUP MANAGER] ⚠️ Failed to delete backup ${b.fileName}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[BACKUP MANAGER] ❌ Cleanup failed: ${err.message}`);
  }
}

/**
 * Generate a manual backup on startup if none exists
 */
export async function ensureInitialBackup() {
  const count = await prisma.backup.count();
  if (count === 0) {
    logger.info(`[BACKUP MANAGER] 🆕 No backups found. Triggering initial backup...`);
    await scheduleBackup(true, "system");
  }
}
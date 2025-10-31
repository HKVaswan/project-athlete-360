/**
 * src/controllers/admin/backup.controller.ts
 * ---------------------------------------------------------------------------
 * Enterprise-grade Admin Backup Controller
 *
 * Features:
 *  - Trigger secure manual backups & restores
 *  - List backup history and restore logs
 *  - Backup system health check
 *  - Integration with backup.manager & restore.manager
 *  - Auth + Role protection (ADMIN only)
 *  - Structured ApiError handling
 */

import { Request, Response } from "express";
import { backupManager } from "../../workers/backup.manager";
import { restoreManager } from "../../workers/restore.manager";
import { logger } from "../../logger";
import { Errors, sendErrorResponse } from "../../utils/errors";
import { checkWorkerHealth } from "../../workers";
import { config } from "../../config";

/**
 * Ensure user has admin privileges
 */
const requireAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "ADMIN") {
    throw Errors.Forbidden("Only administrators can perform this action.");
  }
};

/**
 * POST /api/admin/backups/start
 * Triggers a full system backup
 */
export const startBackup = async (req: Request, res: Response) => {
  try {
    requireAdmin(req);

    const { reason } = req.body || {};

    const jobInfo = await backupManager.triggerBackup(reason || "Manual backup initiated by admin");

    logger.info(`[BACKUP] Admin triggered backup job ID: ${jobInfo.jobId}`);

    return res.status(200).json({
      success: true,
      message: "Backup initiated successfully.",
      job: jobInfo,
    });
  } catch (err: any) {
    logger.error(`[BACKUP] Error during manual backup: ${err.message}`);
    return sendErrorResponse(res, err);
  }
};

/**
 * POST /api/admin/backups/restore
 * Safely restores system data from a given backup key
 */
export const startRestore = async (req: Request, res: Response) => {
  try {
    requireAdmin(req);

    const { backupKey, dryRun } = req.body;
    if (!backupKey) throw Errors.Validation("Missing backup key for restore.");

    const jobInfo = await restoreManager.triggerRestore(backupKey, !!dryRun);

    logger.info(`[RESTORE] Restore job triggered for ${backupKey}`);

    return res.status(200).json({
      success: true,
      message: dryRun
        ? "Dry-run restore simulation started."
        : "Restore process initiated successfully.",
      job: jobInfo,
    });
  } catch (err: any) {
    logger.error(`[RESTORE] Restore initiation failed: ${err.message}`);
    return sendErrorResponse(res, err);
  }
};

/**
 * GET /api/admin/backups/history
 * Returns recent backup & restore operations
 */
export const getBackupHistory = async (req: Request, res: Response) => {
  try {
    requireAdmin(req);

    const history = await backupManager.getHistory();
    const restoreLogs = await restoreManager.getHistory();

    return res.status(200).json({
      success: true,
      message: "Backup & restore history retrieved successfully.",
      data: {
        backups: history,
        restores: restoreLogs,
      },
    });
  } catch (err: any) {
    logger.error(`[BACKUP] Failed to fetch history: ${err.message}`);
    return sendErrorResponse(res, err);
  }
};

/**
 * GET /api/admin/backups/health
 * Returns backup system + Redis worker health
 */
export const getBackupHealth = async (req: Request, res: Response) => {
  try {
    requireAdmin(req);

    const workerHealth = await checkWorkerHealth();

    const backupStats = await backupManager.getStats();

    return res.status(200).json({
      success: true,
      message: "Backup system health status",
      data: {
        redis: workerHealth.redis,
        activeWorkers: workerHealth.activeWorkers,
        queues: workerHealth.queues,
        backupStats,
        lastBackupTime: backupStats?.lastBackupTime,
        storagePath: config.backupPath || "/backups",
      },
    });
  } catch (err: any) {
    logger.error(`[BACKUP] Health check failed: ${err.message}`);
    return sendErrorResponse(res, err);
  }
};

/**
 * DELETE /api/admin/backups/:backupKey
 * Deletes an old backup from storage (cleanup)
 */
export const deleteBackup = async (req: Request, res: Response) => {
  try {
    requireAdmin(req);
    const { backupKey } = req.params;

    if (!backupKey) throw Errors.Validation("Missing backup key for deletion.");

    await backupManager.deleteBackup(backupKey);

    logger.info(`[BACKUP] Backup ${backupKey} deleted by admin.`);

    return res.status(200).json({
      success: true,
      message: `Backup ${backupKey} deleted successfully.`,
    });
  } catch (err: any) {
    logger.error(`[BACKUP] Deletion failed: ${err.message}`);
    return sendErrorResponse(res, err);
  }
};

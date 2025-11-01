/**
 * src/workers/storageMonitor.worker.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Storage Monitor Worker
 *
 * Responsibilities:
 *  - Periodically checks actual storage usage per institution
 *  - Compares usage with allocated plan quota
 *  - Issues warnings at 80%, 90%, and 100% of plan limit
 *  - Prevents further uploads or data creation on hard limit
 *  - Sends alerts to SuperAdmin when limits are breached
 *  - Logs all actions for audit traceability
 *
 * Implementation Notes:
 *  - Runs every few hours as background cron worker
 *  - Uses storageMonitor.service, quota.service, and superAdminAlerts.service
 *  - Designed to scale horizontally (idempotent operations)
 * --------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { quotaService } from "../services/quota.service";
import { storageMonitorService } from "../services/storageMonitor.service";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { planRepository } from "../repositories/plan.repo";

const WARN_THRESHOLDS = [0.8, 0.9, 1.0]; // 80%, 90%, 100%
const CRON_INTERVAL_HOURS = 6; // Run every 6 hours ideally

export class StorageMonitorWorker {
  /**
   * Entry point for scheduled execution.
   */
  async run(): Promise<void> {
    logger.info("🚀 [StorageMonitorWorker] Starting storage monitoring cycle...");

    try {
      const institutions = await prisma.institution.findMany({
        where: { status: { in: ["active", "suspended", "trial"] } },
        select: {
          id: true,
          name: true,
          planId: true,
          status: true,
        },
      });

      logger.info(`[StorageMonitorWorker] Found ${institutions.length} institutions to analyze.`);

      for (const inst of institutions) {
        try {
          await this.evaluateInstitutionUsage(inst.id, inst.name, inst.planId);
        } catch (err: any) {
          logger.error(`[StorageMonitorWorker] Error analyzing institution ${inst.id}`, err);
          await superAdminAlertsService.createAlert({
            level: "error",
            title: "Storage Analysis Error",
            message: `Institution ${inst.name} encountered a storage monitoring error: ${err?.message || err}`,
            tags: ["storage", "worker"],
          });
        }
      }

      logger.info("✅ [StorageMonitorWorker] Storage monitoring cycle complete.");
    } catch (err: any) {
      logger.error("[StorageMonitorWorker] Fatal error during monitoring cycle", err);
      await superAdminAlertsService.createAlert({
        level: "critical",
        title: "Storage Worker Failure",
        message: `Fatal storage worker error: ${err?.message || err}`,
        tags: ["system", "storage"],
      });
    }
  }

  /**
   * Evaluate usage for a specific institution and act on quota breaches.
   */
  private async evaluateInstitutionUsage(institutionId: string, name: string, planId: string | null): Promise<void> {
    const usage = await storageMonitorService.calculateUsage(institutionId);
    const plan = planId ? await planRepository.getPlanById(planId) : await planRepository.getFreeTierPlan();
    if (!plan) {
      logger.warn(`[StorageMonitorWorker] No plan found for institution ${name}`);
      return;
    }

    const quota = plan.storageLimitMb;
    const usedPercent = quota > 0 ? usage.totalMb / quota : 0;

    logger.info(`[StorageMonitorWorker] ${name}: ${usage.totalMb}MB used / ${quota}MB limit (${(usedPercent * 100).toFixed(2)}%)`);

    // Determine if warning thresholds are breached
    for (const threshold of WARN_THRESHOLDS) {
      if (usedPercent >= threshold && usedPercent < threshold + 0.05) {
        await this.handleThresholdBreach(institutionId, name, threshold, usage.totalMb, quota);
      }
    }

    // Hard limit reached
    if (usedPercent >= 1.0) {
      await this.handleQuotaExceeded(institutionId, name, usage.totalMb, quota);
    }
  }

  /**
   * Handle usage threshold (80%, 90%, etc.) warnings.
   */
  private async handleThresholdBreach(
    institutionId: string,
    name: string,
    threshold: number,
    used: number,
    limit: number
  ): Promise<void> {
    const thresholdPercent = Math.floor(threshold * 100);

    const existing = await prisma.systemAlert.findFirst({
      where: {
        institutionId,
        type: "storage_warning",
        meta: { path: ["threshold"], equals: thresholdPercent },
      },
    });

    if (existing) return; // prevent spam

    await superAdminAlertsService.createAlert({
      level: "warning",
      title: `Storage Usage Alert (${thresholdPercent}%)`,
      message: `Institution "${name}" has used ${used}MB of ${limit}MB (${thresholdPercent}%).`,
      institutionId,
      tags: ["storage", "quota"],
    });

    await prisma.systemAlert.create({
      data: {
        institutionId,
        type: "storage_warning",
        title: `Storage at ${thresholdPercent}%`,
        message: `Usage is ${used}MB / ${limit}MB. Consider upgrading the plan.`,
        severity: "medium",
        meta: { threshold: thresholdPercent },
      },
    });

    logger.warn(`[StorageMonitorWorker] Warning: ${name} reached ${thresholdPercent}% of storage limit.`);
  }

  /**
   * Handle full quota exceed cases.
   *  - Lock uploads
   *  - Notify SuperAdmin + Institution Admin
   *  - Prevent further usage via DB flag
   */
  private async handleQuotaExceeded(institutionId: string, name: string, used: number, limit: number): Promise<void> {
    logger.error(`[StorageMonitorWorker] ${name} exceeded storage quota (${used}/${limit}MB)`);

    await prisma.institution.update({
      where: { id: institutionId },
      data: { uploadsBlocked: true },
    });

    await superAdminAlertsService.createAlert({
      level: "critical",
      title: "Storage Limit Exceeded",
      message: `Institution "${name}" has exceeded its storage quota (${used}/${limit}MB). Uploads locked.`,
      institutionId,
      tags: ["storage", "limit"],
    });

    await prisma.systemAlert.create({
      data: {
        institutionId,
        type: "storage_limit_exceeded",
        title: "Storage Limit Exceeded",
        message: `Your institution has exceeded its plan storage limit. Please upgrade to continue uploading.`,
        severity: "high",
        meta: { used, limit },
      },
    });
  }
}

// Export singleton
export const storageMonitorWorker = new StorageMonitorWorker();

// Allow standalone cron execution
if (require.main === module) {
  (async () => {
    logger.info("🕒 Running StorageMonitorWorker standalone execution...");
    const worker = new StorageMonitorWorker();
    await worker.run();
    logger.info("✅ StorageMonitorWorker completed successfully.");
    process.exit(0);
  })();
}
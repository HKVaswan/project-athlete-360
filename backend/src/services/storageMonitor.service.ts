/**
 * src/services/storageMonitor.service.ts
 * ---------------------------------------------------------------------
 * Enterprise Storage Monitor Service
 *
 * Responsibilities:
 *  - Track database and file storage usage (per institution and globally)
 *  - Enforce quotas defined by plan limits
 *  - Trigger warnings / lock accounts when limits exceeded
 *  - Send alerts to institution admins and Super Admin dashboard
 *  - Support manual refresh or scheduled monitoring jobs
 *
 * Integrated Systems:
 *  - Prisma (for DB stats)
 *  - S3 or local storage for file usage (future extension)
 *  - quota.service.ts (plan-based limits)
 *  - notification + audit services
 *  - systemMonitor + superAdmin dashboards
 * ---------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { recordAuditEvent } from "./audit.service";
import { quotaService } from "./quota.service";
import { addNotificationJob } from "../workers/notification.worker";
import { billingService } from "./billing.service";
import { config } from "../config";
import { formatBytes } from "../utils/format";
import { addDays } from "date-fns";

interface StorageUsage {
  institutionId: string;
  usedBytes: number;
  maxBytes: number;
  percentUsed: number;
  status: "normal" | "warning" | "critical" | "locked";
}

/**
 * Core helper: Estimate total storage for an institution.
 * This can be extended with:
 *  - S3 usage reports
 *  - DB table-specific size lookups
 *  - File uploads size
 */
export const calculateInstitutionStorage = async (institutionId: string): Promise<number> => {
  // We only estimate DB-level usage for now.
  // In production, this could query INFORMATION_SCHEMA or use pg_database_size().
  try {
    const result = await prisma.$queryRawUnsafe<{ size: string }[]>(
      `SELECT pg_size_pretty(pg_database_size(current_database())) as size;`
    );
    const sizeString = result?.[0]?.size || "0 MB";
    const sizeMB = parseFloat(sizeString.replace(/[^\d.]/g, ""));
    const bytes = sizeMB * 1024 * 1024;
    return bytes;
  } catch (err) {
    logger.warn(`[STORAGE] Unable to calculate precise DB size for institution ${institutionId}`, err);
    return 0;
  }
};

/**
 * Enforce storage limits and trigger warnings or locks if exceeded.
 * Called automatically by cron or admin action.
 */
export const enforceStorageLimits = async (institutionId: string): Promise<StorageUsage> => {
  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    include: { subscription: { include: { plan: true } } },
  });

  if (!institution) {
    throw new Error("Institution not found");
  }

  const planLimitBytes = institution.subscription?.plan?.storageLimitBytes ?? quotaService.getDefaultLimit("storage");
  const usedBytes = await calculateInstitutionStorage(institutionId);
  const percentUsed = Math.round((usedBytes / planLimitBytes) * 100);

  let status: StorageUsage["status"] = "normal";
  if (percentUsed > 90) status = "critical";
  else if (percentUsed > 75) status = "warning";

  // Handle automatic locking if 100% reached
  if (percentUsed >= 100) {
    await prisma.institution.update({
      where: { id: institutionId },
      data: { isLocked: true },
    });
    status = "locked";
    await addNotificationJob({
      type: "custom",
      recipientId: institution.adminId,
      title: "⚠️ Storage Limit Reached",
      body: "Your institution has reached its allocated storage limit. Access is temporarily restricted until upgrade or cleanup.",
      channel: ["inApp", "email"],
      meta: { percentUsed },
    });

    await recordAuditEvent({
      actorId: institution.adminId,
      actorRole: "institution_admin",
      action: "STORAGE_LOCKED",
      details: { percentUsed, limit: formatBytes(planLimitBytes) },
    });

    logger.warn(`[STORAGE] Institution ${institutionId} locked — exceeded quota.`);
  } else if (status === "warning" || status === "critical") {
    await addNotificationJob({
      type: "custom",
      recipientId: institution.adminId,
      title: "Storage Warning",
      body: `You have used ${percentUsed}% of your available storage (${formatBytes(
        usedBytes
      )}/${formatBytes(planLimitBytes)}). Consider upgrading your plan.`,
      channel: ["inApp", "email"],
      meta: { percentUsed },
    });
    logger.info(`[STORAGE] Warning for institution ${institutionId}: ${percentUsed}% used`);
  }

  return {
    institutionId,
    usedBytes,
    maxBytes: planLimitBytes,
    percentUsed,
    status,
  };
};

/**
 * System-level health scan — run periodically to detect high usage globally.
 */
export const runGlobalStorageScan = async () => {
  logger.info("[STORAGE] 🌍 Starting global storage usage scan...");

  const institutions = await prisma.institution.findMany({ select: { id: true, name: true } });
  const results: StorageUsage[] = [];

  for (const inst of institutions) {
    try {
      const usage = await enforceStorageLimits(inst.id);
      results.push(usage);
    } catch (err) {
      logger.error(`[STORAGE] Failed scan for ${inst.id}`, err);
    }
  }

  const avgUsage = results.reduce((a, b) => a + b.percentUsed, 0) / (results.length || 1);
  const highUsage = results.filter((r) => r.status === "critical" || r.status === "locked").length;

  if (highUsage > 0 || avgUsage > 80) {
    logger.warn(`[STORAGE] Global usage alert — avg ${avgUsage.toFixed(1)}%`);
    await addNotificationJob({
      type: "custom",
      recipientId: config.superAdminId,
      title: "⚠️ Global Storage Alert",
      body: `System-wide average storage usage is ${avgUsage.toFixed(
        1
      )}%. ${highUsage} institutions exceeded safe levels.`,
      channel: ["inApp", "email"],
      meta: { avgUsage, highUsage },
    });

    await recordAuditEvent({
      actorId: config.superAdminId,
      actorRole: "super_admin",
      action: "SYSTEM_ALERT",
      details: { avgUsage, highUsage },
    });
  }

  logger.info("[STORAGE] ✅ Global storage scan completed");
  return results;
};

/**
 * Schedule next automatic check (to run daily or hourly)
 */
export const scheduleStorageCheck = (intervalMs = 1000 * 60 * 60 * 6) => {
  logger.info(`[STORAGE] 🕓 Scheduling storage monitor every ${intervalMs / 3600000} hours`);
  setInterval(runGlobalStorageScan, intervalMs);
};

/**
 * Manually refresh usage for a given institution
 */
export const refreshInstitutionUsage = async (institutionId: string) => {
  const usage = await enforceStorageLimits(institutionId);
  logger.info(`[STORAGE] Manual usage refresh for ${institutionId}: ${usage.percentUsed}%`);
  return usage;
};

/**
 * Get human-readable summary for dashboard display
 */
export const getStorageSummary = async () => {
  const institutions = await prisma.institution.findMany({
    select: { id: true, name: true },
  });

  const summaries = [];
  for (const inst of institutions) {
    const usage = await enforceStorageLimits(inst.id);
    summaries.push({
      id: inst.id,
      name: inst.name,
      usage: usage.percentUsed,
      status: usage.status,
    });
  }

  return summaries;
};

export const storageMonitorService = {
  calculateInstitutionStorage,
  enforceStorageLimits,
  runGlobalStorageScan,
  scheduleStorageCheck,
  refreshInstitutionUsage,
  getStorageSummary,
};
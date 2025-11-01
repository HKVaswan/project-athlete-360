/**
 * src/lib/quotaUtils.ts
 * ---------------------------------------------------------------------------
 * 🔐 Enterprise Quota Utilities
 *
 * Handles:
 *  - Enforcing plan limits (athletes per coach, storage, videos, etc.)
 *  - Quota calculation and validation
 *  - Auto-alerts when nearing limits
 *  - Integrates with plans.service, quota.service, and superAdminAlerts.service
 *
 * Designed for:
 *  - Multi-tenant environments (institution-scoped)
 *  - Robust fail-safe behavior (no app crashes on quota checks)
 *  - Centralized logic for all “limit enforcement”
 *
 * ---------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { quotaService } from "../services/quota.service";
import { plansService } from "../services/plans.service";

/* -------------------------------------------------------------------------- */
/* 🔹 ENUMS & CONSTANTS */
/* -------------------------------------------------------------------------- */

export enum QuotaType {
  ATHLETES = "athletes",
  COACHES = "coaches",
  STORAGE = "storage",
  VIDEOS = "videos",
}

export const QUOTA_WARN_THRESHOLD = 0.85; // 85% usage triggers early warning

/* -------------------------------------------------------------------------- */
/* 🔹 Helper: Calculate Remaining Quota */
/* -------------------------------------------------------------------------- */

/**
 * Returns remaining quota and whether limit is reached
 */
export async function getRemainingQuota(institutionId: string, type: QuotaType) {
  try {
    const plan = await plansService.getInstitutionPlan(institutionId);
    const limits = plan.limits || {};

    const usage = await quotaService.getInstitutionUsage(institutionId);
    if (!usage) throw Errors.Server("Unable to retrieve institution usage data");

    const limit = limits[type];
    const used = usage[type] ?? 0;
    const remaining = Math.max(0, (limit ?? 0) - used);

    return {
      used,
      limit,
      remaining,
      percentUsed: limit ? used / limit : 0,
      isExceeded: limit ? used >= limit : false,
    };
  } catch (err: any) {
    logger.error(`[quotaUtils] Failed to get remaining quota: ${err.message}`);
    throw Errors.Server("Failed to calculate remaining quota");
  }
}

/* -------------------------------------------------------------------------- */
/* 🔹 Enforce Quota Limit */
/* -------------------------------------------------------------------------- */

/**
 * Throws error if the operation would exceed quota.
 * Should be called before actions like:
 * - Creating new athlete/coach
 * - Uploading videos/files
 * - Increasing storage usage
 */
export async function enforceQuota(institutionId: string, type: QuotaType, increment = 1) {
  const { remaining, limit, used } = await getRemainingQuota(institutionId, type);

  if (limit === undefined || limit === null) {
    logger.warn(`[quotaUtils] Plan for institution ${institutionId} has no ${type} limit defined.`);
    return; // no enforcement if undefined (e.g., super plan)
  }

  if (remaining < increment) {
    const msg = `Quota exceeded for ${type}. Limit: ${limit}, Used: ${used}`;
    logger.warn(`[quotaUtils] ${msg}`);
    throw Errors.Forbidden(msg);
  }

  // optional: soft warning if nearing limit
  if ((used + increment) / limit >= QUOTA_WARN_THRESHOLD) {
    await triggerQuotaWarning(institutionId, type, used + increment, limit);
  }
}

/* -------------------------------------------------------------------------- */
/* 🔹 Update Usage After Operation */
/* -------------------------------------------------------------------------- */

/**
 * Should be called when a measurable action happens (e.g. upload, create athlete).
 */
export async function recordUsage(
  institutionId: string,
  type: QuotaType,
  amount = 1,
  action: "increment" | "decrement" = "increment"
) {
  try {
    if (!institutionId) return;

    if (action === "increment") {
      await quotaService.incrementUsage(institutionId, type, amount);
    } else {
      await quotaService.decrementUsage(institutionId, type, amount);
    }

    logger.debug(`[quotaUtils] Updated usage for ${institutionId}: ${type} ${action} by ${amount}`);
  } catch (err: any) {
    logger.error(`[quotaUtils] Failed to update usage: ${err.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 🔹 Quota Warning Notifications */
/* -------------------------------------------------------------------------- */

async function triggerQuotaWarning(
  institutionId: string,
  type: QuotaType,
  used: number,
  limit: number
) {
  try {
    const percent = Math.round((used / limit) * 100);
    logger.warn(`[quotaUtils] ${type.toUpperCase()} usage at ${percent}% for institution ${institutionId}`);

    await superAdminAlertsService.sendQuotaAlert({
      institutionId,
      type,
      used,
      limit,
      percentUsed: percent,
      severity: percent >= 100 ? "critical" : "warning",
    });
  } catch (err: any) {
    logger.error(`[quotaUtils] Failed to trigger quota warning: ${err.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* 🔹 Utility: Check & Block New Athlete/Coach Creation */
/* -------------------------------------------------------------------------- */

/**
 * Use this guard before creating athletes or coaches.
 */
export async function verifyInstitutionCapacity(institutionId: string, role: "athlete" | "coach") {
  const type = role === "athlete" ? QuotaType.ATHLETES : QuotaType.COACHES;
  await enforceQuota(institutionId, type, 1);
}

/* -------------------------------------------------------------------------- */
/* 🔹 Utility: Check Storage before upload */
/* -------------------------------------------------------------------------- */

/**
 * Use this before presigning uploads to block over-limit users.
 */
export async function verifyStorageCapacity(institutionId: string, fileSizeBytes: number) {
  const quota = await getRemainingQuota(institutionId, QuotaType.STORAGE);

  if (quota.remaining <= 0 || fileSizeBytes > quota.remaining) {
    const msg = `Storage quota exceeded. Used: ${quota.used} / ${quota.limit} bytes.`;
    throw Errors.Forbidden(msg);
  }

  if ((quota.used + fileSizeBytes) / quota.limit >= QUOTA_WARN_THRESHOLD) {
    await triggerQuotaWarning(institutionId, QuotaType.STORAGE, quota.used + fileSizeBytes, quota.limit);
  }
}

/* -------------------------------------------------------------------------- */
/* 🔹 Scheduled Recheck (used by cron/workers) */
/* -------------------------------------------------------------------------- */

export async function performQuotaHealthCheck() {
  try {
    const institutions = await prisma.institution.findMany({ select: { id: true } });
    for (const { id } of institutions) {
      for (const type of Object.values(QuotaType)) {
        const quota = await getRemainingQuota(id, type);
        if (quota.percentUsed >= QUOTA_WARN_THRESHOLD) {
          await triggerQuotaWarning(id, type, quota.used, quota.limit);
        }
      }
    }
    logger.info(`[quotaUtils] Quota health check completed for ${institutions.length} institutions.`);
  } catch (err: any) {
    logger.error(`[quotaUtils] Quota health check failed: ${err.message}`);
  }
}
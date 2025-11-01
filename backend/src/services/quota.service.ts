// src/services/quota.service.ts
/**
 * quota.service.ts
 * ---------------------------------------------------------------------------
 * Enterprise-grade Quota & Usage Management Service
 *
 * Responsibilities:
 *  - Tracks institutional resource usage (athletes, storage, uploads, API hits)
 *  - Enforces limits per plan, preventing overuse or abuse
 *  - Supports both soft-limit (warning) and hard-limit (block) strategies
 *  - Emits notifications and system alerts for nearing thresholds
 *  - Integrates with PlansService for plan limit values
 *  - Monitored by Super Admin through alert logs
 *
 * Key Features:
 *  - Incremental usage updates (e.g., after each athlete or upload)
 *  - Periodic re-sync with database (for data consistency)
 *  - Configurable hard limit policies (strict, grace period, lock)
 * ---------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { plansService } from "./plans.service";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { addNotificationJob } from "../workers/notification.worker";
import { auditService } from "../lib/audit";

interface UsageSnapshot {
  athletes: number;
  storageMb: number;
  videosUploaded: number;
  apiCalls: number;
}

/**
 * Quota Enforcement Levels
 */
export type EnforcementLevel = "soft" | "hard" | "block";

/**
 * Quota Check Result
 */
export interface QuotaCheckResult {
  ok: boolean;
  reason?: string;
  limit?: number;
  usage?: number;
  level?: EnforcementLevel;
}

/**
 * QuotaService — central policy enforcement unit
 */
class QuotaService {
  /**
   * Returns latest usage metrics for an institution.
   * This can be called directly or used internally.
   */
  async getUsageSnapshot(institutionId: string): Promise<UsageSnapshot> {
    try {
      const [athletes, storage, videos] = await Promise.all([
        prisma.athlete.count({ where: { institutionId } }),
        prisma.fileStorage.aggregate({
          where: { institutionId },
          _sum: { sizeMb: true },
        }),
        prisma.videoUpload.aggregate({
          where: { institutionId },
          _sum: { sizeMb: true },
        }),
      ]);

      // Optional: API usage stored in separate table or Redis
      const apiUsage = await this.getApiUsage(institutionId);

      return {
        athletes,
        storageMb: storage._sum.sizeMb || 0,
        videosUploaded: videos._sum.sizeMb || 0,
        apiCalls: apiUsage,
      };
    } catch (err: any) {
      logger.error("[QUOTA] Failed to calculate usage snapshot", { err });
      throw Errors.Server("Failed to retrieve institution usage.");
    }
  }

  /**
   * Get API usage count from DB or cache (daily/monthly cap)
   */
  async getApiUsage(institutionId: string): Promise<number> {
    try {
      const record = await prisma.apiUsage.findFirst({
        where: { institutionId, period: "monthly" },
        select: { count: true },
      });
      return record?.count || 0;
    } catch (err) {
      logger.warn("[QUOTA] Failed to read API usage", err);
      return 0;
    }
  }

  /**
   * Increment resource usage after certain actions.
   * Example: when athlete added, video uploaded, etc.
   * Enforces the limit after increment.
   */
  async incrementUsage(
    institutionId: string,
    type: "athlete" | "storageMb" | "videoUploadMb" | "apiCall",
    amount: number
  ) {
    try {
      switch (type) {
        case "athlete":
          // Usually handled via DB insert count, so skip direct increment
          break;
        case "storageMb":
          await prisma.institutionUsage.upsert({
            where: { institutionId },
            update: { storageUsedMb: { increment: amount } },
            create: { institutionId, storageUsedMb: amount },
          });
          break;
        case "videoUploadMb":
          await prisma.institutionUsage.upsert({
            where: { institutionId },
            update: { videoUsedMb: { increment: amount } },
            create: { institutionId, videoUsedMb: amount },
          });
          break;
        case "apiCall":
          await prisma.apiUsage.upsert({
            where: { institutionId },
            update: { count: { increment: amount } },
            create: { institutionId, period: "monthly", count: amount },
          });
          break;
      }

      // Recheck quota after increment
      const result = await this.enforceQuota(institutionId);
      if (!result.ok && result.level === "block") {
        logger.warn(`[QUOTA] Hard block triggered for ${institutionId}: ${result.reason}`);
        throw Errors.Forbidden(`Quota exceeded: ${result.reason}`);
      }

      return result;
    } catch (err: any) {
      logger.error("[QUOTA] incrementUsage error", { err });
      throw err instanceof Errors.ApiError ? err : Errors.Server("Failed to increment usage");
    }
  }

  /**
   * Enforce quota rules.
   * - Checks plan limits vs actual usage
   * - Sends alerts for nearing thresholds
   * - Returns QuotaCheckResult
   */
  async enforceQuota(institutionId: string): Promise<QuotaCheckResult> {
    try {
      const activePlan = await plansService.getActivePlanForInstitution(institutionId);
      if (!activePlan) {
        return { ok: false, reason: "no_active_plan", level: "block" };
      }

      const { plan } = activePlan;
      const usage = await this.getUsageSnapshot(institutionId);

      const issues: QuotaCheckResult[] = [];

      // Athlete count
      if (plan.athleteLimit && usage.athletes >= plan.athleteLimit * 0.9) {
        const level = usage.athletes >= plan.athleteLimit ? "block" : "soft";
        issues.push({
          ok: false,
          reason: "athlete_limit",
          limit: plan.athleteLimit,
          usage: usage.athletes,
          level,
        });
      }

      // Storage usage
      if (plan.storageLimitMb && usage.storageMb >= plan.storageLimitMb * 0.9) {
        const level = usage.storageMb >= plan.storageLimitMb ? "block" : "soft";
        issues.push({
          ok: false,
          reason: "storage_limit",
          limit: plan.storageLimitMb,
          usage: usage.storageMb,
          level,
        });
      }

      // Video upload usage
      if (plan.videoUploadLimitMb && usage.videosUploaded >= plan.videoUploadLimitMb * 0.9) {
        const level = usage.videosUploaded >= plan.videoUploadLimitMb ? "block" : "soft";
        issues.push({
          ok: false,
          reason: "video_limit",
          limit: plan.videoUploadLimitMb,
          usage: usage.videosUploaded,
          level,
        });
      }

      // API call limits (optional)
      if (plan.metadata?.apiLimit && usage.apiCalls >= plan.metadata.apiLimit * 0.9) {
        const level = usage.apiCalls >= plan.metadata.apiLimit ? "block" : "soft";
        issues.push({
          ok: false,
          reason: "api_limit",
          limit: plan.metadata.apiLimit,
          usage: usage.apiCalls,
          level,
        });
      }

      // Handle issues
      if (issues.length > 0) {
        const mostSevere = issues.find((i) => i.level === "block") || issues[0];

        // Soft warning — send notification to institution admin
        if (mostSevere.level === "soft") {
          await this.notifyLimitWarning(institutionId, mostSevere);
        }

        // Hard block — trigger audit + alert
        if (mostSevere.level === "block") {
          await auditService.log({
            actorId: institutionId,
            actorRole: "system",
            action: "SECURITY_EVENT",
            details: {
              type: "quota_block",
              reason: mostSevere.reason,
              usage: mostSevere.usage,
              limit: mostSevere.limit,
            },
          });

          await this.alertSuperAdmin(institutionId, mostSevere);
        }

        return mostSevere;
      }

      return { ok: true };
    } catch (err: any) {
      logger.error("[QUOTA] enforceQuota error", { err });
      throw Errors.Server("Failed to enforce quota");
    }
  }

  /**
   * Send alert to institution admin (soft warning)
   */
  private async notifyLimitWarning(institutionId: string, result: QuotaCheckResult) {
    try {
      const inst = await prisma.institution.findUnique({
        where: { id: institutionId },
        select: { id: true, name: true, adminId: true },
      });
      if (!inst || !inst.adminId) return;

      await addNotificationJob({
        type: "custom",
        recipientId: inst.adminId,
        title: `⚠️ Usage nearing limit (${result.reason})`,
        body: `Your institution "${inst.name}" has reached ${result.usage}/${result.limit} (${Math.round(
          (result.usage! / result.limit!) * 100
        )}%) of its quota.`,
        channel: ["inApp", "email"],
      });

      logger.info(`[QUOTA] Sent warning to ${institutionId} for ${result.reason}`);
    } catch (err) {
      logger.warn("[QUOTA] notifyLimitWarning failed", err);
    }
  }

  /**
   * Escalate severe overuse cases to Super Admin via audit + notification
   */
  private async alertSuperAdmin(institutionId: string, result: QuotaCheckResult) {
    try {
      const admins = await prisma.user.findMany({ where: { role: "super_admin" } });
      const alertMsg = `🚨 Quota Breach Alert: Institution ${institutionId} exceeded ${result.reason} (${result.usage}/${result.limit})`;

      for (const admin of admins) {
        await addNotificationJob({
          type: "custom",
          recipientId: admin.id,
          title: "Quota Breach Detected",
          body: alertMsg,
          channel: ["inApp", "email"],
        });
      }

      logger.warn("[QUOTA] Super admin alert triggered", { institutionId, result });
    } catch (err) {
      logger.error("[QUOTA] alertSuperAdmin failed", err);
    }
  }

  /**
   * Resets monthly API usage counters (for cron worker)
   */
  async resetMonthlyApiUsage() {
    try {
      await prisma.apiUsage.updateMany({
        data: { count: 0, period: "monthly" },
      });
      logger.info("[QUOTA] Monthly API usage reset complete.");
    } catch (err) {
      logger.error("[QUOTA] resetMonthlyApiUsage failed", { err });
    }
  }
}

export const quotaService = new QuotaService();
export default quotaService;
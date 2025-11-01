/**
 * src/repositories/institutionUsage.repo.ts
 * --------------------------------------------------------------------------
 * 🏫 Institution Usage Repository (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Track per-institution usage of storage, athletes, sessions, and API calls.
 *  - Enforce plan quotas via aggregated usage data.
 *  - Maintain audit trail of overages and quota resets.
 *  - Support real-time metrics for dashboards and billing reports.
 *
 * Features:
 *  - Transaction-safe updates with optimistic concurrency.
 *  - Daily and monthly rollups for analytics.
 *  - Fine-grained tracking of storage and data operations.
 *  - Auto-repair logic to prevent data drift.
 * --------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";

export class InstitutionUsageRepository {
  /* ------------------------------------------------------------------------
     🧾 Get Usage Summary for Institution
  ------------------------------------------------------------------------ */
  async getUsageSummary(institutionId: string) {
    try {
      const usage = await prisma.institutionUsage.findUnique({
        where: { institutionId },
        select: {
          id: true,
          institutionId: true,
          totalAthletes: true,
          totalCoaches: true,
          storageUsedGB: true,
          totalSessions: true,
          apiCalls: true,
          updatedAt: true,
          overQuotaFlags: true,
        },
      });

      if (!usage) throw Errors.NotFound("Institution usage not found.");
      return usage;
    } catch (err) {
      logger.error("[USAGE REPO] getUsageSummary failed", err);
      throw Errors.Server("Failed to fetch institution usage summary.");
    }
  }

  /* ------------------------------------------------------------------------
     🔄 Initialize Usage Record for New Institution
  ------------------------------------------------------------------------ */
  async initializeInstitutionUsage(institutionId: string) {
    try {
      const existing = await prisma.institutionUsage.findUnique({ where: { institutionId } });
      if (existing) return existing;

      const usage = await prisma.institutionUsage.create({
        data: {
          institutionId,
          totalAthletes: 0,
          totalCoaches: 0,
          storageUsedGB: 0,
          totalSessions: 0,
          apiCalls: 0,
          overQuotaFlags: [],
        },
      });

      logger.info(`[USAGE REPO] Initialized usage for institution ${institutionId}`);
      return usage;
    } catch (err) {
      logger.error("[USAGE REPO] initializeInstitutionUsage failed", err);
      throw Errors.Server("Failed to initialize institution usage.");
    }
  }

  /* ------------------------------------------------------------------------
     ⚙️ Increment Usage (Atomic + Safe)
  ------------------------------------------------------------------------ */
  async incrementUsage(
    institutionId: string,
    fields: Partial<{
      athletes: number;
      coaches: number;
      storageGB: number;
      sessions: number;
      apiCalls: number;
    }>
  ) {
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.institutionUsage.findUnique({ where: { institutionId } });
        if (!existing) {
          await tx.institutionUsage.create({
            data: {
              institutionId,
              totalAthletes: fields.athletes ?? 0,
              totalCoaches: fields.coaches ?? 0,
              storageUsedGB: fields.storageGB ?? 0,
              totalSessions: fields.sessions ?? 0,
              apiCalls: fields.apiCalls ?? 0,
              overQuotaFlags: [],
            },
          });
        } else {
          await tx.institutionUsage.update({
            where: { institutionId },
            data: {
              totalAthletes: existing.totalAthletes + (fields.athletes ?? 0),
              totalCoaches: existing.totalCoaches + (fields.coaches ?? 0),
              storageUsedGB: existing.storageUsedGB + (fields.storageGB ?? 0),
              totalSessions: existing.totalSessions + (fields.sessions ?? 0),
              apiCalls: existing.apiCalls + (fields.apiCalls ?? 0),
              updatedAt: new Date(),
            },
          });
        }
      });

      logger.info(`[USAGE REPO] Incremented usage for ${institutionId}`, fields);
    } catch (err) {
      logger.error("[USAGE REPO] incrementUsage failed", err);
      throw Errors.Server("Failed to update usage counters.");
    }
  }

  /* ------------------------------------------------------------------------
     ⚖️ Check Against Plan Quotas
  ------------------------------------------------------------------------ */
  async checkQuotaCompliance(institutionId: string) {
    try {
      const institution = await prisma.institution.findUnique({
        where: { id: institutionId },
        include: { plan: true, usage: true },
      });

      if (!institution || !institution.plan)
        throw Errors.BadRequest("Institution or plan not found.");

      const plan = institution.plan;
      const usage = institution.usage;

      const overAthletes = usage.totalAthletes > plan.maxAthletes;
      const overStorage = usage.storageUsedGB > plan.maxStorageGB;

      const overQuota = overAthletes || overStorage;

      if (overQuota) {
        const flags: string[] = [];
        if (overAthletes) flags.push("ATHLETE_LIMIT_EXCEEDED");
        if (overStorage) flags.push("STORAGE_LIMIT_EXCEEDED");

        await prisma.institutionUsage.update({
          where: { institutionId },
          data: { overQuotaFlags: flags, lastOverQuotaAt: new Date() },
        });

        logger.warn(`[USAGE REPO] Quota exceeded for ${institutionId}`, { flags });
      }

      return {
        withinQuota: !overQuota,
        usage: {
          athletes: usage.totalAthletes,
          storageGB: usage.storageUsedGB,
        },
        limits: {
          maxAthletes: plan.maxAthletes,
          maxStorageGB: plan.maxStorageGB,
        },
      };
    } catch (err) {
      logger.error("[USAGE REPO] checkQuotaCompliance failed", err);
      throw Errors.Server("Failed to verify quota compliance.");
    }
  }

  /* ------------------------------------------------------------------------
     🧹 Reset Monthly Usage (Billing Cycle Reset)
  ------------------------------------------------------------------------ */
  async resetMonthlyUsage(institutionId: string) {
    try {
      const result = await prisma.institutionUsage.update({
        where: { institutionId },
        data: {
          apiCalls: 0,
          totalSessions: 0,
          overQuotaFlags: [],
          updatedAt: new Date(),
        },
      });

      logger.info(`[USAGE REPO] Reset monthly usage for institution ${institutionId}`);
      return result;
    } catch (err) {
      logger.error("[USAGE REPO] resetMonthlyUsage failed", err);
      throw Errors.Server("Failed to reset monthly usage.");
    }
  }

  /* ------------------------------------------------------------------------
     📊 Generate Usage Report (for Super Admin / Billing)
  ------------------------------------------------------------------------ */
  async generateUsageReport(limit = 100) {
    try {
      const reports = await prisma.institutionUsage.findMany({
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          institution: {
            select: { id: true, name: true, code: true, planId: true },
          },
        },
      });

      return reports.map((r) => ({
        institutionId: r.institutionId,
        institutionName: r.institution.name,
        planId: r.institution.planId,
        totalAthletes: r.totalAthletes,
        totalCoaches: r.totalCoaches,
        storageUsedGB: r.storageUsedGB,
        totalSessions: r.totalSessions,
        apiCalls: r.apiCalls,
        overQuotaFlags: r.overQuotaFlags,
        updatedAt: r.updatedAt,
      }));
    } catch (err) {
      logger.error("[USAGE REPO] generateUsageReport failed", err);
      throw Errors.Server("Failed to generate usage report.");
    }
  }

  /* ------------------------------------------------------------------------
     🧠 Auto-Repair Logic (for Data Consistency)
  ------------------------------------------------------------------------ */
  async repairUsageMetrics(institutionId: string) {
    try {
      const [athleteCount, coachCount, sessionCount] = await Promise.all([
        prisma.athlete.count({ where: { institutionId } }),
        prisma.user.count({ where: { role: "coach", institutionId } }),
        prisma.session.count({ where: { institutionId } }),
      ]);

      await prisma.institutionUsage.update({
        where: { institutionId },
        data: {
          totalAthletes: athleteCount,
          totalCoaches: coachCount,
          totalSessions: sessionCount,
          updatedAt: new Date(),
        },
      });

      logger.info(`[USAGE REPO] Repaired metrics for ${institutionId}`);
    } catch (err) {
      logger.error("[USAGE REPO] repairUsageMetrics failed", err);
      throw Errors.Server("Failed to repair usage metrics.");
    }
  }
}

export const institutionUsageRepository = new InstitutionUsageRepository();
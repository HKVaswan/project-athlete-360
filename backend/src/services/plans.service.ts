// src/services/plans.service.ts
/**
 * plans.service.ts
 *
 * Enterprise-grade Plans & Billing helper service.
 * - Central place to define/get/update subscription plans.
 * - Safe transactional operations for plan assignment to institutions.
 * - Utility methods for plan validation, quota enforcement hooks, and proration
 * - Works with payment service (pluggable) and quota service
 *
 * NOTE:
 *  - This module assumes Prisma models: Plan, InstitutionPlan (assignment), Institution, User
 *  - It intentionally keeps business rules here; controllers should remain thin.
 */

import { Prisma, Plan as PrismaPlan } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { logger } from "../logger";
import { config } from "../config";
import { addNotificationJob } from "../workers/notification.worker"; // best-effort notify admins
// import paymentService from "./payment.service"; // pluggable (call on assign/renew)
import { format } from "date-fns";

/** TTL for in-memory plan cache (ms) */
const CACHE_TTL = Number(config.planCacheTtlMs || 1000 * 60 * 5);

/** In-memory cache for plan list (simple, restart-safe) */
let planCache: { timestamp: number; plans: PrismaPlan[] } | null = null;

/** DTOs / types */
export type PlanInput = {
  name: string;
  slug: string; // unique key
  description?: string | null;
  priceMonthlyCents: number; // integer cents
  priceYearlyCents?: number | null;
  athleteLimit: number | null; // null == unlimited
  storageLimitMb: number | null; // storage in MB
  videoUploadLimitMb: number | null;
  features?: Record<string, boolean | number | string> | null;
  active?: boolean;
  metadata?: Record<string, any> | null;
};

export type AssignPlanInput = {
  institutionId: string;
  planId: string;
  startsAt?: Date;
  billingCycle?: "monthly" | "yearly";
  trialDays?: number;
  initiatedBy?: string | null; // userId performing assignment
};

/**
 * PlansService
 */
class PlansService {
  /**
   * Create a new plan (admin only — controllers must enforce RBAC)
   */
  async createPlan(input: PlanInput) {
    try {
      // Basic server-side validation
      if (!input.name || !input.slug) throw Errors.Validation("Plan name and slug required");
      if (!Number.isInteger(input.priceMonthlyCents) || input.priceMonthlyCents < 0)
        throw Errors.Validation("priceMonthlyCents must be a non-negative integer");

      const existing = await prisma.plan.findUnique({ where: { slug: input.slug } });
      if (existing) throw Errors.Duplicate("Plan slug already exists");

      const created = await prisma.plan.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          priceMonthlyCents: input.priceMonthlyCents,
          priceYearlyCents: input.priceYearlyCents ?? null,
          athleteLimit: input.athleteLimit,
          storageLimitMb: input.storageLimitMb,
          videoUploadLimitMb: input.videoUploadLimitMb,
          features: input.features ?? {},
          active: input.active ?? true,
          metadata: input.metadata ?? {},
        },
      });

      // Invalidate cache
      planCache = null;
      logger.info(`[PLANS] Created plan ${created.slug} (${created.id})`);
      return created;
    } catch (err: any) {
      logger.error("[PLANS] createPlan error", { err });
      throw err instanceof Errors.ApiError ? err : Errors.Server("Failed to create plan");
    }
  }

  /**
   * Update existing plan
   */
  async updatePlan(planId: string, patch: Partial<PlanInput>) {
    try {
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) throw Errors.NotFound("Plan not found");

      const updated = await prisma.plan.update({
        where: { id: planId },
        data: {
          name: patch.name ?? undefined,
          description: patch.description ?? undefined,
          priceMonthlyCents: patch.priceMonthlyCents ?? undefined,
          priceYearlyCents: patch.priceYearlyCents ?? undefined,
          athleteLimit: typeof patch.athleteLimit !== "undefined" ? patch.athleteLimit : undefined,
          storageLimitMb: typeof patch.storageLimitMb !== "undefined" ? patch.storageLimitMb : undefined,
          videoUploadLimitMb:
            typeof patch.videoUploadLimitMb !== "undefined" ? patch.videoUploadLimitMb : undefined,
          features: patch.features ?? undefined,
          active: typeof patch.active !== "undefined" ? patch.active : undefined,
          metadata: patch.metadata ?? undefined,
        },
      });

      planCache = null;
      logger.info(`[PLANS] Updated plan ${updated.slug} (${updated.id})`);
      return updated;
    } catch (err: any) {
      logger.error("[PLANS] updatePlan error", { err });
      throw err instanceof Errors.ApiError ? err : Errors.Server("Failed to update plan");
    }
  }

  /**
   * Soft-delete (deactivate) a plan (safer than hard delete)
   */
  async deactivatePlan(planId: string) {
    try {
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) throw Errors.NotFound("Plan not found");

      await prisma.plan.update({ where: { id: planId }, data: { active: false } });
      planCache = null;
      logger.info(`[PLANS] Deactivated plan ${plan.slug}`);
      return true;
    } catch (err: any) {
      logger.error("[PLANS] deactivatePlan error", { err });
      throw Errors.Server("Failed to deactivate plan");
    }
  }

  /**
   * List plans (with cache)
   */
  async listPlans({ includeInactive = false } = {}) {
    try {
      // Serve from cache if valid and includeInactive=false
      if (!includeInactive && planCache && Date.now() - planCache.timestamp < CACHE_TTL) {
        return planCache.plans;
      }

      const where: any = {};
      if (!includeInactive) where.active = true;

      const plans = await prisma.plan.findMany({
        where,
        orderBy: { priceMonthlyCents: "asc" },
      });

      if (!includeInactive) {
        planCache = { timestamp: Date.now(), plans };
      }

      return plans;
    } catch (err: any) {
      logger.error("[PLANS] listPlans error", { err });
      throw Errors.Server("Failed to list plans");
    }
  }

  /**
   * Get plan by id or slug
   */
  async getPlan({ id, slug }: { id?: string; slug?: string }) {
    try {
      if (!id && !slug) throw Errors.Validation("id or slug required");
      const plan = id
        ? await prisma.plan.findUnique({ where: { id } })
        : await prisma.plan.findUnique({ where: { slug } });
      if (!plan) throw Errors.NotFound("Plan not found");
      return plan;
    } catch (err: any) {
      logger.error("[PLANS] getPlan error", { err });
      throw err instanceof Errors.ApiError ? err : Errors.Server("Failed to fetch plan");
    }
  }

  /**
   * Assign a plan to an institution (subscribe / trial / manual)
   *
   * This operation:
   *  - Validates institution exists
   *  - Optionally creates billing record via paymentService (not implemented here)
   *  - Writes InstitutionPlan assignment with startsAt / endsAt / status
   *  - Uses transaction to ensure atomicity
   */
  async assignPlanToInstitution(input: AssignPlanInput) {
    const { institutionId, planId, startsAt, billingCycle = "monthly", trialDays = 0, initiatedBy } = input;

    try {
      const [institution, plan] = await Promise.all([
        prisma.institution.findUnique({ where: { id: institutionId } }),
        prisma.plan.findUnique({ where: { id: planId } }),
      ]);
      if (!institution) throw Errors.NotFound("Institution not found");
      if (!plan) throw Errors.NotFound("Plan not found");
      if (!plan.active) throw Errors.BadRequest("Cannot assign inactive plan");

      const start = startsAt ?? new Date();
      let endsAt: Date | null = null;

      // trial handling
      if (trialDays && trialDays > 0) {
        endsAt = new Date(start.getTime() + trialDays * 24 * 60 * 60 * 1000);
      } else {
        // default billing cycle -> compute endsAt
        if (billingCycle === "monthly") {
          endsAt = new Date(start);
          endsAt.setMonth(endsAt.getMonth() + 1);
        } else {
          endsAt = new Date(start);
          endsAt.setFullYear(endsAt.getFullYear() + 1);
        }
      }

      const assigned = await prisma.$transaction(async (tx) => {
        // Archive existing active assignment for institution (if present)
        await tx.institutionPlan.updateMany({
          where: { institutionId, status: "active" },
          data: { status: "cancelled", cancelledAt: new Date() },
        });

        // Create new assignment
        const created = await tx.institutionPlan.create({
          data: {
            institution: { connect: { id: institutionId } },
            plan: { connect: { id: planId } },
            startsAt: start,
            endsAt,
            billingCycle,
            status: "active",
            trial: !!(trialDays && trialDays > 0),
            metadata: { initiatedBy: initiatedBy ?? null },
          },
        });

        // Optionally, create a billing record / invoice via payment service (left pluggable)
        // await paymentService.createSubscription({ institutionId, planId, billingCycle });

        return created;
      });

      // Notify super-admins / institution owner (best-effort)
      try {
        await addNotificationJob({
          type: "custom",
          recipientId: institution.ownerId || institution.adminId || "", // best-effort
          title: "Subscription activated",
          body: `Your plan "${plan.name}" is now active until ${format(endsAt!, "yyyy-MM-dd")}`,
          channel: ["inApp", "email"],
        });
      } catch (e) {
        logger.warn("[PLANS] notify assignment failed", e);
      }

      logger.info(`[PLANS] Assigned plan ${plan.slug} to institution ${institution.id}`);
      return assigned;
    } catch (err: any) {
      logger.error("[PLANS] assignPlanToInstitution error", { err });
      throw err instanceof Errors.ApiError ? err : Errors.Server("Failed to assign plan");
    }
  }

  /**
   * Get active plan assignment for an institution
   */
  async getActivePlanForInstitution(institutionId: string) {
    try {
      const assn = await prisma.institutionPlan.findFirst({
        where: { institutionId, status: "active" },
        include: { plan: true },
        orderBy: { startsAt: "desc" },
      });
      return assn || null;
    } catch (err: any) {
      logger.error("[PLANS] getActivePlanForInstitution error", { err });
      throw Errors.Server("Failed to fetch active plan");
    }
  }

  /**
   * Check if an institution is within quota for a given action.
   * This delegates to quota rules and returns boolean + details
   */
  async checkQuotaForInstitution(institutionId: string, usage: { athletes?: number; storageMb?: number; videoUploadMb?: number }) {
    try {
      const assignment = await this.getActivePlanForInstitution(institutionId);
      if (!assignment) {
        // no plan -> treat as free/no-plan behavior (deny large usage)
        // We'll return failure with recommended plan
        return {
          ok: false,
          reason: "no_active_plan",
          recommended: await this.listPlans().then((p) => p[0] ?? null),
        };
      }

      const plan = assignment.plan as PrismaPlan;

      // check athlete limit
      if (typeof usage.athletes === "number" && plan.athleteLimit !== null) {
        if (usage.athletes > plan.athleteLimit) {
          return { ok: false, reason: "athlete_limit_exceeded", limit: plan.athleteLimit };
        }
      }

      // storage
      if (typeof usage.storageMb === "number" && plan.storageLimitMb !== null) {
        if (usage.storageMb > plan.storageLimitMb) {
          return { ok: false, reason: "storage_limit_exceeded", limit: plan.storageLimitMb };
        }
      }

      // video upload
      if (typeof usage.videoUploadMb === "number" && plan.videoUploadLimitMb !== null) {
        if (usage.videoUploadMb > plan.videoUploadLimitMb) {
          return { ok: false, reason: "video_limit_exceeded", limit: plan.videoUploadLimitMb };
        }
      }

      return { ok: true };
    } catch (err: any) {
      logger.error("[PLANS] checkQuotaForInstitution error", { err });
      throw Errors.Server("Failed to check quota");
    }
  }

  /**
   * Compute prorated charge when switching plans mid-cycle.
   * Formula (simplified):
   *  - Determine remaining fraction of current period
   *  - Calculate credit for unused portion of old plan
   *  - Charge for remaining portion of new plan
   *
   * Returns numbers in cents: { chargeCents, creditCents, netCents }
   */
  async computeProratedCharge(params: {
    institutionId: string;
    newPlanId: string;
    now?: Date;
  }) {
    try {
      const now = params.now ?? new Date();
      const [assignment, newPlan] = await Promise.all([
        prisma.institutionPlan.findFirst({
          where: { institutionId: params.institutionId, status: "active" },
          include: { plan: true },
        }),
        prisma.plan.findUnique({ where: { id: params.newPlanId } }),
      ]);

      if (!newPlan) throw Errors.NotFound("New plan not found");

      // If no assignment or no billing, treat as full charge for new plan
      if (!assignment || !assignment.endsAt || !assignment.startsAt) {
        const charge = (assignment?.billingCycle === "yearly" ? newPlan.priceYearlyCents ?? 0 : newPlan.priceMonthlyCents) ?? newPlan.priceMonthlyCents;
        return { chargeCents: charge, creditCents: 0, netCents: charge };
      }

      const oldPlan = assignment.plan as PrismaPlan;
      const periodStart = assignment.startsAt;
      const periodEnd = assignment.endsAt;
      const totalMs = Math.max(1, periodEnd.getTime() - periodStart.getTime());
      const remainingMs = Math.max(0, periodEnd.getTime() - now.getTime());
      const remainingFraction = remainingMs / totalMs;

      // choose billing basis
      const oldPrice = assignment.billingCycle === "yearly" ? (oldPlan.priceYearlyCents ?? oldPlan.priceMonthlyCents) : oldPlan.priceMonthlyCents;
      const newPrice = assignment.billingCycle === "yearly" ? (newPlan.priceYearlyCents ?? newPlan.priceMonthlyCents) : newPlan.priceMonthlyCents;

      const credit = Math.round(oldPrice * remainingFraction);
      const charge = Math.round(newPrice * remainingFraction);

      const net = Math.max(0, charge - credit);

      return { chargeCents: charge, creditCents: credit, netCents: net };
    } catch (err: any) {
      logger.error("[PLANS] computeProratedCharge error", { err });
      throw Errors.Server("Failed to compute proration");
    }
  }

  /**
   * Periodic housekeeping: expire plans which reached endsAt
   * Intended to be called from billing.worker cron
   */
  async expireDueAssignments() {
    try {
      const now = new Date();
      const due = await prisma.institutionPlan.findMany({
        where: { status: "active", endsAt: { lt: now } },
      });

      for (const d of due) {
        try {
          await prisma.institutionPlan.update({ where: { id: d.id }, data: { status: "expired", expiredAt: new Date() } });
          logger.info(`[PLANS] Expired assignment ${d.id} for institution ${d.institutionId}`);

          // Notify institution owners
          await addNotificationJob({
            type: "custom",
            recipientId: d.institutionId, // best-effort - controllers should map to userId
            title: "Subscription expired",
            body: `Your subscription expired on ${format(d.endsAt!, "yyyy-MM-dd")}. Please renew to avoid service disruption.`,
            channel: ["inApp", "email"],
          });
        } catch (e) {
          logger.warn("[PLANS] expire assignment error", e);
        }
      }

      return due.length;
    } catch (err: any) {
      logger.error("[PLANS] expireDueAssignments error", { err });
      throw Errors.Server("Failed to expire assignments");
    }
  }
}

/** Export singleton */
export const plansService = new PlansService();
export default plansService;
```0
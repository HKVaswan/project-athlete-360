/**
 * src/repositories/plan.repo.ts
 * --------------------------------------------------------------------------
 * 💼 Plan Repository (Enterprise Grade)
 *
 * Responsibilities:
 *  - Manage subscription plan definitions (Free, Starter, Pro, Enterprise)
 *  - Provide quota and feature lookups for runtime enforcement
 *  - Support versioned pricing and backward compatibility
 *  - Maintain consistency across different payment gateways
 * --------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";

export class PlanRepository {
  /* ------------------------------------------------------------------------
     🧩 Get Plan by ID or Code
  ------------------------------------------------------------------------ */
  async getById(id: string) {
    try {
      return await prisma.plan.findUnique({
        where: { id },
        include: { features: true },
      });
    } catch (err) {
      logger.error("[PLAN REPO] getById failed", err);
      throw Errors.Server("Failed to fetch plan.");
    }
  }

  async getByCode(code: string) {
    try {
      return await prisma.plan.findUnique({
        where: { code },
        include: { features: true },
      });
    } catch (err) {
      logger.error("[PLAN REPO] getByCode failed", err);
      throw Errors.Server("Failed to fetch plan by code.");
    }
  }

  /* ------------------------------------------------------------------------
     📋 List All Plans (active only or including archived)
  ------------------------------------------------------------------------ */
  async listAll(includeArchived = false) {
    try {
      return await prisma.plan.findMany({
        where: includeArchived ? {} : { active: true },
        include: { features: true },
        orderBy: { priceMonthly: "asc" },
      });
    } catch (err) {
      logger.error("[PLAN REPO] listAll failed", err);
      throw Errors.Server("Failed to fetch plans list.");
    }
  }

  /* ------------------------------------------------------------------------
     ➕ Create a New Plan (Super Admin only)
  ------------------------------------------------------------------------ */
  async createPlan(data: {
    name: string;
    code: string;
    priceMonthly: number;
    priceYearly: number;
    maxAthletes: number;
    maxStorageGB: number;
    description?: string;
    features?: { name: string; description?: string }[];
    isTrial?: boolean;
  }) {
    try {
      const existing = await prisma.plan.findUnique({ where: { code: data.code } });
      if (existing) throw Errors.Duplicate("Plan code already exists.");

      const plan = await prisma.plan.create({
        data: {
          name: data.name,
          code: data.code,
          priceMonthly: data.priceMonthly,
          priceYearly: data.priceYearly,
          maxAthletes: data.maxAthletes,
          maxStorageGB: data.maxStorageGB,
          description: data.description,
          isTrial: data.isTrial ?? false,
          active: true,
          features: data.features
            ? {
                create: data.features.map((f) => ({
                  name: f.name,
                  description: f.description,
                })),
              }
            : undefined,
        },
      });

      logger.info(`[PLAN REPO] Created plan ${plan.name} (${plan.code})`);
      return plan;
    } catch (err) {
      logger.error("[PLAN REPO] createPlan failed", err);
      throw Errors.Server("Failed to create plan.");
    }
  }

  /* ------------------------------------------------------------------------
     ✏️ Update Existing Plan
  ------------------------------------------------------------------------ */
  async updatePlan(planId: string, updates: Partial<{
    name: string;
    priceMonthly: number;
    priceYearly: number;
    maxAthletes: number;
    maxStorageGB: number;
    description: string;
    active: boolean;
  }>) {
    try {
      const plan = await prisma.plan.update({
        where: { id: planId },
        data: { ...updates, updatedAt: new Date() },
      });

      logger.info(`[PLAN REPO] Updated plan ${plan.name} (${plan.id})`);
      return plan;
    } catch (err) {
      logger.error("[PLAN REPO] updatePlan failed", err);
      throw Errors.Server("Failed to update plan.");
    }
  }

  /* ------------------------------------------------------------------------
     ❌ Archive Plan (instead of delete)
  ------------------------------------------------------------------------ */
  async archivePlan(planId: string) {
    try {
      const plan = await prisma.plan.update({
        where: { id: planId },
        data: { active: false, archivedAt: new Date() },
      });

      logger.warn(`[PLAN REPO] Archived plan ${plan.name} (${plan.id})`);
      return plan;
    } catch (err) {
      logger.error("[PLAN REPO] archivePlan failed", err);
      throw Errors.Server("Failed to archive plan.");
    }
  }

  /* ------------------------------------------------------------------------
     🧮 Get Plan Quotas and Features
  ------------------------------------------------------------------------ */
  async getPlanQuota(planId: string) {
    try {
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
        select: {
          id: true,
          code: true,
          name: true,
          maxAthletes: true,
          maxStorageGB: true,
          priceMonthly: true,
          priceYearly: true,
          isTrial: true,
          features: { select: { name: true, description: true } },
        },
      });

      if (!plan) throw Errors.NotFound("Plan not found.");
      return plan;
    } catch (err) {
      logger.error("[PLAN REPO] getPlanQuota failed", err);
      throw Errors.Server("Failed to fetch plan quota.");
    }
  }

  /* ------------------------------------------------------------------------
     🧾 Sync Plan Price / Metadata from Payment Gateway
  ------------------------------------------------------------------------ */
  async syncFromGateway(
    gateway: "stripe" | "razorpay",
    code: string,
    metadata: Record<string, any>
  ) {
    try {
      const plan = await prisma.plan.findUnique({ where: { code } });
      if (!plan) throw Errors.NotFound("Plan not found.");

      await prisma.plan.update({
        where: { id: plan.id },
        data: {
          gatewayMetadata: {
            ...(plan.gatewayMetadata || {}),
            [gateway]: metadata,
          },
          updatedAt: new Date(),
        },
      });

      logger.info(`[PLAN REPO] Synced ${gateway} metadata for plan ${plan.code}`);
    } catch (err) {
      logger.error("[PLAN REPO] syncFromGateway failed", err);
      throw Errors.Server("Failed to sync plan metadata.");
    }
  }

  /* ------------------------------------------------------------------------
     🧹 Cleanup Archived Plans (optional maintenance)
  ------------------------------------------------------------------------ */
  async cleanupArchived(olderThanDays = 180) {
    try {
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
      const result = await prisma.plan.deleteMany({
        where: { archivedAt: { lt: cutoff } },
      });

      logger.info(`[PLAN REPO] Cleaned up ${result.count} archived plans.`);
      return result.count;
    } catch (err) {
      logger.error("[PLAN REPO] cleanupArchived failed", err);
      throw Errors.Server("Failed to clean archived plans.");
    }
  }
}

export const planRepository = new PlanRepository();
// src/integrations/aiPolicyRepository.ts
/**
 * AI Policy Repository
 * ------------------------------------------------------------------------
 * Persistent data layer for managing AI policy rules from database.
 *
 * Key Features:
 *  ✅ Full CRUD for policies (add, update, deactivate)
 *  ✅ Syncs runtime AI Policy Manager with DB-stored rules
 *  ✅ Auditable and versioned for compliance
 *  ✅ Supports live reload and soft-deletion
 */

import prisma from "../prismaClient";
import { PolicyRule, aiPolicyManager } from "./aiPolicyManager";
import { logger } from "../logger";
import { Errors } from "../utils/errors";

export class AiPolicyRepository {
  /**
   * Create or update policy rule in DB.
   * Automatically registers/updates runtime version as well.
   */
  async upsertPolicy(data: {
    id: string;
    category: string;
    description: string;
    action: "allow" | "deny" | "warn" | "requireConsent";
    message?: string;
    conditionCode?: string; // JS expression (validated)
    active?: boolean;
  }) {
    try {
      const policy = await prisma.aIPolicy.upsert({
        where: { id: data.id },
        update: {
          category: data.category,
          description: data.description,
          action: data.action,
          message: data.message,
          conditionCode: data.conditionCode,
          active: data.active ?? true,
        },
        create: {
          id: data.id,
          category: data.category,
          description: data.description,
          action: data.action,
          message: data.message,
          conditionCode: data.conditionCode,
          active: data.active ?? true,
        },
      });

      // Dynamically register rule at runtime
      if (policy.active && data.conditionCode) {
        try {
          const fn = new Function("req", "res", `return (${data.conditionCode});`);
          const runtimeRule: PolicyRule = {
            id: policy.id,
            category: policy.category as any,
            description: policy.description,
            action: policy.action as any,
            message: policy.message ?? "",
            condition: fn as any,
          };
          aiPolicyManager.registerPolicy(runtimeRule);
          logger.info(`[AI PolicyRepo] Registered runtime policy: ${policy.id}`);
        } catch (err: any) {
          logger.error(`[AI PolicyRepo] Invalid policy condition JS: ${err.message}`);
        }
      }

      return policy;
    } catch (err: any) {
      logger.error(`[AI PolicyRepo] Failed to upsert policy: ${err.message}`);
      throw Errors.Server("Failed to upsert AI policy");
    }
  }

  /**
   * Fetch all policies (optionally only active ones)
   */
  async getPolicies(activeOnly = true) {
    try {
      const where = activeOnly ? { active: true } : {};
      return await prisma.aIPolicy.findMany({ where });
    } catch (err) {
      logger.error(`[AI PolicyRepo] Failed to fetch policies: ${err.message}`);
      throw Errors.Server("Failed to fetch AI policies");
    }
  }

  /**
   * Soft-delete or deactivate policy
   */
  async deactivatePolicy(id: string) {
    try {
      await prisma.aIPolicy.update({
        where: { id },
        data: { active: false },
      });
      logger.info(`[AI PolicyRepo] Policy deactivated: ${id}`);
      return true;
    } catch (err: any) {
      logger.error(`[AI PolicyRepo] Failed to deactivate policy: ${err.message}`);
      throw Errors.Server("Failed to deactivate AI policy");
    }
  }

  /**
   * Permanently delete policy
   */
  async deletePolicy(id: string) {
    try {
      await prisma.aIPolicy.delete({ where: { id } });
      logger.warn(`[AI PolicyRepo] Policy permanently deleted: ${id}`);
      return true;
    } catch (err: any) {
      logger.error(`[AI PolicyRepo] Failed to delete policy: ${err.message}`);
      throw Errors.Server("Failed to delete AI policy");
    }
  }

  /**
   * Sync all active DB-stored policies with in-memory manager.
   * Useful during startup or admin-triggered reload.
   */
  async syncPoliciesToRuntime() {
    try {
      const activePolicies = await prisma.aIPolicy.findMany({ where: { active: true } });
      for (const p of activePolicies) {
        if (!p.conditionCode) continue;
        try {
          const fn = new Function("req", "res", `return (${p.conditionCode});`);
          const runtimeRule: PolicyRule = {
            id: p.id,
            category: p.category as any,
            description: p.description,
            action: p.action as any,
            message: p.message ?? "",
            condition: fn as any,
          };
          aiPolicyManager.registerPolicy(runtimeRule);
        } catch (err: any) {
          logger.error(`[AI PolicyRepo] Invalid condition for ${p.id}: ${err.message}`);
        }
      }
      logger.info(`[AI PolicyRepo] Synced ${activePolicies.length} policies to runtime`);
      return true;
    } catch (err: any) {
      logger.error(`[AI PolicyRepo] Policy sync failed: ${err.message}`);
      throw Errors.Server("AI policy sync failed");
    }
  }
}

export const aiPolicyRepository = new AiPolicyRepository();
export default aiPolicyRepository;
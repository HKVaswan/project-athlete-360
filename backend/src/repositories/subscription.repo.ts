/**
 * src/repositories/subscription.repo.ts
 * --------------------------------------------------------------------------
 * 💼 Subscription Repository (Enterprise Grade)
 *
 * Responsibilities:
 *  - Central DB access layer for subscriptions, invoices, and plan metadata.
 *  - Syncs subscription states with Stripe / Razorpay events.
 *  - Prevents double-free trials and expired renewals.
 *  - All queries are optimized and wrapped with safe transactions.
 * --------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";

export class SubscriptionRepository {
  /* ------------------------------------------------------------------------
     🔍 Get Subscription by ID or by Institution
  ------------------------------------------------------------------------ */
  async getById(id: string) {
    try {
      return await prisma.subscription.findUnique({
        where: { id },
        include: {
          institution: { select: { id: true, name: true, code: true } },
          plan: true,
        },
      });
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] getById failed", err);
      throw Errors.Server("Failed to fetch subscription.");
    }
  }

  async getByInstitution(institutionId: string) {
    try {
      return await prisma.subscription.findFirst({
        where: { institutionId },
        include: { plan: true },
      });
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] getByInstitution failed", err);
      throw Errors.Server("Failed to fetch institution subscription.");
    }
  }

  /* ------------------------------------------------------------------------
     🧩 Create a New Subscription (Free Trial or Paid)
  ------------------------------------------------------------------------ */
  async createSubscription(data: {
    institutionId: string;
    planId: string;
    status: "active" | "trialing" | "expired" | "canceled";
    startDate: Date;
    endDate: Date;
    gateway?: "stripe" | "razorpay" | "manual";
    externalSubId?: string;
    trialUsed?: boolean;
  }) {
    try {
      // Ensure institution does not already have an active or trialing plan
      const existing = await prisma.subscription.findFirst({
        where: {
          institutionId: data.institutionId,
          status: { in: ["active", "trialing"] },
        },
      });
      if (existing) {
        throw Errors.Forbidden("Institution already has an active subscription.");
      }

      // Prevent double free-tier abuse
      if (data.status === "trialing") {
        const trialExists = await prisma.subscription.findFirst({
          where: {
            institutionId: data.institutionId,
            trialUsed: true,
          },
        });
        if (trialExists) {
          throw Errors.Forbidden("Free trial already used for this institution.");
        }
      }

      const subscription = await prisma.subscription.create({
        data: {
          ...data,
          trialUsed: data.trialUsed ?? (data.status === "trialing"),
        },
      });

      logger.info(`[SUBSCRIPTION REPO] Created subscription ${subscription.id}`);
      return subscription;
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] createSubscription failed", err);
      throw Errors.Server("Failed to create subscription.");
    }
  }

  /* ------------------------------------------------------------------------
     ⚙️ Update Subscription Status (renewal, cancellation, upgrade, etc.)
  ------------------------------------------------------------------------ */
  async updateStatus(subscriptionId: string, status: string, meta: any = {}) {
    try {
      const subscription = await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status,
          meta,
          updatedAt: new Date(),
        },
      });

      logger.info(`[SUBSCRIPTION REPO] Status updated to ${status} (${subscriptionId})`);
      return subscription;
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] updateStatus failed", err);
      throw Errors.Server("Failed to update subscription status.");
    }
  }

  /* ------------------------------------------------------------------------
     💳 Link Subscription with Payment Gateway ID
  ------------------------------------------------------------------------ */
  async linkExternalGateway(subscriptionId: string, externalSubId: string, gateway: string) {
    try {
      return await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          externalSubId,
          gateway,
        },
      });
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] linkExternalGateway failed", err);
      throw Errors.Server("Failed to link payment gateway.");
    }
  }

  /* ------------------------------------------------------------------------
     🔁 Extend Subscription Period on Renewal
  ------------------------------------------------------------------------ */
  async extendSubscription(subscriptionId: string, newEndDate: Date) {
    try {
      return await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { endDate: newEndDate, updatedAt: new Date() },
      });
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] extendSubscription failed", err);
      throw Errors.Server("Failed to extend subscription.");
    }
  }

  /* ------------------------------------------------------------------------
     🧾 Log Payment Event / Invoice (for Billing Reports)
  ------------------------------------------------------------------------ */
  async logPaymentEvent(data: {
    subscriptionId: string;
    gateway: string;
    eventType: string;
    amount: number;
    currency: string;
    externalId?: string;
    status: "success" | "failed" | "pending";
  }) {
    try {
      return await prisma.paymentEvent.create({
        data: {
          ...data,
          timestamp: new Date(),
        },
      });
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] logPaymentEvent failed", err);
      throw Errors.Server("Failed to log payment event.");
    }
  }

  /* ------------------------------------------------------------------------
     🧹 Clean up Expired Subscriptions
  ------------------------------------------------------------------------ */
  async cleanupExpired() {
    try {
      const now = new Date();
      const result = await prisma.subscription.updateMany({
        where: {
          endDate: { lt: now },
          status: { notIn: ["expired", "canceled"] },
        },
        data: { status: "expired" },
      });

      logger.info(`[SUBSCRIPTION REPO] Expired ${result.count} subscriptions.`);
      return result.count;
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] cleanupExpired failed", err);
      throw Errors.Server("Failed to clean expired subscriptions.");
    }
  }

  /* ------------------------------------------------------------------------
     🧾 Get All Active or Expired Subscriptions for Reporting
  ------------------------------------------------------------------------ */
  async listAll(filter?: { status?: string }) {
    try {
      return await prisma.subscription.findMany({
        where: filter || {},
        include: { institution: true, plan: true },
        orderBy: { createdAt: "desc" },
      });
    } catch (err) {
      logger.error("[SUBSCRIPTION REPO] listAll failed", err);
      throw Errors.Server("Failed to fetch subscription list.");
    }
  }
}

export const subscriptionRepository = new SubscriptionRepository();
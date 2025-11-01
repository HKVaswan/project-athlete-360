/**
 * src/controllers/subscription.controller.ts
 * ---------------------------------------------------------------------------
 * 💼 Subscription Controller (Enterprise Grade)
 *
 * Responsibilities:
 *  - Handles subscription lifecycle: creation, renewal, upgrade, downgrade.
 *  - Prevents free-tier abuse and enforces plan-based quotas.
 *  - Integrates with payment gateways (Stripe, Razorpay).
 *  - Automatically updates usage limits via QuotaService.
 *  - Supports webhook-triggered billing updates (for async confirmations).
 *  - Fully audited for Super Admin visibility.
 * ---------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { subscriptionService } from "../services/subscription.service";
import { plansService } from "../services/plans.service";
import { billingService } from "../services/billing.service";
import { quotaService } from "../services/quota.service";
import { reconciliationService } from "../services/reconciliation.service";
import { logger } from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { recordAuditEvent } from "../services/audit.service";
import { prisma } from "../prismaClient";
import { createSuperAdminAlert } from "../services/superAdminAlerts.service";

/* -----------------------------------------------------------------------
   🧩 Middleware Utility
------------------------------------------------------------------------*/
const getInstitutionAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || !["institution_admin", "super_admin"].includes(user.role)) {
    throw Errors.Forbidden("Access denied: Institution admin privileges required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   🎯 1. Subscribe to a plan
------------------------------------------------------------------------*/
export const createSubscription = async (req: Request, res: Response) => {
  try {
    const admin = getInstitutionAdmin(req);
    const { planId, paymentProvider, paymentMethodId } = req.body;

    if (!planId || !paymentProvider) {
      throw Errors.Validation("Plan ID and payment provider are required.");
    }

    // Ensure plan exists
    const plan = await plansService.getPlanById(planId);
    if (!plan) throw Errors.NotFound("Selected plan not found.");

    // Ensure institution not exceeding limits or reusing free tier
    await subscriptionService.validateNewSubscription(admin.id, plan);

    // Create payment intent and subscription record
    const paymentIntent = await billingService.createPaymentIntent({
      institutionId: admin.institutionId,
      planId,
      provider: paymentProvider,
      methodId: paymentMethodId,
      amount: plan.price,
    });

    const subscription = await subscriptionService.createSubscription({
      institutionId: admin.institutionId,
      planId,
      paymentProvider,
      paymentReference: paymentIntent.id,
    });

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "SUBSCRIPTION_CREATED",
      details: { planId, paymentProvider, amount: plan.price },
    });

    res.json({
      success: true,
      message: "Subscription created successfully. Complete payment to activate.",
      data: {
        subscription,
        paymentIntent,
      },
    });
  } catch (err: any) {
    logger.error("[SUBSCRIPTION] ❌ createSubscription failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔁 2. Renew subscription (manual or auto)
------------------------------------------------------------------------*/
export const renewSubscription = async (req: Request, res: Response) => {
  try {
    const admin = getInstitutionAdmin(req);
    const { subscriptionId } = req.body;

    if (!subscriptionId) throw Errors.Validation("Subscription ID required.");

    const renewed = await subscriptionService.renewSubscription(subscriptionId, admin.id);

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "SUBSCRIPTION_RENEWED",
      details: { subscriptionId },
    });

    res.json({
      success: true,
      message: "Subscription renewed successfully.",
      data: renewed,
    });
  } catch (err: any) {
    logger.error("[SUBSCRIPTION] ❌ renewSubscription failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🔼 3. Upgrade or downgrade plan
------------------------------------------------------------------------*/
export const changePlan = async (req: Request, res: Response) => {
  try {
    const admin = getInstitutionAdmin(req);
    const { newPlanId } = req.body;

    if (!newPlanId) throw Errors.Validation("New plan ID is required.");

    const result = await subscriptionService.changePlan(admin.institutionId, newPlanId);

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "PLAN_CHANGED",
      details: { newPlanId },
    });

    res.json({
      success: true,
      message: "Plan updated successfully.",
      data: result,
    });
  } catch (err: any) {
    logger.error("[SUBSCRIPTION] ❌ changePlan failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   ⏹️ 4. Cancel subscription
------------------------------------------------------------------------*/
export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const admin = getInstitutionAdmin(req);
    const { reason } = req.body;

    const result = await subscriptionService.cancelSubscription(admin.institutionId, reason);

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "SUBSCRIPTION_CANCELLED",
      details: { reason },
    });

    res.json({
      success: true,
      message: "Subscription cancelled successfully.",
      data: result,
    });
  } catch (err: any) {
    logger.error("[SUBSCRIPTION] ❌ cancelSubscription failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   📊 5. Get subscription & usage details
------------------------------------------------------------------------*/
export const getSubscriptionDetails = async (req: Request, res: Response) => {
  try {
    const admin = getInstitutionAdmin(req);

    const subscription = await subscriptionService.getActiveSubscription(admin.institutionId);
    if (!subscription) throw Errors.NotFound("No active subscription found.");

    const quota = await quotaService.getUsageSummary(admin.institutionId);

    res.json({
      success: true,
      data: { subscription, quota },
    });
  } catch (err: any) {
    logger.error("[SUBSCRIPTION] ❌ getSubscriptionDetails failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧾 6. Trigger reconciliation (super admin only)
------------------------------------------------------------------------*/
export const triggerReconciliation = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== "super_admin") throw Errors.Forbidden("Only Super Admin can trigger reconciliation.");

    const result = await reconciliationService.runFullReconciliation();

    await recordAuditEvent({
      actorId: user.id,
      actorRole: "super_admin",
      action: "RECONCILIATION_RUN",
      details: { summary: result },
    });

    await createSuperAdminAlert({
      title: "Reconciliation Executed",
      message: `Super Admin ${user.username} triggered reconciliation manually.`,
      category: "system",
      severity: "medium",
    });

    res.json({
      success: true,
      message: "Reconciliation completed successfully.",
      data: result,
    });
  } catch (err: any) {
    logger.error("[SUBSCRIPTION] ❌ triggerReconciliation failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   🧭 7. Webhook endpoint for async billing updates
------------------------------------------------------------------------*/
export const handlePaymentWebhook = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const event = req.body;

    await billingService.handleWebhook(provider, event);

    res.status(200).json({ success: true });
  } catch (err: any) {
    logger.error("[SUBSCRIPTION] ❌ handlePaymentWebhook failed", { err });
    res.status(400).json({ success: false, error: "Webhook handling failed." });
  }
};
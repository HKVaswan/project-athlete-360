/**
 * src/controllers/superAdmin/subscriptionAdmin.controller.ts
 * ---------------------------------------------------------------------
 * Super Admin Subscription Controller
 *
 * Responsibilities:
 *  - View and manage all institutional subscriptions
 *  - Override plan assignments (upgrade, downgrade, cancel)
 *  - Trigger reconciliation or sync with payment gateways
 *  - Fully audited and access-controlled for "super_admin" only
 * ---------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { prisma } from "../../prismaClient";
import { sendErrorResponse, Errors } from "../../utils/errors";
import { logger } from "../../logger";
import { auditService } from "../../services/audit.service";
import { reconciliationService } from "../../services/reconciliation.service";
import { billingService } from "../../services/billing.service";
import { plansService } from "../../services/plans.service";

/* ---------------------------------------------------------------
   🧱 Utility: Verify Super Admin Access
----------------------------------------------------------------*/
const requireSuperAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    throw Errors.Forbidden("Access denied. Super admin privileges required.");
  }
  return user;
};

/* ---------------------------------------------------------------
   📋 1. List All Subscriptions
----------------------------------------------------------------*/
export const listAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { status, planId } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (planId) where.planId = planId;

    const subscriptions = await prisma.subscription.findMany({
      where,
      include: {
        institution: { select: { id: true, name: true, code: true } },
        plan: { select: { id: true, name: true, pricePerMonth: true, tier: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "VIEW_SUBSCRIPTIONS",
      details: { count: subscriptions.length, filter: where },
      ip: req.ip,
    });

    res.json({ success: true, data: subscriptions });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   🔍 2. Get Subscription Details by ID
----------------------------------------------------------------*/
export const getSubscriptionDetails = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { id } = req.params;

    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        institution: true,
        plan: true,
        payments: true,
      },
    });

    if (!subscription) throw Errors.NotFound("Subscription not found.");

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "VIEW_SUBSCRIPTION_DETAIL",
      details: { subscriptionId: id },
      ip: req.ip,
    });

    res.json({ success: true, data: subscription });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   ♻️ 3. Manually Update Plan or Status
----------------------------------------------------------------*/
export const updateSubscription = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { subscriptionId, newPlanId, status } = req.body;

    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { institution: true },
    });

    if (!subscription) throw Errors.NotFound("Subscription not found.");

    const updates: any = {};
    if (newPlanId) updates.planId = newPlanId;
    if (status) updates.status = status;

    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: updates,
    });

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "UPDATE_SUBSCRIPTION",
      details: { subscriptionId, updates },
      ip: req.ip,
    });

    logger.info(
      `[SUPERADMIN] Subscription ${subscriptionId} updated by ${superAdmin.email}`,
      { updates }
    );

    res.json({
      success: true,
      message: "Subscription updated successfully.",
      data: updated,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   ❌ 4. Cancel Subscription (Force Stop)
----------------------------------------------------------------*/
export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { subscriptionId, reason } = req.body;

    const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) throw Errors.NotFound("Subscription not found.");

    const updated = await billingService.forceCancelSubscription(subscriptionId, reason);

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "FORCE_CANCEL_SUBSCRIPTION",
      details: { subscriptionId, reason },
      ip: req.ip,
    });

    logger.warn(`[SUPERADMIN] Subscription ${subscriptionId} forcibly cancelled: ${reason}`);

    res.json({
      success: true,
      message: "Subscription forcibly cancelled.",
      data: updated,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   🔄 5. Trigger Payment Reconciliation
----------------------------------------------------------------*/
export const triggerReconciliation = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const { subscriptionId } = req.body;

    await reconciliationService.runForSubscription(subscriptionId);

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "TRIGGER_RECONCILIATION",
      details: { subscriptionId },
      ip: req.ip,
    });

    logger.info(`[SUPERADMIN] Reconciliation triggered for ${subscriptionId}`);

    res.json({
      success: true,
      message: "Reconciliation job triggered successfully.",
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ---------------------------------------------------------------
   🧭 6. View Expiring Soon Subscriptions
----------------------------------------------------------------*/
export const listExpiringSubscriptions = async (req: Request, res: Response) => {
  try {
    const superAdmin = requireSuperAdmin(req);
    const thresholdDays = Number(req.query.days) || 7;

    const threshold = new Date();
    threshold.setDate(threshold.getDate() + thresholdDays);

    const expiring = await prisma.subscription.findMany({
      where: {
        nextBillingDate: { lte: threshold },
        status: "active",
      },
      include: {
        institution: { select: { id: true, name: true, code: true } },
        plan: { select: { name: true, tier: true } },
      },
    });

    await auditService.record({
      actorId: superAdmin.id,
      actorRole: "super_admin",
      action: "VIEW_EXPIRING_SUBSCRIPTIONS",
      details: { count: expiring.length, thresholdDays },
      ip: req.ip,
    });

    res.json({
      success: true,
      message: "Expiring subscriptions retrieved successfully.",
      data: expiring,
    });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};
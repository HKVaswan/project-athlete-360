/**
 * src/middleware/subscription.middleware.ts
 * ---------------------------------------------------------------------
 * 💳 Subscription Middleware (Enterprise-Grade)
 * ---------------------------------------------------------------------
 * Responsibilities:
 *  - Verify active subscription for paid users (institutions/admins)
 *  - Enforce plan-based feature restrictions and quotas
 *  - Handle free-tier expiry and prevent multiple free trials
 *  - Auto-lock expired accounts and notify institution admins
 *  - Provide metadata for downstream services (plan, limits)
 * 
 * Integration:
 *  - Works with plans.service.ts and subscription.service.ts
 *  - Sends alerts via superAdminAlerts.service.ts
 *  - Fully auditable through audit.middleware.ts
 * ---------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import { subscriptionService } from "../services/subscription.service";
import { plansService } from "../services/plans.service";
import { quotaService } from "../services/quota.service";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { auditService } from "../lib/audit";
import { Errors } from "../utils/errors";
import logger from "../logger";

/* ---------------------------------------------------------------------
   🧩 Middleware Function
--------------------------------------------------------------------- */

export const verifySubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;

    if (!user) throw Errors.Auth("User authentication required before subscription check.");

    // 🧠 Only institution admins or coaches under an institution have subscriptions
    if (user.role === "super_admin") return next(); // bypass check
    if (!["admin", "coach", "institution_admin"].includes(user.role)) return next();

    const subscription = await subscriptionService.getActiveSubscriptionByUserId(user.id);

    if (!subscription) {
      throw Errors.PaymentRequired("No active subscription found. Please purchase or renew a plan.");
    }

    // 🕒 Check expiry
    const now = new Date();
    if (subscription.expiresAt && now > new Date(subscription.expiresAt)) {
      logger.warn(`[SUBSCRIPTION] Plan expired for user ${user.id}`);
      await subscriptionService.markAsExpired(subscription.id);

      // 🔔 Notify super admin for monitoring
      await superAdminAlertsService.sendAlert({
        type: "subscriptionExpired",
        title: "Subscription Expired",
        body: `Institution plan expired for user ${user.username || user.id}`,
        severity: "medium",
      });

      throw Errors.PaymentRequired("Your subscription has expired. Please renew to continue using the service.");
    }

    // 💎 Attach plan metadata for further use in route
    const plan = await plansService.getPlanById(subscription.planId);
    (req as any).plan = plan;
    (req as any).subscription = subscription;

    // 🚦 Check for plan-based feature restrictions or quotas
    const quotaCheck = await quotaService.checkUsageAgainstQuota(user.id, plan);

    if (!quotaCheck.ok) {
      throw Errors.Forbidden(
        `Plan limit reached: ${quotaCheck.reason || "You’ve exceeded your quota."}`
      );
    }

    // 🧾 Log subscription verification for audit trail
    await auditService.log({
      actorId: user.id,
      actorRole: user.role,
      action: "SUBSCRIPTION_VERIFIED",
      entity: "subscription",
      entityId: subscription.id,
      details: { planName: plan.name, validTill: subscription.expiresAt },
    });

    next();
  } catch (err: any) {
    logger.error(`[SUBSCRIPTION] ❌ Subscription check failed: ${err.message}`);
    res.status(err.statusCode || 403).json({
      success: false,
      code: err.code || "SUBSCRIPTION_ERROR",
      message: err.message || "Subscription check failed.",
    });
  }
};

/* ---------------------------------------------------------------------
   🧱 Middleware: Enforce Specific Plan Features
--------------------------------------------------------------------- */

/**
 * Enforces access to certain premium features based on plan tier.
 * Usage: router.post("/feature", requireFeature("advanced_analytics"), handler)
 */
export const requireFeature =
  (featureKey: string) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const plan = (req as any).plan;
      if (!plan) throw Errors.Server("Plan data not loaded. Ensure verifySubscription runs before this.");

      if (!plan.features || !plan.features.includes(featureKey)) {
        throw Errors.Forbidden(`This feature is not available on your plan. Upgrade required.`);
      }

      await auditService.log({
        actorId: (req as any).user.id,
        actorRole: (req as any).user.role,
        action: "FEATURE_ACCESS_GRANTED",
        entity: "feature",
        details: { featureKey, planName: plan.name },
      });

      next();
    } catch (err: any) {
      logger.warn(`[FEATURE_LIMIT] Access denied for ${featureKey}: ${err.message}`);
      res.status(err.statusCode || 403).json({
        success: false,
        code: err.code || "FEATURE_LIMIT",
        message: err.message,
      });
    }
  };

/* ---------------------------------------------------------------------
   🧠 Middleware: Prevent Multiple Free Trials
--------------------------------------------------------------------- */

export const preventMultipleFreeTrials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    if (!email) return next();

    const hasUsedTrial = await subscriptionService.hasUsedFreeTrial(email);
    if (hasUsedTrial) {
      throw Errors.Forbidden(
        "Free trial already used on this account or institution. Paid plan required to continue."
      );
    }

    next();
  } catch (err: any) {
    logger.error(`[SUBSCRIPTION] ❌ Trial restriction error: ${err.message}`);
    res.status(403).json({
      success: false,
      code: "FREE_TRIAL_LIMIT",
      message: err.message,
    });
  }
};
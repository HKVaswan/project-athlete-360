/**
 * src/routes/admin/subscriptions.ts
 * ---------------------------------------------------------------------
 * Admin Subscription Routes (Institution-Level)
 * ---------------------------------------------------------------------
 * Handles:
 *  - Viewing current plan & quota usage
 *  - Upgrading / downgrading plans
 *  - Managing renewal & cancellation
 *  - Fetching plan catalog (for pricing UI)
 *  - Enforcing quota and plan compliance
 * 
 * Security:
 *  - JWT + Role-based access control
 *  - All actions logged via audit middleware
 *  - Integrated with billing & payment systems
 * ---------------------------------------------------------------------
 */

import express from "express";
import {
  getCurrentPlan,
  listAvailablePlans,
  upgradePlan,
  cancelSubscription,
  renewSubscription,
  getQuotaUsage,
} from "../../controllers/subscription.controller";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/role.middleware";
import { recordAudit } from "../../middleware/audit.middleware";
import { rateLimiter } from "../../middleware/rateLimiter.middleware";

const router = express.Router();

/* ---------------------------------------------------------------------
   🔒 Protected Routes — Admins Only
--------------------------------------------------------------------- */

router.use(authMiddleware);
router.use(requireRole(["admin", "super_admin"]));
router.use(rateLimiter);

/* ---------------------------------------------------------------------
   📦 Subscription Management Endpoints
--------------------------------------------------------------------- */

// 🔍 Get current active plan details
router.get("/current", recordAudit("SUBSCRIPTION_VIEW"), getCurrentPlan);

// 🧾 View quota usage for current plan
router.get("/quota", recordAudit("SUBSCRIPTION_QUOTA_VIEW"), getQuotaUsage);

// 💳 List available plans (from plans.service)
router.get("/plans", recordAudit("SUBSCRIPTION_PLANS_LIST"), listAvailablePlans);

// ⬆️ Upgrade or change plan (creates billing session)
router.post("/upgrade", recordAudit("SUBSCRIPTION_UPGRADE"), upgradePlan);

// 🔁 Renew subscription (manually trigger next billing cycle)
router.post("/renew", recordAudit("SUBSCRIPTION_RENEW"), renewSubscription);

// ❌ Cancel subscription (soft cancel, until end of billing period)
router.post("/cancel", recordAudit("SUBSCRIPTION_CANCEL"), cancelSubscription);

export default router;
/**
 * src/routes/subscriptions.ts
 * ---------------------------------------------------------------------
 * Subscription & Billing Routes
 * ---------------------------------------------------------------------
 * Handles:
 *  - Plan retrieval
 *  - Subscriptions management
 *  - Payment processing (Stripe, Razorpay)
 *  - Webhooks & status verification
 *  - Quota enforcement (middleware-level)
 *
 * Protected endpoints use authentication & role-based guards.
 * ---------------------------------------------------------------------
 */

import express from "express";
import {
  listAvailablePlans,
  getCurrentSubscription,
  createSubscription,
  cancelSubscription,
  upgradeSubscription,
  renewSubscription,
  handlePaymentWebhook,
} from "../controllers/subscription.controller";

import {
  createBillingSession,
  getBillingHistory,
  downloadInvoice,
} from "../controllers/billing.controller";

import { authMiddleware } from "../middleware/auth.middleware";
import { rateLimiter } from "../middleware/rateLimiter.middleware";
import { verifyPlanAccess } from "../middleware/planAccess.middleware";

const router = express.Router();

/* ---------------------------------------------------------------------
   🧾 Public Endpoints (no auth required)
--------------------------------------------------------------------- */

// Get all available plans (Free + Paid)
router.get("/plans", rateLimiter, listAvailablePlans);

// Payment gateway webhook (Stripe / Razorpay callbacks)
router.post("/webhook", express.raw({ type: "application/json" }), handlePaymentWebhook);

/* ---------------------------------------------------------------------
   🔐 Authenticated Endpoints (institution admin / super admin)
--------------------------------------------------------------------- */
router.use(authMiddleware); // Require JWT auth for below routes

// Get current user subscription
router.get("/current", getCurrentSubscription);

// Create new subscription (free or paid)
router.post("/create", verifyPlanAccess, createSubscription);

// Upgrade subscription plan
router.post("/upgrade", verifyPlanAccess, upgradeSubscription);

// Renew existing subscription
router.post("/renew", renewSubscription);

// Cancel active subscription
router.post("/cancel", cancelSubscription);

/* ---------------------------------------------------------------------
   💳 Billing & Invoices
--------------------------------------------------------------------- */

// Generate new billing checkout session
router.post("/billing/session", createBillingSession);

// Fetch billing history
router.get("/billing/history", getBillingHistory);

// Download invoice
router.get("/billing/invoice/:invoiceId", downloadInvoice);

export default router;
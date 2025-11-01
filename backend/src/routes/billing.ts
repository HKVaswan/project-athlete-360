/**
 * src/routes/billing.ts
 * ---------------------------------------------------------------------
 * Billing Routes (Enterprise-Grade)
 * ---------------------------------------------------------------------
 * Handles:
 *  - Invoice generation & retrieval
 *  - Payment confirmation & reconciliation
 *  - Refunds, failed payments & audit logging
 *  - Billing history for institution admins
 *  - Super admin manual overrides (if required)
 *
 * All routes are secured via JWT + role-based access middleware.
 * ---------------------------------------------------------------------
 */

import express from "express";
import {
  createBillingSession,
  getBillingHistory,
  downloadInvoice,
  getInvoiceById,
  confirmPayment,
  issueRefund,
} from "../controllers/billing.controller";

import { authMiddleware } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { rateLimiter } from "../middleware/rateLimiter.middleware";
import { recordAudit } from "../middleware/audit.middleware";

const router = express.Router();

/* ---------------------------------------------------------------------
   💳 Public Payment Webhooks (Stripe / Razorpay)
--------------------------------------------------------------------- */

// Stripe/Razorpay send events directly here (must be raw body)
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  rateLimiter,
  confirmPayment
);

/* ---------------------------------------------------------------------
   🔐 Authenticated Billing Endpoints
--------------------------------------------------------------------- */

router.use(authMiddleware); // Require JWT for all below routes

// Institution admins and super admins can access billing details
router.use(requireRole(["admin", "super_admin"]));

// 🧾 Create a new billing session (checkout)
router.post("/session", recordAudit("BILLING_SESSION_CREATE"), createBillingSession);

// 📋 Fetch billing history
router.get("/history", recordAudit("BILLING_HISTORY_VIEW"), getBillingHistory);

// 📜 Get a single invoice by ID
router.get("/invoice/:invoiceId", recordAudit("BILLING_INVOICE_VIEW"), getInvoiceById);

// ⬇️ Download invoice PDF
router.get("/invoice/:invoiceId/download", recordAudit("BILLING_INVOICE_DOWNLOAD"), downloadInvoice);

// 💰 Issue refund (super admin only)
router.post("/refund/:paymentId", requireRole(["super_admin"]), recordAudit("BILLING_REFUND"), issueRefund);

export default router;
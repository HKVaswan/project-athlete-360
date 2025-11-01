// src/controllers/billing.controller.ts
/**
 * src/controllers/billing.controller.ts
 * ---------------------------------------------------------------------------
 * Enterprise-grade Billing Controller
 *
 * Responsibilities:
 *  - Create payment intents / invoices
 *  - Attach / detach payment methods (card, UPI, wallets)
 *  - Handle immediate charges or authorize-only flows
 *  - Webhook receiver for payment provider events (idempotent & verified)
 *  - Expose billing info / invoices / payment methods for institutions
 *  - Audit + record sensitive actions for Super Admin review
 *
 * Notes:
 *  - Delegates provider specifics to billingService & provider adapters.
 *  - Expects billingService.createPaymentIntent, billingService.confirmPayment, billingService.attachPaymentMethod, billingService.listInvoices, etc.
 *  - All actions are audited via recordAuditEvent (audit.service).
 * ---------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { billingService } from "../services/billing.service";
import { logger } from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { recordAuditEvent } from "../services/audit.service";
import { config } from "../config";
import { reconciliationService } from "../services/reconciliation.service";

/**
 * Helper: Ensure the requester is an institution admin (or super_admin)
 */
const requireBillingAdmin = (req: Request) => {
  const user = (req as any).user;
  if (!user || !["institution_admin", "super_admin"].includes(user.role)) {
    throw Errors.Forbidden("Access denied: billing admin required.");
  }
  return user;
};

/* -----------------------------------------------------------------------
   Create a payment intent (or equivalent) for a plan / invoice / top-up
   - idempotency: client may pass Idempotency-Key header to prevent duplicate charges
------------------------------------------------------------------------- */
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const user = requireBillingAdmin(req);
    const { amount, currency = "INR", paymentProvider, description, metadata = {} } = req.body;

    if (!amount || amount <= 0) throw Errors.Validation("Valid amount required.");

    // allow caller to pass idempotency key (strongly recommended for retries)
    const idempotencyKey = req.header("Idempotency-Key") || undefined;

    // billingService handles provider selection and provider-adapter calls
    const intent = await billingService.createPaymentIntent({
      institutionId: user.institutionId,
      amount,
      currency,
      provider: paymentProvider,
      description,
      metadata,
      idempotencyKey,
      createdBy: user.id,
    });

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "PAYMENT_INTENT_CREATED",
      details: { institutionId: user.institutionId, amount, provider: paymentProvider, intentId: intent.id },
    });

    res.json({ success: true, data: intent });
  } catch (err: any) {
    logger.error("[BILLING] createPaymentIntent failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   Attach a payment method to an institution/customer
   - Example: card token -> attach to customer record
------------------------------------------------------------------------- */
export const attachPaymentMethod = async (req: Request, res: Response) => {
  try {
    const user = requireBillingAdmin(req);
    const { provider, methodToken, saveForFuture = true, metadata = {} } = req.body;

    if (!provider || !methodToken) throw Errors.Validation("Provider and methodToken are required.");

    const pm = await billingService.attachPaymentMethod({
      institutionId: user.institutionId,
      provider,
      methodToken,
      saveForFuture,
      metadata,
      createdBy: user.id,
    });

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "PAYMENT_METHOD_ATTACHED",
      details: { institutionId: user.institutionId, provider, paymentMethodId: pm.id },
    });

    res.json({ success: true, data: pm });
  } catch (err: any) {
    logger.error("[BILLING] attachPaymentMethod failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   Detach / remove saved payment method
------------------------------------------------------------------------- */
export const detachPaymentMethod = async (req: Request, res: Response) => {
  try {
    const user = requireBillingAdmin(req);
    const { paymentMethodId } = req.params;

    if (!paymentMethodId) throw Errors.Validation("paymentMethodId is required.");

    await billingService.detachPaymentMethod({ institutionId: user.institutionId, paymentMethodId });

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "PAYMENT_METHOD_DETACHED",
      details: { institutionId: user.institutionId, paymentMethodId },
    });

    res.json({ success: true, message: "Payment method detached successfully." });
  } catch (err: any) {
    logger.error("[BILLING] detachPaymentMethod failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   Confirm a payment/intent server-side (for providers that require server confirmation)
------------------------------------------------------------------------- */
export const confirmPayment = async (req: Request, res: Response) => {
  try {
    const user = requireBillingAdmin(req);
    const { intentId, provider } = req.body;

    if (!intentId || !provider) throw Errors.Validation("intentId and provider are required.");

    const result = await billingService.confirmPayment({ institutionId: user.institutionId, provider, intentId });

    await recordAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "PAYMENT_CONFIRMED",
      details: { institutionId: user.institutionId, intentId, provider, status: result.status },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error("[BILLING] confirmPayment failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   Fetch billing overview (active subscription, upcoming invoices, balance)
------------------------------------------------------------------------- */
export const getBillingOverview = async (req: Request, res: Response) => {
  try {
    const user = requireBillingAdmin(req);

    const [subscription, invoices, paymentMethods, usage] = await Promise.all([
      billingService.getActiveSubscription(user.institutionId),
      billingService.listInvoices({ institutionId: user.institutionId, limit: 20 }),
      billingService.listPaymentMethods({ institutionId: user.institutionId }),
      billingService.getUsageSummary(user.institutionId),
    ]);

    res.json({
      success: true,
      data: { subscription, invoices, paymentMethods, usage },
    });
  } catch (err: any) {
    logger.error("[BILLING] getBillingOverview failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   List invoices for institution (paginated)
------------------------------------------------------------------------- */
export const listInvoices = async (req: Request, res: Response) => {
  try {
    const user = requireBillingAdmin(req);
    const page = Number(req.query.page || 1);
    const limit = Math.min(Number(req.query.limit || 20), 100);

    const invoices = await billingService.listInvoices({
      institutionId: user.institutionId,
      page,
      limit,
    });

    res.json({ success: true, data: invoices });
  } catch (err: any) {
    logger.error("[BILLING] listInvoices failed", { err });
    sendErrorResponse(res, err);
  }
};

/* -----------------------------------------------------------------------
   Webhook handler: receives events from payment providers (Stripe, Razorpay, etc.)
   - Verifies signature if provider supports it
   - Ensures idempotency (billingService should internally dedupe)
   - Audits important events
------------------------------------------------------------------------- */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const provider = (req.params.provider || "").toLowerCase();
    if (!provider) return res.status(400).json({ success: false, message: "Provider required in route." });

    const rawBody = (req as any).rawBody || JSON.stringify(req.body); // ensure rawBody middleware is set for signature verification
    const signatureHeader = req.headers["stripe-signature"] || req.headers["x-razorpay-signature"] || req.headers["x-provider-signature"];

    // Let billingService verify & parse the event (provider-specific)
    const event = await billingService.parseWebhookEvent({
      provider,
      rawBody,
      signatureHeader: signatureHeader as string | undefined,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    // Process event (idempotent)
    const result = await billingService.handleWebhookEvent({ provider, event });

    // Audit important events (payment succeeded, failed, refund)
    if (["payment_succeeded", "invoice.paid", "payment.captured", "charge.succeeded"].some((k) => (event.type ?? "").includes(k))) {
      await recordAuditEvent({
        actorId: "system",
        actorRole: "system",
        action: "PAYMENT_EVENT",
        details: { provider, eventType: event.type, raw: event, note: "payment success event" },
      });
    }

    res.status(200).json({ success: true });
  } catch (err: any) {
    // If signature verification failed, return 400 to provider
    logger.error("[BILLING] webhook handling failed", { err });
    // attempt to alert super admin if critical
    try {
      if ((err as any)?.critical) {
        await reconciliationService.flagCriticalIssue({ source: "webhook", details: err.message });
      }
    } catch (_) {}
    res.status(400).json({ success: false, message: "Webhook handling failed." });
  }
};

/* -----------------------------------------------------------------------
   Admin-only: Force reconcile / refund / manual charge (super_admin)
------------------------------------------------------------------------- */
export const adminForceCharge = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== "super_admin") throw Errors.Forbidden("Only super admin may perform this action.");

    const { institutionId, amount, reason, provider } = req.body;
    if (!institutionId || !amount) throw Errors.Validation("institutionId and amount are required.");

    const charge = await billingService.forceCharge({ institutionId, amount, provider, reason, createdBy: user.id });

    await recordAuditEvent({
      actorId: user.id,
      actorRole: "super_admin",
      action: "FORCE_CHARGE",
      details: { institutionId, amount, reason, provider, chargeId: charge.id },
    });

    res.json({ success: true, data: charge });
  } catch (err: any) {
    logger.error("[BILLING] adminForceCharge failed", { err });
    sendErrorResponse(res, err);
  }
};
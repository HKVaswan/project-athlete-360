/**
 * src/controllers/webhooks.controller.ts
 * --------------------------------------------------------------------------
 * 🎯 Centralized Webhook Controller (Enterprise Grade)
 *  - Secure signature verification
 *  - Idempotent processing (Redis-ready)
 *  - Unified audit + alert pipeline
 * --------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { logger } from "../logger";
import { billingService } from "../services/billing.service";
import { subscriptionService } from "../services/subscription.service";
import { auditService } from "../services/audit.service";
import { createSuperAdminAlert } from "../services/superAdminAlerts.service";
import { stripeAdapter } from "../services/billingAdapters/stripe.adapter";
import { razorpayAdapter } from "../services/billingAdapters/razorpay.adapter";
import { Errors, sendErrorResponse } from "../utils/errors";

/* --------------------------------------------------------------------------
   🧱 Simple Idempotency Cache (Redis-ready placeholder)
--------------------------------------------------------------------------- */
const processedEvents = new Map<string, number>();
const EVENT_TTL = 10 * 60 * 1000; // 10 minutes

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  for (const [id, ts] of processedEvents.entries()) {
    if (now - ts > EVENT_TTL) processedEvents.delete(id);
  }
  return false;
}

/* --------------------------------------------------------------------------
   ⚡ Stripe Webhook Handler
--------------------------------------------------------------------------- */
export const handleStripeWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["stripe-signature"] as string;
    const event = stripeAdapter.verifyWebhook(req.rawBody, signature);
    const eventId = event.id;

    if (isDuplicateEvent(eventId)) {
      logger.warn(`[STRIPE WEBHOOK] Duplicate ignored: ${eventId}`);
      return res.status(200).json({ received: true });
    }

    logger.info(`[STRIPE WEBHOOK] Event received: ${event.type}`);

    switch (event.type) {
      case "invoice.payment_succeeded":
        await billingService.markInvoicePaid(event.data.object);
        await subscriptionService.activateSubscription(event.data.object.customer);
        break;
      case "invoice.payment_failed":
        await billingService.markInvoiceFailed(event.data.object);
        await subscriptionService.flagPaymentFailure(event.data.object.customer);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.created":
        await subscriptionService.syncSubscriptionFromStripe(event.data.object);
        break;
      case "customer.subscription.deleted":
        await subscriptionService.cancelSubscription(event.data.object.id);
        break;
      default:
        logger.info(`[STRIPE WEBHOOK] Ignored event: ${event.type}`);
    }

    await auditService.record({
      actorId: "system",
      actorRole: "system",
      action: "STRIPE_WEBHOOK",
      details: { id: event.id, type: event.type },
    });

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error("[STRIPE WEBHOOK] ❌ Handler failed", { err });
    await createSuperAdminAlert({
      title: "Stripe Webhook Failure",
      message: err.message,
      severity: "critical",
    });
    sendErrorResponse(res, err);
  }
};

/* --------------------------------------------------------------------------
   ⚡ Razorpay Webhook Handler
--------------------------------------------------------------------------- */
export const handleRazorpayWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    const rawBody = req.rawBody?.toString() || JSON.stringify(req.body);

    if (!razorpayAdapter.verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const payload = req.body;
    const eventType = payload.event || "";
    const eventId = payload.payload?.payment?.entity?.id || "";

    if (isDuplicateEvent(eventId)) {
      logger.warn(`[RAZORPAY WEBHOOK] Duplicate ignored: ${eventId}`);
      return res.status(200).json({ received: true });
    }

    logger.info(`[RAZORPAY WEBHOOK] Event: ${eventType}`);

    switch (eventType) {
      case "payment.captured":
        await billingService.markPaymentCaptured(payload.payload.payment.entity);
        await subscriptionService.activateSubscription(payload.payload.payment.entity.notes?.customer_id);
        break;
      case "payment.failed":
        await billingService.markPaymentFailed(payload.payload.payment.entity);
        await subscriptionService.flagPaymentFailure(payload.payload.payment.entity.notes?.customer_id);
        break;
      case "subscription.activated":
        await subscriptionService.syncSubscriptionFromRazorpay(payload.payload.subscription.entity);
        break;
      case "subscription.cancelled":
        await subscriptionService.cancelSubscription(payload.payload.subscription.entity.id);
        break;
      default:
        logger.info(`[RAZORPAY WEBHOOK] Ignored event: ${eventType}`);
    }

    await auditService.record({
      actorId: "system",
      actorRole: "system",
      action: "RAZORPAY_WEBHOOK",
      details: { id: eventId, type: eventType },
    });

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error("[RAZORPAY WEBHOOK] ❌ Handler failed", { err });
    await createSuperAdminAlert({
      title: "Razorpay Webhook Failure",
      message: err.message,
      severity: "critical",
    });
    sendErrorResponse(res, err);
  }
};

/* --------------------------------------------------------------------------
   🧠 Health Check Endpoint
--------------------------------------------------------------------------- */
export const webhookHealthCheck = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Webhook endpoint operational.",
    timestamp: new Date().toISOString(),
  });
};
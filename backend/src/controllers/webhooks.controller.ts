/**
 * src/controllers/webhooks.controller.ts
 * --------------------------------------------------------------------------
 * 🎯 Centralized Webhook Controller
 *
 * Responsibilities:
 *  - Handle verified payment gateway webhooks (Stripe / Razorpay / future).
 *  - Delegate billing/subscription updates to services.
 *  - Ensure idempotency (no duplicate processing).
 *  - Log & audit all webhook events securely.
 * --------------------------------------------------------------------------
 */

import { Request, Response } from "express";
import { logger } from "../logger";
import { billingService } from "../services/billing.service";
import { subscriptionService } from "../services/subscription.service";
import { auditService } from "../services/audit.service";
import { Errors, sendErrorResponse } from "../utils/errors";

/* --------------------------------------------------------------------------
   🧱 In-memory Idempotency Cache (avoid duplicate webhook executions)
   - For production, replace with Redis or Postgres lock table.
--------------------------------------------------------------------------- */
const processedEvents = new Map<string, number>();
const EVENT_TTL = 10 * 60 * 1000; // 10 minutes

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);

  // cleanup old
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
    const event = req.body;
    const eventId = event.id || "";

    if (isDuplicateEvent(eventId)) {
      logger.warn(`[STRIPE WEBHOOK] ⚠️ Duplicate event ignored: ${eventId}`);
      return res.status(200).json({ received: true });
    }

    logger.info(`[STRIPE WEBHOOK] 📩 Received event: ${event.type}`);

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
        logger.info(`[STRIPE WEBHOOK] Ignored event type: ${event.type}`);
        break;
    }

    await auditService.record({
      actorId: "system",
      actorRole: "system",
      ip: req.ip,
      action: "STRIPE_WEBHOOK",
      details: { type: event.type, id: event.id },
    });

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error("[STRIPE WEBHOOK] ❌ Handler failed", err);
    sendErrorResponse(res, err);
  }
};

/* --------------------------------------------------------------------------
   ⚡ Razorpay Webhook Handler
--------------------------------------------------------------------------- */
export const handleRazorpayWebhook = async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const eventType = payload.event || "";
    const eventId = payload.payload?.payment?.entity?.id || "";

    if (isDuplicateEvent(eventId)) {
      logger.warn(`[RAZORPAY WEBHOOK] ⚠️ Duplicate event ignored: ${eventId}`);
      return res.status(200).json({ received: true });
    }

    logger.info(`[RAZORPAY WEBHOOK] 📩 Event: ${eventType}`);

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
        break;
    }

    await auditService.record({
      actorId: "system",
      actorRole: "system",
      ip: req.ip,
      action: "RAZORPAY_WEBHOOK",
      details: { type: eventType, id: eventId },
    });

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error("[RAZORPAY WEBHOOK] ❌ Handler failed", err);
    sendErrorResponse(res, err);
  }
};

/* --------------------------------------------------------------------------
   🧠 Health Check Endpoint (Optional)
   - For verifying webhook URL with gateway
--------------------------------------------------------------------------- */
export const webhookHealthCheck = async (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Webhook endpoint operational.",
    timestamp: new Date().toISOString(),
  });
};
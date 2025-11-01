// src/services/payment.service.ts
/**
 * payment.service.ts
 * ---------------------------------------------------------------------------
 * Enterprise-grade Payment & Subscription Service
 *
 * Responsibilities:
 *  - Create/upgrade/cancel subscriptions for Institutions
 *  - Handle payment provider interactions (Stripe primary; PayPal fallback)
 *  - Securely validate provider webhooks (idempotent processing)
 *  - Manage trial periods, grace windows, and automatic renewals
 *  - Reconciliation & webhook retry handling
 *  - Emit notifications and audit events on billing changes
 *  - Expose helper methods for controllers and cron jobs
 *
 * Notes:
 *  - Keep secret keys in env vars. Use strong webhook signing secrets.
 *  - For Stripe: ensure you set STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET.
 *  - For PayPal (optional): set PAYPAL_CLIENT_ID / PAYPAL_SECRET.
 * ---------------------------------------------------------------------------
 */

import Stripe from "stripe";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { addNotificationJob } from "../workers/notification.worker";
import { auditService } from "../lib/audit";
import { plansService } from "./plans.service";
import { quotaService } from "./quota.service";
import crypto from "crypto";
import fetch from "node-fetch"; // if needed for PayPal (or use SDK)
import { v4 as uuidv4 } from "uuid";

const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;

const stripe = STRIPE_API_KEY ? new Stripe(STRIPE_API_KEY, { apiVersion: "2024-11-15" }) : null;

/**
 * PaymentProvider enum for DB-friendly storage
 */
export type PaymentProvider = "stripe" | "paypal" | "manual";

/**
 * High-level subscription states
 */
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing" | "grace" | "expired";

/**
 * Utility: idempotency key generator for safe webhook processing
 */
const idempotencyKeyFromEvent = (provider: string, eventId: string) => {
  return `payment:${provider}:${eventId}`;
};

/* ---------------------------------------------------------------------------
   Core Payment Service
   --------------------------------------------------------------------------- */
class PaymentService {
  /**
   * Create checkout session (Stripe) or order (PayPal)
   * Returns provider-specific checkoutUrl or approval link.
   */
  async createCheckoutSession(institutionId: string, planId: string, opts?: { returnUrl?: string; cancelUrl?: string; couponCode?: string }) {
    const plan = await plansService.getPlanById(planId);
    if (!plan) throw Errors.NotFound("Plan not found");

    // Create local pending subscription record to track the flow
    const localSub = await prisma.subscription.create({
      data: {
        institutionId,
        planId,
        status: "trialing", // temporary pending
        provider: STRIPE_API_KEY ? "stripe" : PAYPAL_CLIENT_ID ? "paypal" : "manual",
        externalId: null,
        amountCents: Math.round(plan.price * 100),
        currency: plan.currency || "USD",
        metadata: {},
      },
    });

    // Use Stripe Checkout if configured
    if (stripe) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: await this.getOrCreateStripeCustomerForInstitution(institutionId),
        line_items: [{ price: plan.externalPriceId!, quantity: 1 }],
        success_url: opts?.returnUrl || `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: opts?.cancelUrl || `${process.env.APP_URL}/billing/cancel`,
        metadata: { localSubscriptionId: localSub.id },
        allow_promotion_codes: true,
      });

      // persist external link and externalId mapping
      await prisma.subscription.update({ where: { id: localSub.id }, data: { externalCheckoutUrl: session.url, externalId: session.id } });

      return { provider: "stripe", checkoutUrl: session.url, sessionId: session.id };
    }

    // Fallback: PayPal (simplified)
    if (PAYPAL_CLIENT_ID && PAYPAL_SECRET) {
      const approvalUrl = `${process.env.APP_URL}/pay/paypal/approve?subscription=${localSub.id}`;
      // In real implementation create PayPal order & return approval url
      await prisma.subscription.update({ where: { id: localSub.id }, data: { externalCheckoutUrl: approvalUrl } });
      return { provider: "paypal", checkoutUrl: approvalUrl, sessionId: localSub.id };
    }

    // Manual invoicing fallback
    return { provider: "manual", invoiceLink: `${process.env.APP_URL}/billing/invoice/${localSub.id}` };
  }

  /**
   * Ensure institution has a Stripe customer id; create one if missing
   */
  private async getOrCreateStripeCustomerForInstitution(institutionId: string): Promise<string> {
    if (!stripe) throw new Error("Stripe not configured");

    const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!inst) throw new Error("Institution not found");

    if (inst.stripeCustomerId) return inst.stripeCustomerId;

    // Create Stripe customer
    const customer = await stripe.customers.create({
      name: inst.name,
      metadata: { institutionId: inst.id },
    });

    await prisma.institution.update({ where: { id: institutionId }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  /**
   * Handle Stripe webhook events. This method is idempotent and safe to call multiple times.
   */
  async handleStripeWebhook(reqRawBody: Buffer, sigHeader: string | undefined) {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      throw new Error("Stripe webhook not configured");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(reqRawBody, sigHeader || "", STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      logger.warn("[PAYMENT] Stripe webhook verification failed", err);
      throw Errors.BadRequest("Invalid Stripe webhook signature");
    }

    const idempotencyKey = idempotencyKeyFromEvent("stripe", event.id);
    const processed = await prisma.webhookEvent.findUnique({ where: { id: idempotencyKey } });
    if (processed) {
      logger.debug("[PAYMENT] Duplicate Stripe webhook ignored", { id: event.id });
      return { ok: true, ignored: true };
    }

    // persist event idempotently
    await prisma.webhookEvent.create({ data: { id: idempotencyKey, provider: "stripe", eventId: event.id, raw: event as any } });

    // Process relevant events
    switch (event.type) {
      case "checkout.session.completed":
        await this._onStripeCheckoutCompleted(event as any);
        break;
      case "invoice.payment_succeeded":
        await this._onInvoicePaymentSucceeded(event as any);
        break;
      case "invoice.payment_failed":
        await this._onInvoicePaymentFailed(event as any);
        break;
      case "customer.subscription.deleted":
      case "customer.subscription.updated":
        await this._onSubscriptionUpdated(event as any);
        break;
      default:
        logger.debug("[PAYMENT] Unhandled Stripe event", event.type);
    }

    return { ok: true };
  }

  /**
   * Internal: on checkout.session.completed - finalize subscription
   */
  private async _onStripeCheckoutCompleted(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    const localSubscriptionId = session.metadata?.localSubscriptionId;
    const subscriptionId = session.subscription as string;

    if (!localSubscriptionId) {
      logger.warn("[PAYMENT] checkout.session.completed missing localSubscriptionId");
      return;
    }

    // link local sub -> external subscription
    await prisma.subscription.update({
      where: { id: localSubscriptionId },
      data: {
        externalId: subscriptionId,
        status: "active",
        provider: "stripe",
        activatedAt: new Date(),
      },
    });

    // audit + notify
    const localSub = await prisma.subscription.findUnique({ where: { id: localSubscriptionId } });
    await auditService.log({ actorId: localSub?.institutionId, action: "SYSTEM_ALERT", details: { event: "subscription_activated", subscription: localSubscriptionId } });
    if (localSub) {
      await addNotificationJob({
        type: "custom",
        recipientId: localSub.institutionId!,
        title: "Subscription Activated",
        body: `Your subscription (${localSub.planId}) is now active.`,
        channel: ["inApp", "email"],
      });
    }
  }

  /**
   * Internal: invoice payment succeeded -> renew subscription
   */
  private async _onInvoicePaymentSucceeded(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = invoice.subscription as string;
    if (!subId) return;

    // find local subscription by externalId
    const localSub = await prisma.subscription.findFirst({ where: { externalId: subId } });
    if (!localSub) return;

    await prisma.subscription.update({ where: { id: localSub.id }, data: { status: "active", currentPeriodEnd: new Date(invoice.lines.data[0]?.period?.end ? invoice.lines.data[0].period.end * 1000 : Date.now()) } });

    // audit + notify
    await auditService.log({ actorId: localSub.institutionId!, action: "SYSTEM_ALERT", details: { event: "payment_succeeded", subscription: localSub.id, invoiceId: invoice.id } });
    await addNotificationJob({ type: "custom", recipientId: localSub.institutionId!, title: "Payment Received", body: `Payment received for subscription ${localSub.planId}`, channel: ["inApp", "email"] });

    // ensure quotas are aligned with plan
    await quotaService.enforceQuota(localSub.institutionId!);
  }

  /**
   * Internal: invoice payment failed -> mark past_due and send warnings
   */
  private async _onInvoicePaymentFailed(event: Stripe.Event) {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = invoice.subscription as string;
    if (!subId) return;

    const localSub = await prisma.subscription.findFirst({ where: { externalId: subId } });
    if (!localSub) return;

    // Move subscription to past_due, set grace window expiry (configurable)
    const gracePeriodHours = Number(process.env.PAYMENT_GRACE_HOURS || 72);
    const graceExpiresAt = new Date(Date.now() + gracePeriodHours * 3600 * 1000);

    await prisma.subscription.update({ where: { id: localSub.id }, data: { status: "past_due", graceExpiresAt } });

    await auditService.log({ actorId: localSub.institutionId!, action: "SYSTEM_ALERT", details: { event: "payment_failed", subscription: localSub.id } });
    await addNotificationJob({ type: "custom", recipientId: localSub.institutionId!, title: "Payment Failed", body: `Payment failed for subscription ${localSub.planId}. Please update billing info within ${gracePeriodHours} hours to avoid interruption.`, channel: ["inApp", "email"] });
  }

  /**
   * Internal: subscription updated/deleted events handler
   */
  private async _onSubscriptionUpdated(event: Stripe.Event) {
    const sub = event.data.object as Stripe.Subscription;
    const localSub = await prisma.subscription.findFirst({ where: { externalId: sub.id } });
    if (!localSub) return;

    // Map Stripe's status to our internal status
    const mapping: Record<string, SubscriptionStatus> = {
      active: "active",
      incomplete: "past_due",
      past_due: "past_due",
      canceled: "canceled",
      trialing: "trialing",
      unpaid: "expired",
    };

    const newStatus = mapping[sub.status] || "past_due";
    await prisma.subscription.update({ where: { id: localSub.id }, data: { status: newStatus, currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined } });

    // audit
    await auditService.log({ actorId: localSub.institutionId!, action: "SYSTEM_ALERT", details: { event: "subscription_status_change", status: newStatus } });
  }

  /**
   * Process PayPal webhooks similarly (signature verification & idempotency).
   * This is a simplified example; prefer official SDK and validation.
   */
  async handlePayPalWebhook(rawBody: Buffer, headers: Record<string, string>) {
    // Implement PayPal verification (omitted for brevity).
    // Steps:
    //  - Verify authenticity using PayPal signature/verify API
    //  - Check idempotency table
    //  - Map events to _onInvoicePaymentSucceeded/_onInvoicePaymentFailed/_onSubscriptionUpdated
    logger.info("[PAYMENT] Received PayPal webhook (processing omitted)");
    return { ok: true };
  }

  /**
   * Controller-facing: cancel subscription (immediate or at period end)
   */
  async cancelSubscription(institutionId: string, opts?: { atPeriodEnd?: boolean; reason?: string; initiatedBy?: string }) {
    const sub = await prisma.subscription.findFirst({ where: { institutionId, status: { in: ["active", "trialing", "past_due"] } } });
    if (!sub) throw Errors.NotFound("Active subscription not found");

    if (sub.provider === "stripe" && stripe && sub.externalId) {
      if (opts?.atPeriodEnd) {
        await stripe.subscriptions.update(sub.externalId, { cancel_at_period_end: true });
      } else {
        await stripe.subscriptions.del(sub.externalId);
      }
    } else if (sub.provider === "paypal") {
      // call PayPal cancel api
    } else {
      // manual invoices: mark canceled
    }

    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "canceled", canceledAt: new Date(), cancelReason: opts?.reason } });

    // audit & notify
    await auditService.log({ actorId: institutionId, action: "ADMIN_OVERRIDE", details: { event: "subscription_canceled", reason: opts?.reason, by: opts?.initiatedBy } });
    await addNotificationJob({ type: "custom", recipientId: institutionId, title: "Subscription Canceled", body: `Subscription ${sub.planId} canceled.`, channel: ["inApp", "email"] });

    return { ok: true };
  }

  /**
   * Reconcile subscriptions periodically:
   *  - Ensure DB matches provider state (externalId statuses)
   *  - Detect unpaid/cancelled subscriptions and alert
   */
  async reconcileSubscriptionsBatch(limit = 100) {
    logger.info("[PAYMENT] Starting subscription reconciliation job");
    const subs = await prisma.subscription.findMany({ where: { provider: { in: ["stripe", "paypal"] } }, take: limit });
    for (const s of subs) {
      try {
        if (s.provider === "stripe" && stripe && s.externalId) {
          const remote = await stripe.subscriptions.retrieve(s.externalId, { expand: [] });
          // update local status if mismatch
          const remoteStatus = remote.status as string;
          // map remoteStatus -> local state
          const mapping: Record<string, SubscriptionStatus> = { active: "active", past_due: "past_due", canceled: "canceled", trialing: "trialing", unpaid: "expired" };
          const mapped = mapping[remoteStatus] || "past_due";
          if (mapped !== s.status) {
            await prisma.subscription.update({ where: { id: s.id }, data: { status: mapped } });
            await auditService.log({ actorId: s.institutionId!, action: "SYSTEM_ALERT", details: { event: "reconciled_subscription", subscriptionId: s.id, from: s.status, to: mapped } });
          }
        }
        // PayPal reconciliation omitted for brevity
      } catch (err: any) {
        logger.warn("[PAYMENT] Reconcile failed for subscription", { id: s.id, err: err.message });
      }
    }
    logger.info("[PAYMENT] Reconciliation job completed");
    return { processed: subs.length };
  }

  /**
   * Verify a webhook payload's signature manually (generic HMAC helper)
   */
  verifyHmacSignature(payload: Buffer | string, secret: string, signatureHeader: string) {
    const computed = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return computed === signatureHeader;
  }

  /**
   * Helper: create invoice (manual invoicing)
   */
  async createManualInvoice(institutionId: string, amountCents: number, currency = "USD", metadata: Record<string, any> = {}) {
    const invoice = await prisma.invoice.create({
      data: {
        institutionId,
        amountCents,
        currency,
        status: "pending",
        metadata,
        externalId: `manual_${uuidv4()}`,
      },
    });

    await auditService.log({ actorId: institutionId, action: "SYSTEM_ALERT", details: { event: "manual_invoice_created", invoiceId: invoice.id } });
    await addNotificationJob({ type: "custom", recipientId: institutionId, title: "New Invoice", body: `Invoice ${invoice.externalId} created for amount ${amountCents / 100} ${currency}`, channel: ["inApp", "email"] });

    return invoice;
  }
}

export const paymentService = new PaymentService();
export default paymentService;
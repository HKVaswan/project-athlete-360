/**
 * src/services/stripe.adapter.ts
 * -------------------------------------------------------------------------
 * Stripe Billing Adapter (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Manage Stripe payments, subscriptions, and invoices
 *  - Ensure full sync between Stripe and internal billing DB
 *  - Support retry, failover, and webhook signature rotation
 *  - Escalate any critical failure to Super Admins
 *
 * Author: Project Athlete 360
 * -------------------------------------------------------------------------
 */

import Stripe from "stripe";
import { logger } from "../logger";
import { config } from "../config";
import prisma from "../prismaClient";
import { createSuperAdminAlert } from "./superAdminAlerts.service";

// Initialize Stripe safely
if (!config.stripeSecretKey) {
  logger.warn("[STRIPE] ⚠️ Missing Stripe secret key. Integration disabled.");
}

export const stripe = new Stripe(config.stripeSecretKey || "", {
  apiVersion: "2024-09-30.acacia",
  typescript: true,
});

/* --------------------------------------------------------------------------
   🧠 Utility: Resilient Retry Wrapper (for transient failures)
--------------------------------------------------------------------------- */
async function retryStripeCall<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const retryable =
        ["rate_limit", "api_connection_error", "timeout"].includes(err.type) &&
        attempt < retries;
      if (retryable) {
        const wait = attempt * 1500;
        logger.warn(`[STRIPE] Retrying ${label} (attempt ${attempt}) after ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      logger.error(`[STRIPE] ❌ ${label} failed permanently`, { err });
      throw err;
    }
  }
  throw new Error(`[STRIPE] ${label} exhausted all retries`);
}

/* --------------------------------------------------------------------------
   💳 Main Stripe Adapter
--------------------------------------------------------------------------- */
export class StripeAdapter {
  /**
   * 🧾 Create Payment Intent (INR Only)
   */
  static async createPaymentIntent(amountInINR: number, customerEmail: string) {
    try {
      if (config.defaultCurrency && config.defaultCurrency !== "INR") {
        throw new Error("Unsupported currency. Stripe currently supports INR only.");
      }

      const intent = await retryStripeCall(
        () =>
          stripe.paymentIntents.create({
            amount: Math.round(amountInINR * 100),
            currency: "inr",
            receipt_email: customerEmail,
            automatic_payment_methods: { enabled: true },
          }),
        "createPaymentIntent"
      );

      return intent.client_secret;
    } catch (err: any) {
      await createSuperAdminAlert({
        title: "Stripe Payment Failure",
        message: `Payment intent failed for ${customerEmail}: ${err.message}`,
        category: "payment",
        severity: "high",
        metadata: { stack: err.stack },
      });
      throw err;
    }
  }

  /**
   * 🧠 Get or Create Stripe Customer
   */
  static async getOrCreateCustomer(email: string, name: string) {
    try {
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) return existing.data[0];

      return await retryStripeCall(
        () =>
          stripe.customers.create({
            email,
            name,
            description: "Institution Admin",
          }),
        "createCustomer"
      );
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Failed to get/create customer", { err });
      throw err;
    }
  }

  /**
   * 💼 Create Subscription with Optional Trial
   */
  static async createSubscription(customerId: string, priceId: string, trialDays = 0) {
    try {
      const sub = await retryStripeCall(
        () =>
          stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: priceId }],
            trial_period_days: trialDays,
            payment_behavior: "default_incomplete",
            expand: ["latest_invoice.payment_intent"],
          }),
        "createSubscription"
      );

      logger.info(`[STRIPE] ✅ Created subscription ${sub.id} for customer ${customerId}`);
      return sub;
    } catch (err: any) {
      await createSuperAdminAlert({
        title: "Stripe Subscription Failure",
        message: `Error creating subscription for ${customerId}: ${err.message}`,
        category: "payment",
        severity: "high",
      });
      throw err;
    }
  }

  /**
   * ❌ Cancel Subscription (Immediate or Period-End)
   */
  static async cancelSubscription(subscriptionId: string, immediate = false) {
    try {
      const updated = await retryStripeCall(
        () =>
          stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: !immediate,
          }),
        "cancelSubscription"
      );

      logger.info(`[STRIPE] 🛑 Subscription cancelled: ${subscriptionId}`);
      return updated;
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Subscription cancellation failed", { err });
      throw err;
    }
  }

  /* --------------------------------------------------------------------------
     📬 Webhook Verification (supports secret rotation)
  --------------------------------------------------------------------------- */
  static verifyWebhook(rawBody: Buffer, sig: string) {
    const secrets = [config.stripeWebhookSecret, config.stripeWebhookSecretAlt].filter(Boolean);
    for (const secret of secrets) {
      try {
        const event = stripe.webhooks.constructEvent(rawBody, sig, secret!);
        return event;
      } catch {
        continue;
      }
    }
    logger.error("[STRIPE] ⚠️ Invalid webhook signature for all known secrets");
    throw new Error("Invalid Stripe signature");
  }

  /* --------------------------------------------------------------------------
     🧾 Sync Invoice / Event to DB (Idempotent)
  --------------------------------------------------------------------------- */
  static async syncInvoice(event: Stripe.Event) {
    const data = event.data.object as Stripe.Invoice;

    try {
      // Prevent duplicate writes
      const existing = await prisma.billingEvent.findUnique({
        where: { eventId: event.id },
      });
      if (existing) {
        logger.info(`[STRIPE] 🔁 Duplicate event skipped: ${event.id}`);
        return;
      }

      await prisma.billingEvent.create({
        data: {
          eventId: event.id,
          type: event.type,
          customerId: data.customer?.toString() || "unknown",
          amountPaid: data.amount_paid / 100,
          currency: data.currency,
          status: data.status,
          hostedInvoiceUrl: data.hosted_invoice_url || null,
        },
      });

      // Auto-update local Subscription table
      if (event.type === "invoice.payment_succeeded" && data.subscription) {
        await prisma.subscription.updateMany({
          where: { providerSubscriptionId: String(data.subscription) },
          data: {
            status: "ACTIVE",
            nextBillingDate: data.next_payment_attempt
              ? new Date(data.next_payment_attempt * 1000)
              : undefined,
          },
        });
      }

      logger.info(`[STRIPE] 💰 Synced invoice event: ${event.type}`);
    } catch (err: any) {
      logger.error(`[STRIPE] ❌ Failed to sync invoice ${event.id}`, { err });
      await createSuperAdminAlert({
        title: "Stripe Sync Error",
        message: `Error syncing event ${event.id}: ${err.message}`,
        category: "payment",
        severity: "medium",
      });
    }
  }

  /* --------------------------------------------------------------------------
     💸 Issue Refund (Admin Approved)
  --------------------------------------------------------------------------- */
  static async issueRefund(paymentIntentId: string, reason?: string) {
    try {
      const refund = await retryStripeCall(
        () =>
          stripe.refunds.create({
            payment_intent: paymentIntentId,
            reason: reason ? "requested_by_customer" : undefined,
            metadata: { note: reason || "No reason specified" },
          }),
        "issueRefund"
      );

      logger.info(`[STRIPE] 💸 Refund issued: ${refund.id}`);
      return refund;
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Refund failed", { err });
      await createSuperAdminAlert({
        title: "Stripe Refund Failure",
        message: `Error issuing refund for ${paymentIntentId}: ${err.message}`,
        category: "payment",
        severity: "high",
      });
      throw err;
    }
  }
}

export const stripeAdapter = StripeAdapter;

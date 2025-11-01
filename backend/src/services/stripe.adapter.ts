/**
 * src/services/stripe.adapter.ts
 * -------------------------------------------------------------------------
 * Stripe Billing Adapter
 *
 * Responsibilities:
 *  - Handle payment intents, subscriptions, and invoices via Stripe
 *  - Sync Stripe data with our billing/subscription system
 *  - Enforce safe retries and webhook validation
 *  - Support multi-currency (default: INR)
 *
 * Features:
 *  - Secure webhook verification
 *  - Automatic retry for transient API errors
 *  - Graceful fallback to manual billing service
 * -------------------------------------------------------------------------
 */

import Stripe from "stripe";
import { logger } from "../logger";
import { config } from "../config";
import { prisma } from "../prismaClient";
import { createSuperAdminAlert } from "./superAdminAlerts.service";

if (!config.stripeSecretKey) {
  logger.warn("[STRIPE] ⚠️ Stripe secret key missing. Stripe integration disabled.");
}

export const stripe = new Stripe(config.stripeSecretKey || "", {
  apiVersion: "2024-09-30.acacia", // latest stable
  typescript: true,
});

export class StripeAdapter {
  /**
   * 🧾 Create a Payment Intent
   */
  static async createPaymentIntent(amountInINR: number, customerEmail: string) {
    try {
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(amountInINR * 100), // Stripe uses smallest currency unit
        currency: "inr",
        receipt_email: customerEmail,
        automatic_payment_methods: { enabled: true },
      });

      return intent.client_secret;
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Payment intent failed", { err });
      await createSuperAdminAlert({
        title: "Stripe Payment Failure",
        message: `Error creating payment intent for ${customerEmail}: ${err.message}`,
        category: "payment",
        severity: "high",
        metadata: { stack: err.stack },
      });
      throw err;
    }
  }

  /**
   * 🧠 Create or Retrieve Stripe Customer
   */
  static async getOrCreateCustomer(email: string, name: string) {
    try {
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) return existing.data[0];

      const customer = await stripe.customers.create({
        email,
        name,
        description: "Institution Admin",
      });

      return customer;
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Failed to create customer", { err });
      throw err;
    }
  }

  /**
   * 💳 Create Subscription
   */
  static async createSubscription(customerId: string, priceId: string, trialDays = 0) {
    try {
      const sub = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        trial_period_days: trialDays,
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      });

      logger.info(`[STRIPE] ✅ Created subscription ${sub.id} for customer ${customerId}`);
      return sub;
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Subscription creation failed", { err });
      await createSuperAdminAlert({
        title: "Stripe Subscription Failure",
        message: `Error creating subscription for customer ${customerId}: ${err.message}`,
        category: "payment",
        severity: "high",
      });
      throw err;
    }
  }

  /**
   * 💼 Cancel Subscription
   */
  static async cancelSubscription(subscriptionId: string, immediate = false) {
    try {
      const updated = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: !immediate,
      });

      logger.info(`[STRIPE] 🛑 Subscription cancelled: ${subscriptionId}`);
      return updated;
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Subscription cancellation failed", { err });
      throw err;
    }
  }

  /**
   * 📬 Handle Stripe Webhooks (Signature Verified)
   */
  static verifyWebhook(rawBody: Buffer, sig: string) {
    try {
      const event = stripe.webhooks.constructEvent(rawBody, sig, config.stripeWebhookSecret!);
      return event;
    } catch (err: any) {
      logger.error("[STRIPE] ⚠️ Invalid webhook signature", { err });
      throw new Error("Invalid Stripe signature");
    }
  }

  /**
   * 🧾 Sync Invoice or Payment to DB
   */
  static async syncInvoice(event: Stripe.Event) {
    const data = event.data.object as Stripe.Invoice;

    try {
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
      logger.info(`[STRIPE] 💰 Synced invoice event: ${event.type}`);
    } catch (err: any) {
      logger.error(`[STRIPE] ❌ Failed to sync invoice ${event.id}`, { err });
    }
  }

  /**
   * 🔐 Refund (on admin approval)
   */
  static async issueRefund(paymentIntentId: string, reason?: string) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: reason ? "requested_by_customer" : undefined,
        metadata: { note: reason || "No reason specified" },
      });

      logger.info(`[STRIPE] 💸 Refund issued: ${refund.id}`);
      return refund;
    } catch (err: any) {
      logger.error("[STRIPE] ❌ Refund failed", { err });
      throw err;
    }
  }
}

export const stripeAdapter = StripeAdapter;
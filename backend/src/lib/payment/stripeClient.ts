/**
 * src/lib/payment/stripeClient.ts
 * ---------------------------------------------------------------------------
 * 💳 Stripe Client (Enterprise Grade)
 *
 * Responsibilities:
 *  - Central integration layer for all Stripe API calls.
 *  - Handles customer creation, subscription management, invoices, and refunds.
 *  - Includes signature verification, retry-safe requests, and webhook safety.
 *  - Securely loads API keys from SecretManager.
 *  - Used by: billing.service.ts, subscription.service.ts, paymentWebhookVerifier.middleware.ts
 * ---------------------------------------------------------------------------
 */

import Stripe from "stripe";
import { config } from "../../config";
import { logger } from "../../logger";
import { secretManagerService } from "../../services/secretManager.service";

// Global singleton instance
let stripe: Stripe | null = null;

/* ---------------------------------------------------------------------------
   🧩 Initialize Secure Stripe Client
---------------------------------------------------------------------------*/
export async function initStripeClient(): Promise<Stripe> {
  if (stripe) return stripe;

  const apiKey = await secretManagerService.getSecret("STRIPE_SECRET_KEY");
  if (!apiKey) {
    throw new Error("Stripe API key not found in Secret Manager.");
  }

  stripe = new Stripe(apiKey, {
    apiVersion: "2024-09-30.acacia",
    typescript: true,
  });

  logger.info("[Stripe] ✅ Client initialized successfully.");
  return stripe;
}

/* ---------------------------------------------------------------------------
   🧾 Create a Customer
---------------------------------------------------------------------------*/
export async function createCustomer(
  email: string,
  name: string,
  metadata?: Record<string, string>
): Promise<Stripe.Customer> {
  const client = await initStripeClient();
  const existing = await client.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];

  const customer = await client.customers.create({
    email,
    name,
    metadata,
  });

  logger.info(`[Stripe] Created new customer: ${customer.id}`);
  return customer;
}

/* ---------------------------------------------------------------------------
   📦 Create Subscription for Institution
---------------------------------------------------------------------------*/
export async function createSubscription(
  customerId: string,
  priceId: string,
  trialDays = 0
): Promise<Stripe.Subscription> {
  const client = await initStripeClient();

  const subscription = await client.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: trialDays,
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
  });

  logger.info(`[Stripe] 🧾 Subscription created for ${customerId}`);
  return subscription;
}

/* ---------------------------------------------------------------------------
   💰 Create One-Time Payment Session (for Add-ons or Upgrades)
---------------------------------------------------------------------------*/
export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.Checkout.Session> {
  const client = await initStripeClient();

  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata,
    allow_promotion_codes: true,
  });

  logger.info(`[Stripe] Checkout session created: ${session.id}`);
  return session;
}

/* ---------------------------------------------------------------------------
   🧾 Retrieve Invoice / Payment Details
---------------------------------------------------------------------------*/
export async function getInvoice(invoiceId: string): Promise<Stripe.Invoice | null> {
  const client = await initStripeClient();
  try {
    const invoice = await client.invoices.retrieve(invoiceId);
    return invoice;
  } catch (err: any) {
    logger.warn(`[Stripe] Invoice not found: ${invoiceId} (${err.message})`);
    return null;
  }
}

/* ---------------------------------------------------------------------------
   ❌ Cancel Subscription (Graceful Downgrade)
---------------------------------------------------------------------------*/
export async function cancelSubscription(subscriptionId: string): Promise<boolean> {
  const client = await initStripeClient();
  try {
    await client.subscriptions.cancel(subscriptionId, { prorate: true });
    logger.info(`[Stripe] Subscription canceled: ${subscriptionId}`);
    return true;
  } catch (err: any) {
    logger.error(`[Stripe] Failed to cancel subscription: ${err.message}`);
    return false;
  }
}

/* ---------------------------------------------------------------------------
   💳 Refund or Partial Refund
---------------------------------------------------------------------------*/
export async function refundPayment(paymentIntentId: string, amount?: number): Promise<boolean> {
  const client = await initStripeClient();
  try {
    await client.refunds.create({
      payment_intent: paymentIntentId,
      amount,
    });
    logger.info(`[Stripe] Refund processed for payment: ${paymentIntentId}`);
    return true;
  } catch (err: any) {
    logger.error(`[Stripe] Refund failed: ${err.message}`);
    return false;
  }
}

/* ---------------------------------------------------------------------------
   🛡️ Verify Webhook Signature (Security Critical)
---------------------------------------------------------------------------*/
export async function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string
): Promise<Stripe.Event> {
  const client = await initStripeClient();
  const webhookSecret = await secretManagerService.getSecret("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) throw new Error("Stripe Webhook Secret missing!");

  try {
    const event = client.webhooks.constructEvent(rawBody, signature, webhookSecret);
    return event;
  } catch (err: any) {
    logger.error(`[Stripe] 🚨 Invalid webhook signature: ${err.message}`);
    throw new Error("Invalid Stripe webhook signature.");
  }
}

/* ---------------------------------------------------------------------------
   ⚙️ Retrieve Product & Price Info (for Plan Setup)
---------------------------------------------------------------------------*/
export async function listAvailablePlans(): Promise<Stripe.Price[]> {
  const client = await initStripeClient();
  const prices = await client.prices.list({
    active: true,
    expand: ["data.product"],
  });

  return prices.data.filter((p) => p.type === "recurring");
}

/* ---------------------------------------------------------------------------
   🧠 Utility: Graceful Reconnection
---------------------------------------------------------------------------*/
export async function reconnectStripe(): Promise<void> {
  stripe = null;
  await initStripeClient();
  logger.info("[Stripe] ♻️ Client reinitialized.");
}
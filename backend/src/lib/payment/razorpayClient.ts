/**
 * src/lib/payment/razorpayClient.ts
 * ---------------------------------------------------------------------------
 * 🇮🇳 Razorpay Client (Enterprise Grade)
 *
 * Responsibilities:
 *  - Unified Razorpay integration for Indian and regional payments.
 *  - Handles order creation, verification, refund, and webhook validation.
 *  - Secured with HMAC signature verification.
 *  - Integrated with secretManager.service.ts for secure key management.
 *  - Works seamlessly with billing.service.ts & subscription.service.ts.
 * ---------------------------------------------------------------------------
 */

import Razorpay from "razorpay";
import crypto from "crypto";
import { config } from "../../config";
import { logger } from "../../logger";
import { secretManagerService } from "../../services/secretManager.service";

// ---------------------------------------------------------------------------
// 🧱 Razorpay Client Initialization
// ---------------------------------------------------------------------------

let razorpay: Razorpay | null = null;

/**
 * Initialize Razorpay client securely (lazy load from secret manager)
 */
export async function initRazorpayClient(): Promise<Razorpay> {
  if (razorpay) return razorpay;

  const keyId = await secretManagerService.getSecret("RAZORPAY_KEY_ID");
  const keySecret = await secretManagerService.getSecret("RAZORPAY_KEY_SECRET");

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials missing from secret manager.");
  }

  razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  logger.info("[Razorpay] ✅ Client initialized successfully.");
  return razorpay;
}

// ---------------------------------------------------------------------------
// 💰 Create Payment Order
// ---------------------------------------------------------------------------

export async function createPaymentOrder(params: {
  amount: number; // INR in paise (1 INR = 100 paise)
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<Razorpay.Order> {
  const client = await initRazorpayClient();

  const order = await client.orders.create({
    amount: params.amount,
    currency: params.currency || "INR",
    receipt: params.receipt,
    payment_capture: 1,
    notes: params.notes,
  });

  logger.info(`[Razorpay] 💵 Order created: ${order.id} (${params.amount / 100} INR)`);
  return order;
}

// ---------------------------------------------------------------------------
// 🔍 Verify Payment Signature (Security Critical)
// ---------------------------------------------------------------------------

export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || config.razorpayWebhookSecret;

  if (!secret) {
    logger.error("[Razorpay] Missing webhook secret for signature verification.");
    throw new Error("Webhook secret not configured.");
  }

  const payload = `${params.orderId}|${params.paymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const isValid = expectedSignature === params.signature;

  if (!isValid) {
    logger.warn("[Razorpay] 🚨 Invalid payment signature detected.");
  } else {
    logger.info("[Razorpay] ✅ Payment signature verified successfully.");
  }

  return isValid;
}

// ---------------------------------------------------------------------------
// 🔔 Verify Webhook Signature
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || config.razorpayWebhookSecret;

  if (!secret) {
    throw new Error("Razorpay webhook secret missing from config.");
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const verified = digest === signature;

  if (!verified) {
    logger.error("[Razorpay] 🚨 Webhook signature verification failed!");
  }

  return verified;
}

// ---------------------------------------------------------------------------
// 💳 Refund Payment (Full or Partial)
// ---------------------------------------------------------------------------

export async function refundPayment(paymentId: string, amount?: number): Promise<boolean> {
  const client = await initRazorpayClient();
  try {
    const refund = await client.payments.refund(paymentId, { amount });
    logger.info(`[Razorpay] 💸 Refund initiated for payment ${paymentId}: ${refund.id}`);
    return true;
  } catch (err: any) {
    logger.error(`[Razorpay] ❌ Refund failed: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 📄 Fetch Payment Details
// ---------------------------------------------------------------------------

export async function fetchPayment(paymentId: string): Promise<Razorpay.Payment | null> {
  const client = await initRazorpayClient();
  try {
    const payment = await client.payments.fetch(paymentId);
    return payment;
  } catch (err: any) {
    logger.warn(`[Razorpay] Payment fetch failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 🧾 Capture Preauthorized Payment (If Not Auto-Captured)
// ---------------------------------------------------------------------------

export async function capturePayment(paymentId: string, amount: number): Promise<boolean> {
  const client = await initRazorpayClient();
  try {
    const payment = await client.payments.capture(paymentId, amount);
    logger.info(`[Razorpay] Payment captured successfully: ${payment.id}`);
    return true;
  } catch (err: any) {
    logger.error(`[Razorpay] Failed to capture payment: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// ⚙️ Health Check / Reconnection
// ---------------------------------------------------------------------------

export async function reconnectRazorpay(): Promise<void> {
  razorpay = null;
  await initRazorpayClient();
  logger.info("[Razorpay] ♻️ Client reinitialized.");
}
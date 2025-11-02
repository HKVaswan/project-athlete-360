/**
 * src/services/razorpay.adapter.ts
 * -------------------------------------------------------------------------
 * Razorpay Billing Adapter (Enterprise Grade)
 *
 * ✅ Secure signature + webhook verification
 * ✅ Resilient retry and backoff for API calls
 * ✅ Full audit & alert integration
 * ✅ Supports UPI / NetBanking / Card / Wallet
 * ✅ Queue-safe event sync for reliability
 * -------------------------------------------------------------------------
 */

import Razorpay from "razorpay";
import crypto from "crypto";
import { logger } from "../logger";
import { config } from "../config";
import prisma from "../prismaClient";
import { createSuperAdminAlert } from "./superAdminAlerts.service";
import { auditService } from "./audit.service";

if (!config.razorpayKeyId || !config.razorpayKeySecret) {
  logger.warn("[RAZORPAY] ⚠️ Razorpay credentials not found. Integration disabled.");
}

export const razorpay = new Razorpay({
  key_id: config.razorpayKeyId || "",
  key_secret: config.razorpayKeySecret || "",
});

/* ------------------------------------------------------------------------
   🧩 Helper: Retry-safe API wrapper
------------------------------------------------------------------------ */
async function safeApiCall<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt < maxRetries && /ECONN|ETIMEDOUT|EAI_AGAIN/.test(err.message)) {
        logger.warn(`[RAZORPAY] ⚠️ ${label} transient error (retry ${attempt})`);
        await new Promise((r) => setTimeout(r, 300 * attempt));
      } else {
        logger.error(`[RAZORPAY] ❌ ${label} failed`, { err: err.message });
        throw err;
      }
    }
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}

/* ------------------------------------------------------------------------
   💼 Main Adapter Class
------------------------------------------------------------------------ */
export class RazorpayAdapter {
  /**
   * 💳 Create a payment order
   */
  static async createOrder(amountInINR: number, receiptId: string, notes?: Record<string, string>) {
    return safeApiCall(async () => {
      const order = await razorpay.orders.create({
        amount: Math.round(amountInINR * 100),
        currency: "INR",
        receipt: receiptId,
        payment_capture: 1,
        notes: notes || {},
      });

      logger.info(`[RAZORPAY] 🧾 Order ${order.id} created for ₹${amountInINR}`);
      await auditService.log({
        actorRole: "system",
        action: "RAZORPAY_ORDER_CREATE",
        details: { orderId: order.id, amountInINR },
      });
      return order;
    }, "CreateOrder");
  }

  /**
   * ✅ Verify payment signature (after payment success)
   */
  static verifySignature({
    orderId,
    paymentId,
    signature,
  }: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    try {
      const generated = crypto
        .createHmac("sha256", config.razorpayKeySecret!)
        .update(orderId + "|" + paymentId)
        .digest("hex");

      const valid = generated === signature;
      if (!valid) {
        logger.warn("[RAZORPAY] ⚠️ Invalid payment signature detected");
        auditService.log({
          actorRole: "system",
          action: "RAZORPAY_SIGNATURE_INVALID",
          details: { orderId, paymentId },
        });
      }
      return valid;
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Signature verification failed", { err: err.message });
      return false;
    }
  }

  /**
   * 🧾 Fetch payment details from Razorpay API
   */
  static async fetchPayment(paymentId: string) {
    return safeApiCall(async () => {
      const payment = await razorpay.payments.fetch(paymentId);
      return payment;
    }, "FetchPayment");
  }

  /**
   * 💸 Issue refund (on admin approval)
   */
  static async refundPayment(paymentId: string, amountInINR?: number, reason?: string) {
    return safeApiCall(async () => {
      const refund = await razorpay.payments.refund(paymentId, {
        amount: amountInINR ? Math.round(amountInINR * 100) : undefined,
        notes: reason ? { reason } : undefined,
      });

      logger.info(`[RAZORPAY] 💸 Refund initiated: ${refund.id}`);
      await auditService.log({
        actorRole: "system",
        action: "RAZORPAY_REFUND",
        details: { paymentId, refundId: refund.id, amountInINR, reason },
      });
      return refund;
    }, "RefundPayment");
  }

  /**
   * 📬 Handle Razorpay Webhook (Signature Verification)
   */
  static verifyWebhookSignature(rawBody: string, signature: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac("sha256", config.razorpayWebhookSecret!)
        .update(rawBody)
        .digest("hex");

      const valid = expectedSignature === signature;
      if (!valid) {
        logger.warn("[RAZORPAY] ⚠️ Invalid webhook signature");
        auditService.log({
          actorRole: "system",
          action: "RAZORPAY_WEBHOOK_INVALID_SIGNATURE",
        });
      }
      return valid;
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Webhook verification failed", { err: err.message });
      return false;
    }
  }

  /**
   * 💾 Sync payment or refund events to DB
   */
  static async syncPaymentEvent(event: any) {
    try {
      await prisma.billingEvent.create({
        data: {
          eventId: event.id,
          type: event.event,
          customerId:
            event.payload?.payment?.entity?.email ||
            event.payload?.order?.entity?.notes?.email ||
            "unknown",
          amountPaid: (event.payload?.payment?.entity?.amount || 0) / 100,
          currency: "INR",
          status: event.payload?.payment?.entity?.status || "unknown",
          metadata: {
            orderId: event.payload?.order?.entity?.id,
            paymentId: event.payload?.payment?.entity?.id,
          },
        },
      });

      logger.info(`[RAZORPAY] 📊 Synced payment event: ${event.event}`);
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Failed to sync payment event", { err: err.message });
      await createSuperAdminAlert({
        title: "Razorpay Sync Failure",
        message: `Failed to persist billing event ${event.id}`,
        category: "payment",
        severity: "medium",
      });
    }
  }
}

export const razorpayAdapter = RazorpayAdapter;

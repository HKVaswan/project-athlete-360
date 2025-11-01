/**
 * src/services/razorpay.adapter.ts
 * -------------------------------------------------------------------------
 * Razorpay Billing Adapter
 *
 * Responsibilities:
 *  - Handle payment orders and verifications via Razorpay
 *  - Integrate with billing & subscription system
 *  - Enforce secure signature validation for all callbacks
 *
 * Features:
 *  - UPI, NetBanking, Card, and Wallet support
 *  - Secure webhook + signature verification
 *  - Retry-safe design with full audit logging
 *  - Super admin alerting on payment or API failures
 * -------------------------------------------------------------------------
 */

import Razorpay from "razorpay";
import crypto from "crypto";
import { logger } from "../logger";
import { config } from "../config";
import { prisma } from "../prismaClient";
import { createSuperAdminAlert } from "./superAdminAlerts.service";

if (!config.razorpayKeyId || !config.razorpayKeySecret) {
  logger.warn("[RAZORPAY] ⚠️ Razorpay credentials not found. Integration disabled.");
}

export const razorpay = new Razorpay({
  key_id: config.razorpayKeyId || "",
  key_secret: config.razorpayKeySecret || "",
});

export class RazorpayAdapter {
  /**
   * 💳 Create a payment order
   */
  static async createOrder(amountInINR: number, receiptId: string, notes?: Record<string, string>) {
    try {
      const order = await razorpay.orders.create({
        amount: Math.round(amountInINR * 100), // smallest currency unit
        currency: "INR",
        receipt: receiptId,
        payment_capture: 1,
        notes: notes || {},
      });

      logger.info(`[RAZORPAY] 🧾 Created order ${order.id} for ₹${amountInINR}`);
      return order;
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Failed to create order", { err });
      await createSuperAdminAlert({
        title: "Razorpay Order Creation Failed",
        message: `Order creation failed for receipt ${receiptId}: ${err.message}`,
        category: "payment",
        severity: "high",
      });
      throw err;
    }
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
      if (!valid) logger.warn("[RAZORPAY] ⚠️ Invalid payment signature detected");
      return valid;
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Signature verification failed", { err });
      return false;
    }
  }

  /**
   * 🧾 Fetch payment details from Razorpay API
   */
  static async fetchPayment(paymentId: string) {
    try {
      const payment = await razorpay.payments.fetch(paymentId);
      return payment;
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Failed to fetch payment details", { err });
      throw err;
    }
  }

  /**
   * 💼 Issue refund (on admin approval)
   */
  static async refundPayment(paymentId: string, amountInINR?: number, reason?: string) {
    try {
      const refund = await razorpay.payments.refund(paymentId, {
        amount: amountInINR ? Math.round(amountInINR * 100) : undefined,
        notes: reason ? { reason } : undefined,
      });

      logger.info(`[RAZORPAY] 💸 Refund initiated: ${refund.id}`);
      return refund;
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Refund failed", { err });
      await createSuperAdminAlert({
        title: "Razorpay Refund Error",
        message: `Refund failed for payment ${paymentId}: ${err.message}`,
        category: "payment",
        severity: "critical",
      });
      throw err;
    }
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
      if (!valid) logger.warn("[RAZORPAY] ⚠️ Invalid webhook signature");
      return valid;
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Webhook verification failed", { err });
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
          customerId: event.payload?.payment?.entity?.email || "unknown",
          amountPaid: (event.payload?.payment?.entity?.amount || 0) / 100,
          currency: "INR",
          status: event.payload?.payment?.entity?.status || "unknown",
          metadata: event,
        },
      });
      logger.info(`[RAZORPAY] 📊 Synced payment event: ${event.event}`);
    } catch (err: any) {
      logger.error("[RAZORPAY] ❌ Failed to sync payment event", { err });
    }
  }
}

export const razorpayAdapter = RazorpayAdapter;
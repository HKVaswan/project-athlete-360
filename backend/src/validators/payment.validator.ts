// src/validators/payment.validator.ts
/**
 * payment.validator.ts
 * ---------------------------------------------------------------------
 * Validation schemas for all payment-related operations.
 * Covers:
 *   - Payment initiation (institution admin)
 *   - Payment verification (webhooks & client confirmations)
 *   - Refunds, retries, and reconciliation
 *   - Global multi-provider support (Stripe, Razorpay, Manual)
 * ---------------------------------------------------------------------
 */

import { z } from "zod";

// ----------------------------------------------------------------------
// 🔧 Common Enums
// ----------------------------------------------------------------------
export const PaymentProviderEnum = z.enum(["stripe", "razorpay", "manual"]);
export const CurrencyEnum = z.enum(["INR", "USD", "EUR", "GBP"]);
export const PaymentStatusEnum = z.enum([
  "pending",
  "completed",
  "failed",
  "refunded",
  "disputed",
]);

// ----------------------------------------------------------------------
// 💰 Initiate Payment
// ----------------------------------------------------------------------
export const initiatePaymentSchema = z.object({
  provider: PaymentProviderEnum,
  planId: z.string().uuid("Invalid plan ID format"),
  institutionId: z.string().uuid("Invalid institution ID"),
  amountCents: z.number().int().positive("Invalid amount"),
  currency: CurrencyEnum,
  description: z.string().min(5, "Description is required"),
  couponCode: z.string().optional(),
  returnUrl: z.string().url("Valid return URL is required"),
  cancelUrl: z.string().url("Valid cancel URL is required"),
  autoRenew: z.boolean().default(true),
  metadata: z.record(z.any()).optional(),
});

// ----------------------------------------------------------------------
// 🔒 Verify Payment (client confirmation)
// ----------------------------------------------------------------------
export const verifyPaymentSchema = z.object({
  provider: PaymentProviderEnum,
  paymentId: z.string().min(5, "Payment ID is required"),
  orderId: z.string().min(5, "Order ID is required"),
  signature: z.string().min(5, "Signature is required"),
  institutionId: z.string().uuid(),
});

// ----------------------------------------------------------------------
// ⚙️ Webhook Event Verification (Stripe / Razorpay)
// ----------------------------------------------------------------------
export const paymentWebhookSchema = z.object({
  provider: PaymentProviderEnum,
  signature: z.string().min(5, "Webhook signature required"),
  payload: z.record(z.any(), { required_error: "Webhook payload missing" }),
});

// ----------------------------------------------------------------------
// 💸 Refunds and Retry
// ----------------------------------------------------------------------
export const refundPaymentSchema = z.object({
  paymentId: z.string().min(5, "Payment ID is required"),
  amountCents: z.number().int().positive(),
  reason: z
    .string()
    .min(5, "Refund reason required")
    .max(250, "Refund reason too long"),
  initiatedBy: z.string().uuid(),
});

export const retryPaymentSchema = z.object({
  paymentId: z.string().min(5, "Payment ID is required"),
  provider: PaymentProviderEnum,
  institutionId: z.string().uuid(),
});

// ----------------------------------------------------------------------
// 🧾 Reconciliation (for background workers)
// ----------------------------------------------------------------------
export const reconciliationJobSchema = z.object({
  provider: PaymentProviderEnum,
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  batchSize: z.number().int().positive().max(500).default(100),
});

// ----------------------------------------------------------------------
// ✅ Type Inference
// ----------------------------------------------------------------------
export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type PaymentWebhookInput = z.infer<typeof paymentWebhookSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
export type RetryPaymentInput = z.infer<typeof retryPaymentSchema>;
export type ReconciliationJobInput = z.infer<typeof reconciliationJobSchema>;
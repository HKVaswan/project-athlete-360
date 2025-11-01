// src/validators/subscription.validator.ts
/**
 * subscription.validator.ts
 * ---------------------------------------------------------------------
 * Zod validation schemas for all subscription & billing related endpoints.
 * Covers:
 *   - Plan creation / updates (super admin)
 *   - Subscription creation / change / cancellation (institution admins)
 *   - Webhook and payment verification
 *   - Auto-renew toggle, quota change, and upgrades
 * ---------------------------------------------------------------------
 */

import { z } from "zod";

// Common fields
const currencyEnum = z.enum(["INR", "USD", "EUR", "GBP"]);
const intervalEnum = z.enum(["monthly", "quarterly", "yearly"]);
const providerEnum = z.enum(["stripe", "razorpay", "manual"]);

const idSchema = z.string().uuid({ message: "Invalid UUID format" });

/* -----------------------------------------------------------------------
   🧩 Plan Management (Super Admin only)
------------------------------------------------------------------------ */
export const createPlanSchema = z.object({
  name: z.string().min(3, "Plan name is required"),
  description: z.string().min(10, "Description must be meaningful"),
  priceCents: z.number().int().positive("Price must be positive"),
  currency: currencyEnum,
  interval: intervalEnum,
  maxAthletes: z.number().int().positive(),
  maxCoaches: z.number().int().positive(),
  maxStorageMb: z.number().int().positive(),
  maxVideoUploads: z.number().int().positive(),
  features: z.array(z.string()).optional(),
  trialDays: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
});

export const updatePlanSchema = createPlanSchema.partial().extend({
  planId: idSchema,
});

/* -----------------------------------------------------------------------
   🏫 Institution Subscriptions (Institution Admin)
------------------------------------------------------------------------ */
export const createSubscriptionSchema = z.object({
  planId: idSchema,
  paymentProvider: providerEnum,
  institutionId: idSchema,
  autoRenew: z.boolean().default(true),
  startDate: z.coerce.date().optional(),
  couponCode: z.string().optional(),
});

export const upgradeSubscriptionSchema = z.object({
  subscriptionId: idSchema,
  newPlanId: idSchema,
});

export const cancelSubscriptionSchema = z.object({
  subscriptionId: idSchema,
  reason: z.string().optional(),
  immediate: z.boolean().default(false),
});

/* -----------------------------------------------------------------------
   💳 Payment & Webhook Validations
------------------------------------------------------------------------ */
export const verifyPaymentSchema = z.object({
  paymentId: z.string().min(1, "Payment ID is required"),
  provider: providerEnum,
  signature: z.string().min(10, "Signature required for verification"),
});

export const webhookEventSchema = z.object({
  provider: providerEnum,
  eventType: z.string(),
  payload: z.record(z.any()),
});

/* -----------------------------------------------------------------------
   🔁 Auto-Renew & Quota Management
------------------------------------------------------------------------ */
export const toggleAutoRenewSchema = z.object({
  subscriptionId: idSchema,
  enabled: z.boolean(),
});

export const updateQuotaSchema = z.object({
  institutionId: idSchema,
  newStorageLimitMb: z.number().int().positive(),
  newVideoLimit: z.number().int().positive(),
});

/* -----------------------------------------------------------------------
   ✅ Type Inference
------------------------------------------------------------------------ */
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpgradeSubscriptionInput = z.infer<typeof upgradeSubscriptionSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type WebhookEventInput = z.infer<typeof webhookEventSchema>;
export type ToggleAutoRenewInput = z.infer<typeof toggleAutoRenewSchema>;
export type UpdateQuotaInput = z.infer<typeof updateQuotaSchema>;
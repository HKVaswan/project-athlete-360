// src/validators/billing.validator.ts
/**
 * billing.validator.ts
 * ---------------------------------------------------------------------
 * Validation schemas for billing, invoicing, and charge lifecycle.
 *
 * Covers:
 *  - Invoice creation & retrieval
 *  - Tax and address validation
 *  - Billing updates & plan changes
 *  - Charge finalization and payment link issuance
 *
 * Built for multi-currency, global compliance (GST, VAT, etc.)
 * ---------------------------------------------------------------------
 */

import { z } from "zod";
import { CurrencyEnum, PaymentProviderEnum } from "./payment.validator";

// ----------------------------------------------------------------------
// 🧾 Create Invoice
// ----------------------------------------------------------------------
export const createInvoiceSchema = z.object({
  institutionId: z.string().uuid("Invalid institution ID"),
  planId: z.string().uuid("Invalid plan ID"),
  amountCents: z.number().int().positive("Invalid invoice amount"),
  currency: CurrencyEnum.default("INR"),
  taxPercent: z.number().min(0).max(50).default(0),
  description: z.string().min(5, "Description required"),
  dueDate: z.coerce.date().optional(),
  provider: PaymentProviderEnum,
  metadata: z.record(z.any()).optional(),
});

// ----------------------------------------------------------------------
// 🧮 Apply Tax or Discount
// ----------------------------------------------------------------------
export const applyTaxDiscountSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice ID"),
  taxPercent: z.number().min(0).max(50).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  couponCode: z.string().optional(),
});

// ----------------------------------------------------------------------
// 🧍 Update Billing Info (Address, GST, VAT, etc.)
// ----------------------------------------------------------------------
export const updateBillingInfoSchema = z.object({
  institutionId: z.string().uuid("Invalid institution ID"),
  billingAddress: z.object({
    line1: z.string().min(3, "Address line 1 required"),
    line2: z.string().optional(),
    city: z.string().min(2),
    state: z.string().min(2),
    postalCode: z.string().min(4).max(12),
    country: z.string().min(2).max(56),
  }),
  gstNumber: z.string().regex(/^[0-9A-Z]{15}$/i, "Invalid GST number").optional(),
  vatNumber: z.string().optional(),
  contactEmail: z.string().email("Valid email required"),
  contactPhone: z.string().min(6).max(15, "Invalid phone number"),
});

// ----------------------------------------------------------------------
// 🧾 Retrieve Invoice / Billing History
// ----------------------------------------------------------------------
export const getInvoiceHistorySchema = z.object({
  institutionId: z.string().uuid("Invalid institution ID"),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});

// ----------------------------------------------------------------------
// 💸 Mark Invoice as Paid / Failed
// ----------------------------------------------------------------------
export const updateInvoiceStatusSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice ID"),
  status: z.enum(["paid", "failed", "pending", "cancelled"]),
  paymentId: z.string().optional(),
  provider: PaymentProviderEnum.optional(),
});

// ----------------------------------------------------------------------
// 🧾 Download / Generate PDF Invoice
// ----------------------------------------------------------------------
export const generateInvoicePdfSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice ID"),
  format: z.enum(["pdf", "html"]).default("pdf"),
  language: z.string().default("en"),
});

// ----------------------------------------------------------------------
// 🔄 Plan Upgrade / Downgrade Request Validation
// ----------------------------------------------------------------------
export const planChangeRequestSchema = z.object({
  institutionId: z.string().uuid("Invalid institution ID"),
  newPlanId: z.string().uuid("Invalid plan ID"),
  effectiveDate: z.coerce.date().optional(),
  reason: z.string().min(5).max(250, "Provide reason for plan change"),
});

// ----------------------------------------------------------------------
// ✅ Type Inference
// ----------------------------------------------------------------------
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type ApplyTaxDiscountInput = z.infer<typeof applyTaxDiscountSchema>;
export type UpdateBillingInfoInput = z.infer<typeof updateBillingInfoSchema>;
export type GetInvoiceHistoryInput = z.infer<typeof getInvoiceHistorySchema>;
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>;
export type GenerateInvoicePdfInput = z.infer<typeof generateInvoicePdfSchema>;
export type PlanChangeRequestInput = z.infer<typeof planChangeRequestSchema>;
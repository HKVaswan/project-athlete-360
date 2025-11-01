/**
 * src/repositories/payment.repo.ts
 * --------------------------------------------------------------------------
 * Enterprise Payment Repository
 *
 * Responsibilities:
 *  - Persist payment attempts, webhook events, refunds and reconciliations
 *  - Idempotent webhook handling (match by providerTxId & external metadata)
 *  - Pagination-friendly listing & search
 *  - Safe updates with optimistic checks
 *  - Helpers for reconciliation and refund marking
 *
 * Notes:
 *  - This repo assumes a Prisma model `Payment` and `PaymentEvent` exist in schema.
 *  - `Payment.metadata` is a JSON field to store provider-specific payloads.
 * --------------------------------------------------------------------------
 */

import { Prisma, Payment, PaymentEvent } from "@prisma/client";
import prisma from "../prismaClient";
import { Errors } from "../utils/errors";
import { logger } from "../logger";

type CreatePaymentInput = {
  institutionId?: string | null;
  userId?: string | null;
  amount: number; // smallest currency unit (e.g., paise/cents)
  currency: string; // e.g. "INR", "USD"
  provider: string; // "stripe" | "razorpay" | "paypal" | etc.
  providerTxId?: string | null; // provider transaction id if available
  description?: string | null;
  metadata?: Record<string, any> | null; // provider raw metadata
  status?: "pending" | "succeeded" | "failed" | "refunded";
  attemptAt?: Date | null;
};

type ListPaymentsOptions = {
  page?: number;
  limit?: number;
  institutionId?: string | null;
  userId?: string | null;
  provider?: string | null;
  status?: string | null;
  from?: Date | null;
  to?: Date | null;
  cursor?: string | null; // for cursor pagination (id)
};

/**
 * PaymentRepository - encapsulates all DB interactions related to payments
 */
export class PaymentRepository {
  /**
   * Create a new payment record (idempotent when providerTxId provided)
   */
  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    try {
      // If providerTxId is provided, try to avoid duplicates
      if (input.providerTxId) {
        const existing = await prisma.payment.findFirst({
          where: { provider: input.provider, providerTxId: input.providerTxId },
        });
        if (existing) return existing;
      }

      const p = await prisma.payment.create({
        data: {
          institutionId: input.institutionId ?? null,
          userId: input.userId ?? null,
          amount: input.amount,
          currency: input.currency,
          provider: input.provider,
          providerTxId: input.providerTxId ?? null,
          description: input.description ?? null,
          metadata: input.metadata ?? {},
          status: input.status ?? "pending",
          attemptAt: input.attemptAt ?? new Date(),
        },
      });

      logger.info(`[PAYMENT] Created payment ${p.id} provider=${p.provider} amount=${p.amount}`);
      return p;
    } catch (err: any) {
      logger.error("[PAYMENT] createPayment failed", err);
      throw Errors.Server("Failed to create payment record.");
    }
  }

  /**
   * Find payment by internal id
   */
  async getPaymentById(id: string): Promise<Payment | null> {
    try {
      return await prisma.payment.findUnique({ where: { id } });
    } catch (err) {
      logger.error("[PAYMENT] getPaymentById failed", err);
      throw Errors.Server("Failed to fetch payment.");
    }
  }

  /**
   * Find by provider transaction id (useful for webhooks)
   */
  async findByProviderTx(provider: string, providerTxId: string): Promise<Payment | null> {
    try {
      return await prisma.payment.findFirst({
        where: { provider, providerTxId },
      });
    } catch (err) {
      logger.error("[PAYMENT] findByProviderTx failed", err);
      throw Errors.Server("Failed to lookup payment by provider tx id.");
    }
  }

  /**
   * List payments with offset pagination (safe defaults)
   */
  async listPayments(opts: ListPaymentsOptions) {
    try {
      const page = Math.max(1, opts.page || 1);
      const limit = Math.min(200, opts.limit || 20);
      const skip = (page - 1) * limit;

      const where: Prisma.PaymentWhereInput = {};

      if (opts.institutionId) where.institutionId = opts.institutionId;
      if (opts.userId) where.userId = opts.userId;
      if (opts.provider) where.provider = opts.provider;
      if (opts.status) where.status = opts.status as any;
      if (opts.from || opts.to) where.createdAt = {};
      if (opts.from) (where.createdAt as any).gte = opts.from;
      if (opts.to) (where.createdAt as any).lte = opts.to;

      const [rows, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.payment.count({ where }),
      ]);

      return {
        data: rows,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (err: any) {
      logger.error("[PAYMENT] listPayments failed", err);
      throw Errors.Server("Failed to list payments.");
    }
  }

  /**
   * Cursor-based listing (for large datasets / exports)
   */
  async listPaymentsCursor(limit = 100, cursor?: string, filter?: Partial<ListPaymentsOptions>) {
    try {
      const where: Prisma.PaymentWhereInput = {};
      if (filter?.institutionId) where.institutionId = filter.institutionId;
      if (filter?.provider) where.provider = filter.provider;
      if (filter?.status) where.status = filter.status as any;

      const payments = await prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const nextCursor = payments.length ? payments[payments.length - 1].id : null;

      return { data: payments, nextCursor };
    } catch (err) {
      logger.error("[PAYMENT] listPaymentsCursor failed", err);
      throw Errors.Server("Failed to fetch payments (cursor).");
    }
  }

  /**
   * Record a provider webhook event (idempotent) and optionally link to a payment.
   * - provider: provider name
   * - providerEventId: idempotency key from provider (e.g., stripe.event.id)
   * - payload: raw provider payload
   */
  async recordProviderEvent(args: {
    provider: string;
    providerEventId: string;
    payload: any;
    receivedAt?: Date;
  }): Promise<PaymentEvent> {
    try {
      // Idempotent: if same providerEventId exists return it
      const existing = await prisma.paymentEvent.findUnique({
        where: { provider_providerEventId: { provider: args.provider, providerEventId: args.providerEventId } },
      });
      if (existing) return existing;

      const ev = await prisma.paymentEvent.create({
        data: {
          provider: args.provider,
          providerEventId: args.providerEventId,
          payload: args.payload ?? {},
          receivedAt: args.receivedAt ?? new Date(),
          processed: false,
        },
      });

      logger.info(`[PAYMENT] Recorded provider event ${ev.id} provider=${args.provider}`);
      return ev;
    } catch (err: any) {
      logger.error("[PAYMENT] recordProviderEvent failed", err);
      throw Errors.Server("Failed to record provider event.");
    }
  }

  /**
   * Mark provider event as processed (after business logic)
   */
  async markEventProcessed(eventId: string, result?: { success: boolean; note?: string }) {
    try {
      const ev = await prisma.paymentEvent.update({
        where: { id: eventId },
        data: {
          processed: true,
          processedAt: new Date(),
          result: result ?? undefined,
        },
      });
      return ev;
    } catch (err) {
      logger.error("[PAYMENT] markEventProcessed failed", err);
      throw Errors.Server("Failed to mark provider event processed.");
    }
  }

  /**
   * Update payment status safely (idempotent & audit-friendly)
   */
  async updatePaymentStatus(id: string, payload: { status: Payment["status"]; providerTxId?: string | null; metadata?: any }) {
    try {
      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) throw Errors.NotFound("Payment record not found.");

      // Avoid downgrading a succeeded -> pending/failed incorrectly
      const allowedTransitions: Record<string, string[]> = {
        pending: ["succeeded", "failed", "refunded"],
        failed: ["pending", "succeeded"],
        succeeded: ["refunded"],
        refunded: [],
      };

      if (payload.status && payment.status !== payload.status) {
        const allowed = allowedTransitions[payment.status] || [];
        if (!allowed.includes(payload.status)) {
          logger.warn(`[PAYMENT] Invalid status transition ${payment.status} -> ${payload.status} for ${id}`);
          // still allow explicit forced update via an admin path? For repo, we'll reject
          throw Errors.BadRequest("Invalid payment status transition.");
        }
      }

      const updated = await prisma.payment.update({
        where: { id },
        data: {
          status: payload.status,
          providerTxId: payload.providerTxId ?? payment.providerTxId,
          metadata: { ...payment.metadata, ...(payload.metadata ?? {}) },
          updatedAt: new Date(),
        },
      });

      logger.info(`[PAYMENT] Updated payment ${id} -> status=${updated.status}`);
      return updated;
    } catch (err: any) {
      if (err instanceof Errors.ApiError) throw err;
      logger.error("[PAYMENT] updatePaymentStatus failed", err);
      throw Errors.Server("Failed to update payment status.");
    }
  }

  /**
   * Mark a payment as refunded (idempotent). Stores refund metadata.
   */
  async markRefunded(id: string, refundInfo: { providerRefundId?: string; amount?: number; metadata?: any }) {
    try {
      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) throw Errors.NotFound("Payment not found.");

      if (payment.status === "refunded") {
        // Already refunded - idempotent success
        return payment;
      }

      const updated = await prisma.payment.update({
        where: { id },
        data: {
          status: "refunded",
          metadata: { ...payment.metadata, refund: { ...(payment.metadata?.refund ?? {}), ...refundInfo } },
          updatedAt: new Date(),
        },
      });

      logger.info(`[PAYMENT] Payment ${id} marked refunded - providerRefundId=${refundInfo.providerRefundId}`);
      return updated;
    } catch (err: any) {
      logger.error("[PAYMENT] markRefunded failed", err);
      throw Errors.Server("Failed to mark payment refunded.");
    }
  }

  /**
   * Reconcile a provider record with a payment (idempotent)
   * - If payment exists link it and update status
   * - If not, create a new payment record with provider metadata
   */
  async reconcileProviderRecord(args: {
    provider: string;
    providerTxId: string;
    amount: number;
    currency: string;
    providerPayload?: any;
    institutionId?: string | null;
    userId?: string | null;
    status?: Payment["status"];
  }) {
    try {
      const existing = await this.findByProviderTx(args.provider, args.providerTxId);
      if (existing) {
        // update status & metadata if needed
        const updated = await this.updatePaymentStatus(existing.id, {
          status: args.status ?? existing.status,
          metadata: args.providerPayload ?? existing.metadata,
        });
        return updated;
      }

      // Create new payment record
      const created = await this.createPayment({
        institutionId: args.institutionId ?? null,
        userId: args.userId ?? null,
        amount: args.amount,
        currency: args.currency,
        provider: args.provider,
        providerTxId: args.providerTxId,
        description: `Reconciled ${args.provider} tx ${args.providerTxId}`,
        metadata: args.providerPayload ?? {},
        status: args.status ?? "succeeded",
        attemptAt: new Date(),
      });

      return created;
    } catch (err: any) {
      logger.error("[PAYMENT] reconcileProviderRecord failed", err);
      throw Errors.Server("Failed to reconcile provider record.");
    }
  }

  /**
   * Fetch pending/unprocessed provider events (for worker consumption)
   */
  async getPendingProviderEvents(limit = 50) {
    try {
      return await prisma.paymentEvent.findMany({
        where: { processed: false },
        orderBy: { receivedAt: "asc" },
        take: limit,
      });
    } catch (err) {
      logger.error("[PAYMENT] getPendingProviderEvents failed", err);
      throw Errors.Server("Failed to fetch pending provider events.");
    }
  }

  /**
   * Search payments by id or providerTxId (helper)
   */
  async searchPayments(query: { q: string; limit?: number }) {
    try {
      const limit = Math.min(100, query.limit ?? 25);
      const data = await prisma.payment.findMany({
        where: {
          OR: [
            { id: { contains: query.q } },
            { providerTxId: { contains: query.q } },
            { description: { contains: query.q } },
          ],
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      });
      return data;
    } catch (err) {
      logger.error("[PAYMENT] searchPayments failed", err);
      throw Errors.Server("Failed to search payments.");
    }
  }
}

export const paymentRepository = new PaymentRepository();
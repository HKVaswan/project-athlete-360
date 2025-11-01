/**
 * src/services/subscription.service.ts
 * ---------------------------------------------------------------------
 * Enterprise Subscription Service
 *
 * Responsibilities:
 *  - Create subscriptions tied to institutions (trial / paid)
 *  - Coordinate with payment provider (create checkout/session)
 *  - Activate / cancel / renew subscriptions safely (DB transactions)
 *  - Handle provider webhook confirmation callbacks
 *  - Prevent free-trial re-use and duplicate active subscriptions
 *  - Emit audit events and notifications for super-admin and institution admins
 * ---------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { paymentService } from "./payment.service";
import { billingService } from "./billing.service";
import { recordAuditEvent } from "./audit.service";
import { addNotificationJob } from "../workers/notification.worker";
import { addDays, isBefore } from "date-fns";

type CreateSubscriptionOpts = {
  institutionId: string;
  planId: string;
  source?: "internal" | "stripe" | "razorpay" | "manual";
  useTrial?: boolean;
  couponCode?: string | null;
  // optional billing customer id / payment method reference
  providerCustomerId?: string | null;
};

/**
 * Create a new subscription record.
 * If source !== 'internal' this returns a payment session object that the frontend
 * should complete. Only on successful payment webhook will subscription be marked active.
 *
 * This function ensures:
 *  - Only one active subscription per institution (unless intentional multiple subscriptions allowed)
 *  - Free trial rules are respected (billingService.applyFreeTrial checks for reuse)
 */
export const createSubscription = async (opts: CreateSubscriptionOpts) => {
  const { institutionId, planId, source = "stripe", useTrial = false, couponCode, providerCustomerId } = opts;

  // Validate plan
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw Errors.NotFound("Selected plan not found");

  // Prevent duplicate active subscriptions
  const active = await prisma.subscription.findFirst({
    where: { institutionId, status: "active" },
  });
  if (active) throw Errors.BadRequest("An active subscription already exists for this institution");

  // If trial requested, delegate to billingService (which enforces one-time trial)
  if (useTrial && plan.tier === "FREE") {
    // billingService will create the trial subscription row and send notifications
    await billingService.applyFreeTrial(institutionId);
    await recordAuditEvent({
      actorId: institutionId,
      actorRole: "institution_admin",
      action: "TRIAL_STARTED",
      details: { planId, note: "free trial via subscription service" },
    });
    return { success: true, trial: true, message: "Free trial applied" };
  }

  // For paid plans: create a pending subscription record and initiate payment session
  return await prisma.$transaction(async (tx) => {
    // create a pending subscription row (status: pending)
    const sub = await tx.subscription.create({
      data: {
        institutionId,
        planId,
        status: "pending",
        isTrial: false,
        provider: source,
        providerCustomerId: providerCustomerId || undefined,
        startedAt: new Date(),
        // endsAt will be set on activation after successful payment
      },
    });

    // Create provider checkout / payment session
    try {
      // paymentService should be a thin adapter that returns provider-specific session info
      const session = await paymentService.createCheckoutSession({
        subscriptionId: sub.id,
        plan,
        institutionId,
        couponCode,
        provider: source,
      });

      logger.info(`[SUBSCRIPTION] Created pending subscription ${sub.id} for inst ${institutionId}`);
      await recordAuditEvent({
        actorId: institutionId,
        actorRole: "institution_admin",
        action: "SUBSCRIPTION_CREATED_PENDING",
        details: { subscriptionId: sub.id, provider: source },
      });

      return { success: true, subscription: sub, paymentSession: session };
    } catch (err: any) {
      logger.error("[SUBSCRIPTION] Payment session creation failed", err);
      // Rollback subscription row by throwing — Prisma transaction will revert
      throw Errors.Server("Unable to create payment session");
    }
  });
};

/**
 * Activate subscription after provider confirms payment (webhook flow).
 * - Marks subscription active, sets startedAt/endsAt based on plan.period (days)
 * - Stores provider invoice id / payment reference
 * - Revokes other pending subscriptions if necessary
 * - Sends notifications & audit events
 */
export const activateSubscription = async (subscriptionId: string, providerPayload: { providerInvoiceId?: string; paidAt?: string; providerCustomerId?: string; }) => {
  const { providerInvoiceId, paidAt, providerCustomerId } = providerPayload;

  return await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true, institution: true } });
    if (!sub) throw Errors.NotFound("Subscription not found");

    if (sub.status === "active") {
      logger.warn(`[SUBSCRIPTION] Attempt activate already active subscription ${subscriptionId}`);
      return sub;
    }

    // compute period: use plan.months or plan.days fallback
    // assuming plan has billingPeriodDays or months fields
    const periodDays = sub.plan?.billingPeriodDays ?? (sub.plan?.billingPeriodMonths ? sub.plan.billingPeriodMonths * 30 : 30);
    const now = paidAt ? new Date(paidAt) : new Date();
    const endsAt = addDays(now, periodDays);

    // update subscription
    const updated = await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: "active",
        providerInvoiceId: providerInvoiceId || undefined,
        providerCustomerId: providerCustomerId || undefined,
        startedAt: now,
        endsAt,
      },
    });

    // revoke other pending subscriptions for this institution (cleanup)
    await tx.subscription.updateMany({
      where: { institutionId: sub.institutionId, id: { not: subscriptionId }, status: "pending" },
      data: { status: "cancelled" },
    });

    // audit and notification
    await recordAuditEvent({
      actorId: sub.institutionId,
      actorRole: "institution_admin",
      action: "SUBSCRIPTION_ACTIVATED",
      details: { subscriptionId, invoiceId: providerInvoiceId },
    });

    // notify institution admins (best-effort)
    const admins = await tx.user.findMany({ where: { institutionId: sub.institutionId, role: "admin" } });
    const adminEmails = admins.map((a) => a.email).filter(Boolean) as string[];
    if (adminEmails.length) {
      await addNotificationJob({
        type: "custom",
        recipientId: admins[0].id,
        title: "Subscription Activated",
        body: `Your subscription (${sub.plan.name}) has been activated and is valid until ${endsAt.toISOString().split("T")[0]}.`,
        channel: ["inApp", "email"],
        meta: { subscriptionId },
      });
    }

    // run any post-activation tasks (quota refresh, metrics)
    try {
      await billingService.notifySuperAdminOnThreshold(); // light check
    } catch (e) {
      logger.debug("[SUBSCRIPTION] post activation threshold check failed", e);
    }

    logger.info(`[SUBSCRIPTION] Activated subscription ${subscriptionId} for institution ${sub.institutionId}`);
    return updated;
  });
};

/**
 * Cancel subscription (user-initiated or admin-initiated).
 * If immediate = false -> mark as cancelled and let it run until endsAt (no prorata in this simple impl).
 * If immediate = true -> mark expired and optionally attempt refund via paymentService.
 */
export const cancelSubscription = async (subscriptionId: string, opts: { immediate?: boolean; initiatedBy?: string | null; reason?: string | null } = {}) => {
  const { immediate = false, initiatedBy, reason } = opts;

  return await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: { institution: true, plan: true } });
    if (!sub) throw Errors.NotFound("Subscription not found");

    if (sub.status !== "active" && sub.status !== "pending") {
      throw Errors.BadRequest("Subscription is not cancellable in current state");
    }

    if (immediate) {
      // optional refund flow
      if (sub.provider && sub.provider !== "internal" && sub.providerInvoiceId) {
        try {
          await paymentService.issueRefund({ provider: sub.provider, invoiceId: sub.providerInvoiceId });
        } catch (e) {
          logger.warn("[SUBSCRIPTION] Refund attempt failed or not supported", e);
        }
      }
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status: "cancelled", endsAt: new Date() } });
      await tx.institution.update({ where: { id: sub.institutionId }, data: { isLocked: true } });
    } else {
      // mark to cancel at period end
      await tx.subscription.update({ where: { id: subscriptionId }, data: { status: "cancelled_at_period_end" } });
    }

    await recordAuditEvent({
      actorId: initiatedBy ?? sub.institutionId,
      actorRole: initiatedBy ? "institution_admin" : "system",
      action: "SUBSCRIPTION_CANCELLED",
      details: { subscriptionId, immediate, reason },
    });

    // notify institution admins
    const admins = await tx.user.findMany({ where: { institutionId: sub.institutionId, role: "admin" } });
    if (admins.length) {
      await addNotificationJob({
        type: "custom",
        recipientId: admins[0].id,
        title: "Subscription Cancelled",
        body: immediate ? "Your subscription has been cancelled immediately." : "Your subscription will be cancelled at the end of the billing period.",
        channel: ["inApp", "email"],
        meta: { subscriptionId },
      });
    }

    logger.info(`[SUBSCRIPTION] Subscription ${subscriptionId} cancelled (immediate=${immediate})`);
    return { success: true };
  });
};

/**
 * Renew subscription (manual or scheduled).
 * This will create a new invoice / payment session if provider-based billing is used.
 * For 'internal' provider (manual payments) it will simply extend the subscription if admin confirms.
 */
export const renewSubscription = async (subscriptionId: string, opts: { provider?: string; initiatedBy?: string | null } = {}) => {
  const { provider = "stripe", initiatedBy } = opts;

  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
  if (!sub) throw Errors.NotFound("Subscription not found");

  if (sub.status !== "active" && sub.status !== "expired") {
    throw Errors.BadRequest("Subscription cannot be renewed in current state");
  }

  // if provider-driven billing, create a new payment session
  if (provider !== "internal") {
    const session = await paymentService.createRecurringPayment({
      subscriptionId,
      plan: sub.plan,
      institutionId: sub.institutionId,
      provider,
    });
    await recordAuditEvent({
      actorId: initiatedBy ?? sub.institutionId,
      actorRole: initiatedBy ? "institution_admin" : "system",
      action: "RENEWAL_INITIATED",
      details: { subscriptionId, provider },
    });
    return { success: true, paymentSession: session };
  }

  // internal renewal: extend subscription by plan period
  const periodDays = sub.plan?.billingPeriodDays ?? (sub.plan?.billingPeriodMonths ? sub.plan.billingPeriodMonths * 30 : 30);
  const now = new Date();
  const newEndsAt = addDays(now, periodDays);

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { endsAt: newEndsAt, status: "active", startedAt: now },
  });

  await recordAuditEvent({
    actorId: initiatedBy ?? sub.institutionId,
    actorRole: initiatedBy ? "institution_admin" : "system",
    action: "SUBSCRIPTION_RENEWED_INTERNAL",
    details: { subscriptionId },
  });

  return { success: true, subscription: updated };
};

/**
 * Handle incoming payment provider webhooks (generic).
 * - Verifies payment provider event (paymentService.verifyWebhook)
 * - Activates subscription on successful payment & stores provider reference
 */
export const handleProviderWebhook = async (provider: string, rawBody: Buffer | string, headers: Record<string, string>) => {
  // paymentService will parse + verify signature and return a typed payload
  const event = await paymentService.verifyWebhook({ provider, rawBody, headers });

  // example normalized event: { type: 'invoice.paid', subscriptionId, invoiceId, paidAt, metadata }
  logger.debug("[SUBSCRIPTION] webhook event parsed", { provider, type: event.type });

  // handle events
  if (event.type === "invoice.paid" || event.type === "checkout.session.completed") {
    const subscriptionId = event.metadata?.subscriptionId || event.subscriptionId;
    if (!subscriptionId) {
      logger.warn("[SUBSCRIPTION] webhook missing subscriptionId in metadata");
      return { ok: false, message: "missing subscriptionId" };
    }

    try {
      const activated = await activateSubscription(subscriptionId, {
        providerInvoiceId: event.invoiceId,
        paidAt: event.paidAt,
        providerCustomerId: event.customerId,
      });

      return { ok: true, activated };
    } catch (err: any) {
      logger.error("[SUBSCRIPTION] Activation from webhook failed", err);
      throw err;
    }
  }

  // handle cancellations/refunds
  if (event.type === "invoice.refunded" || event.type === "subscription.cancelled") {
    const subscriptionId = event.metadata?.subscriptionId || event.subscriptionId;
    if (!subscriptionId) return { ok: false, message: "missing subscriptionId" };
    await cancelSubscription(subscriptionId, { immediate: true, initiatedBy: "system", reason: "provider_cancelled_or_refund" });
    return { ok: true, cancelled: true };
  }

  return { ok: true, message: "event ignored" };
};

/**
 * Helper: Returns subscription summary for an institution
 */
export const getSubscriptionForInstitution = async (institutionId: string) => {
  const sub = await prisma.subscription.findFirst({
    where: { institutionId },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });

  if (!sub) return null;

  // compute days left
  const now = new Date();
  const daysLeft = sub.endsAt ? Math.max(0, Math.ceil((sub.endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : null;

  return {
    id: sub.id,
    status: sub.status,
    plan: sub.plan ? { id: sub.plan.id, name: sub.plan.name, tier: sub.plan.tier } : null,
    startedAt: sub.startedAt,
    endsAt: sub.endsAt,
    daysLeft,
    isTrial: sub.isTrial || false,
    provider: sub.provider,
  };
};

/* -----------------------------------------------------------------------
   Small utility: safe retry wrapper (exponential backoff)
------------------------------------------------------------------------*/
const retryWrapper = async <T>(fn: () => Promise<T>, attempts = 3, baseMs = 300) => {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const wait = baseMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
};

export default {
  createSubscription,
  activateSubscription,
  cancelSubscription,
  renewSubscription,
  handleProviderWebhook,
  getSubscriptionForInstitution,
  retryWrapper,
};
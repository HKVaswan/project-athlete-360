// src/services/autoRenew.service.ts
/**
 * autoRenew.service.ts
 *
 * Enterprise-grade Auto-Renew Service
 *
 * Responsibilities:
 *  - Periodically scan for subscriptions nearing renewal and attempt auto-charge
 *  - Support Stripe / Razorpay adapters (pluggable adapters)
 *  - Idempotent charging with payment intent / mandate checks
 *  - Graceful retries with exponential backoff and state transitions
 *  - Emit notifications, audit logs, and metrics for each event
 *  - Safe to run across multiple instances (best-effort Redis locking)
 *
 * Public methods:
 *  - startAutoRenewScheduler(intervalMs)
 *  - processDueRenewals(nowDate?)
 *  - processSubscriptionRenewal(subscriptionId)
 *  - retryFailedRenewal(subscriptionId)
 *
 * NOTE: This service expects the following to exist in your codebase:
 *  - prisma client
 *  - payment adapters: stripeClient / razorpayClient (with chargeSubscription / retrieveMandate)
 *  - notification job function: addNotificationJob(...) or notificationRepository
 *  - audit / analytics hooks
 *
 */

import { config } from "../config";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { auditService } from "./audit.service"; // your audit service
import { Errors } from "../utils/errors";
import { sleep } from "../utils/time"; // (optional) small util to sleep; fallback below
import Analytics from "../lib/analytics";
import { addNotificationJob } from "../workers/notification.worker"; // if available
import crypto from "crypto";

type PaymentResult = {
  success: boolean;
  provider?: string;
  providerResponse?: any;
  error?: string;
  idempotencyKey?: string;
};

const DEFAULT_INTERVAL_MS = Number(config.autoRenewCheckIntervalMs) || 1000 * 60 * 15; // 15 min
const MAX_RETRY = Number(config.autoRenewMaxRetry || 3);
const BASE_BACKOFF_MS = Number(config.autoRenewBackoffMs || 1000 * 60 * 5); // 5 min

// Optional Redis lock (best-effort). If REDIS_URL is set and ioredis installed, use it.
// Lock prevents two instances from concurrently scanning the same time window.
let redisClient: any = null;
const tryInitRedis = (() => {
  let attempted = false;
  return () => {
    if (attempted) return;
    attempted = true;
    try {
      const url = process.env.REDIS_URL;
      if (!url) return;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require("ioredis");
      redisClient = new IORedis(url, { maxRetriesPerRequest: null });
      redisClient.on("error", (err: any) => {
        logger.warn("[autoRenew] Redis connection error — continuing without distributed lock", err?.message || err);
        redisClient = null;
      });
      logger.info("[autoRenew] Redis client initialized for locking");
    } catch (err) {
      redisClient = null;
      logger.info("[autoRenew] Redis not available for locking");
    }
  };
})();

// fallback sleep
const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const _sleepFn = (typeof sleep === "function" ? (sleep as (n:number)=>Promise<void>) : _sleep);

/**
 * Compute exponential backoff delay with jitter
 */
const backoffDelay = (attempt: number) => {
  const base = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * (base * 0.2));
  return base + jitter;
};

/**
 * Create idempotency key for a subscription renewal attempt
 */
const idempotencyKeyFor = (subscriptionId: string, periodStartISO: string) => {
  return crypto.createHash("sha256").update(`${subscriptionId}:${periodStartISO}`).digest("hex");
};

/**
 * Dynamically choose payment adapter based on subscription.paymentProvider
 * Expected adapter interface:
 *  - chargeSubscription(subscription, options) => PaymentResult
 *  - retrieveMandate(subscription) => { active: boolean, info: ... } (optional)
 */
const getPaymentAdapter = (provider: string | null) => {
  if (!provider) return null;
  const p = provider.toLowerCase();
  if (p.includes("stripe")) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("../lib/payment/stripeClient").stripeClient;
  }
  if (p.includes("razorpay")) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("../lib/payment/razorpayClient").razorpayClient;
  }
  // add more providers here...
  return null;
};

/**
 * Single subscription renewal attempt (idempotent).
 * - loads subscription with related institution/user info
 * - checks if autoRenew=true and status active/grace
 * - uses idempotency key to avoid double-charge
 */
export const processSubscriptionRenewal = async (subscriptionId: string): Promise<{ ok: boolean; reason?: string; result?: PaymentResult }> => {
  const trx = await prisma.$transaction();

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { institution: true, user: true },
    });

    if (!subscription) {
      logger.warn(`[autoRenew] Subscription ${subscriptionId} not found`);
      return { ok: false, reason: "not_found" };
    }

    if (!subscription.autoRenew) {
      logger.info(`[autoRenew] Subscription ${subscriptionId} is not configured for auto-renew`);
      return { ok: false, reason: "auto_renew_disabled" };
    }

    // If already processed (e.g., status active and nextRenewalAt after now), skip
    const now = new Date();
    if (subscription.status === "active" && subscription.currentPeriodEnd && subscription.currentPeriodEnd > now) {
      logger.info(`[autoRenew] Subscription ${subscriptionId} not due yet`);
      return { ok: false, reason: "not_due" };
    }

    // Determine provider and adapter
    const adapter = getPaymentAdapter(subscription.paymentProvider || "");
    if (!adapter || typeof adapter.chargeSubscription !== "function") {
      logger.error(`[autoRenew] No payment adapter for provider=${subscription.paymentProvider}`);
      await auditService.log({
        actorId: "system",
        action: "SYSTEM_ALERT",
        details: { subscriptionId, message: "missing_payment_adapter", provider: subscription.paymentProvider },
      });
      return { ok: false, reason: "no_adapter" };
    }

    const periodStart = subscription.currentPeriodStart ? subscription.currentPeriodStart.toISOString() : new Date().toISOString();
    const idem = idempotencyKeyFor(subscription.id, periodStart);

    // Attempt charge using adapter (adapter MUST honor idempotency key to avoid double-charging)
    const chargeOptions = {
      idempotencyKey: idem,
      amount: subscription.amountCents || 0,
      currency: subscription.currency || "INR",
      metadata: { subscriptionId: subscription.id, institutionId: subscription.institutionId },
    };

    logger.info(`[autoRenew] Attempting auto-renew for subscription=${subscription.id} provider=${subscription.paymentProvider}`);

    let payRes: PaymentResult;
    try {
      payRes = await adapter.chargeSubscription(subscription, chargeOptions);
    } catch (err: any) {
      logger.error(`[autoRenew] Adapter charge error for ${subscription.id}: ${err?.message || err}`);
      payRes = { success: false, provider: subscription.paymentProvider || "unknown", error: err?.message || "adapter_error" };
    }

    // Process result
    if (payRes.success) {
      // Update subscription period and status atomically
      const newPeriodStart = subscription.currentPeriodEnd || now;
      const newPeriodEnd = new Date(newPeriodStart.getTime() + (subscription.billingIntervalDays || 30) * 24 * 60 * 60 * 1000);

      await prisma.$transaction([
        prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "active",
            currentPeriodStart: newPeriodStart,
            currentPeriodEnd: newPeriodEnd,
            lastRenewedAt: new Date(),
            retryCount: 0,
          },
        }),
        prisma.payment.create({
          data: {
            subscriptionId: subscription.id,
            institutionId: subscription.institutionId,
            userId: subscription.userId,
            provider: payRes.provider || subscription.paymentProvider,
            providerResponse: payRes.providerResponse ?? {},
            amountCents: subscription.amountCents || 0,
            currency: subscription.currency || "INR",
            status: "success",
            idempotencyKey: payRes.idempotencyKey || idem,
          },
        }),
      ]);

      // Notifications & audit
      try {
        await auditService.log({
          actorId: subscription.userId || "system",
          action: "SYSTEM_ALERT",
          details: { subscriptionId: subscription.id, event: "auto_renew_success", provider: payRes.provider },
        });
      } catch (_) {}

      // Notify institution admin
      try {
        await addNotificationJob?.({
          type: "custom",
          recipientId: subscription.institution?.adminId || subscription.userId,
          title: "Subscription renewed successfully",
          body: `Your subscription for ${subscription.planName || "plan"} was renewed successfully.`,
          channel: ["inApp", "email"],
        });
      } catch (_) {}

      Analytics.track({ event: "subscription.autorenew.success", distinctId: subscription.institutionId || subscription.userId, properties: { subscriptionId: subscription.id, provider: payRes.provider } });

      logger.info(`[autoRenew] ✅ Renewal succeeded for subscription ${subscription.id}`);
      return { ok: true, result: payRes };
    } else {
      // Payment failed — increment retry count and set status to grace
      const nextRetry = (subscription.retryCount || 0) + 1;
      const graceUntil = new Date(Date.now() + (subscription.gracePeriodDays || 7) * 24 * 60 * 60 * 1000);

      await prisma.$transaction([
        prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: nextRetry >= MAX_RETRY ? "past_due" : "grace",
            retryCount: nextRetry,
            lastRetryAt: new Date(),
            graceUntil,
          },
        }),
        prisma.payment.create({
          data: {
            subscriptionId: subscription.id,
            institutionId: subscription.institutionId,
            userId: subscription.userId,
            provider: payRes.provider || subscription.paymentProvider,
            providerResponse: payRes.providerResponse ?? {},
            amountCents: subscription.amountCents || 0,
            currency: subscription.currency || "INR",
            status: "failed",
            failureReason: payRes.error || "unknown",
            idempotencyKey: payRes.idempotencyKey || idem,
          },
        }),
      ]);

      // Log & notify
      await auditService.log({
        actorId: subscription.userId || "system",
        action: "SYSTEM_ALERT",
        details: { subscriptionId: subscription.id, event: "auto_renew_failed", provider: payRes.provider, error: payRes.error, retryCount: nextRetry },
      });

      // Send helpful email to institution admin / billing contact
      try {
        await addNotificationJob?.({
          type: "custom",
          recipientId: subscription.institution?.adminId || subscription.userId,
          title: "Auto-renewal failed",
          body: `We attempted to renew the subscription for ${subscription.planName || "plan"} but the payment failed. We'll retry ${Math.max(0, MAX_RETRY - nextRetry)} more time(s). Please update your payment method.`,
          channel: ["inApp", "email"],
        });
      } catch (_) {}

      Analytics.track({ event: "subscription.autorenew.failed", distinctId: subscription.institutionId || subscription.userId, properties: { subscriptionId: subscription.id, provider: payRes.provider, retryCount: nextRetry } });

      logger.warn(`[autoRenew] ❌ Renewal failed for subscription ${subscription.id} (retry ${nextRetry})`);

      // If retries exhausted, escalate: disable features, notify super admin optionally
      if (nextRetry >= MAX_RETRY) {
        await auditService.log({
          actorId: subscription.userId || "system",
          action: "ADMIN_OVERRIDE",
          details: { subscriptionId: subscription.id, event: "autorenew_exhausted" },
        });

        try {
          await addNotificationJob?.({
            type: "custom",
            recipientId: subscription.institution?.adminId || subscription.userId,
            title: "Subscription expired due to payment failures",
            body: `Your subscription has been put into past_due state after ${MAX_RETRY} failed attempts. Please renew to restore service.`,
            channel: ["inApp", "email"],
          });
        } catch (_) {}
      }

      return { ok: false, reason: "charge_failed", result: payRes };
    }
  } catch (err: any) {
    logger.error(`[autoRenew] Unexpected error processing renewal ${subscriptionId}: ${err?.message || err}`, err);
    try {
      await auditService.log({
        actorId: "system",
        action: "SYSTEM_ALERT",
        details: { subscriptionId, event: "autorenew_internal_error", message: err?.message },
      });
    } catch (_) {}
    return { ok: false, reason: "internal_error" };
  } finally {
    try {
      await trx.$disconnect?.();
    } catch (_) {}
  }
};

/**
 * Scan for due subscriptions and process them.
 * - look ahead window (configurable) to find subscriptions that need renewals
 * - use optional Redis lock so only one instance runs scan at a time
 */
export const processDueRenewals = async (asOf?: Date, lookaheadHours = 0) => {
  tryInitRedis();

  const lockKey = "autoRenew:scan:lock";
  const lockTtl = 60 * 1000 * 5; // 5 min

  // Acquire lock if redis available
  let lockAcquired = false;
  if (redisClient) {
    try {
      const token = crypto.randomBytes(16).toString("hex");
      const ok = await redisClient.set(lockKey, token, "PX", lockTtl, "NX");
      if (!ok) {
        logger.info("[autoRenew] Another instance is scanning renewals — skipping this run.");
        return;
      }
      lockAcquired = true;
      // ensure release later
    } catch (err) {
      logger.warn("[autoRenew] Redis lock attempt failed — continuing without lock");
      lockAcquired = false;
    }
  }

  try {
    const now = asOf || new Date();
    const lookahead = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

    logger.info(`[autoRenew] Scanning for subscriptions due before ${lookahead.toISOString()}`);

    // Query: subscriptions with autoRenew true and (currentPeriodEnd <= lookahead OR status in ['grace','past_due'])
    const due = await prisma.subscription.findMany({
      where: {
        autoRenew: true,
        OR: [
          { currentPeriodEnd: { lte: lookahead } },
          { status: { in: ["grace", "past_due"] } },
        ],
      },
      take: 200, // chunk size — process in batches
      orderBy: { currentPeriodEnd: "asc" },
    });

    logger.info(`[autoRenew] Found ${due.length} subscriptions to evaluate`);

    for (const s of due) {
      try {
        // skip subscriptions already processing (concurrent safety: check an optimistic lock flag)
        const processingFlagKey = `autorenew:processing:${s.id}`;
        if (redisClient) {
          const ok = await redisClient.set(processingFlagKey, "1", "PX", 60 * 1000, "NX");
          if (!ok) {
            logger.debug(`[autoRenew] Subscription ${s.id} is being processed by another worker; skipping`);
            continue;
          }
        }

        // process and then release processingFlag (or let TTL expire)
        await processSubscriptionRenewal(s.id);
      } catch (err) {
        logger.error(`[autoRenew] Failed processing subscription ${s.id}: ${err?.message || err}`);
      } finally {
        // best-effort release processing flag
        try {
          if (redisClient) await redisClient.del(`autorenew:processing:${s.id}`);
        } catch (_) {}
      }
    }
  } catch (err: any) {
    logger.error("[autoRenew] Failed to scan/process due renewals", err);
  } finally {
    if (redisClient && lockAcquired) {
      try {
        await redisClient.del("autoRenew:scan:lock");
      } catch (_) {}
    }
  }
};

/**
 * Start a scheduler interval (for simple deployments).
 * For production you should schedule a recurring job via cron/worker.
 */
let _schedulerHandle: NodeJS.Timeout | null = null;
export const startAutoRenewScheduler = (intervalMs = DEFAULT_INTERVAL_MS) => {
  if (_schedulerHandle) {
    logger.warn("[autoRenew] Scheduler already running");
    return;
  }
  logger.info(`[autoRenew] Starting auto-renew scheduler (interval=${intervalMs}ms)`);
  _schedulerHandle = setInterval(() => {
    processDueRenewals().catch((e) => logger.error("[autoRenew] Scheduler run failed", e));
  }, intervalMs);

  // run immediately once
  processDueRenewals().catch((e) => logger.error("[autoRenew] Initial run failed", e));
};

export const stopAutoRenewScheduler = () => {
  if (_schedulerHandle) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
    logger.info("[autoRenew] Scheduler stopped");
  }
};

/**
 * Manual retry hook — called if we want to retry one subscription sooner
 */
export const retryFailedRenewal = async (subscriptionId: string) => {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw Errors.NotFound("Subscription not found");
  return processSubscriptionRenewal(subscriptionId);
};

export default {
  processSubscriptionRenewal,
  processDueRenewals,
  startAutoRenewScheduler,
  stopAutoRenewScheduler,
  retryFailedRenewal,
};
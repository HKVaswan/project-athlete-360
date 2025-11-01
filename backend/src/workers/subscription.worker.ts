/**
 * src/workers/subscription.worker.ts
 * --------------------------------------------------------------------------
 * 🧠 Enterprise Subscription Lifecycle Worker
 *
 * Responsibilities:
 *  - Automatically checks all active subscriptions daily/hourly
 *  - Handles plan expirations (downgrade → free / deactivate)
 *  - Initiates auto-renewals for recurring payments
 *  - Sends expiry and renewal reminder notifications
 *  - Notifies SuperAdmin when an institution's subscription fails or expires
 *
 * Implementation:
 *  - Should run as a background cron worker (every 6–12 hours)
 *  - Uses Prisma for database access and calls internal services:
 *      - subscription.service
 *      - billing.service
 *      - superAdminAlerts.service
 *  - Safe retry logic with logging
 * --------------------------------------------------------------------------
 */

import prisma from "../prismaClient";
import { logger } from "../logger";
import { subscriptionService } from "../services/subscription.service";
import { billingService } from "../services/billing.service";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { planRepository } from "../repositories/plan.repo";
import { subscriptionRepository } from "../repositories/subscription.repo";
import { paymentRepository } from "../repositories/payment.repo";

const RENEWAL_REMINDER_DAYS = 5; // notify institutions 5 days before expiry
const CRON_INTERVAL_HOURS = 6;   // how often this worker should run

export class SubscriptionWorker {
  /**
   * Entry point for worker — safe loop with logging and protection.
   */
  async run(): Promise<void> {
    logger.info("🚀 [SubscriptionWorker] Starting subscription lifecycle check...");

    try {
      // 1️⃣ Get all active or expiring subscriptions
      const subscriptions = await subscriptionRepository.findExpiringWithinDays(RENEWAL_REMINDER_DAYS);

      logger.info(`[SubscriptionWorker] Found ${subscriptions.length} subscriptions for processing.`);

      for (const sub of subscriptions) {
        try {
          await this.processSubscription(sub.id);
        } catch (err: any) {
          logger.error(`[SubscriptionWorker] Error processing subscription ${sub.id}`, err);
          await superAdminAlertsService.createAlert({
            level: "error",
            title: "Subscription Processing Error",
            message: `Subscription ${sub.id} encountered an error: ${err?.message || err}`,
            tags: ["worker", "subscription"],
          });
        }
      }

      logger.info("✅ [SubscriptionWorker] Processing cycle complete.");
    } catch (err: any) {
      logger.error("[SubscriptionWorker] Fatal worker error", err);
      await superAdminAlertsService.createAlert({
        level: "critical",
        title: "Subscription Worker Failure",
        message: `Fatal worker error: ${err?.message || err}`,
        tags: ["system", "subscription"],
      });
    }
  }

  /**
   * Process a single subscription record.
   */
  private async processSubscription(subscriptionId: string): Promise<void> {
    const subscription = await subscriptionRepository.getSubscriptionById(subscriptionId);
    if (!subscription) {
      logger.warn(`[SubscriptionWorker] Subscription ${subscriptionId} not found.`);
      return;
    }

    const plan = await planRepository.getPlanById(subscription.planId);
    if (!plan) {
      logger.error(`[SubscriptionWorker] Missing plan for subscription ${subscriptionId}.`);
      return;
    }

    const now = new Date();
    const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;
    const daysRemaining = expiresAt
      ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // 🔔 Send reminder if near expiry
    if (daysRemaining !== null && daysRemaining <= RENEWAL_REMINDER_DAYS && !subscription.reminderSent) {
      await this.sendReminder(subscription);
    }

    // ⌛ Handle expired subscriptions
    if (expiresAt && expiresAt <= now) {
      await this.handleExpiredSubscription(subscription);
    }

    // 🔁 Handle auto-renewal
    if (subscription.autoRenew && expiresAt && daysRemaining !== null && daysRemaining <= 1) {
      await this.handleAutoRenew(subscription);
    }
  }

  /**
   * Send pre-expiry reminder notifications.
   */
  private async sendReminder(subscription: any): Promise<void> {
    try {
      const institution = await prisma.institution.findUnique({
        where: { id: subscription.institutionId },
      });

      if (!institution) return;

      logger.info(`[SubscriptionWorker] Sending renewal reminder to ${institution.name}`);

      await superAdminAlertsService.createAlert({
        level: "info",
        title: "Subscription Renewal Reminder",
        message: `Institution "${institution.name}" has a subscription expiring on ${subscription.expiresAt}.`,
        tags: ["subscription", "reminder"],
      });

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { reminderSent: true },
      });
    } catch (err) {
      logger.error("[SubscriptionWorker] Failed to send reminder", err);
    }
  }

  /**
   * Handle expired subscription:
   * - Auto-downgrade to Free Tier
   * - Suspend institution access (if no Free Tier available)
   * - Notify SuperAdmin
   */
  private async handleExpiredSubscription(subscription: any): Promise<void> {
    try {
      const institution = await prisma.institution.findUnique({
        where: { id: subscription.institutionId },
      });

      if (!institution) return;

      logger.warn(`[SubscriptionWorker] Subscription expired for ${institution.name}`);

      // Attempt downgrade to free plan
      const freePlan = await planRepository.getFreeTierPlan();
      if (freePlan) {
        await subscriptionService.assignPlan(institution.id, freePlan.id);
        logger.info(`[SubscriptionWorker] Downgraded ${institution.name} to Free Tier plan.`);
      } else {
        await prisma.institution.update({
          where: { id: institution.id },
          data: { status: "suspended" },
        });
        logger.warn(`[SubscriptionWorker] Suspended institution ${institution.name} — no Free Tier available.`);
      }

      await superAdminAlertsService.createAlert({
        level: "warning",
        title: "Subscription Expired",
        message: `Institution "${institution.name}" subscription expired and was downgraded/suspended.`,
        tags: ["subscription", "expiration"],
      });
    } catch (err) {
      logger.error("[SubscriptionWorker] Failed to handle expired subscription", err);
    }
  }

  /**
   * Handle automatic renewal attempts for subscriptions.
   * - Uses billingService to charge the saved payment method
   * - On success → extend plan
   * - On failure → send alert + mark as "renewal_failed"
   */
  private async handleAutoRenew(subscription: any): Promise<void> {
    try {
      const institution = await prisma.institution.findUnique({
        where: { id: subscription.institutionId },
      });
      if (!institution) return;

      const plan = await planRepository.getPlanById(subscription.planId);
      if (!plan) return;

      logger.info(`[SubscriptionWorker] Attempting auto-renewal for ${institution.name}`);

      const payment = await billingService.chargeInstitution({
        institutionId: institution.id,
        amount: plan.price,
        currency: plan.currency,
        description: `Auto-renewal for ${plan.name}`,
      });

      if (payment && payment.status === "succeeded") {
        await subscriptionService.renewSubscription(subscription.id);
        logger.info(`[SubscriptionWorker] Auto-renewed subscription for ${institution.name}`);
      } else {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "renewal_failed" },
        });

        await superAdminAlertsService.createAlert({
          level: "error",
          title: "Subscription Renewal Failed",
          message: `Auto-renewal failed for institution "${institution.name}". Manual intervention may be required.`,
          tags: ["subscription", "renewal"],
        });
      }
    } catch (err) {
      logger.error("[SubscriptionWorker] Auto-renewal failure", err);
    }
  }
}

// Export singleton
export const subscriptionWorker = new SubscriptionWorker();

// Optional: run immediately if invoked directly (standalone worker)
if (require.main === module) {
  (async () => {
    logger.info("🕒 Running SubscriptionWorker standalone execution...");
    const worker = new SubscriptionWorker();
    await worker.run();
    logger.info("✅ SubscriptionWorker completed successfully.");
    process.exit(0);
  })();
}
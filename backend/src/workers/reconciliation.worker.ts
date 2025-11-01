/**
 * src/workers/reconciliation.worker.ts
 * --------------------------------------------------------------------------
 * 🧾 Enterprise Payment Reconciliation Worker
 *
 * Responsibilities:
 *  - Periodically validate subscription payment records
 *  - Cross-check internal DB with external payment providers (Stripe/Razorpay)
 *  - Detect and flag mismatches, failed or missing invoices
 *  - Auto-suspend overdue accounts (grace period applied)
 *  - Notify SuperAdmin about anomalies
 *  - Full audit logging for compliance
 *
 * Frequency: Runs daily (or every few hours in high-volume setups)
 * --------------------------------------------------------------------------
 */

import { logger } from "../logger";
import { reconciliationService } from "../services/reconciliation.service";
import { billingService } from "../services/billing.service";
import { subscriptionService } from "../services/subscription.service";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import prisma from "../prismaClient";

const GRACE_PERIOD_DAYS = 5; // Institutions have 5 days to fix failed payments

export class ReconciliationWorker {
  /**
   * Run the full reconciliation process.
   */
  async run(): Promise<void> {
    logger.info("🚀 [ReconciliationWorker] Starting daily reconciliation cycle...");

    try {
      // Step 1: Fetch all active and pending subscriptions
      const subscriptions = await prisma.subscription.findMany({
        where: {
          status: { in: ["active", "pending_payment", "overdue"] },
        },
        include: {
          institution: { select: { id: true, name: true } },
          plan: { select: { id: true, name: true, priceMonthly: true } },
        },
      });

      logger.info(`[ReconciliationWorker] Found ${subscriptions.length} subscriptions to check.`);

      for (const sub of subscriptions) {
        try {
          await this.verifySubscription(sub);
        } catch (err: any) {
          logger.error(`[ReconciliationWorker] Subscription check failed for ${sub.id}`, err);
          await superAdminAlertsService.createAlert({
            level: "error",
            title: "Reconciliation Error",
            message: `Subscription ${sub.id} for ${sub.institution.name} failed verification: ${err?.message || err}`,
            tags: ["reconciliation", "billing"],
          });
        }
      }

      logger.info("✅ [ReconciliationWorker] Reconciliation cycle completed successfully.");
    } catch (err: any) {
      logger.error("[ReconciliationWorker] Fatal error in reconciliation cycle", err);
      await superAdminAlertsService.createAlert({
        level: "critical",
        title: "Reconciliation Worker Failure",
        message: `Fatal reconciliation worker error: ${err?.message || err}`,
        tags: ["system", "billing"],
      });
    }
  }

  /**
   * Verify and reconcile one subscription record.
   */
  private async verifySubscription(subscription: any): Promise<void> {
    const { id, externalPaymentId, paymentGateway, status, institution } = subscription;

    const gatewayRecord = await reconciliationService.fetchGatewayTransaction(paymentGateway, externalPaymentId);

    if (!gatewayRecord) {
      logger.warn(`[ReconciliationWorker] Missing gateway record for ${institution.name} (${id})`);
      await this.flagAnomaly(subscription, "missing_gateway_record");
      return;
    }

    if (gatewayRecord.status === "paid" && status === "pending_payment") {
      // ✅ Payment succeeded externally but not updated internally — fix it
      await billingService.markPaymentAsComplete(id, gatewayRecord.amount, gatewayRecord.transactionDate);
      logger.info(`[ReconciliationWorker] Fixed stale payment for ${institution.name}`);
      return;
    }

    if (gatewayRecord.status === "failed" && status === "active") {
      // ⚠️ External payment failed — mark overdue
      await subscriptionService.markOverdue(id);
      await this.handleOverdue(subscription);
      return;
    }

    if (status === "overdue" && this.isPastGracePeriod(subscription.updatedAt)) {
      // ⛔ Grace period expired — auto-suspend
      await this.suspendInstitution(subscription);
    }
  }

  /**
   * Handles overdue subscriptions (grace period starts).
   */
  private async handleOverdue(subscription: any): Promise<void> {
    const { institution } = subscription;

    await superAdminAlertsService.createAlert({
      level: "warning",
      title: "Subscription Payment Failed",
      message: `Payment failure detected for institution "${institution.name}". Grace period started.`,
      institutionId: institution.id,
      tags: ["subscription", "payment"],
    });

    logger.warn(`[ReconciliationWorker] ${institution.name} payment failed — grace period started.`);
  }

  /**
   * Suspends an institution after grace period ends.
   */
  private async suspendInstitution(subscription: any): Promise<void> {
    const { institution } = subscription;

    await prisma.institution.update({
      where: { id: institution.id },
      data: { status: "suspended" },
    });

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "suspended" },
    });

    await superAdminAlertsService.createAlert({
      level: "critical",
      title: "Institution Suspended (Non-Payment)",
      message: `Institution "${institution.name}" was automatically suspended after payment grace period expired.`,
      institutionId: institution.id,
      tags: ["billing", "compliance"],
    });

    logger.error(`[ReconciliationWorker] Institution ${institution.name} suspended for non-payment.`);
  }

  /**
   * Detect if a subscription exceeded its grace period.
   */
  private isPastGracePeriod(updatedAt: Date): boolean {
    const diffDays = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > GRACE_PERIOD_DAYS;
  }

  /**
   * Log anomaly and alert super admin.
   */
  private async flagAnomaly(subscription: any, anomalyType: string): Promise<void> {
    const { institution } = subscription;

    await prisma.reconciliationIssue.create({
      data: {
        subscriptionId: subscription.id,
        institutionId: institution.id,
        type: anomalyType,
        resolved: false,
      },
    });

    await superAdminAlertsService.createAlert({
      level: "warning",
      title: "Payment Record Mismatch",
      message: `Anomaly detected for institution "${institution.name}" — ${anomalyType.replace(/_/g, " ")}.`,
      institutionId: institution.id,
      tags: ["reconciliation", "anomaly"],
    });
  }
}

// Export singleton
export const reconciliationWorker = new ReconciliationWorker();

// Optional direct run (via cron)
if (require.main === module) {
  (async () => {
    logger.info("🧾 Running ReconciliationWorker standalone...");
    const worker = new ReconciliationWorker();
    await worker.run();
    logger.info("✅ ReconciliationWorker finished.");
    process.exit(0);
  })();
}
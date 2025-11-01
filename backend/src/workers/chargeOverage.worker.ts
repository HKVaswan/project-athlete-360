/**
 * src/workers/chargeOverage.worker.ts
 * --------------------------------------------------------------------------
 * 💰 Overage Charge & Limit Enforcement Worker
 *
 * Responsibilities:
 *  - Periodically check all institutions' usage metrics (athletes, coaches, storage, etc.)
 *  - Detect if they exceeded plan limits
 *  - Automatically calculate and charge overage fees OR suspend services
 *  - Notify institution admins and Super Admin
 *  - Maintain audit trail for compliance and transparency
 *
 * Frequency: Runs every few hours or daily depending on system scale.
 * --------------------------------------------------------------------------
 */

import { logger } from "../logger";
import prisma from "../prismaClient";
import { quotaService } from "../services/quota.service";
import { billingService } from "../services/billing.service";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { subscriptionService } from "../services/subscription.service";
import { planService } from "../services/plans.service";

const OVERAGE_RATE_PER_GB = 0.8; // USD (or INR equivalent) per GB above limit
const OVERAGE_RATE_PER_ATHLETE = 0.5; // USD/INR per athlete above limit
const OVERAGE_RATE_PER_VIDEO = 0.2; // per video above limit

export class ChargeOverageWorker {
  /**
   * Run overage check and billing cycle
   */
  async run(): Promise<void> {
    logger.info("🚀 [ChargeOverageWorker] Starting overage detection and charge cycle...");

    try {
      const activeSubscriptions = await prisma.subscription.findMany({
        where: { status: "active" },
        include: {
          institution: { select: { id: true, name: true, adminId: true } },
          plan: { select: { id: true, name: true, storageLimitGB: true, athleteLimit: true, videoLimit: true } },
        },
      });

      logger.info(`[ChargeOverageWorker] Found ${activeSubscriptions.length} active institutions.`);

      for (const sub of activeSubscriptions) {
        try {
          await this.handleInstitution(sub);
        } catch (err: any) {
          logger.error(`[ChargeOverageWorker] Failed processing ${sub.institution.name}: ${err.message}`);
          await superAdminAlertsService.createAlert({
            level: "error",
            title: "Overage Billing Error",
            message: `Error handling overage for ${sub.institution.name}: ${err.message}`,
            tags: ["overage", "billing"],
          });
        }
      }

      logger.info("✅ [ChargeOverageWorker] Overage check completed successfully.");
    } catch (err: any) {
      logger.error("[ChargeOverageWorker] Fatal system error:", err);
      await superAdminAlertsService.createAlert({
        level: "critical",
        title: "ChargeOverage Worker Crash",
        message: `Fatal overage worker error: ${err.message}`,
        tags: ["system", "billing"],
      });
    }
  }

  /**
   * Handle one institution's usage, detect overages, and bill accordingly.
   */
  private async handleInstitution(subscription: any): Promise<void> {
    const { institution, plan } = subscription;

    const usage = await quotaService.getInstitutionUsage(institution.id);
    if (!usage) {
      logger.warn(`[ChargeOverageWorker] No usage data found for ${institution.name}`);
      return;
    }

    const overages = this.detectOverages(usage, plan);

    if (Object.values(overages).every((v) => v <= 0)) {
      logger.info(`[ChargeOverageWorker] ${institution.name} is within limits.`);
      return;
    }

    const overageCost = this.calculateOverageCost(overages);
    if (overageCost <= 0) return;

    await billingService.createOverageCharge({
      institutionId: institution.id,
      amount: overageCost,
      details: overages,
    });

    await superAdminAlertsService.createAlert({
      level: "info",
      title: "Overage Detected",
      message: `Institution "${institution.name}" exceeded limits. Auto charge: $${overageCost}`,
      institutionId: institution.id,
      tags: ["overage", "billing"],
    });

    logger.info(`[ChargeOverageWorker] ${institution.name} charged $${overageCost.toFixed(2)} for overage.`);
  }

  /**
   * Detect overages by comparing usage vs plan limits.
   */
  private detectOverages(usage: any, plan: any) {
    const overStorage = Math.max(0, usage.storageUsedGB - plan.storageLimitGB);
    const overAthletes = Math.max(0, usage.athletesCount - plan.athleteLimit);
    const overVideos = Math.max(0, usage.videosCount - (plan.videoLimit || 0));

    return {
      storageGB: overStorage,
      athletes: overAthletes,
      videos: overVideos,
    };
  }

  /**
   * Calculate overage cost dynamically based on limits exceeded.
   */
  private calculateOverageCost(overages: { storageGB: number; athletes: number; videos: number }): number {
    const cost =
      overages.storageGB * OVERAGE_RATE_PER_GB +
      overages.athletes * OVERAGE_RATE_PER_ATHLETE +
      overages.videos * OVERAGE_RATE_PER_VIDEO;
    return parseFloat(cost.toFixed(2));
  }
}

// Export singleton worker
export const chargeOverageWorker = new ChargeOverageWorker();

// Allow direct standalone run for cron execution
if (require.main === module) {
  (async () => {
    logger.info("💰 Running ChargeOverageWorker standalone...");
    const worker = new ChargeOverageWorker();
    await worker.run();
    logger.info("✅ ChargeOverageWorker finished successfully.");
    process.exit(0);
  })();
}
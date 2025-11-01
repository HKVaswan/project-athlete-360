/**
 * src/workers/planMonitor.worker.ts
 * --------------------------------------------------------------------------
 * 🧩 Plan Monitor Worker (Enterprise Grade)
 *
 * Responsibilities:
 *  - Continuously enforce plan-based feature and quota limits.
 *  - Detect and correct any overuse or unauthorized activity.
 *  - Automatically downgrade privileges or suspend features
 *    when institutions exceed their plan limits.
 *  - Prevent data overload (athletes, videos, storage).
 *  - Syncs with quotaService & subscriptionService.
 *
 * Frequency: Every 3–6 hours (configurable via cron / scheduler)
 * --------------------------------------------------------------------------
 */

import { logger } from "../logger";
import prisma from "../prismaClient";
import { quotaService } from "../services/quota.service";
import { subscriptionService } from "../services/subscription.service";
import { notificationRepository } from "../repositories/notification.repo";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { emitSocketNotification } from "../lib/socket";

export class PlanMonitorWorker {
  async run(): Promise<void> {
    logger.info("[PlanMonitorWorker] 🚀 Starting plan usage enforcement...");

    try {
      const activeSubs = await prisma.subscription.findMany({
        where: { status: "active" },
        include: {
          plan: true,
          institution: { select: { id: true, name: true, adminId: true } },
        },
      });

      for (const sub of activeSubs) {
        try {
          await this.enforceInstitutionLimits(sub);
        } catch (err: any) {
          logger.error(`[PlanMonitorWorker] Failed for ${sub.institution.name}: ${err.message}`);
        }
      }

      logger.info("[PlanMonitorWorker] ✅ Plan enforcement cycle complete.");
    } catch (err: any) {
      logger.error("[PlanMonitorWorker] ❌ Fatal error during plan enforcement:", err);
      await superAdminAlertsService.createAlert({
        level: "critical",
        title: "Plan Monitor Failure",
        message: err.message,
        tags: ["system", "plan", "monitor"],
      });
    }
  }

  /**
   * Enforce usage limits for a single institution.
   */
  private async enforceInstitutionLimits(sub: any) {
    const { institution, plan } = sub;
    const usage = await quotaService.getInstitutionUsage(institution.id);
    if (!usage) return;

    const storagePercent = (usage.storageUsedGB / plan.storageLimitGB) * 100;
    const athletePercent = (usage.athletesCount / plan.athleteLimit) * 100;
    const videoPercent = (usage.videosCount / (plan.videoLimit || 1)) * 100;

    const exceeded =
      usage.storageUsedGB > plan.storageLimitGB ||
      usage.athletesCount > plan.athleteLimit ||
      usage.videosCount > (plan.videoLimit || 1);

    if (exceeded) {
      await this.handlePlanExceed(institution, plan, { storagePercent, athletePercent, videoPercent });
    } else if (storagePercent > 95 || athletePercent > 95 || videoPercent > 95) {
      await this.sendPreventionAlert(institution, plan, { storagePercent, athletePercent, videoPercent });
    }
  }

  /**
   * Handle institution exceeding its plan limits.
   * Temporarily disable new uploads, athlete linking, etc.
   */
  private async handlePlanExceed(
    institution: any,
    plan: any,
    usage: { storagePercent: number; athletePercent: number; videoPercent: number }
  ) {
    logger.warn(`[PlanMonitorWorker] ⚠️ Institution ${institution.name} exceeded plan limits.`);

    // 1. Suspend over-limit activity (temporary block)
    await prisma.institution.update({
      where: { id: institution.id },
      data: { suspended: true },
    });

    // 2. Notify institution admin
    const msg = `🚫 Your institution has exceeded its ${plan.name} plan limits.
Please upgrade your plan to continue using full features.`;

    await notificationRepository.create({
      userId: institution.adminId,
      type: "planLimitExceeded",
      title: "Plan Limit Reached",
      body: msg,
      meta: usage,
    });

    emitSocketNotification(institution.adminId, {
      title: "Plan Limit Reached",
      body: msg,
    });

    // 3. Notify Super Admin for monitoring
    await superAdminAlertsService.createAlert({
      level: "warning",
      title: "Institution Suspended for Plan Overuse",
      message: `${institution.name} exceeded ${plan.name} plan limits.`,
      tags: ["plan", "quota", "suspension"],
      details: usage,
    });
  }

  /**
   * Notify institutions nearing their plan limit.
   */
  private async sendPreventionAlert(
    institution: any,
    plan: any,
    usage: { storagePercent: number; athletePercent: number; videoPercent: number }
  ) {
    logger.info(`[PlanMonitorWorker] ⚠️ ${institution.name} nearing plan limits.`);

    const msg = `⚠️ You have used nearly all of your ${plan.name} plan resources.
Upgrade soon to prevent interruptions.`;

    await notificationRepository.create({
      userId: institution.adminId,
      type: "planWarning",
      title: "Plan Usage Warning",
      body: msg,
      meta: usage,
    });

    emitSocketNotification(institution.adminId, {
      title: "Plan Usage Warning",
      body: msg,
    });
  }
}

// Singleton instance export
export const planMonitorWorker = new PlanMonitorWorker();

// Optional CLI mode
if (require.main === module) {
  (async () => {
    logger.info("🔄 Running PlanMonitorWorker standalone...");
    const worker = new PlanMonitorWorker();
    await worker.run();
    process.exit(0);
  })();
}
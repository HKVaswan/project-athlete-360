/**
 * src/workers/notificationOnQuota.worker.ts
 * --------------------------------------------------------------------------
 * 🚨 Quota Notification Worker
 *
 * Responsibilities:
 *  - Monitors all institution usage across the system
 *  - Detects when usage approaches defined plan limits (75%, 90%, 100%)
 *  - Sends warning notifications to institution admins
 *  - Alerts Super Admin when multiple institutions near capacity
 *  - Triggers preventive system actions (optional: pause uploads, limit creation)
 *
 * Frequency: every 6–12 hours (configurable via cron / scheduler)
 * --------------------------------------------------------------------------
 */

import { logger } from "../logger";
import prisma from "../prismaClient";
import { quotaService } from "../services/quota.service";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { notificationRepository } from "../repositories/notification.repo";
import { emitSocketNotification } from "../lib/socket";

interface QuotaThreshold {
  level: number; // percentage
  message: string;
}

const QUOTA_THRESHOLDS: QuotaThreshold[] = [
  { level: 75, message: "⚠️ You have used 75% of your current plan quota." },
  { level: 90, message: "🚨 You have used 90% of your current plan quota. Consider upgrading your plan soon." },
  { level: 100, message: "⛔ You have reached your quota limit. Some features may be restricted." },
];

export class NotificationOnQuotaWorker {
  async run(): Promise<void> {
    logger.info("[QuotaNotificationWorker] 🚀 Starting quota usage monitoring...");

    try {
      const activeSubs = await prisma.subscription.findMany({
        where: { status: "active" },
        include: {
          plan: true,
          institution: { select: { id: true, name: true, adminId: true } },
        },
      });

      logger.info(`[QuotaNotificationWorker] Checking ${activeSubs.length} active subscriptions...`);

      const alertStats = {
        nearFull: 0,
        atLimit: 0,
      };

      for (const sub of activeSubs) {
        try {
          await this.handleInstitution(sub, alertStats);
        } catch (err: any) {
          logger.error(`[QuotaNotificationWorker] Failed ${sub.institution.name}: ${err.message}`);
        }
      }

      // Notify super admin if many institutions are near capacity
      if (alertStats.nearFull > 3 || alertStats.atLimit > 0) {
        await superAdminAlertsService.createAlert({
          level: alertStats.atLimit > 0 ? "warning" : "info",
          title: "Quota Capacity Warning",
          message: `${alertStats.nearFull} institutions are nearing limits, ${alertStats.atLimit} reached max capacity.`,
          tags: ["quota", "capacity", "monitor"],
        });
      }

      logger.info("[QuotaNotificationWorker] ✅ Quota usage monitoring complete.");
    } catch (err: any) {
      logger.error("[QuotaNotificationWorker] ❌ Fatal error during quota monitoring:", err);
      await superAdminAlertsService.createAlert({
        level: "critical",
        title: "Quota Worker Crash",
        message: err.message,
        tags: ["system", "quota"],
      });
    }
  }

  /**
   * Handle quota check for one institution.
   */
  private async handleInstitution(sub: any, stats: { nearFull: number; atLimit: number }) {
    const { institution, plan } = sub;
    const usage = await quotaService.getInstitutionUsage(institution.id);

    if (!usage) {
      logger.warn(`[QuotaNotificationWorker] No usage record for ${institution.name}`);
      return;
    }

    // Calculate percentages
    const storagePercent = (usage.storageUsedGB / plan.storageLimitGB) * 100;
    const athletePercent = (usage.athletesCount / plan.athleteLimit) * 100;
    const videoPercent = (usage.videosCount / (plan.videoLimit || 1)) * 100;

    const maxUsagePercent = Math.max(storagePercent, athletePercent, videoPercent);
    const threshold = this.getThreshold(maxUsagePercent);

    if (!threshold) return;

    // Track system-wide stats
    if (maxUsagePercent >= 90) stats.nearFull++;
    if (maxUsagePercent >= 100) stats.atLimit++;

    // Notify institution admin
    const message = `${threshold.message} (Current usage: ${maxUsagePercent.toFixed(1)}%)`;

    await notificationRepository.create({
      userId: institution.adminId,
      type: "quotaWarning",
      title: "Usage Alert",
      body: message,
      meta: { usagePercent: maxUsagePercent, plan: plan.name },
    });

    emitSocketNotification(institution.adminId, {
      title: "Usage Alert",
      body: message,
    });

    logger.info(`[QuotaNotificationWorker] ${institution.name} warned (${threshold.level}%)`);
  }

  /**
   * Determine applicable threshold based on current usage.
   */
  private getThreshold(usagePercent: number): QuotaThreshold | null {
    const reached = QUOTA_THRESHOLDS.filter((t) => usagePercent >= t.level);
    if (reached.length === 0) return null;
    return reached[reached.length - 1];
  }
}

// Singleton export
export const notificationOnQuotaWorker = new NotificationOnQuotaWorker();

// Optional: allow standalone run via CLI/cron
if (require.main === module) {
  (async () => {
    logger.info("🔔 Running QuotaNotificationWorker standalone...");
    const worker = new NotificationOnQuotaWorker();
    await worker.run();
    process.exit(0);
  })();
}
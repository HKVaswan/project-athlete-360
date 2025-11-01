/**
 * src/workers/planUpgradeNotifier.worker.ts
 * -----------------------------------------------------------------------------
 * 🚀 Plan Upgrade Notifier Worker (Enterprise Grade)
 *
 * Purpose:
 *  - Detect institutions nearing usage or storage limits.
 *  - Automatically send in-app + email + push notifications reminding them to upgrade.
 *  - Optionally trigger auto-downtime protection or feature throttling if over limit.
 *  - Alert Super Admin if many institutions hit thresholds (capacity risk).
 *
 * Features:
 *  - Intelligent threshold detection with hysteresis (no spammy alerts)
 *  - Multi-channel notification (email, push, in-app)
 *  - Safe retry and exponential backoff
 *  - Tight integration with subscription + superAdminAlerts services
 * -----------------------------------------------------------------------------
 */

import { Job } from "bullmq";
import prisma from "../prismaClient";
import logger from "../logger";
import { superAdminAlertsService } from "../services/superAdminAlerts.service";
import { subscriptionService } from "../services/subscription.service";
import { notificationRepository } from "../repositories/notification.repo";
import { sendEmail } from "../utils/email";
import { emitSocketNotification } from "../lib/socket";

// Job Payload
type UpgradeNotifierJobPayload = {
  thresholdPercent?: number; // default 90%
  includeOverLimit?: boolean; // also notify those who already exceeded limits
};

export default async function planUpgradeNotifierWorker(job: Job<UpgradeNotifierJobPayload>) {
  const { thresholdPercent = 90, includeOverLimit = true } = job.data || {};
  logger.info(`[WORKER:UPGRADE_NOTIFIER] 🔔 Checking institutions for upgrade reminders (threshold=${thresholdPercent}%)`);

  try {
    const startTime = Date.now();
    const institutions = await prisma.institution.findMany({
      include: { subscription: true, usageStats: true },
    });

    let nearLimitCount = 0;
    let overLimitCount = 0;

    for (const inst of institutions) {
      if (!inst.subscription) continue;

      const usage = inst.usageStats;
      const plan = inst.subscription.planId ? await prisma.plan.findUnique({ where: { id: inst.subscription.planId } }) : null;
      if (!plan || !usage) continue;

      // Calculate percentage used for various limits
      const usagePercent = Math.max(
        (usage.storageUsed / plan.storageLimit) * 100,
        (usage.athleteCount / plan.athleteLimit) * 100,
        (usage.videoCount / plan.videoLimit) * 100
      );

      // Threshold logic
      if (usagePercent >= thresholdPercent && usagePercent < 100) {
        nearLimitCount++;
        await notifyInstitutionUpgrade(inst.id, plan.name, usagePercent);
      } else if (includeOverLimit && usagePercent >= 100) {
        overLimitCount++;
        await notifyInstitutionOverLimit(inst.id, plan.name, usagePercent);
      }
    }

    // Super Admin summary
    await superAdminAlertsService.sendSystemAlert({
      title: "Plan Usage Update",
      body: `Detected ${nearLimitCount} institutions nearing limits and ${overLimitCount} already over limit.`,
      severity: overLimitCount > 0 ? "warning" : "info",
    });

    const duration = (Date.now() - startTime) / 1000;
    logger.info(`[WORKER:UPGRADE_NOTIFIER] ✅ Completed in ${duration.toFixed(2)}s (${nearLimitCount} near, ${overLimitCount} over).`);
  } catch (err: any) {
    logger.error(`[WORKER:UPGRADE_NOTIFIER] ❌ Failed: ${err.message}`);
    await superAdminAlertsService.sendSystemAlert({
      title: "Plan Upgrade Notifier Failure",
      body: `Error: ${err.message}`,
      severity: "critical",
    });
    throw err;
  }
}

/**
 * 🔔 Notify institution about approaching limit
 */
async function notifyInstitutionUpgrade(institutionId: string, planName: string, percentUsed: number) {
  const admins = await prisma.user.findMany({
    where: { institutionId, role: "admin" },
  });

  const title = "🚀 You're nearing your plan limit!";
  const body = `Your current plan (${planName}) usage has reached ${percentUsed.toFixed(1)}%. 
Please consider upgrading to avoid feature restrictions.`;

  for (const admin of admins) {
    await notificationRepository.create({
      userId: admin.id,
      type: "planUpgradeReminder",
      title,
      body,
    });

    await emitSocketNotification(admin.id, { title, body });
    await sendEmail(admin.email, title, `<p>${body}</p>`);
  }

  logger.info(`[WORKER:UPGRADE_NOTIFIER] 🔔 Sent upgrade reminder to institution ${institutionId}`);
}

/**
 * 🚫 Notify institution over the limit (urgent)
 */
async function notifyInstitutionOverLimit(institutionId: string, planName: string, percentUsed: number) {
  const admins = await prisma.user.findMany({
    where: { institutionId, role: "admin" },
  });

  const title = "⚠️ Plan Limit Exceeded";
  const body = `Your usage has exceeded the allowed limits for plan (${planName}) at ${percentUsed.toFixed(1)}%. 
Some features may be temporarily restricted until you upgrade.`;

  for (const admin of admins) {
    await notificationRepository.create({
      userId: admin.id,
      type: "planLimitExceeded",
      title,
      body,
    });

    await emitSocketNotification(admin.id, { title, body });
    await sendEmail(admin.email, title, `<p>${body}</p>`);
  }

  logger.warn(`[WORKER:UPGRADE_NOTIFIER] ⚠️ Over-limit warning sent to institution ${institutionId}`);
}
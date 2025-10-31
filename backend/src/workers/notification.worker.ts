/**
 * workers/notification.worker.ts
 * --------------------------------------------------------------------
 * Enterprise Notification Worker (Enhanced)
 *
 * Handles background notifications with:
 *  - Audit logs
 *  - Super admin escalation
 *  - Retry tracking and fault tolerance
 *  - Channel-based routing & monitoring
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { auditService } from "../lib/audit";
import { notificationRepository } from "../repositories/notification.repo";
import { sendEmail } from "../utils/email";
import { sendPushNotification } from "../lib/push";
import { emitSocketNotification } from "../lib/socket";
import prisma from "../prismaClient";

type NotificationJobPayload = {
  type: "sessionReminder" | "competitionUpdate" | "messageAlert" | "systemAlert" | "custom";
  recipientId: string;
  title: string;
  body: string;
  channel?: ("email" | "push" | "inApp")[];
  meta?: Record<string, any>;
  initiatedBy?: string; // admin/super_admin/system
};

export default async function (job: Job<NotificationJobPayload>) {
  const startTime = Date.now();
  const { type, recipientId, title, body, channel = ["inApp"], meta, initiatedBy } = job.data;

  logger.info(`[NOTIFICATION] 📩 Processing job ${job.id} → ${type} for user ${recipientId}`);

  await auditService.log({
    actorId: initiatedBy || "system",
    actorRole: initiatedBy ? "admin" : "system",
    action: "NOTIFICATION_DISPATCH_START",
    details: { type, recipientId, channels: channel, jobId: job.id },
  });

  try {
    // 1️⃣ Save notification in DB
    const saved = await notificationRepository.create({
      userId: recipientId,
      type,
      title,
      body,
      meta,
      status: "pending",
    });

    // 2️⃣ Dispatch through selected channels
    const results: { channel: string; success: boolean; error?: string }[] = [];

    if (channel.includes("inApp")) {
      try {
        await emitSocketNotification(recipientId, { title, body, meta });
        results.push({ channel: "inApp", success: true });
      } catch (err: any) {
        results.push({ channel: "inApp", success: false, error: err.message });
      }
    }

    if (channel.includes("push")) {
      try {
        await sendPushNotification(recipientId, { title, body });
        results.push({ channel: "push", success: true });
      } catch (err: any) {
        results.push({ channel: "push", success: false, error: err.message });
      }
    }

    if (channel.includes("email")) {
      try {
        await sendEmail(recipientId, title, `<p>${body}</p>`);
        results.push({ channel: "email", success: true });
      } catch (err: any) {
        results.push({ channel: "email", success: false, error: err.message });
      }
    }

    const failures = results.filter((r) => !r.success);
    const latencyMs = Date.now() - startTime;

    if (failures.length === 0) {
      await notificationRepository.markAsSent(saved.id);
      logger.info(`[NOTIFICATION] ✅ Job ${job.id} completed successfully.`);
    } else {
      await notificationRepository.markAsFailed(saved.id, failures.map(f => f.error).join(", "));
      logger.warn(`[NOTIFICATION] ⚠️ Partial/failed delivery for job ${job.id}`, failures);
    }

    await auditService.log({
      actorId: initiatedBy || "system",
      actorRole: initiatedBy ? "admin" : "system",
      action: "NOTIFICATION_DISPATCH_RESULT",
      details: { jobId: job.id, recipientId, results, latencyMs },
    });

    // 3️⃣ Escalate repeated failures to Super Admins
    if (failures.length > 0) {
      await handleFailureEscalation(type, failures, job.id);
    }
  } catch (err: any) {
    logger.error(`[NOTIFICATION] ❌ Fatal failure for job ${job.id}: ${err.message}`);

    await auditService.log({
      actorId: "system",
      actorRole: "system",
      action: "NOTIFICATION_DISPATCH_FAILURE",
      details: { jobId: job.id, error: err.message, stack: err.stack },
    });

    // Critical escalation for system-level issues
    await handleCriticalFailureAlert(err.message);
    throw Errors.Server("Notification job failed critically.");
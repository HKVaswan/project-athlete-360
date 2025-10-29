/**
 * workers/notification.worker.ts
 * --------------------------------------------------------------------
 * Enterprise Notification Worker
 *
 * Handles background processing for:
 *  - In-app notifications (database + websocket)
 *  - Push notifications (mobile/web)
 *  - Scheduled reminders (sessions, deadlines, events)
 *
 * Features:
 *  - Fault-tolerant with retries and exponential backoff
 *  - Modular channel system (email, in-app, push)
 *  - Extendable for WhatsApp/SMS in the future
 *  - Uses NotificationRepository for DB operations
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { notificationRepository } from "../repositories/notification.repo";
import { sendEmail } from "../utils/email";
import { sendPushNotification } from "../lib/push";
import { emitSocketNotification } from "../lib/socket";

type NotificationJobPayload = {
  type: "sessionReminder" | "competitionUpdate" | "messageAlert" | "custom";
  recipientId: string;
  title: string;
  body: string;
  channel?: ("email" | "push" | "inApp")[];
  meta?: Record<string, any>;
};

export default async function (job: Job<NotificationJobPayload>) {
  const { type, recipientId, title, body, channel = ["inApp"], meta } = job.data;

  logger.info(`[NOTIFICATION] 📩 Processing job ${job.id}: ${type} for user ${recipientId}`);

  try {
    // 1. Save notification in DB (always)
    const saved = await notificationRepository.create({
      userId: recipientId,
      type,
      title,
      body,
      meta,
      status: "pending",
    });

    // 2. Send notifications through requested channels
    const promises: Promise<any>[] = [];

    if (channel.includes("inApp")) {
      promises.push(emitSocketNotification(recipientId, { title, body, meta }));
    }

    if (channel.includes("push")) {
      promises.push(sendPushNotification(recipientId, { title, body }));
    }

    if (channel.includes("email")) {
      promises.push(sendEmail(recipientId, title, `<p>${body}</p>`));
    }

    await Promise.allSettled(promises);

    // 3. Mark as sent
    await notificationRepository.markAsSent(saved.id);
    logger.info(`[NOTIFICATION] ✅ Job ${job.id} completed successfully.`);
  } catch (err: any) {
    logger.error(`[NOTIFICATION] ❌ Failed job ${job.id}: ${err.message}`);
    throw Errors.Server("Notification job failed");
  }
}
/**
 * workers/sessionReminder.worker.ts
 * ---------------------------------------------------------------------
 * Session Reminder Worker
 *
 * Responsibilities:
 *  - Send session reminders to athletes and coaches.
 *  - Integrate with notification + email systems.
 *  - Run automatically via scheduler (BullMQ repeatable jobs).
 *
 * Features:
 *  - Graceful retry and backoff.
 *  - Logs, failure tracking, and extensibility for AI-based optimization.
 */

import { Job } from "bullmq";
import { logger } from "../logger";
import prisma from "../prismaClient";
import { notificationRepository } from "../repositories/notification.repo";
import { sendEmail } from "../utils/email";
import { emitSocketNotification } from "../lib/socket";

type SessionReminderPayload = {
  sessionId: string;
  reminderType?: "daily" | "hourly" | "custom";
};

export default async function (job: Job<SessionReminderPayload>) {
  const { sessionId, reminderType = "daily" } = job.data;

  logger.info(`[SESSION REMINDER] Processing reminder job for session ${sessionId}`);

  try {
    // Fetch session with participants
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        coach: { select: { id: true, name: true, email: true } },
        participants: {
          include: { athlete: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    if (!session) {
      logger.warn(`[SESSION REMINDER] Session ${sessionId} not found.`);
      return;
    }

    // Prepare notification content
    const title = `Upcoming Session: ${session.title}`;
    const body = `Hi! Your training session "${session.title}" is scheduled for ${new Date(
      session.startTime
    ).toLocaleString()}. Please be ready.`;

    const recipients = [
      ...(session.participants?.map((p) => p.athlete) || []),
      session.coach,
    ].filter(Boolean);

    // Send notifications to each recipient
    for (const recipient of recipients) {
      if (!recipient?.id) continue;

      await notificationRepository.create({
        userId: recipient.id,
        type: "sessionReminder",
        title,
        body,
        meta: { sessionId },
      });

      await Promise.allSettled([
        emitSocketNotification(recipient.id, { title, body }),
        sendEmail(recipient.email, title, `<p>${body}</p>`),
      ]);
    }

    logger.info(
      `[SESSION REMINDER] ✅ Sent reminders for session ${session.title} to ${recipients.length} users.`
    );
  } catch (err: any) {
    logger.error(`[SESSION REMINDER] ❌ Failed job ${job.id}: ${err.message}`);
    throw err;
  }
}
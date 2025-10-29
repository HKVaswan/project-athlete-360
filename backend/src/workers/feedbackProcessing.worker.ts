/**
 * workers/feedbackProcessing.worker.ts
 * -------------------------------------------------------------------------
 * Feedback Processing Worker (Enterprise-Grade)
 *
 * Responsibilities:
 *  - Process and analyze feedback from athletes and coaches.
 *  - Store structured metrics for performance tracking.
 *  - Generate automated reports and alerts (AI-ready).
 *
 * Features:
 *  - Fault-tolerant job processing.
 *  - AI integration-ready for sentiment and insights.
 *  - Modular to expand for survey analytics and feedback loops.
 */

import { Job } from "bullmq";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { emitSocketNotification } from "../lib/socket";
import { notificationRepository } from "../repositories/notification.repo";
import { sendEmail } from "../utils/email";

type FeedbackProcessingPayload = {
  feedbackId: string;
  type: "athlete" | "coach";
};

export default async function (job: Job<FeedbackProcessingPayload>) {
  const { feedbackId, type } = job.data;

  logger.info(`[FEEDBACK WORKER] Processing feedback job for ${type} feedback ID: ${feedbackId}`);

  try {
    // Fetch feedback with user and session details
    const feedback = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        session: { select: { id: true, title: true, coachId: true } },
      },
    });

    if (!feedback) {
      logger.warn(`[FEEDBACK WORKER] Feedback ${feedbackId} not found.`);
      return;
    }

    // Basic sentiment estimation (placeholder until AI integration)
    const sentiment =
      feedback.comment?.includes("good") || feedback.comment?.includes("great")
        ? "positive"
        : feedback.comment?.includes("bad") || feedback.comment?.includes("poor")
        ? "negative"
        : "neutral";

    // Update feedback with sentiment result
    await prisma.feedback.update({
      where: { id: feedbackId },
      data: { sentiment },
    });

    logger.info(`[FEEDBACK WORKER] ✅ Processed sentiment: ${sentiment}`);

    // Notify coach/admin if negative feedback detected
    if (sentiment === "negative") {
      const adminUsers = await prisma.user.findMany({
        where: { role: "admin" },
        select: { id: true, email: true },
      });

      for (const admin of adminUsers) {
        const title = `⚠️ Negative feedback detected`;
        const body = `Negative feedback received from ${feedback.user.name} on session "${feedback.session.title}".`;

        await notificationRepository.create({
          userId: admin.id,
          type: "feedbackAlert",
          title,
          body,
          meta: { feedbackId },
        });

        await Promise.allSettled([
          emitSocketNotification(admin.id, { title, body }),
          sendEmail(admin.email, title, `<p>${body}</p>`),
        ]);
      }
    }

    logger.info(`[FEEDBACK WORKER] Feedback ${feedbackId} processed successfully.`);
  } catch (err: any) {
    logger.error(`[FEEDBACK WORKER] ❌ Job ${job.id} failed: ${err.message}`);
    throw err;
  }
}